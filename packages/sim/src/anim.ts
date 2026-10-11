/**
 * Animation: keyed move clips → spring-followed pose → forward kinematics → joints.
 * Joints drive skinStrokes(), so the player's own lines perform every move.
 *
 * Angle conventions (fighter faces +x, y up):
 *  lean / head : from vertical, + = toward facing (forward)
 *  arm*        : upper arm from straight down, + = swings forward/up (absolute)
 *  elbow*      : forearm relative to upper arm, + = folds forward/up
 *  thigh*      : from straight down, + = knee forward
 *  knee*       : bend, + = shin folds back
 *  rot         : whole-body pitch about the pelvis, + = forward
 *  rootX/rootY : body offset (figure heights); rootY lifts off the ground
 *  sx / sy     : squash & stretch about the feet
 */
import type { Pt } from "@nf/shared";
import { BONES, J, auxLowest, extendedJoints, fightStrokes, skinStrokes, type Deform, type Joints, type Rig, type RigShape } from "./rig";
import { RapierRagdoll, RapierTumble, physicsReady } from "./physics";

export type Pose = {
  rootX: number;
  rootY: number;
  rot: number;
  lean: number;
  head: number;
  armF: number;
  elbowF: number;
  armB: number;
  elbowB: number;
  thighF: number;
  kneeF: number;
  thighB: number;
  kneeB: number;
  sx: number;
  sy: number;
  /** serpent body wave amplitude (figure heights) */
  wave: number;
};
export const POSE_KEYS: (keyof Pose)[] = ["rootX", "rootY", "rot", "lean", "head", "armF", "elbowF", "armB", "elbowB", "thighF", "kneeF", "thighB", "kneeB", "sx", "sy", "wave"];

export const GUARD: Pose = {
  rootX: 0,
  rootY: 0,
  rot: 0,
  lean: 0.08,
  head: -0.04,
  armF: 0.55,
  elbowF: 1.95,
  armB: 0.3,
  elbowB: 2.15,
  thighF: 0.3,
  kneeF: 0.32,
  thighB: -0.26,
  kneeB: 0.3,
  sx: 1,
  sy: 1,
  wave: 0.02,
};

const P = (over: Partial<Pose>): Pose => ({ ...GUARD, ...over });

export function mixPose(a: Pose, b: Pose, k: number): Pose {
  const out = { ...a };
  for (const key of POSE_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  return out;
}

// ---------------------------------------------------------------- easing
type Ease = "linear" | "in" | "out" | "inOut" | "back" | "snap";
function ease(kind: Ease, t: number) {
  switch (kind) {
    case "linear":
      return t;
    case "in":
      return t * t * t;
    case "out":
      return 1 - (1 - t) ** 3;
    case "back": {
      // overshoots then settles: follow-through baked into the key
      const c = 1.9;
      return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    }
    case "snap":
      return 1 - (1 - t) ** 5;
    default:
      return t * t * (3 - 2 * t);
  }
}

/** keyframe: time (s), pose, easing used to arrive at this key */
type Key = { t: number; pose: Pose; ease?: Ease };
export type Clip = { keys: Key[]; loop: boolean; length: number; /** active (hit) window, seconds */ active?: [number, number] };

function clip(keys: Key[], loop = false, active?: [number, number]): Clip {
  return { keys, loop, length: keys[keys.length - 1].t, active };
}

export function sampleClip(c: Clip, time: number): Pose {
  let t = time;
  if (c.loop) t = ((t % c.length) + c.length) % c.length;
  else t = Math.max(0, Math.min(c.length, t));
  const keys = c.keys;
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1] ?? a;
  const span = b.t - a.t || 1;
  const u = Math.max(0, Math.min(1, (t - a.t) / span));
  return mixPose(a.pose, b.pose, ease(b.ease ?? "inOut", u));
}

