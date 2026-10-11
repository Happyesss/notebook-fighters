"use client";

/**
 * The computer's pre-drawn rivals on the notebook page: the picker you see before a fight against the
 * computer (who, and on which level) and each rival's character card. Every number comes from the
 * fight itself (@nf/sim rivalProfile builds the same sim /play builds), never from a table here.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ROSTER, rivalProfile, type Difficulty, type RivalProfile, type RosterId } from "@nf/sim";
import { Dialog } from "./dialog";
import { paintInk, type Stroke } from "./ink";

export const LEVELS: Difficulty[] = ["easy", "normal", "hard"];
export const LEVEL_NAMES: Record<Difficulty, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const WEIGHT: Record<1 | 2 | 3, string> = { 1: "lightweight", 2: "middleweight", 3: "heavyweight" };
const PICKED_ON: Record<1 | 2 | 3, Difficulty> = { 1: "easy", 2: "normal", 3: "hard" };

/** a few words about each rival (the numbers on the card come from the sim) */
const ABOUT: Record<RosterId, string> = {
  kid: "A skinny kid with long, quick legs. Light on his feet and hard to pin down, but his hits barely sting.",
  dog: "A scruffy notebook dog on four legs. It trots in fast, bites, and charges when it gets a run-up.",
  boxer: "Gloves up, chin down. Throws fast straight punches and keeps his guard tight.",
  karate: "Gi, belt and a calm stare. A strong straight punch and a snapping kick.",
  ninja: "Masked and low to the ground, with a short blade at the ready. Quick in, quick out.",
  swordsman: "Fights with a sword in hand, so he can hit you from further away than a fist reaches.",
  pehelwan: "A wrestler from the akhara: sumo-like bulk and heavy legs. Slow to get going, hard to move.",
  bodybuilder: "Drawn a size bigger than everyone else on the page. Hulking arms, heavy hits, a wide stance.",
};

const BUTTON_NAMES: Record<RivalProfile["moves"][number]["button"], string> = { punch: "Punch button", kick: "Kick button", run: "Run in + punch", air: "Jump + attack" };

