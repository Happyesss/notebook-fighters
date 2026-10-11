/**
 * Rapier2D (deterministic build) knockout ragdoll — plan §6.
 *
 * The drawing's ten bones become capsules (their thickness taken from the ink around each bone, so a
 * round head or a blob's belly rests on the floor), chained by revolute joints with soft angle limits.
 * The floor, the stage walls and the opponent's bones (kinematic capsules that follow the winner's
 * pose every frame) are colliders, so a KO'd body can be flung into the victor and slump against it.
 *
 * The deterministic build gives bit-identical results on every platform, so the lockstep netcode
 * keeps both clients in sync through a KO. It only runs after a knockout; the fight itself is still
 * the hand-written sim (the authority).
 */
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import type { Pt } from "@nf/shared";
import { BONES, J, JOINTS } from "./rig";

type R = typeof RAPIER;
let R: R | null = null;
let loading: Promise<boolean> | null = null;

/** load the WASM once (async); afterwards ragdolls can be built synchronously inside step() */
export function loadPhysics(): Promise<boolean> {
  if (R) return Promise.resolve(true);
  loading ??= RAPIER.init()
    .then(() => {
      R = RAPIER;
      return true;
    })
    .catch(() => false);
  return loading;
}
export const physicsReady = () => !!R;
export const physicsVersion = () => (R ? R.version() : null);

const TORSO = 0;
const HEAD = 1;
/** joint → [bone, which end (0 = from, 1 = to)] for joints that sit on a bone end */
const END_OF: Record<number, [number, 0 | 1]> = {
  [J.pelvis]: [TORSO, 0],
  [J.chest]: [TORSO, 1],
  [J.crown]: [HEAD, 1],
  [J.elbowB]: [2, 1],
  [J.handB]: [3, 1],
  [J.elbowF]: [4, 1],
  [J.handF]: [5, 1],
  [J.kneeB]: [6, 1],
  [J.footB]: [7, 1],
  [J.kneeF]: [8, 1],
  [J.footF]: [9, 1],
};
/** shoulders and hips ride on the torso */
const ON_TORSO = [J.shB, J.shF, J.hipB, J.hipF];
/** child bone, parent bone, the joint they share, soft limit half-range (rad) */
const LINKS: [number, number, number, number][] = [
  [HEAD, TORSO, J.chest, 0.6],
  [2, TORSO, J.shB, 2.6],
  [3, 2, J.elbowB, 1.5],
  [4, TORSO, J.shF, 2.6],
  [5, 4, J.elbowF, 1.5],
  [6, TORSO, J.hipB, 1.3],
  [7, 6, J.kneeB, 1.3],
  [8, TORSO, J.hipF, 1.3],
  [9, 8, J.kneeF, 1.3],
];
/** top of the floor collider: ink (drawn ~0.02 thick) then rests on the drawn ground line */
const FLOOR = 0.002;
const RAGDOLL = 0x0001_0002; // member of group 1, collides with group 2
const SCENERY = 0x0002_0001; // member of group 2, collides with group 1