// ---------------------------------------------------------------- the move library
const BREATH = P({ lean: 0.11, head: 0.0, armF: 0.6, elbowF: 2.05, armB: 0.36, elbowB: 2.2, kneeF: 0.42, kneeB: 0.4, thighF: 0.34, thighB: -0.22, sy: 0.985, sx: 1.01 });
export const CLIPS = {
  idle: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.8, pose: BREATH },
      { t: 1.6, pose: GUARD },
    ],
    true,
  ),
  // walk: contact → down → passing → up → contact (mirror) …  fighter keeps a loose guard
  walk: clip(
    [
      { t: 0, pose: P({ lean: 0.14, thighF: 0.5, kneeF: 0.12, thighB: -0.42, kneeB: 0.2, armF: 0.4, elbowF: 2.0, armB: 0.5, elbowB: 2.0 }) },
      { t: 0.125, pose: P({ lean: 0.16, thighF: 0.3, kneeF: 0.45, thighB: -0.3, kneeB: 0.35, armF: 0.45, armB: 0.42, sy: 0.97 }) },
      { t: 0.25, pose: P({ lean: 0.14, thighF: -0.02, kneeF: 0.2, thighB: 0.35, kneeB: 1.15, armF: 0.55, elbowF: 1.9, armB: 0.3, elbowB: 2.2, sy: 1.02 }) },
      { t: 0.375, pose: P({ lean: 0.13, thighF: -0.25, kneeF: 0.15, thighB: 0.55, kneeB: 0.7, armF: 0.65, armB: 0.2 }) },
      { t: 0.5, pose: P({ lean: 0.14, thighF: -0.42, kneeF: 0.2, thighB: 0.5, kneeB: 0.12, armF: 0.7, elbowF: 1.85, armB: 0.15, elbowB: 2.25 }) },
      { t: 0.625, pose: P({ lean: 0.16, thighF: -0.3, kneeF: 0.35, thighB: 0.3, kneeB: 0.45, armF: 0.65, armB: 0.2, sy: 0.97 }) },
      { t: 0.75, pose: P({ lean: 0.14, thighF: 0.35, kneeF: 1.15, thighB: -0.02, kneeB: 0.2, armF: 0.55, armB: 0.3, sy: 1.02 }) },
      { t: 0.875, pose: P({ lean: 0.13, thighF: 0.55, kneeF: 0.7, thighB: -0.25, kneeB: 0.15, armF: 0.45, armB: 0.42 }) },
      { t: 1, pose: P({ lean: 0.14, thighF: 0.5, kneeF: 0.12, thighB: -0.42, kneeB: 0.2, armF: 0.4, elbowF: 2.0, armB: 0.5, elbowB: 2.0 }) },
    ],
    true,
  ),
  // jab: wind-up (anticipation) → snap out → hold → recoil → guard
  punch: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.1, pose: P({ lean: -0.08, head: -0.08, armF: 0.15, elbowF: 2.5, armB: 0.45, elbowB: 2.2, thighF: 0.28, kneeF: 0.42, thighB: -0.3, kneeB: 0.42, rootX: -0.02, sx: 0.97 }), ease: "out" },
      { t: 0.17, pose: P({ lean: 0.32, head: 0.06, armF: 1.62, elbowF: 0.02, armB: 0.05, elbowB: 2.4, thighF: 0.5, kneeF: 0.5, thighB: -0.38, kneeB: 0.12, rootX: 0.07, sx: 1.05, sy: 0.98 }), ease: "snap" },
      { t: 0.25, pose: P({ lean: 0.3, head: 0.04, armF: 1.55, elbowF: 0.1, armB: 0.08, elbowB: 2.35, thighF: 0.48, kneeF: 0.48, thighB: -0.36, kneeB: 0.15, rootX: 0.065 }), ease: "linear" },
      { t: 0.38, pose: P({ lean: 0.12, armF: 0.8, elbowF: 1.4, rootX: 0.02 }), ease: "inOut" },
      { t: 0.48, pose: GUARD, ease: "out" },
    ],
    false,
    [0.15, 0.25],
  ),
  // front kick: chamber knee → extend → hold → re-chamber → set down
  kick: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.08, pose: P({ lean: 0.12, thighF: 0.2, kneeF: 0.55, thighB: -0.2, kneeB: 0.45, sy: 0.96 }), ease: "out" },
      { t: 0.2, pose: P({ lean: -0.12, head: -0.05, thighF: 1.55, kneeF: 2.2, thighB: -0.05, kneeB: 0.25, armF: 0.95, elbowF: 1.5, armB: -0.45, elbowB: 1.2 }), ease: "out" },
      { t: 0.29, pose: P({ lean: -0.38, head: 0.1, thighF: 1.62, kneeF: 0.02, thighB: -0.1, kneeB: 0.15, armF: 0.75, elbowF: 1.1, armB: -0.95, elbowB: 0.5, rootX: 0.05, sx: 1.04 }), ease: "snap" },
      { t: 0.38, pose: P({ lean: -0.35, head: 0.08, thighF: 1.58, kneeF: 0.08, thighB: -0.1, kneeB: 0.18, armF: 0.75, elbowF: 1.15, armB: -0.9, elbowB: 0.55, rootX: 0.05 }), ease: "linear" },
      { t: 0.5, pose: P({ lean: -0.05, thighF: 1.2, kneeF: 1.9, armB: -0.2, elbowB: 1.5, rootX: 0.03 }), ease: "inOut" },
      { t: 0.66, pose: GUARD, ease: "back" },
    ],
    false,
    [0.25, 0.38],
  ),
  block: clip(
    [
      { t: 0, pose: P({ lean: -0.04, head: -0.2, armF: 1.15, elbowF: 2.55, armB: 1.0, elbowB: 2.65, thighF: 0.35, kneeF: 0.55, thighB: -0.3, kneeB: 0.5 }) },
      { t: 0.5, pose: P({ lean: -0.02, head: -0.17, armF: 1.18, elbowF: 2.5, armB: 1.04, elbowB: 2.6, thighF: 0.36, kneeF: 0.62, thighB: -0.3, kneeB: 0.56 }) },
      { t: 1, pose: P({ lean: -0.04, head: -0.2, armF: 1.15, elbowF: 2.55, armB: 1.0, elbowB: 2.65, thighF: 0.35, kneeF: 0.55, thighB: -0.3, kneeB: 0.5 }) },
    ],
    true,
  ),
  crouch: clip(
    [
      { t: 0, pose: P({ lean: 0.35, head: -0.2, thighF: 1.05, kneeF: 2.0, thighB: 0.35, kneeB: 1.9, armF: 0.8, elbowF: 1.9, armB: 0.6, elbowB: 2.1 }) },
      { t: 0.7, pose: P({ lean: 0.38, head: -0.18, thighF: 1.08, kneeF: 2.05, thighB: 0.38, kneeB: 1.95, armF: 0.84, elbowF: 1.9, armB: 0.62, elbowB: 2.1 }) },
      { t: 1.4, pose: P({ lean: 0.35, head: -0.2, thighF: 1.05, kneeF: 2.0, thighB: 0.35, kneeB: 1.9, armF: 0.8, elbowF: 1.9, armB: 0.6, elbowB: 2.1 }) },
    ],
    true,
  ),
  // hit to the head: snap back, knees buckle, arms flail, recover
  hit: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.05, pose: P({ lean: -0.4, head: -0.55, armF: -0.2, elbowF: 0.7, armB: -0.6, elbowB: 0.5, thighF: 0.25, kneeF: 0.75, thighB: -0.15, kneeB: 0.65, rootX: -0.05, sx: 0.95, sy: 1.03 }), ease: "snap" },
      { t: 0.18, pose: P({ lean: -0.25, head: -0.3, armF: 0.1, elbowF: 1.1, armB: -0.3, elbowB: 1.0, thighF: 0.3, kneeF: 0.6, thighB: -0.2, kneeB: 0.55, rootX: -0.04 }), ease: "out" },
      { t: 0.42, pose: GUARD, ease: "inOut" },
    ],
  ),
  // hit to the body: double over
  hitLow: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.06, pose: P({ lean: 0.55, head: 0.35, armF: 0.4, elbowF: 2.3, armB: 0.2, elbowB: 2.4, thighF: 0.5, kneeF: 0.9, thighB: -0.05, kneeB: 0.8, rootX: -0.04, sy: 0.94 }), ease: "snap" },
      { t: 0.22, pose: P({ lean: 0.4, head: 0.2, armF: 0.45, elbowF: 2.1, thighF: 0.42, kneeF: 0.7, kneeB: 0.6, rootX: -0.03 }), ease: "out" },
      { t: 0.45, pose: GUARD, ease: "inOut" },
    ],
  ),
  blockHit: clip(
    [
      { t: 0, pose: P({ lean: -0.04, head: -0.2, armF: 1.15, elbowF: 2.55, armB: 1.0, elbowB: 2.65, thighF: 0.35, kneeF: 0.55, thighB: -0.3, kneeB: 0.5 }) },
      { t: 0.05, pose: P({ lean: -0.18, head: -0.3, armF: 1.0, elbowF: 2.7, armB: 0.85, elbowB: 2.75, thighF: 0.3, kneeF: 0.7, thighB: -0.35, kneeB: 0.6, rootX: -0.03 }), ease: "snap" },
      { t: 0.2, pose: P({ lean: -0.04, head: -0.2, armF: 1.15, elbowF: 2.55, armB: 1.0, elbowB: 2.65, thighF: 0.35, kneeF: 0.55, thighB: -0.3, kneeB: 0.5 }), ease: "out" },
    ],
  ),
  // jump phases are picked by the animator from vertical velocity
  jumpCrouch: clip([
    { t: 0, pose: GUARD },
    { t: 0.11, pose: P({ lean: 0.3, head: 0.1, thighF: 0.95, kneeF: 1.75, thighB: 0.3, kneeB: 1.6, armF: -0.55, elbowF: 0.4, armB: -0.75, elbowB: 0.3, sy: 0.86, sx: 1.06 }), ease: "out" },
  ]),
  rise: clip([{ t: 0, pose: P({ lean: 0.02, head: -0.15, thighF: 0.15, kneeF: 0.05, thighB: -0.25, kneeB: 0.3, armF: 2.7, elbowF: 0.2, armB: 2.3, elbowB: 0.3, sy: 1.1, sx: 0.94 }) }]),
  tuck: clip([{ t: 0, pose: P({ lean: 0.25, head: 0.05, thighF: 1.4, kneeF: 2.1, thighB: 0.9, kneeB: 1.9, armF: 1.3, elbowF: 1.2, armB: 0.9, elbowB: 1.4 }) }]),
  fall: clip([{ t: 0, pose: P({ lean: 0.05, head: 0.08, thighF: 0.45, kneeF: 0.35, thighB: -0.15, kneeB: 0.4, armF: 1.7, elbowF: 0.5, armB: 1.3, elbowB: 0.6, sy: 1.04 }) }]),
  land: clip([
    { t: 0, pose: P({ lean: 0.3, head: 0.1, thighF: 0.9, kneeF: 1.6, thighB: 0.3, kneeB: 1.5, armF: 0.9, elbowF: 0.8, armB: 0.5, elbowB: 0.8, sy: 0.84, sx: 1.08 }) },
    { t: 0.07, pose: P({ lean: 0.34, head: 0.12, thighF: 0.95, kneeF: 1.75, thighB: 0.32, kneeB: 1.6, armF: 0.7, elbowF: 1.2, sy: 0.88, sx: 1.05 }), ease: "out" },
    { t: 0.24, pose: GUARD, ease: "back" },
  ]),
  victory: clip(
    [
      { t: 0, pose: P({ lean: -0.08, head: -0.15, armF: 2.45, elbowF: 0.35, armB: 3.75, elbowB: 0.3, thighF: 0.25, kneeF: 0.5, thighB: -0.25, kneeB: 0.5, sy: 0.95 }) },
      { t: 0.18, pose: P({ lean: -0.12, head: -0.22, armF: 2.6, elbowF: 0.05, armB: 3.9, elbowB: 0.05, thighF: 0.1, kneeF: 0.05, thighB: -0.12, kneeB: 0.1, rootY: 0.09, sy: 1.06 }), ease: "out" },
      { t: 0.36, pose: P({ lean: -0.1, head: -0.18, armF: 2.5, elbowF: 0.25, armB: 3.8, elbowB: 0.2, thighF: 0.2, kneeF: 0.3, thighB: -0.2, kneeB: 0.35, rootY: 0.02 }), ease: "in" },
      { t: 0.5, pose: P({ lean: -0.08, head: -0.15, armF: 2.45, elbowF: 0.35, armB: 3.75, elbowB: 0.3, thighF: 0.25, kneeF: 0.5, thighB: -0.25, kneeB: 0.5, sy: 0.95 }), ease: "out" },
      { t: 0.9, pose: P({ lean: -0.08, head: -0.15, armF: 2.45, elbowF: 0.35, armB: 3.75, elbowB: 0.3, thighF: 0.25, kneeF: 0.5, thighB: -0.25, kneeB: 0.5, sy: 0.95 }) },
    ],
    true,
  ),
  // ---------------------------------------------------------------- body-specific moves
  // armless / legless: lunge the head in
  headbutt: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.1, pose: P({ lean: -0.3, head: -0.35, rootX: -0.03, sy: 0.95 }), ease: "out" },
      { t: 0.18, pose: P({ lean: 0.65, head: 0.35, rootX: 0.08, sy: 1.04, armF: -0.2, armB: -0.4 }), ease: "snap" },
      { t: 0.3, pose: P({ lean: 0.6, head: 0.3, rootX: 0.08, armF: -0.2, armB: -0.4 }), ease: "linear" },
      { t: 0.48, pose: GUARD, ease: "back" },
    ],
    false,
    [0.15, 0.3],
  ),
  // legless kick: topple forward like a felled tree and whack with the whole body
  flop: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.14, pose: P({ rot: -0.25, lean: -0.1, armF: 2.6, elbowF: 0.2, armB: 2.4, elbowB: 0.3, sy: 1.06 }), ease: "out" },
      { t: 0.3, pose: P({ rot: 1.05, lean: 0.1, armF: 1.6, elbowF: 0.1, armB: 1.5, elbowB: 0.2, rootX: 0.05 }), ease: "in" },
      { t: 0.46, pose: P({ rot: 1.0, lean: 0.1, armF: 1.7, elbowF: 0.3, armB: 1.6, elbowB: 0.4, rootX: 0.05, sy: 0.95 }), ease: "out" },
      { t: 0.78, pose: GUARD, ease: "back" },
    ],
    false,
    [0.26, 0.46],
  ),
  // weapon: big overhead arc — wind up behind the head, cut down through the target, follow through low
  swing: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.16, pose: P({ lean: -0.18, head: -0.1, armF: 3.25, elbowF: 0.55, armB: 0.6, elbowB: 1.6, thighF: 0.25, kneeF: 0.45, thighB: -0.32, kneeB: 0.4, rootX: -0.02, sy: 1.03 }), ease: "out" },
      { t: 0.25, pose: P({ lean: 0.3, head: 0.08, armF: 1.35, elbowF: 0.08, armB: 0.1, elbowB: 2.2, thighF: 0.55, kneeF: 0.55, thighB: -0.4, kneeB: 0.15, rootX: 0.07, sx: 1.04 }), ease: "snap" },
      { t: 0.34, pose: P({ lean: 0.38, head: 0.1, armF: 0.45, elbowF: 0.15, armB: 0.05, elbowB: 2.3, thighF: 0.55, kneeF: 0.6, thighB: -0.4, kneeB: 0.15, rootX: 0.07 }), ease: "out" },
      { t: 0.62, pose: GUARD, ease: "inOut" },
    ],
    false,
    [0.19, 0.34],
  ),
  // beasts: rear the head back, then snap the jaws forward and shake
  bite: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.11, pose: P({ head: -0.4, rot: -0.07, rootX: -0.03, thighF: 0.45, kneeF: 0.55, thighB: -0.15, kneeB: 0.5, sy: 0.95 }), ease: "out" },
      { t: 0.19, pose: P({ head: 0.35, rot: 0.1, rootX: 0.09, thighF: 0.0, kneeF: 0.15, thighB: -0.5, kneeB: 0.15, sx: 1.07 }), ease: "snap" },
      { t: 0.25, pose: P({ head: 0.12, rot: 0.08, rootX: 0.09, thighF: 0.0, kneeF: 0.15, thighB: -0.5, kneeB: 0.15, sx: 1.05 }), ease: "linear" },
      { t: 0.31, pose: P({ head: 0.3, rot: 0.1, rootX: 0.09, thighF: 0.0, kneeF: 0.15, thighB: -0.5, kneeB: 0.15, sx: 1.05 }), ease: "linear" },
      { t: 0.5, pose: GUARD, ease: "inOut" },
    ],
    false,
    [0.16, 0.32],
  ),
  // head down, full gallop into the foe (legs come from the running cycle)
  charge: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.1, pose: P({ head: 0.4, rot: 0.06, sx: 1.04, sy: 0.96 }), ease: "out" },
      { t: 0.45, pose: P({ head: 0.45, rot: 0.08, sx: 1.06, sy: 0.96 }), ease: "linear" },
      { t: 0.62, pose: GUARD, ease: "back" },
    ],
    false,
    [0.12, 0.46],
  ),
  // crouch, spring, fly with the front end reaching, land
  pounce: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.13, pose: P({ thighF: 0.75, kneeF: 1.3, thighB: 0.25, kneeB: 1.2, rot: -0.04, head: -0.15, sy: 0.86, sx: 1.04 }), ease: "out" },
      { t: 0.24, pose: P({ thighF: -0.55, kneeF: 0.1, thighB: -0.75, kneeB: 0.1, rot: -0.22, head: -0.2, sy: 1.08, sx: 1.06 }), ease: "snap" },
      { t: 0.42, pose: P({ thighF: -0.35, kneeF: 0.2, thighB: -0.5, kneeB: 0.2, rot: 0.08, head: 0.3, sx: 1.1 }), ease: "inOut" },
      { t: 0.56, pose: P({ thighF: 0.6, kneeF: 1.0, thighB: 0.1, kneeB: 0.9, rot: 0.14, head: 0.15, sy: 0.9, sx: 1.05 }), ease: "out" },
      { t: 0.78, pose: GUARD, ease: "back" },
    ],
    false,
    [0.3, 0.58],
  ),
  // turn on the spot so the tail lashes the foe, then turn back (sx flips through 0: a 2D turn)
  tailWhip: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.1, pose: P({ rot: 0.05, head: 0.15, sy: 0.95, sx: 0.9, thighF: 0.45, kneeF: 0.6 }), ease: "out" },
      { t: 0.22, pose: P({ sx: -1, head: -0.1, rot: -0.04, sy: 1.02, wave: 0.06 }), ease: "snap" },
      { t: 0.36, pose: P({ sx: -1.02, head: -0.1, rot: 0.02, wave: 0.05 }), ease: "linear" },
      { t: 0.5, pose: P({ sx: -0.9, head: 0, wave: 0.03 }), ease: "inOut" },
      { t: 0.68, pose: GUARD, ease: "inOut" },
    ],
    false,
    [0.18, 0.42],
  ),
  // blob: squash, stretch up, and crash down onto the foe
  slam: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.14, pose: P({ sx: 1.28, sy: 0.7, rootX: -0.02, armF: 1.2, armB: 1.0 }), ease: "out" },
      { t: 0.3, pose: P({ sx: 0.8, sy: 1.32, rootY: 0.16, rot: -0.15, armF: 2.8, elbowF: 0.2, armB: 2.6, elbowB: 0.2 }), ease: "out" },
      { t: 0.42, pose: P({ sx: 1.22, sy: 0.78, rootY: 0, rot: 0.7, rootX: 0.1, armF: 1.4, armB: 1.3 }), ease: "in" },
      { t: 0.54, pose: P({ sx: 1.3, sy: 0.72, rot: 0.62, rootX: 0.1, armF: 1.3, armB: 1.2 }), ease: "out" },
      { t: 0.82, pose: GUARD, ease: "back" },
    ],
    false,
    [0.36, 0.56],
  ),
  // blob: pancake, then spring forward stretched long
  squish: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.12, pose: P({ sx: 1.38, sy: 0.6, rootX: -0.03 }), ease: "out" },
      { t: 0.25, pose: P({ sx: 1.5, sy: 0.72, rootX: 0.15, rot: 0.22, armF: 1.6, armB: -0.4 }), ease: "snap" },
      { t: 0.36, pose: P({ sx: 1.42, sy: 0.75, rootX: 0.14, rot: 0.2, armF: 1.5, armB: -0.3 }), ease: "linear" },
      { t: 0.6, pose: GUARD, ease: "back" },
    ],
    false,
    [0.2, 0.38],
  ),
  // serpent: coil back, rear up, then strike out straight
  coilStrike: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.15, pose: P({ wave: 0.06, sx: 0.78, rot: -0.28, head: -0.35, rootX: -0.03 }), ease: "out" },
      { t: 0.25, pose: P({ wave: 0.0, sx: 1.25, rot: 0.08, head: 0.25, rootX: 0.1 }), ease: "snap" },
      { t: 0.35, pose: P({ wave: 0.005, sx: 1.2, rot: 0.06, head: 0.2, rootX: 0.1 }), ease: "linear" },
      { t: 0.56, pose: GUARD, ease: "inOut" },
    ],
    false,
    [0.21, 0.37],
  ),
  // vehicle: rev back, then lurch forward into the foe
  ram: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.16, pose: P({ rootX: -0.05, rot: -0.06, sy: 0.96 }), ease: "out" },
      { t: 0.28, pose: P({ rootX: 0.12, rot: 0.06, sx: 1.08, sy: 0.97 }), ease: "snap" },
      { t: 0.4, pose: P({ rootX: 0.12, rot: 0.04, sx: 1.05 }), ease: "linear" },
      { t: 0.62, pose: GUARD, ease: "back" },
    ],
    false,
    [0.22, 0.42],
  ),
  // vehicle: pop the front wheel up, then slam it down on the foe
  wheelie: clip(
    [
      { t: 0, pose: GUARD },
      { t: 0.12, pose: P({ sy: 0.94, rootX: -0.02 }), ease: "out" },
      { t: 0.26, pose: P({ rot: -0.5, rootX: 0.03, sy: 1.02 }), ease: "out" },
      { t: 0.36, pose: P({ rot: 0.1, rootX: 0.1, sy: 0.92, sx: 1.05 }), ease: "in" },
      { t: 0.46, pose: P({ rot: 0.04, rootX: 0.1, sy: 0.97 }), ease: "out" },
      { t: 0.66, pose: GUARD, ease: "back" },
    ],
    false,
    [0.3, 0.46],
  ),
} satisfies Record<string, Clip>;
export type MoveName = keyof typeof CLIPS | "ko";