export function RivalThumb({ strokes, className = "rival-thumb" }: { strokes: Stroke[]; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    paintInk(ref.current, strokes);
  }, [strokes]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

const strokesOf = (id: RosterId) => ROSTER.find((r) => r.id === id)?.strokes ?? [];

function LevelPicker({ level, onLevel, prefix }: { level: Difficulty; onLevel: (d: Difficulty) => void; prefix: string }) {
  return (
    <div className="lvl-pick" role="group" aria-label="Difficulty">
      {LEVELS.map((l) => (
        <button key={l} type="button" aria-pressed={level === l} data-testid={`${prefix}-level-${l}`} onClick={() => onLevel(l)}>
          {LEVEL_NAMES[l]}
        </button>
      ))}
    </div>
  );
}

/** "HP 104 · punch 7.1 · kick 11 · speed ×1.0" for a picker card */
function keyStats(p: RivalProfile) {
  const [a, b] = p.moves;
  return `HP ${p.hp} · ${a.title} ${a.damage} · ${b.title} ${b.damage} · speed ×${p.speed.toFixed(2)}`;
}

/**
 * Who do you fight, and how hard? Opens after "Play with computer" once you have a drawing.
 * `player` is your drawing: it decides the rival's power on Normal/Hard (as in the fight).
 */
export function RivalPicker({
  player,
  rival,
  level,
  onRival,
  onLevel,
  onFight,
  onInfo,
  onClose,
}: {
  player: Stroke[];
  rival: RosterId | "auto";
  level: Difficulty;
  onRival: (id: RosterId | "auto") => void;
  onLevel: (d: Difficulty) => void;
  onFight: () => void;
  onInfo: (id: RosterId) => void;
  onClose: () => void;
}) {
  const profiles = useMemo(() => {
    const out = new Map<RosterId | "auto", RivalProfile>();
    for (const id of ["auto" as const, ...ROSTER.map((r) => r.id)]) out.set(id, rivalProfile(id, level, player));
    return out;
  }, [level, player]);
  const auto = profiles.get("auto")!;
  const chosen = profiles.get(rival) ?? auto;
  return (
    <Dialog label="Choose your opponent" onClose={onClose} className="picker" testid="rival-picker">
      <h2 className="dlg-title">Who do you fight?</h2>
      <div className="picker-top">
        <LevelPicker level={level} onLevel={onLevel} prefix="pick" />
        <span className="picker-note">Numbers are for {LEVEL_NAMES[level]}, against your drawing.</span>
      </div>
      <div className="picker-grid" role="radiogroup" aria-label="Opponent">
        <button type="button" role="radio" className="pick-card" data-testid="pick-auto" aria-checked={rival === "auto"} onClick={() => onRival("auto")} {...(rival === "auto" ? { "data-autofocus": true } : {})}>
          <span className="rival-q" aria-hidden="true">?</span>
          <span className="rival-name">Computer picks</span>
          <span className="pick-tier">a fair match: {auto.name}</span>
          <span className="pick-stats">{keyStats(auto)}</span>
        </button>
        {ROSTER.map((r) => {
          const p = profiles.get(r.id)!;
          return (
            <div key={r.id} className="pick-cell">
              <button type="button" role="radio" className="pick-card" data-testid={`pick-${r.id}`} aria-checked={rival === r.id} onClick={() => onRival(r.id)} onDoubleClick={onFight} {...(rival === r.id ? { "data-autofocus": true } : {})}>
                <RivalThumb strokes={r.strokes} />
                <span className="rival-name">{r.name}</span>
                <span className="pick-tier">
                  {WEIGHT[r.tier]} · {LEVEL_NAMES[PICKED_ON[r.tier]]} pick
                </span>
                <span className="pick-stats">{keyStats(p)}</span>
                {p.special && <span className="pick-special">★ {p.special.move}</span>}
              </button>
              <button type="button" className="pick-info" data-testid={`pick-info-${r.id}`} aria-label={`${r.name}: full character card`} onClick={() => onInfo(r.id)}>
                i
              </button>
            </div>
          );
        })}
      </div>
      <div className="dlg-actions">
        <button type="button" className="text-btn" onClick={onClose}>
          Back
        </button>
        <button type="button" className="play-link" data-testid="pick-fight" onClick={onFight}>
          Fight {rival === "auto" ? `${auto.name} (computer's pick)` : chosen.name} on {LEVEL_NAMES[level]} →
        </button>
      </div>
    </Dialog>
  );
}

function Stat({ label, value, max, text, testid }: { label: string; value: number; max: number; text: string; testid: string }) {
  return (
    <div className="stat-row" data-testid={testid}>
      <span>{label}</span>
      <span className="stat-track">
        <span className="stat-fill" style={{ width: `${Math.max(4, Math.min(100, (value / max) * 100))}%` }} />
      </span>
      <span className="stat-num">{text}</span>
    </div>
  );
}

/** One rival's character card: real stats on a level, special, moves, abilities, and "Fight this rival". */
export function RivalCard({ id, player, level: level0, onFight, onClose }: { id: RosterId; player: Stroke[] | null; level: Difficulty; onFight: (id: RosterId, level: Difficulty) => void; onClose: () => void }) {
  const [level, setLevel] = useState<Difficulty>(level0);
  const all = useMemo(() => Object.fromEntries(LEVELS.map((l) => [l, rivalProfile(id, l, player)])) as Record<Difficulty, RivalProfile>, [id, player]);
  const p = all[level];
  const pct = (m: number) => `${m <= 1 ? "−" : "+"}${Math.abs(Math.round((1 - m) * 100))}%`;
  return (
    <Dialog label={`${p.name}: character card`} onClose={onClose} className="char-card" testid="char-card">
      <div className="cc-head">
        <RivalThumb strokes={strokesOf(id)} className="cc-thumb" />
        <div className="cc-who">
          <h2 className="dlg-title" data-testid="char-name">{p.name}</h2>
          <p className="cc-kind">
            {WEIGHT[p.tier]} · read as a {p.kind}
            {p.size !== 1 ? ` · drawn ×${p.size} size` : ""} · the computer's pick on {LEVEL_NAMES[PICKED_ON[p.tier]]}
          </p>
          <p className="cc-about">{ABOUT[p.id]}</p>
          <LevelPicker level={level} onLevel={setLevel} prefix="card" />
        </div>
      </div>
      <section className="cc-stats" aria-label={`Stats on ${LEVEL_NAMES[level]}`}>
        <Stat label="HP" value={p.hp} max={175} text={String(p.hp)} testid="cc-hp" />
        {p.moves.slice(0, 2).map((m, i) => (
          <Stat key={m.button} label={i ? "Kick" : "Punch"} value={m.damage} max={22} text={`${m.damage}`} testid={`cc-${m.button}`} />
        ))}
        <Stat label="Speed" value={p.speed} max={1.45} text={`×${p.speed.toFixed(2)}`} testid="cc-speed" />
        <Stat label="Jump" value={p.jump} max={1.3} text={`×${p.jump.toFixed(2)}`} testid="cc-jump" />
        <Stat label="Reach" value={p.reach} max={1} text={p.reach.toFixed(2)} testid="cc-reach" />
        <Stat label="Defense" value={2 - p.armour.body} max={1.5} text={`body ${pct(p.armour.body)}`} testid="cc-defense" />
        <p className="cc-note">
          Punch / kick: damage of one clean hit on {LEVEL_NAMES[level]} (computer hits ×{p.levelDmg}), before blocks and armour. Speed and jump: ×1 is a plain stick figure. Reach: in figure heights. Defense: damage it takes to the body (head {pct(p.armour.head)}).
        </p>
      </section>
      <section className="cc-block" aria-label="Special move">
        <h3>Special move</h3>
        {p.special ? (
          <p data-testid="cc-special">
            <b>★ {p.special.move}</b> ({p.special.name}, every {p.special.cooldown} s): {p.special.passive}.
          </p>
        ) : (
          <p data-testid="cc-special">None on {LEVEL_NAMES[level]}.</p>
        )}
        <p className="cc-note">
          It draws itself a power to match yours: {LEVELS.map((l) => `${LEVEL_NAMES[l]} ${all[l].special ? all[l].special!.move : "none"}`).join(" · ")}.
        </p>
      </section>
      <section className="cc-block" aria-label="Moves">
        <h3>Moves</h3>
        <ul className="cc-moves" data-testid="cc-moves">
          {p.moves.map((m) => (
            <li key={m.button}>
              <span>{BUTTON_NAMES[m.button]}</span> <b>{m.title}</b> <span className="cc-dmg">{m.damage} dmg</span>
            </li>
          ))}
          <li>
            <span>Also</span> <b>block · crouch · jump</b>
          </li>
        </ul>
      </section>
      {p.abilities.length > 0 && (
        <section className="cc-block" aria-label="Abilities">
          <h3>Abilities (read from its drawing)</h3>
          <ul className="cc-abilities" data-testid="cc-abilities">
            {p.abilities.slice(0, 5).map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      <div className="dlg-actions">
        <button type="button" className="text-btn" onClick={onClose}>
          Close
        </button>
        <button type="button" className="play-link" data-testid="card-fight" data-autofocus onClick={() => onFight(id, level)}>
          Fight this rival →
        </button>
      </div>
    </Dialog>
  );
}