type Body = InstanceType<R["RigidBody"]>;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class RapierRagdoll {
  p: Pt[];
  settled = 0;
  /** (unused: the colliders carry the ink's thickness) kept so the animator treats both ragdolls alike */
  clear: number[];
  private world: InstanceType<R["World"]>;
  private bodies: Body[] = [];
  private half: number[] = [];
  private torsoLocal: Pt[] = [];
  private foe: { body: Body; half: number }[] = [];
  freed = false;
  private age = 0;
  private calmed = 0;
  private moving = 1;
  private initTop: number;
  private wallX: [number, number];
  private foeOn = true;
  private endOf: [number, [number, 0 | 1]][];
  private onTorso: number[];

  /**
   * @param joints  pose at the blow (fighter-local, x forward, y up)
   * @param vel     per-joint velocity (figure heights / s), blow included
   * @param ink     the drawing's skinned ink points (fighter-local) and the bone each is skinned to
   *                 (-1 / an aux bone ⇒ the nearest) → bone thickness and feelers
   * @param walls   stage walls in fighter-local x
   */
  constructor(joints: Pt[], vel: Pt[], ink: { q: Pt; bone: number }[], dt: number, gravity: number, walls: [number, number]) {
    const r = R!;
    this.p = joints.map((q) => ({ ...q }));
    this.clear = joints.map(() => 0);
    this.initTop = Math.max(...joints.map((q) => q.y));
    this.world = new r.World({ x: 0, y: -gravity * 0.32 });
    this.world.timestep = dt;
    // follower chains (a beast's front legs, extra arms) get their own two bones each when the
    // joints come extended (rig.extendedJoints: root, mid, end per chain after the 15 joints)
    const nAux = Math.max(0, Math.floor((joints.length - JOINTS.length) / 3));
    const bones: [number, number][] = BONES.map(([a, b]) => [a, b]);
    const links = LINKS.slice();
    this.endOf = Object.entries(END_OF).map(([j, e]) => [+j, e]);
    this.onTorso = ON_TORSO.slice();
    const tv = { x: (vel[J.pelvis].x + vel[J.chest].x) / 2, y: (vel[J.pelvis].y + vel[J.chest].y) / 2 };
    vel = joints.map((_, i) => vel[i] ?? tv);
    for (let k = 0; k < nAux; k++) {
      const base = JOINTS.length + k * 3;
      const up = bones.length;
      bones.push([base, base + 1], [base + 1, base + 2]);
      links.push([up, TORSO, base, 1.3], [up + 1, up, base + 1, 1.3]);
      this.endOf.push([base + 1, [up, 1]], [base + 2, [up + 1, 1]]);
      this.onTorso.push(base);
    }
    // bone thickness from the ink nearest to it (round heads, bellies), clamped
    const thick = bones.map(() => 0.014);
    const owned: { q: Pt; d: number }[][] = bones.map(() => []);
    for (const { q, bone } of ink) {
      // a follower chain's ink without its own bodies (not extended) would act as stiff stilts on the trunk
      if (bone >= bones.length) continue;
      let best = 0;
      let bd = Infinity;
      if (bone >= 0) {
        best = bone;
        bd = segDist(q, joints[bones[bone][0]], joints[bones[bone][1]]);
      } else
        bones.forEach(([a, b], i) => {
          const d = segDist(q, joints[a], joints[b]);
          if (d < bd) {
            bd = d;
            best = i;
          }
        });
      owned[best].push({ q, d: bd });
      if (bd < 0.4) thick[best] = Math.max(thick[best], bd * 0.95);
    }
    // scenery: floor, two walls
    const fixed = this.world.createRigidBody(r.RigidBodyDesc.fixed());
    const scen = (d: InstanceType<R["ColliderDesc"]>) => this.world.createCollider(d.setCollisionGroups(SCENERY).setFriction(0.9).setRestitution(0.12), fixed);
    scen(r.ColliderDesc.cuboid(40, 1).setTranslation(0, -1 + FLOOR));
    const [w0, w1] = walls[0] < walls[1] ? walls : [walls[1], walls[0]];
    this.wallX = [w0, w1];
    // slick walls: a body propped against one slides down instead of leaning there forever
    for (const x of [w0 - 0.5, w1 + 0.5]) {
      const wall = scen(r.ColliderDesc.cuboid(0.5, 20).setTranslation(x, 10));
      wall.setFriction(0.05);
      wall.setFrictionCombineRule(r.CoefficientCombineRule.Min);
    }
    // bones
    bones.forEach(([a, b], i) => {
      const A = joints[a];
      const B = joints[b];
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const L = Math.hypot(dx, dy);
      const ang = L > 1e-4 ? Math.atan2(dy, dx) - Math.PI / 2 : 0;
      const rad = Math.min(i === HEAD ? 0.3 : 0.22, thick[i]);
      const h = Math.max(0.002, L / 2);
      const va = vel[a];
      const vb = vel[b];
      const w = L > 1e-4 ? (dx * (vb.y - va.y) - dy * (vb.x - va.x)) / (L * L) : 0;
      const body = this.world.createRigidBody(
        r.RigidBodyDesc.dynamic()
          .setTranslation((A.x + B.x) / 2, (A.y + B.y) / 2)
          .setRotation(ang)
          .setLinvel((va.x + vb.x) / 2, (va.y + vb.y) / 2)
          .setAngvel(Math.max(-30, Math.min(30, w)))
          .setLinearDamping(0.5)
          .setAngularDamping(1.2)
          .setCcdEnabled(true),
      );
      // the torso is the heavy part, limbs light (a stick figure's mass is mostly its trunk)
      const density = i === TORSO ? 4 : i === HEAD ? 2 : 1;
      this.world.createCollider(r.ColliderDesc.capsule(h, Math.max(0.012, rad)).setDensity(density).setFriction(0.85).setRestitution(0.08).setCollisionGroups(RAGDOLL), body);
      // ink that sticks out past the capsule (a sword, a tail, a doodle) gets little feeler balls
      const cap = Math.max(0.012, rad);
      const far = owned[i].filter((o) => o.d > cap + 0.015).sort((x, y) => y.d - x.d);
      const picked: Pt[] = [];
      for (const o of far) {
        if (picked.length >= 8) break;
        if (picked.every((p) => Math.hypot(p.x - o.q.x, p.y - o.q.y) > 0.08)) picked.push(o.q);
      }
      for (const q of picked) {
        const lp = this.toLocal(body, q);
        this.world.createCollider(r.ColliderDesc.ball(0.012).setTranslation(lp.x, lp.y).setDensity(0.3).setFriction(0.85).setRestitution(0.05).setCollisionGroups(RAGDOLL), body);
      }
      this.bodies.push(body);
      this.half.push(h);
    });
    const torso = this.bodies[TORSO];
    this.torsoLocal = this.onTorso.map((j) => this.toLocal(torso, joints[j]));
    for (const [child, parent, at, lim] of links) {
      const c = this.bodies[child];
      const pa = this.bodies[parent];
      const ac = this.toLocal(c, joints[at]);
      const ap = this.toLocal(pa, joints[at]);
      const jd = r.JointData.revolute(ap, ac);
      const jt = this.world.createImpulseJoint(jd, pa, c, true) as InstanceType<R["RevoluteImpulseJoint"]>;
      jt.setContactsEnabled(false);
      const rel = wrap(c.rotation() - pa.rotation());
      const lo = Math.max(-Math.PI + 0.01, rel - lim);
      const hi = Math.min(Math.PI - 0.01, rel + lim);
      if (lim < 2.5) jt.setLimits(lo, hi);
    }
  }

  /** the opponent's bones (in this fighter's local frame) as kinematic obstacles */
  setFoe(segs: [Pt, Pt][]) {
    const r = R!;
    if (this.freed || !this.foeOn) return;
    if (!this.foe.length) {
      for (const [a, b] of segs) {
        const h = Math.max(0.002, Math.hypot(b.x - a.x, b.y - a.y) / 2);
        const body = this.world.createRigidBody(r.RigidBodyDesc.kinematicPositionBased().setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2));
        this.world.createCollider(r.ColliderDesc.capsule(h, 0.05).setCollisionGroups(SCENERY).setFriction(0.6), body);
        this.foe.push({ body, half: h });
      }
    }
    segs.forEach(([a, b], i) => {
      const f = this.foe[i];
      if (!f) return;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      f.body.setNextKinematicTranslation({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      f.body.setNextKinematicRotation(L > 1e-4 ? Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2 : 0);
    });
  }

  step(dt: number, _gravity: number) {
    if (this.freed) return;
    this.world.timestep = dt;
    this.age += dt;
    // the winner only matters for the blow itself; later a body would lean on them as if propped up
    if (this.foeOn && this.age > 0.45) {
      this.foeOn = false;
      for (const f of this.foe) f.body.setEnabled(false);
    }
    this.slump(dt);
    // once down, friction of a body lying on paper: damp it so it settles instead of rocking forever
    const calm = this.age > 2.2 ? 2 : this.age > 1.2 ? 1 : 0;
    if (calm > this.calmed) {
      this.calmed = calm;
      for (const b of this.bodies) {
        b.setLinearDamping(calm === 2 ? 8 : 3);
        b.setAngularDamping(calm === 2 ? 14 : 6);
      }
    }
    this.world.step();
    let moving = 0;
    for (const b of this.bodies) {
      const v = b.linvel();
      moving = Math.max(moving, Math.hypot(v.x, v.y), Math.abs(b.angvel()) * 0.1);
    }
    this.moving = moving;
    if (moving < 0.05) this.settled += dt;
    this.read();
  }

  /**
   * A knocked-out body has no muscle tone: if it has come to a stop still upright (balanced on four
   * legs, wedged against a wall), nudge its base out and tip it over so it ends up lying down.
   */
  private slump(dt: number) {
    if (this.age < 0.7 || this.age > 2.6 || this.moving > 0.5) return;
    const top = Math.max(...this.p.map((q) => q.y));
    if (top < Math.max(0.3, this.initTop * 0.5)) return;
    const crown = this.p[J.crown];
    const pelvis = this.p[J.pelvis];
    const [w0, w1] = this.wallX;
    const x = pelvis.x;
    // shove the trunk away from a wall it leans on, otherwise the way it already leans, and let it
    // sag: straight legs tilt, knees and hips give, and it goes down
    let dir: number;
    if (x - w0 < 0.6) dir = 1;
    else if (w1 - x < 0.6) dir = -1;
    else {
      const lean = crown.x - pelvis.x;
      dir = Math.abs(lean) > 0.04 ? Math.sign(lean) : x < (w0 + w1) / 2 ? 1 : -1;
    }
    const torso = this.bodies[TORSO];
    const m = torso.mass();
    torso.applyImpulse({ x: dir * m * 1.6 * dt, y: -m * 2.4 * dt }, true);
  }

  private read() {
    const end = (i: number, e: 0 | 1) => this.toWorld(this.bodies[i], { x: 0, y: e ? this.half[i] : -this.half[i] });
    for (const [j, [bone, e]] of this.endOf) this.p[j] = end(bone, e);
    this.onTorso.forEach((j, k) => (this.p[j] = this.toWorld(this.bodies[TORSO], this.torsoLocal[k])));
  }

  private toLocal(b: Body, p: Pt): Pt {
    const t = b.translation();
    const a = b.rotation();
    const c = Math.cos(a);
    const s = Math.sin(a);
    const dx = p.x - t.x;
    const dy = p.y - t.y;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }
  private toWorld(b: Body, p: Pt): Pt {
    const t = b.translation();
    const a = b.rotation();
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: t.x + p.x * c - p.y * s, y: t.y + p.x * s + p.y * c };
  }

  free() {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1e-6;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/**
 * A rigid drawing with nothing to flop (a car): one Rapier body whose collider is the drawn ink
 * itself (a compound of small balls along the strokes). It is hopped back with a spin, rolls on its
 * real outline and comes to rest on whatever side it lands — the joints ride along rigidly.
 */
export class RapierTumble {
  p: Pt[];
  settled = 0;
  clear: number[];
  freed = false;
  private world: InstanceType<R["World"]>;
  private body: Body;
  private rel: Pt[];
  private age = 0;
  private calmed = 0;
  constructor(joints: Pt[], ink: Pt[], impulse: Pt, dt: number, gravity: number, walls: [number, number]) {
    const r = R!;
    this.p = joints.map((q) => ({ ...q }));
    this.clear = joints.map(() => 0);
    this.world = new r.World({ x: 0, y: -gravity * 0.32 });
    this.world.timestep = dt;
    const fixed = this.world.createRigidBody(r.RigidBodyDesc.fixed());
    const scen = (d: InstanceType<R["ColliderDesc"]>) => this.world.createCollider(d.setCollisionGroups(SCENERY).setFriction(0.9).setRestitution(0.1), fixed);
    scen(r.ColliderDesc.cuboid(40, 1).setTranslation(0, -1 + FLOOR));
    const [w0, w1] = walls[0] < walls[1] ? walls : [walls[1], walls[0]];
    scen(r.ColliderDesc.cuboid(0.5, 20).setTranslation(w0 - 0.5, 10));
    scen(r.ColliderDesc.cuboid(0.5, 20).setTranslation(w1 + 0.5, 10));
    const pts = ink.length ? ink : joints;
    const cx = pts.reduce((t, q) => t + q.x, 0) / pts.length;
    const cy = pts.reduce((t, q) => t + q.y, 0) / pts.length;
    this.rel = joints.map((q) => ({ x: q.x - cx, y: q.y - cy }));
    // spin so it goes over onto its roof: knocked backwards ⇒ nose lifts first
    const dir = impulse.x <= 0 ? 1 : -1;
    // half a turn during the hop: spin = π / (time in the air)
    const vy = 1.6 + Math.max(0, impulse.y) * 0.4;
    const tAir = (2 * vy) / Math.max(0.1, gravity * 0.32);
    this.body = this.world.createRigidBody(
      r.RigidBodyDesc.dynamic()
        .setTranslation(cx, cy)
        .setLinvel(impulse.x * 0.75, vy)
        .setAngvel((dir * Math.PI * 1.05) / tAir)
        .setLinearDamping(0.3)
        .setAngularDamping(0.25)
        .setCcdEnabled(true),
    );
    const picked: Pt[] = [];
    for (const q of pts) if (picked.length < 90 && picked.every((p) => Math.hypot(p.x - q.x, p.y - q.y) > 0.05)) picked.push(q);
    for (const q of picked) this.world.createCollider(r.ColliderDesc.ball(0.014).setTranslation(q.x - cx, q.y - cy).setDensity(1).setFriction(0.8).setRestitution(0.15).setCollisionGroups(RAGDOLL), this.body);
  }
  setFoe() {}
  step(dt: number, _gravity: number) {
    if (this.freed) return;
    this.world.timestep = dt;
    this.age += dt;
    const calm = this.age > 2.4 ? 2 : this.age > 1.4 ? 1 : 0;
    if (calm > this.calmed) {
      this.calmed = calm;
      this.body.setLinearDamping(calm === 2 ? 6 : 1.5);
      this.body.setAngularDamping(calm === 2 ? 10 : 3);
    }
    this.world.step();
    const v = this.body.linvel();
    if (Math.hypot(v.x, v.y) < 0.05 && Math.abs(this.body.angvel()) < 0.3) this.settled += dt;
    const t = this.body.translation();
    const a = this.body.rotation();
    const c = Math.cos(a);
    const s = Math.sin(a);
    this.p = this.rel.map((q) => ({ x: t.x + q.x * c - q.y * s, y: t.y + q.x * s + q.y * c }));
  }
  free() {
    if (this.freed) return;
    this.freed = true;
    this.world.free();
  }
}