/** looping / reaction clips swapped in per body plan or gait */
const loopy = (keys: [number, Partial<Pose>, Ease?][], loop = true, active?: [number, number]) => clip(keys.map(([t, p, e]) => ({ t, pose: P(p), ease: e })), loop, active);
const VARIANTS: Partial<Record<string, Partial<Record<MoveName, Clip>>>> = {
  blob: {
    // big squash-and-stretch breathing
    idle: loopy([[0, { sx: 1, sy: 1 }], [0.35, { sx: 1.1, sy: 0.9 }], [0.75, { sx: 0.94, sy: 1.08 }], [1.1, { sx: 1, sy: 1 }]]),
    hit: loopy([[0, {}], [0.05, { sx: 1.3, sy: 0.75, rootX: -0.05, rot: -0.2 }, "snap"], [0.16, { sx: 0.85, sy: 1.15, rootX: -0.04 }], [0.28, { sx: 1.08, sy: 0.94 }], [0.42, {}, "inOut"]], false),
    hitLow: loopy([[0, {}], [0.05, { sx: 0.8, sy: 1.2, rootX: -0.05, rot: 0.15 }, "snap"], [0.16, { sx: 1.15, sy: 0.88, rootX: -0.04 }], [0.3, { sx: 0.96, sy: 1.04 }], [0.45, {}, "inOut"]], false),
    block: loopy([[0, { sx: 1.18, sy: 0.8, lean: -0.08 }], [0.5, { sx: 1.2, sy: 0.78, lean: -0.06 }], [1, { sx: 1.18, sy: 0.8, lean: -0.08 }]]),
    blockHit: loopy([[0, { sx: 1.18, sy: 0.8 }], [0.05, { sx: 1.35, sy: 0.68, rootX: -0.03 }, "snap"], [0.2, { sx: 1.18, sy: 0.8 }, "out"]], false),
    crouch: loopy([[0, { sx: 1.35, sy: 0.62 }], [0.7, { sx: 1.38, sy: 0.6 }], [1.4, { sx: 1.35, sy: 0.62 }]]),
    victory: loopy([[0, { sx: 1.2, sy: 0.8, armF: 2.6, armB: 3.6 }], [0.18, { sx: 0.85, sy: 1.2, rootY: 0.14, armF: 2.8, armB: 3.8 }, "out"], [0.36, { sx: 0.95, sy: 1.05, rootY: 0.1 }, "in"], [0.5, { sx: 1.2, sy: 0.8, armF: 2.6, armB: 3.6 }, "in"]]),
  },
  vehicle: {
    // engine rumble
    idle: loopy([[0, { sy: 1 }], [0.05, { sy: 0.985, rot: 0.006 }], [0.1, { sy: 1.005, rot: -0.004 }], [0.15, { sy: 1 }]]),
    hit: loopy([[0, {}], [0.05, { rot: -0.2, rootX: -0.06, sy: 1.03 }, "snap"], [0.2, { rot: 0.05, rootX: -0.04 }], [0.42, {}, "inOut"]], false),
    hitLow: loopy([[0, {}], [0.05, { rot: 0.08, rootX: -0.05, sy: 0.9 }, "snap"], [0.2, { rot: -0.03, rootX: -0.04, sy: 1.02 }], [0.45, {}, "inOut"]], false),
    block: loopy([[0, { rot: -0.06, rootX: -0.02, sy: 0.95 }], [0.5, { rot: -0.07, rootX: -0.02, sy: 0.94 }], [1, { rot: -0.06, rootX: -0.02, sy: 0.95 }]]),
    blockHit: loopy([[0, { rot: -0.06, sy: 0.95 }], [0.05, { rot: -0.14, rootX: -0.04, sy: 0.92 }, "snap"], [0.2, { rot: -0.06, sy: 0.95 }, "out"]], false),
    crouch: loopy([[0, { sy: 0.85 }], [0.7, { sy: 0.84 }], [1.4, { sy: 0.85 }]]),
    victory: loopy([[0, { rot: -0.3, sy: 1 }], [0.2, { rot: -0.42, rootY: 0.03 }, "out"], [0.4, { rot: -0.3 }, "in"]]),
  },
  serpent: {
    idle: loopy([[0, { wave: 0.025, rot: 0 }], [0.8, { wave: 0.03, rot: -0.05, head: -0.1 }], [1.6, { wave: 0.025, rot: 0 }]]),
    hit: loopy([[0, {}], [0.05, { wave: 0.06, sx: 0.82, rot: -0.25, head: -0.4, rootX: -0.05 }, "snap"], [0.2, { wave: 0.04, sx: 0.9, rootX: -0.04 }], [0.42, {}, "inOut"]], false),
    hitLow: loopy([[0, {}], [0.05, { wave: 0.07, sx: 0.85, rot: 0.1, rootX: -0.05, sy: 0.9 }, "snap"], [0.2, { wave: 0.04, rootX: -0.04 }], [0.45, {}, "inOut"]], false),
    block: loopy([[0, { wave: 0.06, sx: 0.82, rot: -0.12, head: -0.3 }], [0.5, { wave: 0.065, sx: 0.8, rot: -0.14, head: -0.32 }], [1, { wave: 0.06, sx: 0.82, rot: -0.12, head: -0.3 }]]),
    blockHit: loopy([[0, { wave: 0.06, sx: 0.82 }], [0.05, { wave: 0.08, sx: 0.74, rootX: -0.03 }, "snap"], [0.2, { wave: 0.06, sx: 0.82 }, "out"]], false),
    crouch: loopy([[0, { wave: 0.015, sy: 0.75, rot: 0.05 }], [1.4, { wave: 0.015, sy: 0.75, rot: 0.05 }]]),
    victory: loopy([[0, { rot: -0.55, head: -0.2, wave: 0.05 }], [0.35, { rot: -0.65, head: -0.35, wave: 0.07 }], [0.7, { rot: -0.55, head: -0.2, wave: 0.05 }]]),
  },
  quadruped: {
    victory: loopy([[0, { rot: -0.45, head: -0.5, thighF: 0.5, kneeF: 0.6 }], [0.25, { rot: -0.55, head: -0.6, rootY: 0.03 }, "out"], [0.5, { rot: -0.45, head: -0.5, thighF: 0.5, kneeF: 0.6 }, "in"]]),
    block: loopy([[0, { rot: -0.1, head: -0.35, thighF: 0.7, kneeF: 1.0, thighB: 0.1, kneeB: 0.9, rootX: -0.02 }], [1, { rot: -0.12, head: -0.38, thighF: 0.72, kneeF: 1.05, thighB: 0.12, kneeB: 0.95, rootX: -0.02 }]]),
  },
};
/** gait-specific locomotion cycles (one cycle = phase 0..1) */
const GAITS: Partial<Record<string, Clip>> = {
  // two hops per cycle, squash on each landing
  hop: loopy([[0, { rootY: 0, sy: 0.86, sx: 1.08, lean: 0.1 }], [0.12, { rootY: 0.12, sy: 1.08, sx: 0.95, lean: 0.2, armF: 1.2, armB: 0.0 }, "out"], [0.25, { rootY: 0.15, sy: 1.02 }], [0.38, { rootY: 0.06, sy: 1.05, lean: 0.12 }, "in"], [0.5, { rootY: 0, sy: 0.86, sx: 1.08, lean: 0.1 }, "in"], [0.62, { rootY: 0.12, sy: 1.08, sx: 0.95, lean: 0.2, armF: 0.2, armB: 1.1 }, "out"], [0.75, { rootY: 0.15, sy: 1.02 }], [0.88, { rootY: 0.06, sy: 1.05 }, "in"], [1, { rootY: 0, sy: 0.86, sx: 1.08, lean: 0.1 }, "in"]]),
  bounce: loopy([[0, { rootY: 0, sy: 0.8, sx: 1.16 }], [0.12, { rootY: 0.09, sy: 1.14, sx: 0.9, lean: 0.12, armF: 1.2, armB: 0.9 }, "out"], [0.25, { rootY: 0.12, sy: 1.04, sx: 0.97 }], [0.4, { rootY: 0.05, sy: 1.06, sx: 0.95 }, "in"], [0.5, { rootY: 0, sy: 0.8, sx: 1.16 }, "in"], [0.62, { rootY: 0.09, sy: 1.14, sx: 0.9, lean: 0.12, armF: 0.6, armB: 1.3 }, "out"], [0.75, { rootY: 0.12, sy: 1.04, sx: 0.97 }], [0.9, { rootY: 0.05, sy: 1.06, sx: 0.95 }, "in"], [1, { rootY: 0, sy: 0.8, sx: 1.16 }, "in"]]),
  slither: loopy([[0, { wave: 0.05, rot: 0 }], [0.5, { wave: 0.055, rot: -0.02 }], [1, { wave: 0.05, rot: 0 }]]),
  roll: loopy([[0, { rot: 0, sy: 1 }], [0.25, { rot: -0.02, sy: 0.985 }], [0.5, { rot: 0.0, sy: 1 }], [0.75, { rot: 0.015, sy: 0.99 }], [1, { rot: 0, sy: 1 }]]),
};

export type AttackKind = "punch" | "kick";
/** the moves a drawing gets for its two attack buttons, plus context moves */
export function movesetOf(rig: Rig): { punch: MoveName; kick: MoveName; air?: MoveName; run?: MoveName } {
  switch (rig.plan) {
    case "quadruped":
      return { punch: "bite", kick: rig.tail.length ? "tailWhip" : "pounce", air: "pounce", run: "charge" };
    case "blob":
      return { punch: "slam", kick: "squish" };
    case "serpent":
      return { punch: "coilStrike", kick: "tailWhip" };
    case "vehicle":
      return { punch: "ram", kick: "wheelie", run: "ram" };
    default: {
      // a limb only counts if it can reach past the drawing's own front (tiny arms under a huge head can't)
      const b = rig.bind;
      const sh = rig.shape;
      const armReach = Math.max(rig.found.armF ? b[J.shF].x + sh.upperArmF + sh.foreArmF : -9, rig.found.armB ? b[J.shB].x + sh.upperArmB + sh.foreArmB : -9);
      const legReach = Math.max(rig.found.legF ? b[J.hipF].x + sh.thighF + sh.shinF : -9, rig.found.legB ? b[J.hipB].x + sh.thighB + sh.shinB : -9);
      const arms = armReach > rig.extent.front + 0.04;
      const legs = legReach > rig.extent.front - 0.02;
      return { punch: rig.weapon ? "swing" : arms ? "punch" : "headbutt", kick: legs ? "kick" : "flop" };
    }
  }
}
export const MOVE_TITLES: Partial<Record<MoveName, string>> = {
  punch: "punch", kick: "kick", swing: "weapon swing", headbutt: "headbutt", flop: "body flop", bite: "bite", charge: "charge", pounce: "pounce",
  tailWhip: "tail whip", slam: "slam", squish: "squish", coilStrike: "coil strike", ram: "ram", wheelie: "wheelie",
};
export const ATTACKS = new Set<MoveName>(["punch", "kick", "swing", "headbutt", "flop", "bite", "charge", "pounce", "tailWhip", "slam", "squish", "coilStrike", "ram", "wheelie"]);
export const isAttack = (m: MoveName) => ATTACKS.has(m);

// ---------------------------------------------------------------- forward kinematics
const down = (a: number, L: number): Pt => ({ x: Math.sin(a) * L, y: -Math.cos(a) * L });
const up = (a: number, L: number): Pt => ({ x: Math.sin(a) * L, y: Math.cos(a) * L });

/** pose → joint positions (figure space, feet planted on y = 0 unless rootY lifts them) */
export function solvePose(shape: RigShape, p: Pose): Joints {
  const j: Pt[] = new Array(15);
  const pelvis = { x: 0, y: 0 };
  const lean = p.lean * shape.leanScale + shape.leanOffset;
  const chest = addP(pelvis, up(lean, shape.torso));
  j[J.pelvis] = pelvis;
  j[J.chest] = chest;
  j[J.crown] = addP(chest, up(lean + p.head + shape.headOffset, shape.head));
  // limb roots ride the torso where the drawing attached them
  const d = { x: Math.sin(lean), y: Math.cos(lean) };
  const n = { x: -d.y, y: d.x };
  const root = (r: { t: number; o: number }) => ({ x: d.x * r.t * shape.torso + n.x * r.o, y: d.y * r.t * shape.torso + n.y * r.o });
  j[J.shF] = root(shape.roots.armF);
  j[J.shB] = root(shape.roots.armB);
  j[J.hipF] = root(shape.roots.legF);
  j[J.hipB] = root(shape.roots.legB);
  j[J.elbowF] = addP(j[J.shF], down(p.armF, shape.upperArmF));
  j[J.handF] = addP(j[J.elbowF], down(p.armF + p.elbowF, shape.foreArmF));
  j[J.elbowB] = addP(j[J.shB], down(p.armB, shape.upperArmB));
  j[J.handB] = addP(j[J.elbowB], down(p.armB + p.elbowB, shape.foreArmB));
  j[J.kneeF] = addP(j[J.hipF], down(p.thighF, shape.thighF));
  j[J.footF] = addP(j[J.kneeF], down(p.thighF - p.kneeF, shape.shinF));
  j[J.kneeB] = addP(j[J.hipB], down(p.thighB, shape.thighB));
  j[J.footB] = addP(j[J.kneeB], down(p.thighB - p.kneeB, shape.shinB));
  // whole-body pitch about the pelvis (+ = forward = clockwise)
  if (p.rot !== 0) {
    const c = Math.cos(-p.rot);
    const s = Math.sin(-p.rot);
    for (let i = 0; i < j.length; i++) j[i] = { x: j[i].x * c - j[i].y * s, y: j[i].x * s + j[i].y * c };
  }
  // plant: lowest foot (or knee, when kneeling) touches the ground
  const low = Math.min(j[J.footF].y, j[J.footB].y, j[J.kneeF].y + 0.01, j[J.kneeB].y + 0.01);
  const lift = -low + p.rootY;
  for (let i = 0; i < j.length; i++) j[i] = { x: j[i].x * p.sx + p.rootX, y: (j[i].y + lift) * p.sy };
  return j;
}

function addP(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

// ---------------------------------------------------------------- ragdoll (KO)
/**
 * Position-based (verlet) ragdoll over the same 11 joints. Bone lengths are the
 * drawing's own, so a lanky drawing flops differently from a stocky one.
 */
export class Ragdoll {
  p: Pt[];
  q: Pt[]; // previous positions
  rest: [number, number, number][];
  settled = 0;
  /** per joint: how far drawn ink hangs below it (a round head, a belly), so the floor holds the ink up */
  clear: number[];
  constructor(joints: Joints, vel: Pt[], dt: number) {
    this.p = joints.map((v) => ({ ...v }));
    this.q = joints.map((v, i) => ({ x: v.x - vel[i].x * dt, y: v.y - vel[i].y * dt }));
    this.clear = joints.map(() => 0);
    const c: [number, number, number][] = BONES.map(([a, b]) => [a, b, dist(joints[a], joints[b])]);
    // stiffeners: keep head on the torso, stop knees/elbows folding inside out
    const brace = (a: number, b: number) => c.push([a, b, dist(joints[a], joints[b])]);
    brace(J.pelvis, J.crown);
    for (const r of [J.shF, J.shB, J.hipF, J.hipB]) {
      brace(r, J.pelvis);
      brace(r, J.chest);
    }
    this.rest = c;
    const pairs: [number, number, number][] = [
      [J.hipF, J.footF, 0.45],
      [J.hipB, J.footB, 0.45],
      [J.shF, J.handF, 0.3],
      [J.shB, J.handB, 0.3],
    ];
    this.limits = pairs.map(([a, b, k]) => {
      const reach = this.reach(a, b);
      return [a, b, reach * k, reach] as [number, number, number, number];
    });
  }
  limits: [number, number, number, number][];
  private reach(_a: number, b: number) {
    const L = (x: number, y: number) => this.rest.find(([i, k]) => (i === x && k === y) || (i === y && k === x))?.[2] ?? 0;
    if (b === J.footF) return L(J.hipF, J.kneeF) + L(J.kneeF, J.footF);
    if (b === J.footB) return L(J.hipB, J.kneeB) + L(J.kneeB, J.footB);
    if (b === J.handF) return L(J.shF, J.elbowF) + L(J.elbowF, J.handF);
    if (b === J.handB) return L(J.shB, J.elbowB) + L(J.elbowB, J.handB);
    return L(J.pelvis, J.chest) + (b === J.kneeF ? L(J.hipF, J.kneeF) : L(J.hipB, J.kneeB));
  }
  step(dt: number, gravity: number) {
    const g = gravity * 0.32; // figure heights / s²
    const ground = 0.012;
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      const q = this.q[i];
      const onGround = p.y <= ground + 0.002;
      const damp = onGround ? 0.7 : 0.995;
      const vx = (p.x - q.x) * damp;
      const vy = (p.y - q.y) * 0.995;
      this.q[i] = { ...p };
      this.p[i] = { x: p.x + vx, y: p.y + vy - g * dt * dt };
    }
    for (let it = 0; it < 8; it++) {
      for (const [a, b, L] of this.rest) solveDist(this.p, a, b, L, L);
      for (const [a, b, min, max] of this.limits) solveDist(this.p, a, b, min, max);
      for (let i = 0; i < this.p.length; i++) {
        if (this.p[i].y < ground + this.clear[i]) {
          this.p[i].y = ground + this.clear[i];
          // friction
          this.q[i].x = this.q[i].x + (this.p[i].x - this.q[i].x) * 0.6;
        }
      }
    }
    let moving = 0;
    for (let i = 0; i < this.p.length; i++) moving = Math.max(moving, dist(this.p[i], this.q[i]) / dt);
    if (moving < 0.05) this.settled += dt;
  }
}

/**
 * KO for rigid bodies with no limbs to flop (a car): the whole drawing hops back, rolls over onto its
 * roof and rocks to a stop. The joints move as one rigid piece, so the drawn ink rolls with them and
 * the lowest bit of ink (not just a joint) rests on the floor.
 */
export class Tumble {
  p: Pt[];
  settled = 0;
  private t = 0;
  private x = 0;
  private y = 0;
  private vx: number;
  private vy: number;
  private dir: number;
  private rel: Pt[];
  private ink: Pt[];
  private landed = false;
  constructor(joints: Joints, ink: Pt[], impulse: Pt) {
    const cx = ink.reduce((t, q) => t + q.x, 0) / (ink.length || 1);
    const cy = ink.reduce((t, q) => t + q.y, 0) / (ink.length || 1);
    this.x = cx;
    this.y = cy;
    this.rel = joints.map((q) => ({ x: q.x - cx, y: q.y - cy }));
    this.ink = ink.map((q) => ({ x: q.x - cx, y: q.y - cy }));
    this.vx = impulse.x * 0.75;
    this.vy = 1.6 + Math.max(0, impulse.y) * 0.4;
    // knocked backwards ⇒ the nose lifts first and it rolls over backwards (counter-clockwise)
    this.dir = impulse.x <= 0 ? 1 : -1;
    this.p = joints.map((q) => ({ ...q }));
  }
  get angle() {
    const k = Math.min(1, this.t / 0.7);
    const roll = Math.PI * (k * k * (3 - 2 * k));
    // after landing on its roof it rocks a little and stops
    const rock = this.t > 0.7 ? 0.12 * Math.sin((this.t - 0.7) * 11) * Math.exp(-(this.t - 0.7) * 3.5) : 0;
    return this.dir * (roll + rock);
  }
  step(dt: number, gravity: number) {
    this.t += dt;
    const g = gravity * 0.32;
    this.vy -= g * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    const a = this.angle;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const rot = (q: Pt) => ({ x: q.x * c - q.y * sn, y: q.x * sn + q.y * c });
    let low = Infinity;
    for (const q of this.ink) low = Math.min(low, rot(q).y);
    if (this.y + low < 0) {
      this.y = -low;
      if (this.vy < 0) this.vy = this.t > 0.6 ? -this.vy * 0.25 : 0;
      this.vx *= this.t > 0.6 ? 0.8 : 0.97;
      this.landed = this.t > 0.6;
    }
    if (this.landed) this.vx *= Math.exp(-dt * 4);
    this.p = this.rel.map((q) => {
      const r = rot(q);
      return { x: this.x + r.x, y: this.y + r.y };
    });
    if (this.t > 1.6) this.settled += dt;
  }
}

function solveDist(p: Pt[], a: number, b: number, min: number, max: number) {
  const dx = p[b].x - p[a].x;
  const dy = p[b].y - p[a].y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const target = d < min ? min : d > max ? max : d;
  if (target === d) return;
  const k = ((d - target) / d) * 0.5;
  p[a].x += dx * k;
  p[a].y += dy * k;
  p[b].x -= dx * k;
  p[b].y -= dy * k;
}

function dist(a: Pt, b: Pt) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// ---------------------------------------------------------------- animator
export type AnimTuning = { wn: number; zeta: number; muscle: number; damping: number; gravity: number };
export const DEFAULT_ANIM: AnimTuning = { wn: 18, zeta: 0.72, muscle: 1, damping: 1, gravity: 14 };

// secondary motion: heads, forearms and shins lag their parents → overlap & follow-through
const CHANNEL_SPEED: Record<keyof Pose, number> = {
  rootX: 1.1,
  rootY: 1.4,
  rot: 0.9,
  lean: 0.85,
  head: 0.55,
  armF: 1,
  elbowF: 0.78,
  armB: 0.9,
  elbowB: 0.72,
  thighF: 1.05,
  kneeF: 0.9,
  thighB: 1.05,
  kneeB: 0.9,
  sx: 1.3,
  sy: 1.3,
  wave: 0.8,
};

const ONE_SHOT: Partial<Record<MoveName, true>> = { hit: true, hitLow: true, blockHit: true, land: true, jumpCrouch: true, ...Object.fromEntries([...ATTACKS].map((m) => [m, true])) };

/** Plays moves on a rig and produces joints every frame. Used by the duel sim and the clan battle. */
export class Animator {
  rig: Rig;
  move: MoveName = "idle";
  time = 0;
  /** looping base (idle / walk / block / crouch / air / victory) that one-shots return to */
  base: MoveName = "idle";
  baseTime = 0;
  pose: Pose = { ...GUARD };
  vel: Pose = zeroPose();
  joints: Joints;
  prevJoints: Joints;
  ragdoll: Ragdoll | Tumble | RapierRagdoll | RapierTumble | null = null;
  /** KO physics: the hand-written verlet ragdoll, or Rapier2D (deterministic build) when loaded */
  physics: "classic" | "rapier" = "classic";
  /** stage walls in this fighter's local x, set by the sim before a knockout (Rapier ragdoll only) */
  walls: [number, number] = [-6, 6];
  private gravity = DEFAULT_ANIM.gravity;
  /** seconds since the knockout (drives a serpent's dying twitch) */
  private koTime = 0;
  private koWave = 0;
  /** shiver amount for line boil (render) */
  shiver = 0;
  private walkPhase = 0;
  /** secondary-motion angle for tails / capes (render reads it) */
  sway = 0;
  private swayVel = 0;
  private air: { vy: number } | null = null;
  /** wheel spin angle (vehicles) and body-wave phase (serpents) */
  spin = 0;
  wavePhase = 0;
  private clock = 0;
  readonly moves: ReturnType<typeof movesetOf>;
  /** aim for straight strikes (radians, − = lower): punches and kicks go where the foe's body is */
  aim = 0;
  /** punch target in figure space (x forward, y up): the fist is steered there with 2-bone IK */
  aimAt: Pt | null = null;
  /** stride per walk cycle in figure heights: tiny legs scurry, long legs stride */
  private stride: number;
  /** a body's own way of standing (a hulk's arms hang wide, its feet are planted wide): pose offsets on the
   * guard / walk / block / hit poses; attacks blend it out on the limbs they swing */
  stance: Partial<Pose> | null = null;
  /** a big body (a sized roster fighter) throws punches and kicks without throwing its whole bulk in: forward lean / step scale */
  attackLean = 1;

  constructor(rig: Rig) {
    this.rig = rig;
    this.moves = movesetOf(rig);
    const legLen = Math.max(rig.found.legF ? rig.shape.thighF + rig.shape.shinF : 0, rig.found.legB ? rig.shape.thighB + rig.shape.shinB : 0);
    this.stride = rig.gait === "walk" || rig.gait === "trot" ? Math.max(0.16, Math.min(0.55, legLen * 1.35)) : rig.gait === "slither" ? 0.7 : 0.5;
    this.joints = this.solve();
    this.prevJoints = this.joints.map((p) => ({ ...p }));
  }

  /** the clip for a move on this body (blobs squash, cars rumble, serpents coil …) */
  clipOf(move: MoveName): Clip {
    if (move === "walk") return GAITS[this.rig.gait] ?? CLIPS.walk;
    return VARIANTS[this.rig.plan]?.[move] ?? (CLIPS as Record<string, Clip>)[move] ?? CLIPS.idle;
  }

  /** pick and start this body's attack for a button; returns the move played */
  attack(kind: AttackKind, ctx: { air?: boolean; running?: boolean } = {}): MoveName {
    const m = ctx.air && this.moves.air ? this.moves.air : ctx.running && this.moves.run ? this.moves.run : this.moves[kind];
    this.play(m);
    return m;
  }

  /** shape changes the renderer and hit tests apply on top of the joints */
  get deform(): Deform {
    const rd = !!this.ragdoll;
    let waveAmp = this.pose.wave;
    if (rd && this.rig.plan === "serpent") {
      // a knocked-out snake twitches a few times, then settles into a still, slack curve
      const t = this.koTime;
      const twitch = [0.35, 0.9, 1.6].reduce((sum, at, i) => sum + Math.exp(-((t - at) ** 2) * 90) * (0.9 - i * 0.25), 0);
      waveAmp = this.koWave * (0.45 + 0.55 * Math.exp(-t * 1.5) + 0.9 * twitch);
    }
    return { sway: this.sway, spin: this.spin, wavePhase: this.wavePhase, waveAmp, sx: rd ? 1 : this.pose.sx, sy: rd ? 1 : this.pose.sy };
  }

  /** start a one-shot move (punch, kick, hit, …) or switch the looping base */
  play(move: MoveName) {
    if (this.ragdoll) return;
    if (move === "ko") return;
    if (ONE_SHOT[move]) {
      this.move = move;
      this.time = 0;
      if (move === "hit" || move === "hitLow" || move === "blockHit") this.shiver = 1;
      return;
    }
    if (this.base !== move) {
      this.base = move;
      this.baseTime = 0;
    }
    if (!ONE_SHOT[this.move]) {
      this.move = move;
      this.time = 0;
    }
  }

  get busy() {
    return !!ONE_SHOT[this.move] && this.time < this.clipOf(this.move).length;
  }
  /** true while the current attack's active window is open */
  get active() {
    const c = ONE_SHOT[this.move] ? this.clipOf(this.move) : null;
    return !!c?.active && this.time >= c.active[0] && this.time <= c.active[1];
  }
  progress() {
    const c = this.clipOf(this.move);
    return c ? this.time / c.length : 0;
  }

  /** KO: hand the current pose to the ragdoll, keep the momentum, add the blow */
  knockout(impulse: Pt, dt: number) {
    if (this.ragdoll) return;
    const vel = this.joints.map((p, i) => ({ x: (p.x - this.prevJoints[i].x) / dt, y: (p.y - this.prevJoints[i].y) / dt }));
    // the blow lands high: upper body takes most of it, legs get swept the other way a bit
    //            pelvis chest crown elbB handB elbF handF kneeB footB kneeF footF shB shF hipB hipF
    // long and round bodies (beasts, snakes, cars, blobs) get shoved and tumble rather than flung upright
    const upright = this.rig.plan === "biped";
    const weight = upright ? [0.6, 1, 1.25, 0.9, 0.9, 1, 1, 0.3, 0.1, 0.3, 0.1, 1, 1, 0.6, 0.6] : [1, 0.9, 0.85, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const lift = upright ? 1 : this.rig.plan === "blob" ? 0.75 : 0.45;
    for (let i = 0; i < vel.length; i++) {
      vel[i].x += impulse.x * weight[i];
      vel[i].y += impulse.y * weight[i] * lift;
    }
    if (upright) {
      vel[J.footF].x -= impulse.x * 0.25;
      vel[J.footB].x -= impulse.x * 0.25;
    }
    // limbs that were never drawn (a snake's, a blob's) must not act as levers: fold them onto
    // their root, then make sure nothing starts under the floor (the floor clamp would pry it up)
    const start = this.joints.map((p) => ({ ...p }));
    if (this.rig.plan !== "vehicle") {
      const limbs: [keyof Rig["found"], number, number, number][] = [
        ["armF", J.shF, J.elbowF, J.handF],
        ["armB", J.shB, J.elbowB, J.handB],
        ["legF", J.hipF, J.kneeF, J.footF],
        ["legB", J.hipB, J.kneeB, J.footB],
      ];
      for (const [limb, root, mid, end] of limbs) {
        if (this.rig.found[limb]) continue;
        start[mid] = { ...start[root] };
        start[end] = { ...start[root] };
        vel[mid] = { ...vel[root] };
        vel[end] = { ...vel[root] };
      }
    }
    const low = Math.min(...start.map((p) => p.y));
    if (low < 0.012) for (const p of start) p.y += 0.012 - low;
    this.koTime = 0;
    this.koWave = Math.max(0.05, Math.abs(this.pose.wave));
    if (this.rig.plan === "vehicle") {
      // a car has nothing to flop: it rolls over onto its roof
      const ink = fightStrokes(this.rig, this.joints, this.deform).flatMap((s) => s.points);
      this.ragdoll = this.physics === "rapier" && physicsReady() ? new RapierTumble(this.joints, ink, impulse, dt, this.gravity, this.walls) : new Tumble(this.joints, ink, impulse);
    } else if (this.physics === "rapier" && physicsReady()) {
      // the ragdoll's bodies come from the drawn lines, not the costume: a hulk's drawn chest would make a fat
      // torso capsule that starts inside the foe it was fighting and gets shot into the sky
      const ink = skinStrokes(this.rig, start, this.deform).flatMap((s, k) => (s.label === "costume" ? [] : s.points.map((q, m) => ({ q, bone: this.rig.strokes[k]?.points[m]?.b0 ?? -1 }))));
      // follower chains (a beast's front legs, extra arms) become real bodies too: hand the ragdoll the
      // extended joints; it returns them extended and the skin reads the chains from there
      this.ragdoll = new RapierRagdoll(extendedJoints(this.rig, start), vel, ink, dt, this.gravity, this.walls);
    } else this.ragdoll = new Ragdoll(start, vel, dt);
    this.move = "ko";
    this.time = 0;
    this.shiver = 1;
  }

  revive() {
    if (this.ragdoll instanceof RapierRagdoll || this.ragdoll instanceof RapierTumble) this.ragdoll.free();
    this.ragdoll = null;
    this.move = "idle";
    this.base = "idle";
    this.time = 0;
    this.pose = { ...GUARD };
    this.vel = zeroPose();
    this.joints = this.solve();
    this.prevJoints = this.joints.map((p) => ({ ...p }));
  }

  /**
   * advance one tick.
   * speed  – signed ground speed in figure-heights/s (+ forward), drives the walk phase so feet don't skate
   * air    – vertical velocity when airborne (null on the ground)
   */
  update(dt: number, opts: { speed?: number; air?: { vy: number } | null; tuning?: Partial<AnimTuning> } = {}) {
    const tune = { ...DEFAULT_ANIM, ...opts.tuning };
    this.gravity = tune.gravity;
    this.prevJoints = this.joints;
    this.shiver = Math.max(0, this.shiver - dt * 2.5);
    this.time += dt;
    this.baseTime += dt;
    this.clock += dt;
    if (this.ragdoll) {
      this.ragdoll.step(dt, tune.gravity);
      this.joints = this.ragdoll.p.map((p) => ({ ...p }));
      this.koTime += dt;
      // upside-down wheels keep spinning down; a dying snake's ripple slows to a stop
      if (this.rig.wheelR > 0) this.spin += dt * 9 * Math.exp(-this.koTime * 0.8);
      this.wavePhase += dt * (1 + 7 * Math.exp(-this.koTime * 1.2));
      // the ragdoll only keeps joints above the floor; drawn ink (a round head, a blob's belly, a
      // snake's ripple) reaches further. Push the joint nearest each sunken bit of ink back up.
      if (this.ragdoll instanceof Ragdoll) {
        const rd = this.ragdoll;
        const need = this.joints.map((_, i) => rd.clear[i] * 0.97);
        for (const st of fightStrokes(this.rig, this.joints, this.deform))
          for (const q of st.points) {
            if (q.y >= 0) continue;
            let best = 0;
            let bd = Infinity;
            this.joints.forEach((jp, i) => {
              const d = (jp.x - q.x) ** 2 + (jp.y - q.y) ** 2;
              if (d < bd) {
                bd = d;
                best = i;
              }
            });
            need[best] = Math.max(need[best], this.joints[best].y - q.y);
          }
        need.forEach((n, i) => {
          rd.clear[i] = Math.min(0.6, n);
          if (rd.p[i].y < rd.clear[i]) {
            rd.p[i].y = rd.clear[i];
            rd.q[i].y = Math.max(rd.q[i].y, rd.p[i].y - 0.002);
          }
        });
        this.joints = rd.p.map((q) => ({ ...q }));
      }
      return;
    }
    const speed = opts.speed ?? 0;
    {
      // tails/capes lag behind motion: trail opposite to travel, lift when falling, wobble on hits
      const vy = opts.air?.vy ?? 0;
      let target = -speed * 0.55 + vy * 0.18 + (isAttack(this.move) ? -0.3 : 0);
      // a happy tail wags; a whipping tail lashes
      if (this.rig.tail.length && (this.move === "idle" || this.move === "victory")) target += Math.sin(this.clock * (this.move === "victory" ? 14 : 5)) * (this.move === "victory" ? 0.6 : 0.22);
      if (this.move === "tailWhip") target = this.time < 0.12 ? 0.6 : this.time < 0.42 ? -1.15 : 0;
      target = Math.max(-1.2, Math.min(1.2, target));
      const w = 9;
      this.swayVel += (w * w * (target - this.sway) - 2 * 0.35 * w * this.swayVel) * dt;
      this.sway += this.swayVel * dt;
    }
    const wasAir = this.air;
    this.air = opts.air ?? null;
    // landing squash
    if (wasAir && !this.air && !isAttack(this.move)) this.play("land");
    // wheels roll with the ground speed; a serpent's wave travels faster when it moves
    if (this.rig.wheelR > 0) this.spin += (speed * dt) / this.rig.wheelR;
    this.wavePhase += dt * (2.2 + Math.abs(speed) * 9) * (isAttack(this.move) ? 1.6 : 1);

    // looping base from locomotion state
    if (!ONE_SHOT[this.move] || !this.busy) {
      if (this.air) this.base = this.air.vy > 1.2 ? "rise" : this.air.vy > -0.6 ? "tuck" : "fall";
      else if (Math.abs(speed) > 0.05 && (this.base === "idle" || this.base === "walk" || this.base === "rise" || this.base === "tuck" || this.base === "fall")) this.base = "walk";
      else if (this.base === "walk" || this.base === "rise" || this.base === "tuck" || this.base === "fall") this.base = "idle";
      if (ONE_SHOT[this.move]) {
        this.move = this.base;
        this.time = this.baseTime;
      } else this.move = this.base;
    }

    // stride scales with the drawn legs (tiny legs scurry); walking backward plays the cycle in reverse
    this.walkPhase += (speed / this.stride) * dt;
    const walkClip = this.clipOf("walk");
    let target: Pose;
    if (this.base === "walk" && !ONE_SHOT[this.move]) target = sampleClip(walkClip, this.walkPhase);
    else if (ONE_SHOT[this.move]) {
      target = sampleClip(this.clipOf(this.move), this.time);
      // legs keep stepping under an upper-body attack while moving (layering, plan §6.7); a charge gallops
      if (Math.abs(speed) > 0.05 && !this.air && (this.move === "punch" || this.move === "swing" || this.move === "blockHit" || this.move === "charge" || this.move === "bite")) {
        const legs = sampleClip(CLIPS.walk, this.walkPhase * (this.move === "charge" ? 1.4 : 1));
        target = { ...target, thighF: legs.thighF, kneeF: legs.kneeF, thighB: legs.thighB, kneeB: legs.kneeB };
      }
      // attacks in the air: keep the tuck in the legs
      if (this.air && (this.move === "punch" || this.move === "swing" || this.move === "headbutt")) {
        const t = CLIPS.tuck.keys[0].pose;
        target = { ...target, thighF: t.thighF, kneeF: t.kneeF, thighB: t.thighB, kneeB: t.kneeB };
      }
    } else target = sampleClip(this.clipOf(this.base), this.baseTime);
    if (this.air) target = { ...target, rootY: 0 };
    if (this.stance) {
      const atk = isAttack(this.move);
      const legsBusy = atk && (this.move === "kick" || this.move === "charge" || this.move === "pounce");
      const t = { ...target };
      for (const [key, v] of Object.entries(this.stance) as [keyof Pose, number][]) {
        const arm = key === "armF" || key === "elbowF" || key === "armB" || key === "elbowB";
        const leg = key === "thighF" || key === "kneeF" || key === "thighB" || key === "kneeB";
        if (arm && (atk || this.move === "block" || this.move === "blockHit" || this.base === "block")) continue;
        if (leg && (legsBusy || this.air)) continue;
        t[key] += v;
      }
      target = t;
    }
    if (this.attackLean !== 1 && (this.move === "punch" || this.move === "kick")) {
      const k = this.attackLean;
      target = { ...target, lean: target.lean > 0 ? target.lean * k : target.lean, rootX: target.rootX > 0 ? target.rootX * k : target.rootX, sx: target.sx > 1 ? 1 + (target.sx - 1) * k : target.sx };
      // the arm that isn't striking stays tucked at the side (cocked at the hip) instead of a huge guard fist
      // held out in front, where it would cover the foe
      const w = 1 - k;
      const mix = (from: number, to: number) => from + (to - from) * w;
      const punchF = this.rig.strike.punch !== J.handB;
      if (this.move === "punch") {
        if (punchF) target = { ...target, armB: mix(target.armB, -0.55), elbowB: mix(target.elbowB, 1.3) };
        else target = { ...target, armF: mix(target.armF, -0.3), elbowF: mix(target.elbowF, 1.4) };
      } else target = { ...target, armF: mix(target.armF, -0.3), elbowF: mix(target.elbowF, 1.4) };
    }
    if (this.aim && (this.move === "punch" || this.move === "kick")) {
      const k = Math.max(0, Math.min(1, this.move === "punch" ? (target.armF - GUARD.armF) / 1.0 : (target.thighF - GUARD.thighF) / 1.2));
      // a low target (a snake, a car's bumper): drop into a crouching punch instead of only tipping the arm down
      const squat = Math.max(0, Math.min(1, (-this.aim - 0.35) / 0.55)) * k;
      if (this.move === "punch") {
        const c = CLIPS.crouch.keys[0].pose;
        const mixL = (a: number, b: number) => a + (b - a) * squat;
        target = {
          ...target,
          armF: this.aimAt ? target.armF : target.armF + this.aim * (0.85 - 0.35 * squat) * k,
          lean: target.lean - this.aim * 0.35 * k + 0.25 * squat,
          thighF: mixL(target.thighF, c.thighF),
          kneeF: mixL(target.kneeF, c.kneeF),
          thighB: mixL(target.thighB, c.thighB),
          kneeB: mixL(target.kneeB, c.kneeB),
        };
      }
      else target = { ...target, thighF: target.thighF + this.aim * 0.9 * k, lean: target.lean + this.aim * -0.3 * k };
    }
    // punches reach for the nearest bit of the foe's drawn body (2-bone IK on the striking arm)
    if (this.move === "punch" && this.aimAt && this.rig.strike.punch === J.handF) {
      const k = Math.max(0, Math.min(1, (target.armF - GUARD.armF) / 1.0));
      const ik = armIK(this.joints[J.shF], this.aimAt, this.rig.shape.upperArmF, this.rig.shape.foreArmF);
      if (ik && k > 0) target = { ...target, armF: target.armF + (ik.arm - target.armF) * k, elbowF: target.elbowF + (ik.elbow - target.elbowF) * k };
    }
    // a weapon in the back hand: that arm does the swinging
    if (this.move === "swing" && this.rig.weapon?.limb === "armB") target = { ...target, armF: target.armB, elbowF: target.elbowB, armB: target.armF, elbowB: target.elbowF };
    // no legs to bend (wheels, a belly, a pogo stick): keep the invisible legs straight so it sits still on the ground
    if (this.rig.plan === "vehicle" || this.rig.plan === "serpent" || (!this.rig.found.legF && !this.rig.found.legB))
      target = { ...target, thighF: 0, kneeF: 0, thighB: 0, kneeB: 0 };

    // critically-ish damped springs per channel: smooth interpolation + a touch of overshoot
    const attack = isAttack(this.move) || this.move === "hit" || this.move === "hitLow" || this.move === "blockHit";
    // big heads are heavy: they lag and bobble
    const headK = this.rig.found.head && this.rig.shape.headRadius > this.rig.shape.torso * 0.75 ? 0.55 : 1;
    const wn = tune.wn * tune.muscle * (attack ? 1.9 : 1);
    const zeta = tune.zeta * tune.damping;
    const steps = 2;
    const h = dt / steps;
    for (let s = 0; s < steps; s++) {
      for (const key of POSE_KEYS) {
        const w = wn * CHANNEL_SPEED[key] * (key === "head" ? headK : 1);
        const z = key === "head" && headK < 1 ? zeta * 0.45 : zeta;
        const a = w * w * (target[key] - this.pose[key]) - 2 * z * w * this.vel[key];
        this.vel[key] += a * h;
        this.pose[key] += this.vel[key] * h;
      }
    }
    this.joints = this.solve();
  }

  /** FK + keep extra (follower) legs above the ground too */
  private solve(): Joints {
    // long bodies turn and squash about their middle, not their hips
    // …and when turned round (a tail whip) the whole length swings forward to where the head was
    const overhang = Math.max(0, this.rig.extent.front - 2 * this.rig.pivotX + 0.05);
    const pose = this.rig.pivotX
      ? { ...this.pose, rootX: this.pose.rootX + this.rig.pivotX * (1 - this.pose.sx) + (this.pose.sx < 0 ? -this.pose.sx * overhang : 0) }
      : this.pose;
    const j = solvePose(this.rig.shape, pose);
    const low = auxLowest(this.rig, j);
    if (low < 0) for (const p of j) p.y -= low;
    return j;
  }
}

/** two-bone IK in pose angles (from straight down, + forward); elbow stays below the reach line */
function armIK(sh: Pt, t: Pt, L1: number, L2: number): { arm: number; elbow: number } | null {
  const v = { x: t.x - sh.x, y: t.y - sh.y };
  const D = Math.min(Math.hypot(v.x, v.y), (L1 + L2) * 0.995);
  if (D < Math.abs(L1 - L2) + 1e-3) return null;
  const theta = Math.atan2(v.x, -v.y);
  const alpha = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const arm = theta - alpha;
  const e = { x: sh.x + Math.sin(arm) * L1, y: sh.y - Math.cos(arm) * L1 };
  const tt = { x: sh.x + (v.x / (Math.hypot(v.x, v.y) || 1)) * D, y: sh.y + (v.y / (Math.hypot(v.x, v.y) || 1)) * D };
  const fore = Math.atan2(tt.x - e.x, -(tt.y - e.y));
  let elbow = fore - arm;
  while (elbow > Math.PI) elbow -= Math.PI * 2;
  while (elbow < -Math.PI) elbow += Math.PI * 2;
  return { arm, elbow };
}

function zeroPose(): Pose {
  const z = {} as Pose;
  for (const k of POSE_KEYS) z[k] = 0;
  return z;
}
