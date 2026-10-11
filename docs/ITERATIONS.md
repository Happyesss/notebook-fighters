# Notebook Fighters: iteration log ("the fighter you draw is the fighter that moves")

## Starting point
- Only `apps/web` existed. `/play` redirected to `/` and imported `@nf/shared`, `@nf/sim` and `@nf/render`, none of which existed.
- The war page skinned strokes with a simple nearest-bone rule onto a fixed rest pose, so a hat or cape could hijack the binding.
- `reading.ts` had a type error, and `next/font` needed network access at build time, so the build failed offline.

## Iteration 1: make it build and run
- Created `packages/shared` (types, tuning, constants), `packages/sim` and `packages/render`, consumed as TS source via `transpilePackages`.
- Wrote the skeleton reader (`inferRig`): it finds the head, torso, arms and legs from the strokes, then does a 15-joint FK rig with 2-bone linear blend skinning. Every stroke point is stored as (bone, t, offset), so the user's own ink deforms with the bones.
- Added a keyframed clip library: idle, walk, punch, kick, block, crouch, hit, hitLow, blockHit, jumpCrouch/rise/tuck/fall/land, victory. It has eased anticipation and overshoot (`back`/`snap` easings), plus a per-channel spring follow so limbs lag the body (secondary motion).
- Added a verlet ragdoll for KO, and the Canvas2D renderer: two-pass graphite line, line boil, smears, onomatopoeia, dust, screen shake, hit flash, KO scribble and "OUT!" stamp.
- Fixed `reading.ts` and swapped `next/font` for a `<link>` with CSS fallbacks.
- Restored `/play` as a real duel page.
- Playwright test (`/workspace/proj/e2e/moves.mjs`) draws a figure with the mouse and steps the sim deterministically through every move, saving screenshots.

## Iteration 2: the reader picked the hat as the head
- Head choice now uses a roundness score (coefficient of variation of the radius). Loops inside another loop count as features (eyes, spiral faces).
- The jagged boil became a smooth sinusoid at about 10 fps.

## Iteration 3: kicks and rival hits whiffed
- The hurtbox is now the victim's bones plus its skinned ink.
- Strikes are sampled along the whole limb chain, not just the tip.
- Lunges are held until the active window.
- AI spacing uses the drawing's real extent.

## Iteration 4: messy drawing
- A spiral face inside the head is no longer read as an arm.
- One stroke for body+leg is split at the hip.
- One stroke for both arms is split at the crossing.
- One primary limb per side; extras become aux chains that copy their source limb's motion. A steep extra "arm" hanging off the shoulders becomes a cape.

## Iteration 5: "they can draw ANYTHING"
- Body plans:
  - biped;
  - quadruped (body axis near horizontal; mirrored so it faces +x if the head points -x);
  - blob (a big loop with 3+ connections, or a loop body with no head; PCA axis).
- Part labels: head add-on (hat, hair, horn), face/body detail, tail (a dangle spring that sways), cape (dangle), prop/weapon (rigid to the hand it touches), extra arms and legs (followers).
- Fallbacks:
  - missing legs get a planted virtual foot;
  - a single line becomes a body that headbutts;
  - a scribble becomes a blob;
  - no hands means the strike joint is the crown (headbutt).
- `/play` shows what was read ("I read a four-legged beast: head, body, tail...").

## Iteration 6: per-drawing fixes from screenshots
- The four-armed figure got a false hip split; splitting now requires the leg end to be near the ground.
- The blob's eye was taken as its head.
- The long dog and the blob overlapped the rival; separation now uses `rig.extent`.
- The dog's hind legs lifted off the ground; lean is scaled per plan.
- The tail branch was unreachable in the classifier.

## Iteration 7: browser pass on all 6 test drawings
- Test drawings: clean, sloppy, fourArms, quadruped, blob, swordsman.
- All land punch, kick, hit, hitLow, block (chip damage), KO and victory, with 0 page errors.
- The quadruped trots in diagonal pairs (front legs follow the opposite hind leg).

## Iteration 8: polish
- Quadruped "kick" is a buck/pounce: hind legs drive back, the body stretches, the head leads.
- Push boxes shrink (×0.82) while someone is mid-attack, so pounces and headbutts connect without fighters overlapping at rest. Base gap raised to 0.18.
- Bug: the rival "brute" sketch's shoulder-pad line was read as "both arms in one stroke", which demoted the real arms to followers. Now:
  - split strokes only win when long (reach > 0.15);
  - a short line across the body once the limbs exist is a "body add-on".
- Main-page clan battle verified with hand-drawn soldiers (a sword and a tail ride along): `shots/war_*.png`.

# Round 2: moves that fit the body, odd drawings, stats from the reader

## Iteration 9: reader extensions for odd shapes
- New plans: `serpent` (one long squiggle) and `vehicle` (two round loops at the bottom plus a wide chassis). New gaits: walk, trot, hop, bounce, slither, roll.
- Car: the wheels are no longer read as a head. The chassis, wheels and window are labelled, the pelvis and chest sit on the wheel centres, and invisible legs run from axle to wheel bottom.
- Tree: the trunk is no longer split at the hip (`endAttached`). The canopy reads as a big head.
- Plus sign: the upright line of a cross becomes the body and the crossbar becomes the arms.
- Big head: a head up to 0.9 of the figure is still a head when a body line hangs below it (`hangsBelow`), so it is no longer read as a blob.
- Snake: a quadruped with no leg or arm candidates becomes a serpent.
- Weapons: the longest prop held in a hand becomes the weapon. A prop in the other hand is a "shield / held thing".
- Each drawing gets a plain-English kind ("vehicle on wheels", "serpent", "four-legged beast with a tail", "walking tree", "big-headed fighter", "legless fighter (hops)" and so on), shown on /play as "I read a …".

## Iteration 9b: moves per body
- `movesetOf(rig)` maps the two buttons, plus run-in and jump context, to clips:

| Body | Punch | Kick | Run in | In the air |
|---|---|---|---|---|
| Beast | bite | tail whip (pounce if no tail) | charge | pounce |
| Blob or circle | slam (squash, then a stretch crash) | squish | | |
| Serpent | coil strike | tail whip | | |
| Vehicle | ram | wheelie | ram | |
| Armed biped | overhead swing | kick | | |

  - A short-armed biped (tree, big head) headbutts or punches depending on its reach; a short-legged one does a body flop ("TIMBER!").
- A deform layer drives several effects:
  - blobs squash and stretch, mirror-safe;
  - car wheels spin with the distance travelled;
  - a serpent's body carries a travelling wave, with the head end steadier;
  - tails trail behind and whip.
- Each attack has a MoveSpec: striker (punch, kick, head, tail, weapon, body or front), damage, knockback, lunge or leap, and a hit word (SHING!, CHOMP!, SPLAT!, HISS!, CRASH!, VROOM!, TIMBER!).
- Hits are tested against the deformed ink, not only the bones, so a long car or snake can be hit anywhere along its body.

## Iteration 9c: aim and spacing (fixing misses on long bodies)
- Punches and kicks aim at the band of the foe's leading edge. The fist is steered with 2-bone IK toward the nearest foe ink (with a bias toward the upper body). A low target such as a car or snake gets a crouching punch.
- Turning pivots about the middle of the body. Tail whips overhang when flipped.
- The push-box gap now shrinks additively: 0.18 at rest, 0.10 while attacking and 0.03 during the active frames. The multiplicative version let fighters walk onto a long body.

## Iteration 9d: stats from the same reader
- `apps/web/app/reading.ts` `measure(rig)` computes:
  - bulk: loop area or ink length of the torso and head;
  - armour: shields and add-ons;
  - arm reach, leg length, and extra limbs.
- HP is 70 + 60·sat(bulk) + armour, clamped to 55–140. Punch depends on the plan, reach and weapon; speed depends on the gait.
- The reading line explains the numbers in words and lists the moves.
- War page:
  - soldiers use `anim.attack()`, and damage is `moveDamage(move)`;
  - long and wide drawings are scaled to a stick man's ink footprint (`fitOf`) and stand off by their own front edge.

## Iteration 10: browser pass on 12 drawings plus polish
- Drawings: clean, sloppy, fourArms, swordsman, quadruped, blob, loneCircle, snake, car, tree, plusSign, bigHead.
- All 12 land their punch and kick moves, plus the dog's run and air specials, in Playwright, with 0 page errors.
- Fixes:
  - weapon and tail trails reset on a turn instead of streaking;
  - hop amplitude raised so legless hoppers read as hopping;
  - KO: undrawn limbs fold onto their root and nothing starts under the floor, so the snake no longer pole-vaults when it gets knocked out (it is flung and lies flat);
  - non-bipeds get a lower, uniform KO impulse, so they tumble instead of flying upright.

# Round 3: main-page battle layout, rival cards, the last KO and facing gaps

## Iteration 11: main-page battle (war-client.tsx)
- Problem: 4 overlapping soldiers per side.
  - Each one's stand-off was set by its own drawn front edge, so a car (front edge 1.4 figure-heights ahead of its root) stopped far back.
  - Meanwhile 2 blue guards fought in the middle. Our drawing was not the one fighting, and our queue piled up on the hall.
- New layout:
  - One duel at a time on the field. Fighter 1 (the player's first drawing, in its own pencil colours) marches out of our hall gate and meets Guard 1 at the centre line. The front edges of their drawn ink stop 1.4% of the page width short of the line.
  - Everyone else waits on a "next up" bench under the field, side by side in drawing order. The bench scale is computed so they all fit with no overlap.
  - When a duellist is knocked out, it lies still, fades off the page, and the next fighter comes out of the hall.
  - Knocked-out bodies are clamped so they never slide into their own hall.
- Sizing: drawings are fitted to at most about 0.9 fig² of ink and 1.45 figure-heights across, then scaled ±10% by HP. A car stays car-sized next to a stick man.
- The halls are smaller and their cannons are pulled in, so the field between the halls is free.
- Name and an outlined HP bar float over each duellist, in the clan's colour. Bench fighters are labelled under their feet.
- A fighter mid-swing takes the blow but finishes its move, so a slow ram or slam is no longer stun-locked by quick punches.
- Reading cards:
  - The duellist's card shows the full reading. The others stay compact (name, body, stats), so the cards no longer reach down into the fight.
  - The cards give way to the verdict, which sits above the winner instead of on it.
- Rival cards: the generic text ("FIGHTER" / "The other hall sent a fighter of the same strength") was on purpose. Rivals are blue stick sketches given the same HP, punch and speed as the drawing they face, so the moves decide the fight. The card now says so explicitly:
  - "GUARD (STICK FIGHTER, HELMET)" or "BRUTE (STICK FIGHTER, SHOULDER PADS)";
  - "Matched to Fighter 1 (vehicle on wheels): same HP, punch and speed, so the moves decide it";
  - the moves come from reading the guard's own sketch (`rivalSketch()` is shared with the battle).

## Iteration 11b: small gaps
- Hit words: a new swing, hit or block retires the previous hit word (life cut to 0.08s), so "CRASH!" no longer hangs over the next wheelie. The K.O. stamp stays.
- A car drawn facing left now turns to face its foe. The cabin (the upper part of the outline, plus any window) sits behind the centre; the bonnet is the longer low end. If the cabin is right of centre, the drawing is mirrored. Test drawing: `carLeft`.
- A car KO is now a `Tumble`: the car hops back, rolls over backwards onto its roof, rocks and stops with its wheels spinning down. Its lowest drawn ink rests on the floor.
- Snake KO: the ripple twitches 3 times (at 0.35, 0.9 and 1.6s), slows and settles into a slack, still curve, lying on top of the floor.
- All ragdolls: the floor now holds up the drawn ink, not only the joints. Each joint gets a clearance for the ink hanging below it, so a KO'd stick man's head, a blob's belly or a dog's body no longer sinks halfway into the ground.

## Verification (all passing)
- `tsc --noEmit` passes for apps/web and packages/sim, render and shared.
- `next build` passes.
- `packages/sim/test/recognize.ts`: the parts and plan for all 12 drawings.
- `test/duel.ts`: each drawing lands both of its moves (and its extras), is hit by the rival's punch and kick, blocks, and lands its moves as the rival on the right.
- `test/edge.ts`: dog facing left, single line, scribble, a dot, random lines, car facing left, arms only; all skinned ink is finite.
- `test/stats.ts`: stat sanity (big bodies have more HP; cars and beasts are faster than blobs, and so on).
- `test/ko.ts`: every drawing's KO rests on top of the floor (a brief dip of up to 0.08 is allowed while landing), the car ends on its roof, and the snake twitches, then settles.
- `/workspace/proj/e2e/moves.mjs` (Playwright, headless) captures every move per drawing into `shots/it11_<drawing>/` (13 drawings including `carLeft`), plus `x_charge` and `x_pounce` for the dog.
- `/workspace/proj/e2e/war.mjs`: draws 4 soldiers on the main page with matching pencils, screenshots the battle every 2s into `shots/war3*`, and checks the layout at every snapshot: no two visible fighters overlap on a row, and nobody stands on a hall. 3 scenarios (odd shapes, stick fighters, tree/blob/big head/plus sign) show 0 overlaps and 0 errors.
- Overview: `shots/moves.png` (drawing × move key frames) and `shots/moves.gif` (all 12 doing the same button).

## Known gaps
- Physics is still a kinematic sim plus a verlet ragdoll (and a scripted car tumble), not Rapier. Rendering is Canvas2D, not Pixi.
- The main-page layout check uses each drawing's bind-pose extent. Mid-attack lunges (a ram, a pounce) can briefly reach over the centre line into the foe, by design.
- A tree reads as a fighter with a big head (the canopy). That is believable, but it is not a bespoke "tree" body.
- A car whose cabin is drawn dead centre keeps its drawn direction.
- The stats formulas are hand-tuned heuristics.
- No sword/shield parry; a shield only adds HP.

## Round 4: fair fights on /play (2026-10-10)

Problem (from a real playthrough): the rival hit the player during the duel click and right after R; the CPU was far too strong; hits felt stingy; there was no crouch button; /favicon.ico gave a 404; there was no round flow.

Changes
- sim: a `countdown` (3 s on /play with the AI on, 0 with ?ai=off) during which both fighters get NO_INPUT and the AI does not think. "FIGHT!" shows for 0.7 s.
- sim: `Difficulty` easy/normal/hard via `AI_PROFILES`: think interval, attack bias, a single block roll after a reaction delay (the old AI rolled 4% every frame, about 52% per attack), combo cap then back-off, and damage scaling for rival and player (only when the AI is on, so the duel/reach tests are unchanged).
- sim: player assist lunge toward the foe on ground attacks, plus +0.035 bone/ink hit slack for the player.
- sim: best of 3 (`round`, `wins`, `matchWinner`, `rematch()`, `reset(match)`).
- web: banner (3-2-1 / FIGHT! / K.O. card / match card; tap it or press R for the next round), a round row with Easy/Normal/Hard (saved in localStorage, or ?level=), a Crouch pad button, and a tap latch so quick key presses are never lost between frames. app/icon.svg is the favicon.
- css: the K.O. card has a paper background and sits above the winner's head; the reading line sits under the bars and hides while a K.O. card is up.

Verification
- packages/sim/test/bot.ts: a casual-human bot (13-20 frame lag, random-ish choices). Over 100 rounds across all bodies: Easy 100%, Normal 48%, Hard 7%. Rounds average more than 15 s.
- e2e/human.mjs: real keys in Chromium, 4 drawings x 5 rounds on Normal. Won 10/20, shortest round 16.7 s, average 22.2 s, 0 damage during countdowns, 0 console errors, no 404s.
- recognize / duel / edge / stats / ko / reach all pass; moves.mjs (ai=off) is unchanged; tsc and next build are clean.

Gaps: balance varies by body (blob ~20% win, car ~70% for the bot); the bot is only a proxy for humans; HP is a flat 100 in /play (reader stats are not applied there); Rapier/Pixi are still out.

## Round 5, phase 1: the drawing shapes the fight (2026-10-10)

Problem: scribbling a part again (the notebook's own advice) made the reader see *extra limbs* ("5-armed fighter", "tail, cape" for a re-drawn body); /play used a flat 100 HP; per-body balance was off (bot: blob ~20%, car ~70%).

Changes
- rig: overdraw collapse. A stroke whose ink lies ≥80% within 0.035 figure-heights of a longer earlier stroke reinforces it (same part, label, bone; `rig.over[i]` = base index). Re-drawing an arm 4× now reads "fighter" with "armF (drawn 4×)".
- sim/stats.ts (new, plan §5): passes per part = how often ink enters a small circle around each point of the part's own line (only ink of that part counts, so junctions don't), weighted by pencil darkness (0.85 + 0.3·(1 − luminance)); p75 along the part; strength s = 1 − exp(−(d − 1)/2.5).
  - HP = 100 × body (bulk, capes/hats) × (1 + 0.4·s_head + 0.15·s_torso); punch/kick ×(1 + 0.6·s_striking limb + 0.2·s_other); legs: speed ×(1 + 0.2·s̄), jump ×(1 + 0.25·s̄); per-part armour 1/(1 + 0.5·s_p) applied to the part that is hit; weapon/tail/body strikes use their own part.
  - Scribble budget: s_head + s_torso + ½·Σ limbs/weapon/tail ≤ 1.6, else all scaled down (the card says so).
  - Body-type power budget: at one pass every body type gets the same power index (HP × reach × arms × speed^0.5 × measured body edge); HP and damage are scaled by √(1/power). Body edges calibrated with test/calibrate.ts (bot vs Normal CPU; the CPU's biped is the reference).
- sim uses each drawing's stats (max HP per side, damage × striker multiplier × victim's part armour, speed, jump). SimState carries playerMax/bagMax.
- web: reading.ts uses computeStats (cards on the main page show the same numbers); each notebook slot shows live "HP · hits · speed" + the top reason; /play has a Fighter Card (stat bars + reasons + the rival's line) that opens during the countdown/K.O. and folds while fighting (pin with the button). HP bars scale to each side's max.

Verification
- test/scribble.ts: re-drawn arm/head/legs stay a plain "fighter" (no extra limbs); dark right arm punch +45%, HP/kick unchanged; a back-and-forth scrub counts; dark head HP +28%; dark legs faster/jump/kick; darkening everything hits the budget and loses to each specialist; no drawing (13 + 5 scribbled) is best at HP, hits and speed at once.
- e2e/card.mjs: draws clean + darkRightArm with the mouse; slot stats read "HP 100 · hits ×1.2 … very dark right arm (4 passes): punch +45%"; /play card shows Punch ×1.48 and the reason; the card folds during the fight.

## Round 5, phase 2: powers from doodles (2026-10-10)

Problem: a doodle on a fighter (a flame, a bolt, drops) was either ignored or misread as an extra limb or a weapon. Every fighter had the same two buttons.

Changes
- sim/powers.ts (new, plan §8): shapeOf() reads a stroke's shape after 2× [1,2,1] smoothing. The shapes are zigzag, bolt (2–3 alternating corners), wave, line, curve, drop and loop. hueOf() sorts the pencil into warm, gold, cool or neutral. rig.ts maps doodles to powers:
  - fire: a zigzag in a warm colour or graphite, or a warm drop or wave
  - lightning: a bolt, or a gold zigzag or drop
  - water: cool drops or a cool wave, or ≥2 graphite drops
  - ice: a blue zigzag, or an asterisk of crossing short lines
  - wings: a loop at the upper back
  - shield: a loop held at a hand, unless it is a sword's guard
  - spikes: a zigzag hugging the body
  Zigzags on the head are hair. At most 2 powers per drawing. Power ink never counts as a limb or weapon. rig.powers = [{kind, strokes, bone}].
- stats: powers count in the scribble budget (½ weight). Drawing a doodle over again makes it stronger (×0.85–1.15). Each power also costs body power through POWER_EDGE (shield 1.35, spikes 1.06, wings 1.04, elements 1). The card shows a line for each power, e.g. "fire doodle: special Fireball, burns on hit".
- sim: the fighter kit is its special plus passives. `PlayerInput.special` fires it when the cooldown is ready (1.5 s at round start).
  - Fireball: a projectile, 9 damage, burns 2.2/s for 1.6 s.
  - Water wave: a low, tall projectile, 7 damage, big knockback. It puts out burning and leaves a puddle that slows the other side to ×0.55.
  - Ice shard: 8 damage, freezes for 1.7 s (walk ×0.5, animation ×0.6, blue tint).
  - Lightning dash: 5.6 u/s for 0.28 s, passes through, 7 damage, stun.
  - Dive (wings): climb, then steer down onto the foe, 11 damage. Passives: double jump and glide.
  - Shield bash: 7 damage, stun 0.7. Passive: blocks take only 4% and stop shots and specials completely.
  - Spike burst: close range, 7 damage, knockback. Passive: thorns return 12% of melee damage.
  Counters (elementMult ×1.5 / ×0.67): water beats fire, fire beats ice, ice beats water, lightning beats water. Shots clash in the air and the counter wins (PSSHH! / HISS! / CRACK!).
- sim: blows thrown in the same frame now both land (strikes resolve from the frame's starting state), so trades are fair in 2P.
- CPU: the rival uses its special when ready and in range (Easy 0.2 / Normal 0.3 / Hard 0.5 per decision). `rivalPower: "auto"` picks a power deterministically:
  - Easy: none.
  - Normal: only if you drew one, never your counter or your own kind, from wings/shield/fire/ice/water.
  - Hard: the counter to your element, else lightning or fire.
  The rival's specials hit ×0.6/0.7/0.95 (they are a gift, not drawn). setDifficulty redraws the rival's power.
- render: fireballs (scribbled orange ball with a tail), water waves (three curling crests), ice shards, puddles, burning flames and frozen crystals over the head, a lightning/dive after-image, coloured hit words (FWOOSH! SPLASH ×1.5! ZAP! FREEZE! SWOOP! BASH! SPIKES!).
- web /play: a Special pad button, the E key (or L), a cooldown meter under each health bar ("Fireball ready" / "Ice shard 2.1s", in the element's colour), and power lines on the Fighter Card for you and the rival. The reading line moved under the taller bars and wraps. ?rivalPower=<kind>|none overrides the rival's power.

Verification
- test/powers.ts: all 11 powered drawings are read with the right power, the rest of the body is unchanged, and plain drawings have no powers. The swordsman's round shield reads as a shield; its cross-guard does not.
- test/specials.ts: each power's special fires once and lands (fireball 10.4, wave 5.8, ice 6.6, dash, dive, bash, burst), with no second special during cooldown. Also checked:
  - fire burns, ice slows walking 0.10 vs 0.38, water leaves a puddle
  - the dash stuns and ends past the rival; wings jump higher (0.78 vs 0.47)
  - a shield block takes 0 from a fireball (a bare block takes 1.5); thorns hurt the puncher
  - the water wave douses the fireball and rolls on; water vs fire hits ×1.5
  - runs are deterministic; the Hard rival answers fire with water
- e2e/powers.mjs (Chromium, real keys): for all 7 powers the card shows ★ special, the meter goes ready, then cooling after E, the special hits, and the Special button works. Water douses a fireball in the browser. The Hard CPU draws water against a fire drawing and uses it. 0 page errors.
- Bot balance on Normal (test/bot.ts, N=100 per body, 17 bodies incl. 7 powered): every body 38–61%, all 47%. Easy 100%, Hard 8% (N=40).

## Round 5, phase 3: local 2-player (2026-10-10)

Changes
- sim: `ai: "versus"`: `step(p1, tuning, p2)` drives the second fighter from player 2's input (no CPU). Both players get the step-in assist and hit slack, with no damage scaling. Best of 3 and the countdown work as in 1P.
- web home: a "2 players, one keyboard" row (P1 box / P2 box pickers, default boxes 1 and 2, with P1/P2 badges on the boxes). "2P duel →" saves nf:fighter and nf:fighter2 and opens /play?mode=2p.
- web /play?mode=2p: P1 uses A/D walk, W/Space jump, S crouch, F punch, G kick, H block, E special. P2 uses ←/→ walk, ↑ jump, ↓ crouch, J punch, K kick, L block, ; (or /) special. There is one key reader per player with its own tap latch.
  - Two legends, each on its own side, and split touch pads (7 each: walk ←/→, Hit, Kick, Jump, Block, ★).
  - P1/P2 health bars and meters, a "P1 wins round 1" / "P2 wins the match!" banner, P1/P2 name tags over the heads, no difficulty buttons. R starts a rematch.
  - In 1P, J/K/arrows still work as before.

Verification
- test/versus.ts: idle P2 stays put (no CPU), P2 walks in and lands hits, the two face each other, and a best-of-3 between a fire and a water drawing ends 2–1 with specials from both.
- e2e/twop.mjs (Chromium): draws a fire fighter in box 1 and an ice fighter in box 2 with the mouse. The button goes from "both players draw first" to "2P duel →". Then:
  - versus mode starts with the countdown; both legends show; 14 pads, P1 on the left and P2 on the right
  - D+← held together moves both in; E+; fire both specials together
  - F/G vs J/K trade hits (P1 101→52, P2 90→29); the P2 punch pad and P1 block pad work
  - the best of 3 ends with "P1 wins the match!"; R gives a 0–0 rematch with the countdown; 0 page errors

### Round 5 wrap-up (2026-10-10, ~15:00 IST)
- Re-ran everything after the interruption; nothing was broken.
  - tsc is clean for sim, render, shared and web; `next build` passes.
  - Sim tests pass: recognize, duel, edge, stats, ko, reach, rig, scribble, powers, specials, versus.
  - Bot balance passes: Normal 38–61% per body and 47% overall.
  - Browser tests pass: card.mjs, powers.mjs and twop.mjs.
- :3100 serves /, /play and /play?mode=2p (200).
- moves.gif and moves.png were regenerated from it12 (13 drawings × 11 moves, 0 errors), and stickfight-improved.zip was rebuilt.

## Round 5, phase 4: game feel (2026-10-10)

Changes
- Impact (sim):
  - Hit-stop now grows with damage: (2 + dmg/5) frames, capped at 10. A jab freezes 4 frames and a kick 5. Specials use 3 + dmg/5.
  - The final blow freezes for 14 frames.
  - Hit events name the victim, and snapshots now copy deform and tip so recorded frames stay intact.
- Impact (render):
  - The fighter who is hit squashes and stretches (×1.22 wide, ×0.82 tall, a springy wobble that dies away over ~0.4 s).
  - The camera punches in toward heavy hits (≥11 damage: +5–14% zoom) and toward a K.O. (+24%), then eases back out within ~0.6 s (first tried +32%, but that cropped the victory frames in moves.png).
  - Screen shake is unchanged (trauma²).
- Slow-mo: the client runs the sim at 0.3× for 1.3 s after a K.O. event.
- Replays (web): a ring buffer keeps the last 300 frames (5 s) of sim states, each with its effects and a slow-mo flag. About 2.3 s after a K.O., the window from 1.8 s before the blow to 0.8 s after replays at ×0.35, with a "REPLAY ×0.35" caption. The banner, reading line and card hide during the replay. R cancels it.
- Save clip:
  - The button replays the whole buffer onto the canvas at 1× (the slow-mo stretch stays slow) and records it with MediaRecorder from canvas.captureStream(30). The format is VP9/VP8 WebM, with the sound track when sound is on.
  - It downloads as notebook-fighters-<time>.webm. A red recording dot and a "CLIP" caption show while it records.
- Sound: app/play/sfx.ts makes every sound with WebAudio; no audio files are downloaded.
  - Whooshes are a pencil scratch (band-passed noise swept down), heavier for kicks and swings.
  - A hit is a thwack: a sine thump plus filtered noise, scaled by damage. A block is a tak click; jumps and landings are soft thuds.
  - A K.O. rings a desk bell (inharmonic partials). The countdown ticks like a classroom clock and FIGHT! rings a trilled school bell.
  - Powers:
    - fire: a whoomph and crackle
    - water: a splash sweep and gurgle
    - lightning: a buzzy saw zap
    - ice: a glass chime
    - wings: wing flaps
    - shield: a clang
    - spikes: clicks
  - Shots that clash in the air hiss.
  - The AudioContext is created only on the first key or tap. Repeats of the same sound are spaced out. The mute toggle (🔊/🔇) is saved in localStorage nf:mute.
- Fixes:
  - P1/P2 tags slide apart side by side when the fighters overlap.
  - Hard is softened: think 0.5 + 0.45 s, block 0.38, reaction 0.2, special chance 0.45, rival specials ×0.8, rival damage ×0.9.

Verification
- e2e/feel.mjs (Chromium) passes:
  - Audio is "none" before any gesture and "running" after one key, with 3 sounds (ticks plus bell) by FIGHT! and 0 audio errors.
  - Mute is saved as "1"; after a reload it shows "sound off"; unmuting saves "0".
  - Hit-stop: a jab (8.3 damage) freezes 4 frames and a kick (13.5) 5 frames. The receiver's squash amplitude is 0.94.
  - A K.O. runs 51 slow-mo frames with a camera punch-in of 0.18. The REPLAY ×0.35 caption plays, then the K.O. banner returns.
  - Save clip downloads a 0.85 MB WebM: EBML header 1A45DFA3, VP9, 1280×720, 153 frames per ffprobe.
  - Overlapping 2P tags end up 76 px apart. 0 page errors.
- Bot balance (Normal N=100 per body, 17 bodies): 39–60% per body, 47% overall. Easy 100%. Hard 20% overall (car 3%, fourArms 33%).
- All sim tests pass; tsc is clean; next build passes; :3100 serves /, /play and /play?mode=2p.
- These browser tests also pass: card.mjs, powers.mjs (fire, water), twop.mjs and human.mjs (0 countdown damage, 0 errors).
- moves.gif and moves.png were regenerated from it13 (13 drawings, 0 errors).

## Round 5 · Phase 5A — online 1v1 (checkpoints)

### Checkpoint 1 (4:16 PM IST) — what exists after the interruption
- `apps/server`: Colyseus **0.16** (`@colyseus/core` + `ws-transport`; 0.18 needs Node ≥ 22, the box has Node 20). Room `duel`, 6-char code = roomId, seats 2, holds both drawings, server-side pings → input delay, relays inputs, full per-seat input log, checksum compare → `desync` broadcast, `allowReconnection(60 s)` on dropped sockets, `/health` counters. Port 2567.
- `packages/shared/src/net.ts`: protocol, `packInput`/`unpackInput` (1 byte/frame), `pickDelay`, room codes.
- `packages/sim/src/lockstep.ts`: deterministic lockstep with input delay, redundant sends (last 8 frames), stall when a peer's input is missing, rounds advance a fixed 180 frames after a KO (match: 300), FNV-1a `sim.checksum()` every 60 frames.
- `packages/sim/src/online.ts`: `OnlineSession` (shared by browser and Node test), simulated lag pipe (`?lag=100&jitter=30`: extra round trip, in-order), ping, reconnect resync, rebuild + fast-forward after a page reload.
- `apps/web/app/online`: lobby (Create room / join by code), share link `/r/CODE` → `/online?join=CODE`, net HUD (ping, delay, frame, sync), disconnect banner, auto-reconnect, `?autoplay=SEED` scripted fighter for tests.
- Headless Node test (`apps/server/test/headless.ts`, real server + 2 colyseus.js clients): no lag, 100±30 ms, drop+reconnect, reload+fast-forward — all full best-of-3, same rounds both sides, 0 desyncs.
- Found while resuming: in dev, React's double-mount made `/online?join=` open two sockets (the second join hit a full room). Fixed: connect on the next tick and drop the socket if the effect was already cleaned up.
- Next: two-browser Playwright test (normal + 100 ms ±30 jitter + keys/drop/reload).

### Checkpoint 2 (4:27 PM IST) — two real browsers, full matches
- `e2e/online.mjs`: two Playwright contexts against the server on :2567.
  1. No lag: room code + `/r/CODE` link (307 → `/online?join=CODE`), full best of 3 (1996 frames). Same rounds on both clients (R1 P1@815, R2 P1@1696), 33/33 shared checksums identical, 0 desyncs. Delay 3 frames, ping 1 ms.
  2. 100 ms ±30 ms jitter on both clients: delay picked as 10 frames (167 ms). Full best of 3 (2893 frames, 3 rounds: P2/P1/P2), identical on both, 48/48 checksums, 0 desyncs.
  3. Keyboard input travels over the network (A holds D; A's fighter walks on B's screen). B's socket is closed: A shows the "connection dropped" banner and B reconnects by itself. B reloads mid-match: it gets its seat back, rebuilds the match, fast-forwards 366 frames and lands on the same frame as A with identical checksums.
  - Server totals: 3 matches, 11,076 input frames, 188 checksum reports, 0 desyncs, 2 reconnects. 0 page errors.
- Both clients run at a measured 60 sim fps and 60 draw fps (about 0.3 ms per draw).
- Scope change for this task: Pixi and Rapier are opt-in for now. Defaults are Canvas2D and the classic ragdoll; `?renderer=pixi` and `?physics=rapier` turn them on. The finished work is left for phase 5B.

### Checkpoint 3 (4:37 PM IST) — regression run, how to run it
- Game server is running in the background on the box: `PORT=2567 tsx apps/server/src/index.ts`, log at /tmp/nf-server.log, `curl localhost:2567/health`.
- How to run:
  - `pnpm server`: starts Colyseus on :2567.
  - `pnpm dev`: starts the web app on :3100.
  - Open `/online` and click "Create room", then send the `/r/CODE` link.
  - The client finds the server at `ws://<page host>:2567` by default. Override with `?server=` or `NEXT_PUBLIC_NF_SERVER`.
- Tests:
  - `pnpm test:online` runs the headless test (4 scenarios).
  - `node e2e/online.mjs` runs the two-browser test.
- Results, all green:
  - Sim tests: recognize, duel, edge, stats, ko, reach, rig, scribble, powers, specials, versus, rivalcheck and the new rapier test.
  - The headless online test passes all 4 scenarios (369 checksums, 0 desyncs, 2 reconnects).
  - Browser tests: card, powers, twop, human (5/5 rounds, 0 countdown damage) and feel.
  - The new online.mjs passes.
  - tsc is clean for web and server. `next build` passes and adds the routes /online and /r/[code].
- Known limits (phase 5A):
  - It is lockstep only (no rollback), so the input delay grows with latency: 3 frames on LAN and 10 frames (167 ms) at 100±30 ms.
  - The delay is picked once, at the start of the fight.
  - No spectators and no TURN/WebRTC.
  - The room is closed if a seat stays away for more than 60 s.

## Round 5 · Phase 5B — Rapier + Pixi (checkpoints)

### Checkpoint 0 (4:36 PM IST) — starting point
- Rapier KO ragdoll (`packages/sim/src/physics.ts`): ten bone capsules whose thickness comes from the ink, revolute joints with limits, feeler balls on ink that sticks out (swords, doodles), floor and stage walls, the winner's bones as kinematic obstacles, calming damping. Behind `?physics=rapier`. The car still uses the hand-written Tumble.
- Pixi renderer (`packages/render/src/pixi-ctx.ts`): a Canvas2D-shaped adapter, so the same drawing code runs on Pixi v8 Graphics/Text. Behind `?renderer=pixi`. Software WebGL falls back to Canvas2D unless Pixi was chosen.
- To do: rapier online lockstep in browsers, the car on Rapier, KO screenshots, Pixi parity (replay, clip, specials), fps benchmark, the dog's missing name tag online.

### Checkpoint 1 (5:08 PM IST) — Rapier KO hardened
- Car (vehicle plan) on Rapier: `RapierTumble` is one rigid body whose collider is the drawn ink (up to 90 small balls). It is hopped back with a spin sized to its airtime and rolls onto its roof (axle dx −1.01), resting on the paper.
- Ink rests on the floor: bone ownership comes from the skin, feeler balls stand in for ink that sticks out past the bone, and the floor is lowered to 0.002. Resting ink now sits between −0.02 and +0.02 for all drawings (classic let heads and bellies sink).
- Follower chains are real bodies now. A beast's front legs and extra arms used to be stiff feelers on the trunk, so the dog stayed standing on stilts. Each chain is now two capsules plus revolute joints, the ragdoll returns extended joints, and `extendedJoints` passes them through, so the dog folds with all four legs splayed.
- No more propping: the winner's bones only collide for the first 0.45 s (the blow itself), the stage walls are slick (friction 0.05, min-combine), and a body still upright after 0.7 s gets a slump nudge (its trunk is pushed the way it leans, or away from the wall, and down).
- `test/rapier.ts` passes for all 17 drawings plus the 7 powered and 4 graphite ones. A rapier versus match replayed twice gives 79/79 identical checksums.

### Checkpoint 2 (5:37 PM IST) — online lockstep with Rapier, KO shots, dog tag
- `Q="physics=rapier" TAG=rapier node e2e/online.mjs`: all 3 scenarios pass.
  - No lag: 34 identical checksums.
  - 100±30 ms lag: 36 identical checksums, same rounds and winner on both clients.
  - Keys, a dropped socket and a reload with a 364-frame fast-forward: 10 identical checksums.
  - Server: 0 desyncs. Page errors: 0.
- `ONLY=1 Q="physics=rapier&renderer=pixi"`: 3 rounds, 57 identical checksums, 0 desyncs.
- KO shots: `shots/p5b/rapier_ko_key.png` (stick man, car, dog: classic at rest / Rapier falling / Rapier at rest), plus `shots/p5b/ko/*`. The KO sheet now hides the HUD and centres the crop on the body.
- Dog name tag:
  - Tags are drawn last, with a paper-coloured outline, so hit words ("CHOMP!") no longer cover them.
  - Tags close together share one line, side by side (the y tolerance went from 0.12 to 0.6 of the figure height).
  - Empty names fall back to P1/P2, in both the client and the server.
  - online.mjs now asserts that both tags are drawn inside the canvas on both screens: A ["YOU","Ben"(dog)], B ["Ana","YOU"].

### Checkpoint 3 (5:45 PM IST) — Pixi parity
- `Q="renderer=pixi&physics=rapier"` feel.mjs passes FEEL OK:
  - hit-stop 4 and 5 frames;
  - K.O. slow-mo for 31 frames, camera punch-in 0.18;
  - auto replay ×0.35;
  - "Save clip" makes a valid 1280×720 VP9 WebM (104 frames, 849 KB);
  - 2P tags slide apart.
- powers.mjs passes POWERS UI OK: all 7 specials fire, the water wave douses the fireball, and the Hard rival counter-draws.
- 0 page errors in both runs. HUD shows "Pixi (WebGL)" and "KO: Rapier".
- Shots: `shots/p5b/pixi_parity.png` (replay, fireball, lightning dash, a clip frame).

### Checkpoint 4 (5:55 PM IST) — fps benchmark and the defaults decision
- Benchmark (e2e/engine.mjs, shots/p5b/bench.json): the same busy CPU-vs-CPU fight on Hard, 1280×720, headless Chromium. The box only has SwiftShader (software) WebGL.

  | Renderer | Live fps | Max throughput (fps) | Frame time |
  |---|---|---|---|
  | Canvas2D | 60.2 | 446 | 2.24 ms |
  | Pixi | 35.6 | 47 | 21.2 ms |
  | Pixi, no MSAA | 51.6 | 60 | 16.7 ms |

- Decision:
  - **Rapier becomes the default KO physics** (`DEFAULT_PHYSICS = "rapier"`; online rooms default to rapier too). `?physics=classic` and the toggle keep the verlet ragdoll.
  - **Pixi stays opt-in** (`?renderer=pixi` or the toggle); Canvas2D remains the default. The bar was "fps equal or better", and Pixi is slower everywhere it could be measured. A real GPU could not be tested on this box.
- engine.mjs passes ENGINE OK with the new defaults (canvas + rapier).

### Checkpoint 5 (6:24 PM IST) — full regression with the new defaults (canvas + rapier)
- tsc is clean for sim, render, web and server. `next build` passes.
- Sim tests: rig, shapes, recognize, duel, ko, powers, specials, stats, edge, reach, versus, scribble, rivalcheck and rapier all pass. The `bot` calibration script is not part of the suite and is unchanged, so it was not run.
- Browser tests:
  - card, powers, twop and feel pass;
  - human: 5 rounds, 0 countdown damage, 0 errors;
  - engine passes ENGINE OK;
  - online.mjs with defaults (now rapier) passes 3 scenarios with 0 desyncs.
- `pnpm test:online` (headless) passes: 335 checksums, 0 desyncs.
- Moves (it14, all 29 drawings, defaults): 0 errors.
  - moves.gif is regenerated with a shared median-cut palette at 0.75 scale: 3.3 MB, down from 5.9 MB.
  - moves.png is regenerated and quantised: 0.3 MB.
- Zip refreshed: 97 files, 4.2 MB. It contains the code, the e2e scripts, moves.gif/png and the key p5/p5b shots. Clips and big shots are left out.
- Servers: dev :3100 and game :2567 are up.
- Gaps: the Pixi fps on a real GPU is still unmeasured, and Pixi stays opt-in.

## Phase 6 — vs-computer is a normal 1v1, a pre-drawn roster, drawing quality, slower pace, phones/tablets/gamepads

### Checkpoint 1 (6:40 PM IST) — 1v1 vs computer, the roster, drawing quality, pace
- **The clan/castle battle is gone.** The home page (`home-client.tsx`) has two slots ("You" and an optional Player 2) and a rival picker: "Computer picks" plus 8 pre-drawn fighters. "Fight the computer" opens `/play` (`?rival=<id>`) as a normal 1v1. The 2P duel and the online duel stay as they were. `war-client.tsx` was deleted.
- **Roster** (`packages/sim/src/roster.ts`): skinny kid and dog (tier 1); boxer, karate guy, ninja and swordsman (tier 2); pehelwan and bodybuilder (tier 3).
  - Each one is drawn in pencil strokes with a little wobble and read by the same rig reader as a player drawing, with the same proportions and height (0.85 of the page).
  - Big guys get a heavier lead: a new optional `InkStroke.w` line weight is used only when drawing the line, not by the reader. The bodybuilder also has a 3× overdrawn trunk and arms and a chest, so it really hits harder: punch ×1.48.
  - "Computer picks" chooses the tier from the level (Easy → kid/dog, Normal → the four tier-2 fighters, Hard → pehelwan/bodybuilder) and is deterministic for a given drawing.
  - New test `test/roster.ts` checks that every entry reads with no stray tails, limbs or powers; HP is between 95 and 140; the swordsman has a sword; the picks follow the level; `?rival=` works.
- **Drawing quality** (`drawingQuality` in stats.ts) is scored from:

  | Factor | Weight |
  |---|---|
  | detail | 30% |
  | clean closed head | 20% |
  | symmetry | 20% |
  | dark (overdrawn) parts | 15% |
  | add-ons | 15% |

  - It adds up to +10% HP and +6% hit damage (hard caps).
  - It is shown on the Fighter Card as a "Drawing" bar plus a line of explanation.
- **Pace**: `GAME_PACE = 0.72` scales all sim motion (walk, attacks, knockback, powers, the KO ragdoll). Countdown and banners stay real time. AI decisions run at the same pace (`AI_PACE` = 1, override with `NF_AI_PACE`). Normal rounds now average about 29–32 s, up from about 20 s.

### Checkpoint 2 (7:16 PM IST) — phones, tablets, touch, gamepads
- **Touch controls on every fight page** (`play/touchpad.tsx`): 1P, the 2P duel (one pad per player, mirrored) and the online duel.
  - A virtual joystick: drag left/right to walk, up to jump, down to crouch.
  - Big Punch and Kick buttons, plus Jump, Block, Crouch and a ★ Special button.
  - Each control captures its own pointer, so walking and punching with two thumbs works (multi-touch).
  - The controls press the same key names as the keyboard, so the sim and the online netcode are unchanged.
  - On a mouse (`pointer: fine`) the pad is smaller and the keyboard legend still shows.
- **No scroll or zoom**: a `viewport` export (no user scaling, viewport-fit cover), `touch-action: none` on the stage, pads and drawing slots, and `overscroll-behavior: none`.
- **Responsive layout**:
  - Phone portrait: one slim top row (back, sound/engine buttons, Tuners) with full-width health bars under it; the arena sits above the controls.
  - Phone landscape: the arena is lifted above the stick and buttons, which are slightly see-through.
  - Home: a 3-column rival grid on phones; the drawing slot fits the screen in landscape.
  - The Next dev badge is hidden (`devIndicators: false`).
- **Gamepad API** (`play/gamepad.ts`), standard mapping:
  - left stick or d-pad: move (up jumps, down crouches);
  - A jump, X punch, Y kick, B/LB/LT block, RB/RT special.
  - Pad 1 plays P1 (or you) and pad 2 plays P2. It is polled every frame on /play and /online.
- **Drawing with touch** works on the home slots (pointer events, with `touch-action: none`).
- **Test**: new `e2e/mobile.mjs` passes as MOBILE OK, 34 checks, using real CDP touch events.
  - Devices: iPhone 13 portrait and landscape, Pixel 7, iPad Pro 11 portrait and landscape.
  - Steps on each device:
    - draw the fighter with a finger;
    - pick the Bodybuilder and fight;
    - push the stick and hold Punch together (two fingers);
    - check the fighter walks and the keys release;
    - swipe the arena and check there is no scroll or zoom.
  - Also covered: a stubbed gamepad (stick plus X walks and punches), the 2P phone duel (P1 stick and P2 punch at once) and the online page's pad.
  - Known emulation quirk: on the iPads, the first tap after the scripted drawing sometimes loses its click, so the test taps the rival card again.
- **Sim fix**: the CPU's dice were a module-level seed shared by every sim in the process, so two fights in one process were not repeatable (specials.ts "deterministic" failed once the pace changed). The seed is now per fight.
- Screenshots are in `shots/p6/`: home_*, fight_bodybuilder_* (each device), twop_iPhone_13_landscape, online_Pixel_7, play_iPhone_13*.

### Checkpoint 3 (8:35 PM IST) — roster costumes and full-screen phone fights (from the review of the landscape shot)
- **Roster fighters look like themselves in the fight.** There is a new optional `InkStroke.deco` for costume lines ("head", "torso", or "auto" for the nearest bone).
  - The reader skips costume lines; they are skinned onto the bones after the reading, so they move, ragdoll and render with the fighter. They are excluded from the passes and bulk measures.
  - test/roster.ts checks that all 35 costume lines leave every entry's reading and stats unchanged.
  - Costumes per fighter:

    | Fighter | Costume lines |
    |---|---|
    | Bodybuilder (rust red) | V-shaped torso outline, pecs, abs, bulging biceps, triceps, forearms and thighs |
    | Pehelwan (brown) | the whole round belly, navel, heavy thighs and shoulders, a filled red langot |
    | Ninja (indigo) | hood and face mask scribbled in, red sash |
    | Boxer (plum) | red gloves and trunks filled in |
    | Karate (teal) | gi sides and sleeves, thick black belt |

  - Every pre-drawn fighter now has its own ink colour, distinct from the player's graphite.
- **Fair pre-drawn rivals**: `NotebookSim.fairRival()` sets a roster rival's HP and average hit to those of the plain sketch rival with no power, times its tier step (`ROSTER_TIER_STEP`: 0.94 / 1 / 1.06) and its power step (`RIVAL_POWER_STEP`). This keeps the rival's strength separate from the player's power edges, so tuning one doesn't move the other.
  - A tier step is then applied: ×0.94 for kid/dog, ×1 for tier 2, ×1.06 for pehelwan/bodybuilder.
  - The fighter keeps its own shape: which strike is stronger, speed, reach and armour.
- **Phones fight full-screen** (`play/arena.ts` sets the view's new `layout`: ground line, fill and side room, per fit):
  - Landscape: the canvas fills the whole screen, and the ground line sits above the thumb controls.
    - The controls are one low row: the stick in the left corner and six buttons in the right corner.
    - The HUD is a single slim strip: both bars side by side, power meters only when a power is drawn, and the round/level row inline.
  - Portrait: the bars sit side by side with the round row under them; the arena takes the middle and the controls sit below it.
  - The sound, Canvas2D/Pixi, KO physics and clip chips, the "I read a fighter…" line and the Tuners move into a ☰ menu (testid `menu`) on phones.
  - The fighters are now about 2× taller on a landscape phone.
  - Online uses the same framing.
- mobile.mjs gains checks that the ☰ menu hides and shows those items, that the arena is at least 50% of the height, and that the ground line is above the attack buttons.

### Checkpoint 4 (8:50 PM IST) — every device checked again, iPad header fix
- `e2e/mobile.mjs` was run one device at a time in the foreground on iPhone 13 (portrait), iPhone 13 landscape, Pixel 7, iPad Pro 11 and iPad Pro 11 landscape. Every run ends in MOBILE OK, with 11–12 checks each.
- Phones (iPhone portrait, Pixel): the chips, reading line and tuners are hidden while fighting and shown in the ☰ menu. The arena takes 57% of the height in portrait and all of it in landscape. The ground line sits above the attack buttons.
- iPad portrait: the engine chips (Canvas2D / KO / Save clip) ran under the health bars. A new rule for 701–900 px wide screens taller than 500 px wraps them into the space left of the bars.
- The bodybuilder now reads as its own fighter on every device: rust-brown ink, a thick trunk and arms, pecs, abs and arm bulges.
- Known quirk: in emulated iPads the rival card sometimes needs a second tap after scripted drawing (Chromium emulation). The test retries the tap and logs it.
- Shots: `shots/p6/fight_bodybuilder_{iPhone_13,iPhone_13_landscape,Pixel_7,iPad_Pro_11,iPad_Pro_11_landscape}.png` and `shots/p6/menu_*.png`.

### Checkpoint 5 (9:28 PM IST) — balance against the roster, full regression
**Balance** (GAME_PACE 0.72, `test/bot.ts`, the casual bot plays the player's drawing against a pre-drawn roster rival)
- Rival strength is now separate from the player's power edges (see Checkpoint 3). Tuning: `BODY_EDGE` armed 0.9→0.74, blob 0.62→0.54. `POWER_EDGE` ice 1.02→1.08, shield 2.0→1.8, spikes 0.95→1.05. `RIVAL_POWER_STEP` ice 0.9, shield 0.9 (the others stay at 1).
- At N=40, one body can swing 20–35 points between identical runs, so the final Normal table uses N=120 rounds per body:

  | body | rival power | Normal, bot wins |
  |---|---|---|
  | clean | – | 55% |
  | swordsman | ice | 57% |
  | fourArms | – | 48% |
  | bigHead | – | 49% |
  | tree | – | 53% |
  | plusSign | – | 56% |
  | quadruped | – | 51% |
  | snake | – | 52% |
  | blob | – | 46% |
  | car | – | 48% |
  | fire | shield | 54% |
  | water | fire | 58% |
  | lightning | water | 60% |
  | ice | wings | 57% |
  | wings | shield | 48% |
  | shield | wings | 36% |
  | spikes | water | 55% |

  All 17 bodies are inside 35–65%. Shield is the closest to the edge.
- Easy (N=40): the bot wins 100% with every body. Hard (N=40): 11–18% per group. By body: clean 38%, quadruped 0%, swordsman 3%, shield 5%, the rest 8–23%.

**Regression** (all green)
- tsc: shared, sim, render, server and web.
- next build OK.
- Sim tests: rig, shapes, recognize, duel, ko, powers, specials, stats, edge, reach, versus, scribble, rivalcheck, rapier, roster.
  - `stats.ts` was updated: "four arms hit harder" and "big head soaks more" now compare stats before the body-type balance (divided by bodyScale), the same way the sword check does. The traits still add strength. The balance edges and the clean figure's drawing-quality bonus had hidden that in the raw numbers.
- Browser e2e: card, powers, twop, human, feel, online (0 desyncs), engine and mobile (5 devices, Checkpoint 4).
- Headless online: ONLINE OK, 0 desyncs.
- The game server was restarted with the new sim first.

### Checkpoint 6 (in progress, 12:57 AM IST) — difficulty tuning (Easy 75–90%, Normal 35–65%, Hard 20–35%)
- Already in code: shield power edge 1.8→1.7. `RIVAL_POWER_STEP` fire 1.04, lightning 0.9 (ice 0.9, shield 0.9 kept). `test/bot.ts` takes `AI="hard.block=0.22,easy.think=0.6/0.55"` overrides for tuning.
- Why Hard was lopsided: with the quadruped, removing the rival's blocks (0→21%) or limiting its combo to 1 (0→42%) helped far more than removing its power (0→8%). So the main levers were Hard's block 0.38 and combo 3.
- Passes at 40 rounds per body (bot wins):
  - Easy, old profile: 100% for every body.
  - Easy t3 (think 0.6/0.55, attack 0.74, block 0.28, reaction 0.28, rivalDmg 1.0, playerDmg 0.7, combo 2, backOff 0.85): 60–93%, mean ~71%.
  - Easy t4 (think 0.65/0.58, attack 0.72, block 0.25, reaction 0.3, rivalDmg 0.95, playerDmg 0.75, combo 2, backOff 0.9): 80–100%, mean ~90%.
  - Hard t3 (rivalDmg 0.88, playerDmg 0.72, block 0.22, combo 2, backOff 0.6): 13–43%, mean ~29%. Swordsman 13% and shield 18%, both against lightning.
  - Hard t4 (same plus the rival steps for lightning and fire): 20–45%. Quadruped is at 0% against a fire rival and still needs work.
- 1:20 AM IST:
  - **Finding:** the bot test only ever met one rival per level (kid on Easy, ninja or boxer on Normal, pehelwan on Hard). The page picks the rival by drawing and round. `test/bot.ts` now plays the whole tier in turn: kid and dog on Easy; boxer, karate, ninja and swordsman on Normal; pehelwan and bodybuilder on Hard.
  - **Quadruped on Hard:** 0% against both the pehelwan and the bodybuilder. Without the rival's blocks it rises to 38% (clean only goes 25→42%), so its slow, telegraphed beast moves were being blocked every time. New AI rule: the rival blocks bite, tail whip, charge and pounce at half its usual rate (`HARD_TO_READ_BLOCK` 0.5).
  - **Easy t5** (think 0.62/0.56, attack 0.73, block 0.27, reaction 0.29, rivalDmg 0.98, playerDmg 0.72, combo 2, backOff 0.88), kid only: 63–95%, mean ~80%. Pass t6 re-runs this Easy profile and Hard t4 against the full tier pools.
- 1:37 AM IST, pass t6 (full tier pools, 40 rounds):
  - **Easy (t5 profile):** 43–95%, mean ~72%. Shield 43% and tree 53%; the dog is tougher than the kid.
  - **Hard (t4 profile + beast rule):** 10–43%, mean ~26%. Low: quadruped 10%, clean 13%, tree 13%, blob 15%. Swordsman is at 43%.
  - **Pass t7:** Easy think 0.68/0.6, attack 0.7, block 0.22, reaction 0.32, rivalDmg 0.9, playerDmg 0.78. Hard rivalDmg 0.84, playerDmg 0.75.
- 1:40 AM IST, pass t7:
  - **Easy:** 78–100%, mean ~89%, too easy. The answer lies between t6 and t7.
  - **Hard:** against fire rivals 15–35% (mean ~25%); against lightning rivals 40–53%, so lightning rival step 0.9 overshot.
  - **Pass t8:** lightning rival step 1.02. Easy think 0.65/0.58, attack 0.72, block 0.25, reaction 0.3, rivalDmg 0.94, playerDmg 0.75. Hard unchanged from t7.
- 1:48 AM IST, pass t8 (40 rounds):
  - **Easy:** 73–100%, mean ~84%. fourArms, plusSign and shield 73%; snake 100%; blob and car 93%.
  - **Hard:** against fire rivals 15–35%. Against lightning rivals at 1.02: swordsman 10%, shield 13%, the rest 20–28%. At 0.9 (t7) the same bodies were 40–53%, so the lightning step is very sensitive.
  - **Now written into `AI_PROFILES`:**
    - Easy: think 0.65/0.58, attack 0.72, block 0.25, reaction 0.3, rivalDmg 0.94, playerDmg 0.75, combo 2, backOff 0.9.
    - Hard: think 0.5/0.45, attack 0.8, block 0.22, reaction 0.2, rivalDmg 0.84, playerDmg 0.75, combo 2, backOff 0.6.
  - **Pass t9 (Hard only):** lightning rival step 0.96.
- 2:03 AM IST, pass t9 (40 rounds):
  - **Hard:** against fire rivals 15–35%. Against lightning rivals at 0.96: lightning 50%, water 53%, wings 57%, swordsman 35%, shield 23%.
  - **Normal with the full tier pool** (karate and swordsman now included): mean ~42%. Low: bigHead 25%, car 25%, fourArms 30%, shield 33%. Swordsman is high at 68%.
  - **Pass t10 (last tuning pass):**
    - Normal rivalDmg 0.92→0.86.
    - Lightning rival step 0.99.
    - `BODY_EDGE`: armed 0.74→0.82, manyArms 1.06→0.98, bigHead 1.25→1.12, vehicle 0.75→0.68.
- 2:18 AM IST, pass t10 (40 rounds):
  - **Normal:** 28–68%. blob 28%, fourArms 33%, snake 68%, swordsman 65%, ice 63%; the rest 38–55%.
  - **Hard:** 15–48%. fourArms, spikes and swordsman 15%; lightning 48%; the rest 20–35%.
  - **Small nudges for the final run:** `BODY_EDGE` manyArms 0.94, blob 0.5, serpent 1.22.
  - **Final table:** 120 rounds per body, all three levels, 24 parallel processes.
- 2:36 AM IST — **final table** (120 rounds per body; Easy plays the kid and dog in turn, Normal the boxer, karate, ninja and swordsman, Hard the pehelwan and bodybuilder):

  | body | Easy | Normal | Hard |
  |---|---|---|---|
  | clean | 82% | 59% | 28% |
  | swordsman | 85% | 53% | 22% |
  | fourArms | 88% | 57% | 37% |
  | bigHead | 86% | 57% | 35% |
  | tree | 78% | 41% | 24% |
  | plusSign | 89% | 50% | 26% |
  | quadruped | 90% | 52% | 26% |
  | snake | 99% | 63% | 28% |
  | blob | 93% | 46% | 23% |
  | car | 99% | 48% | 33% |
  | fire | 83% | 48% | 30% |
  | water | 84% | 53% | 34% |
  | lightning | 80% | 57% | 40% |
  | ice | 83% | 62% | 25% |
  | wings | 78% | 53% | 35% |
  | shield | 73% | 43% | 15% |
  | spikes | 76% | 61% | 15% |

  - **Normal:** all 17 bodies inside 35–65%.
  - **Easy:** 13 of 17 inside 75–90%. Outside: snake 99%, car 99%, blob 93%, shield 73%.
  - **Hard:** 12 of 17 inside 20–35%. None below 15%, but shield and spikes are at exactly 15%. Above the band: lightning 40%, fourArms 37%. Just below 20%: none apart from shield and spikes.
  - **Final parameters:**
    - Easy: think 0.65/0.58, attack 0.72, block 0.25, reaction 0.3, rivalDmg 0.94, playerDmg 0.75, combo 2, backOff 0.9.
    - Normal: rivalDmg 0.86, everything else unchanged.
    - Hard: block 0.22, rivalDmg 0.84, playerDmg 0.75, combo 2, backOff 0.6.
    - Beast moves are blocked at half rate.
    - `RIVAL_POWER_STEP`: fire 1.04, lightning 0.99, ice 0.9, shield 0.9.
    - `BODY_EDGE`: armed 0.82, manyArms 0.94, bigHead 1.12, blob 0.5, serpent 1.22, vehicle 0.68.
    - `POWER_EDGE`: shield 1.7.
  - All sim tests pass after the tuning.

### Checkpoint 7 (2:55 AM IST) — phone landscape header spacing
- **Problem:** on iPhone SE, 13 and 15 Pro Max in landscape, the ☰ (8–46 px), "← notebook" (54–115 px) and the HP bars (from 123 px) were only about 8 px apart, and the red margin line ran through "← notebook".
- **Fix (phone landscape only):**
  - "← notebook" moves into the ☰ menu on /play (`menu-back`, styled like the menu buttons).
  - The bars start at 72 px (plus the safe-area inset), with a 1rem gap between the bars.
  - The margin line moves to 57–59 px, between ☰ and the bars.
  - On /online there is no ☰, so "← notebook" stays in the header at 72 px, also clear of the line.
- **Test:** `e2e/mobile.mjs` now checks on phones that ☰, back, the two bars and the round row never overlap, that ☰ and back keep at least 16 px to their neighbours, that the margin line runs through no header text, and, in landscape, that "← notebook" is in the ☰ menu.
- **Before the regex fix:** iPhone SE, iPhone 13 and iPhone 15 Pro Max landscape all show ☰ 8–46 and the YOU bar from 72, so the nearest gap is 26 px. The margin-line check had a regex bug that read nothing; it is fixed and re-run in the regression below.
- Neither server was restarted; a demo recording is running.
- 3:35 AM IST — **quick regression** (no server restarts):
  - **mobile.mjs:** 7 devices — iPhone SE landscape, iPhone 13, iPhone 13 landscape, iPhone 15 Pro Max landscape, Pixel 7, iPad Pro 11 and iPad Pro 11 landscape. All end in MOBILE OK.
    - Header in landscape: ☰ 8–46 px, YOU bar from 72 px (26 px gap), margin line at x=58 px, "← notebook" in the ☰ menu.
    - Portrait keeps its two-row header. The margin-line check applies to landscape only; the first iPhone 13 portrait run failed on it before it was scoped, and the re-run passes.
  - **human:** pass, won 4 of 5. **feel:** FEEL OK.
  - **tsc:** sim, web and server pass. **Sim tests:** all 15 pass.

## Phase 7 — real sound effects, controls per device

### Checkpoint 0 (3:55 PM IST) — sources
- **Blocked:** the box can't reach kenney.nl, opengameart.org, freesound.org, archive.org or github.com (connections time out). It can reach cdn.jsdelivr.net and npm.
- **Source used:** Kenney's CC0 packs (Impact Sounds, Foley Sounds, RPG Audio, Sci-Fi Sounds, Interface Sounds, Digital Audio, Music Jingles), which are mirrored unchanged with their `License.txt` files in the GitHub repo CraigBuilds/kenney_assets_v2. I found it with GitHub code search and downloaded it through jsDelivr. Each pack's `License.txt` says "Created/distributed by Kenney (www.kenney.nl) … License: Creative Commons Zero, CC0".

### Checkpoint 1 (4:55 PM IST) — real, layered sound effects
- **Files:** 52 Kenney CC0 sounds, each as `.ogg` and `.m4a`, in `apps/web/public/sfx` (268 KB in all). Every file's source and licence is in `CREDITS.md`.
- **Processing (ffmpeg):** leading silence trimmed so each sound starts on its frame; mono; long sounds faded out.
- **Layers in `play/sfx.ts`:**
  - On the swing start: a swish, or a heavy swish for kicks and big moves.
  - On the contact frame: punch (5 variants) or kick (5 variants). Kicks add a low thump.
  - The hulk (sim `Fighter.size` > 1.1, new `heavy` flag on hit/whoosh events) plays everything slower and deeper, with a thump on every blow.
  - Block: a wooden clack.
  - K.O.: big hit + thump + low boom + bell, then the body thud and a round-win jingle.
  - Landing and jumping: soft thuds.
  - Specials: fire roar, water splash, zap, ice crack, wing flap, shield clang, spikes scrape.
  - Clash: a force-field hiss. Countdown: ticks. FIGHT!: a bell.
  - Variants are picked at random, never the same one twice in a row, with ±4% pitch and −12/+8% volume.
- **Loading:** all bytes are fetched at page load and decoded into WebAudio buffers when the context unlocks, so playback is just starting a buffer. If a file fails, its event falls back to the old procedural sound. Mute is unchanged.
- **Bug fixed:** a sound's first play could be blocked for up to a second after the audio context started.
- **New `e2e/sfx.mjs`:** checks that every file is credited, served with HTTP 200 and decodes. It also checks:
  - punch and kick: the swish on the exact swing-start frame and the impact on the exact HP-drop frame;
  - variants never repeat back to back;
  - against the computer's hulk: block clack, and impact + thump on its blows;
  - every special, the K.O. layers, and countdown ticks + bell;
  - real play with the keyboard;
  - with all files blocked, the synth fallback still plays.
  
  Result: SFX OK, no console errors.

### Checkpoint 2 (5:45 PM IST) — controls per device
- **New `play/input-mode.ts`:** `<html data-input="touch|keys">` controls which set shows.
  - An inline `<head>` script in `layout.tsx` sets it before first paint from the primary pointer: `(pointer: coarse)` gives touch, anything else gives keys.
  - `watchInputMode()`, used on the /play and /online fight pages, switches to touch on the first touch or pen pointer-down or `touchstart`, and back to keys on a key press. Typing in inputs and shortcut combos are ignored. Mouse clicks never switch.
  - The CSS hides `.touchpad` in keys mode, and the keyboard legend (1P), the per-player legends (2P) and `.keys-legend` (online; its net HUD stays) in touch mode.
  - The old `pointer: coarse` rule that hid the legend was removed, so the mode alone decides. Gamepads are untouched.
- **Tests:**
  - New `e2e/controls.mjs`:
    - desktop: no pads, legend shown on 1P, 2P and online;
    - iPhone 13 portrait and landscape, Pixel 7 and iPad Pro 11: pads shown, no legend, on all three pages;
    - hybrid laptop: trackpad-primary starts with the legend, a touch shows the pads, a key brings the legend back, a mouse click changes nothing; in a touch-enabled context real CDP touches and keys switch back and forth;
    - a stubbed gamepad walks P1 on both desktop and iPhone.
  - Result: CONTROLS OK.
  - `mobile.mjs` now also checks "touch controls only" per device.
  - `twop.mjs` and `powers.mjs` now expect hidden pads on the desktop, and send one touch before using the pads.
- **Shots:** `shots/p7/controls_*.png`.

## Phase 7 — Checkpoint 3 (regression, started 5:12 PM IST)

One line is appended after each test finishes.

- 5:12 PM IST — tsc packages/shared: PASS
- 5:12 PM IST — tsc packages/sim: PASS
- 5:12 PM IST — tsc packages/render: PASS
- 5:12 PM IST — tsc apps/server: PASS
- 5:12 PM IST — tsc apps/web: PASS
- 5:12 PM IST — sim rig: PASS — ALL OK
- 5:12 PM IST — sim shapes: PASS — darkEverything 0:curve(c0,i0,t6.3)=head  1:line(c0,i0,t0.0)=
- 5:12 PM IST — sim recognize: PASS — ALL OK
- 5:12 PM IST — sim duel: PASS — ALL LAND
- 5:12 PM IST — sim ko: PASS — KO OK
- 5:12 PM IST — sim powers: PASS — POWERS READ OK
- 5:12 PM IST — sim specials: PASS — SPECIALS OK
- 5:12 PM IST — sim stats: PASS — STATS OK
- 5:12 PM IST — sim edge: PASS — ok  armsOnly: plan=biped mirrored=false kind="legless fighte
- 5:12 PM IST — sim reach: PASS — punch closest dx during active 0.003
- 5:12 PM IST — sim versus: PASS — VERSUS OK
- 5:12 PM IST — sim scribble: PASS — SCRIBBLE OK
- 5:13 PM IST — sim rivalcheck: PASS — clean vs spikes: bot wins 47%
- 5:13 PM IST — sim rapier: PASS — RAPIER OK
- 5:13 PM IST — sim roster: PASS — ROSTER OK
- 5:13 PM IST — next build: PASS
- 5:30 PM IST — e2e controls: PASS — CONTROLS OK
- 5:37 PM IST — e2e sfx: FAIL exit=1 — Node.js v20.19.2
- 5:39 PM IST — e2e mobile_iPhone_13: PASS — MOBILE OK
- 5:39 PM IST — e2e mobile_iPhone_13_landscape: PASS — MOBILE OK
- 5:39 PM IST — e2e mobile_iPhone_SE_landscape: PASS — MOBILE OK
- 5:40 PM IST — e2e mobile_Pixel_7: PASS — MOBILE OK
- 5:40 PM IST — e2e mobile_iPad_Pro_11: PASS — MOBILE OK
- 5:40 PM IST — e2e mobile_iPad_Pro_11_landscape: PASS — MOBILE OK
- 5:41 PM IST — e2e card: PASS — CARD OK
- 5:41 PM IST — e2e powers: PASS — POWERS UI OK
- 5:42 PM IST — e2e twop: PASS — TWO PLAYER OK
- 5:52 PM IST — e2e human: PASS — {"draw":"clean","rounds":5,"won":3,"avgSecs":19.7,"countdownDamage":0,
- 5:52 PM IST — e2e feel: PASS — FEEL OK
- 5:54 PM IST — e2e online: PASS — ONLINE E2E OK
- 6:08 PM IST — e2e sfx (rerun after fix): PASS — SFX OK (16/16 checks)
  - Cause of the 12:07 UTC (5:37 PM IST) failure: the page's Google Fonts stylesheet (fonts.googleapis.com, linked in layout.tsx) hangs on the box's restricted network rather than failing, so `page.goto(..., {waitUntil: "networkidle"})` never settled and timed out after 30 s on the very first load. The game was fine.
  - Fix (tests only): every e2e Chromium launch now passes `--host-resolver-rules=MAP fonts.googleapis.com ~NOTFOUND, MAP fonts.gstatic.com ~NOTFOUND`, so the font request fails at once and the system fallback font is used. Earlier controls/engine goto timeouts had the same cause; those waits now use `load` with a 90 s timeout.
  - **Checkpoint 3 result: everything PASS** — tsc ×5, 15 sim tests, next build, controls, sfx, mobile ×6, card, powers, twop, human, feel, online.

## Cloudflare Workers + Durable Objects (Oct 11, 2026)

- Online play moved off Colyseus onto **one Cloudflare Worker** (`apps/worker`): Workers Static Assets serves `apps/web/out`, and each room is a SQLite-backed Durable Object `Room` (`idFromName(code)`, free plan) using the WebSocket Hibernation API — seat on the socket attachment, alarms for the 60 s seat hold, runtime-answered keepalive, no timers. `apps/server` (Colyseus) was removed; it's in git history.
- Same protocol, mapped 1:1: rooms by 6-char code (`POST /api/rooms` claims one), drawings in `join`, server-held input logs, checksum every 60 frames + desync broadcast, token reconnect with log replay / fast-forward. The input-delay pick now uses round trips the clients measure and report in their lobby pings (no server ping timer, so the room can hibernate).
- Native-WebSocket client (`packages/sim/src/net-room.ts`) replaces colyseus.js; one JSON array of messages per frame. Inputs are batched only within the input-delay slack (`Lockstep.maybeFlush`), checksums and fight pings ride along. The catch-up rule (3 steps/tick) now only fires when actually behind the peer, which stopped it eating the delay window: fewer stalls *and* bigger batches.
- Results (wrangler dev / Miniflare): headless A–D and browser e2e online (no lag, 100±30 ms, keys/drop/reload) all PASS, 0 desyncs, same winners. Browser: 2.00 frames/message ≈ 29.5 msg/s with no lag (was 59.7), 3.74 frames/message ≈ 14.8 msg/s at 100±30 ms (was 48.7); stalled ticks at 100±30 ms 214 vs 1239. Site, `/play`, sfx, 404 and `/r/CODE` → 302 served by the Worker. tsc ×5 and 15 sim suites PASS.

## Play nearby, no internet (Oct 12, 2026)

- **What:** two phones on one hotspot (or any Wi-Fi with no internet) fight over a direct WebRTC data channel, paired by two QR codes. Browsers can't do phone-to-phone Bluetooth, so the hotspot does that job. New page `/nearby`, linked from the notebook ("📶 Play nearby (no internet)" under "join a friend's room") and from `/online` (also in the "Online is busy" box).
- **Pairing:** the host taps "Create nearby room": `RTCPeerConnection({ iceServers: [] })` (no STUN, works offline), one ordered, reliable data channel, wait for ICE gathering to finish, then the SDP goes into a code: unneeded lines stripped, `CompressionStream("deflate-raw")`, base64url, header `NO1z` (offer) / `NA1z` (answer). The code is shown as a QR (bundled `qrcode-generator`, ECC L) plus a copy box. The friend scans it (`BarcodeDetector` where available, else bundled `jsQR` on `getUserMedia` frames) or pastes it, gets an answer QR, and the host scans or pastes that back. Hint on every step: "One phone: turn on Hotspot. Other phone: join it. Mobile data not needed." Both players need a drawing first (the same draw-first box as `/online`). Wrong codes get a plain message ("That's an answer code…", "That isn't a Notebook Fighters nearby code.").
- **Room without a server:** `packages/sim/src/local-room.ts`. `HostRoom` is the Durable Object room's protocol run on the host's phone: lobby, the friend's drawing in "ask", Accept / Decline, round trips measured in the lobby → `pickDelay(0, friendRtt, spread)`, inputs relayed and logged, checksums every 60 frames compared, desync broadcast. `PipeRoom` is the friend's end. Both talk over a `Pipe` (send / onMessage / onClose), the transport interface: in the browser `channelPipe` wraps the data channel (1 s heartbeat, closed after 6 s of silence, failed ICE or a closed channel; messages over 16 KB, like a heavily scrubbed drawing in "join", go in chunks). `OnlineSession` and `Lockstep` are unchanged, apart from fight pings now carrying the last round trip, so the host's HUD shows the real phone-to-phone ping. The link dropping shows "Connection lost" with Rematch (pair again) / Back; there is no reconnect.
- **Offline / installable:** `manifest.webmanifest` (192 / 512 / maskable icons, apple-touch icon), and `scripts/build-sw.mjs` runs after `next build` to write `out/sw.js` with every file of the static export (173: pages, JS, CSS, page payloads, sounds, icons) and a content-hash version. Install precaches all of it plus the Google Fonts CSS and font files (best effort). Pages and page payloads are network-first with a 3 s timeout, then the saved copy. Hashed `/_next/static` files and sounds are cache-first. `/api/*` is never intercepted, and `/r/CODE` goes to the network with the saved `/online` as the offline fallback. The worker keeps the current and previous cache. The notebook and `/nearby` show "✓ Works offline" once the worker is active, plus Install (Chrome's prompt) or the iPhone "Share → Add to Home Screen" steps.
- **Refactor:** the fight half of `/online` (input, 60 Hz loop, renderer, HUD, sounds, overlay) moved to `app/online/duel.tsx` and is shared by `/online` and `/nearby`.
- **Tests:**
  - `packages/sim/test/nearby.ts` (now in `pnpm test`): HostRoom + PipeRoom over an in-memory pipe. A) no lag and B) 100 ms round trip, full best-of-3, same rounds, identical checksums, 0 desyncs. C) decline → 4403, then a new link gets asked. D) the link drops → the host sees the friend gone and the friend's room closes. NEARBY OK.
  - `e2e/nearby.mjs`, headless Chromium:
    1. Against `wrangler dev` with `context.setOffline(true)`: `/`, `/play`, `/play?mode=2p`, `/online`, `/nearby` and `/r/CODE` all open from the service worker. The vs-computer fight runs and `/api/health` is not served from the cache.
    2. Two desktop contexts with the game loaded once from a test-owned static server that is then shut down. They pair by paste using Chrome's default mDNS `.local` host candidates and play a full best-of-3: 0 desyncs, same winner. The friend's 30 KB drawing goes over in chunks. Pulling the link gives "Connection lost" on both, and Rematch pairs again.
    3. Two iPhone 13 contexts, server shut down: each phone's fake camera plays the other's QR, and jsQR reads it on both sides. A 100 ms round trip is injected on the friend, giving an input delay of 5f and a ping of about 105 ms. Full best-of-3, 0 desyncs, same winner.
  - Note: Chromium's `setOffline` emulation also blocks WebRTC's UDP, which is why 2) and 3) use "server shut down" for no internet.
- **Known risk:** Chrome hides host addresses behind mDNS `.local` names until the page has camera permission. In test 2 the host's offer had only `.local` candidates and still connected; once the camera was granted, real IPs appeared. On a phone hotspot mDNS usually resolves, but a network that blocks multicast would stop the pairing. A real two-phone test is still to do.
- **Screens:** `/workspace/shots-nearby/` (desktop + iPhone 13).

## The notebook on phones: thumb-sized and notch-safe (Oct 12, 2026)

- **Audit** at 320×568, 360×640, 375×667, iPhone 13 portrait (390×844) and landscape (750×342), a 600×960 small tablet and iPad Mini. Before: no horizontal scroll anywhere, but the join link was a 22 px tall target, the colour pencils were 27 px, the "P2" and delete chips under a box were 27–31 px wide and 38 px tall, the "You" / "P2" badges and the kicker were 12 px, and the dialog ✕ scrolled away with the content. In phone landscape the header used the whole first screen, so the boxes started below the fold.
- **Phones (≤640 px):** "Play with computer" runs full width, with "2 players" and "Create a room" side by side below it (48 px tall). "Join with a code" and "📶 Play nearby (no internet)" sit beside each other as 44 px chips. The eight pencils share one row, each about 35 px plus a larger touch area. Under each box, "✓ you" / "play this" takes the free space and P2 / 🗑 are 44 px squares. The in-box ⤢ / clear stay small, because drawings start below them, but their touch area reaches up into the box edge (never down into the paper, where a stroke may start). The "Install / works offline" hint moved under the boxes. The draw-first toast spans the width with 44 px buttons.
- **Phone landscape:** the title and the three buttons share one row, and the pitch is one line, so the drawing boxes start on the first screen.
- **Everywhere:** the notebook's padding includes `env(safe-area-inset-*)` (the viewport is already `viewport-fit=cover`), so nothing sits under the notch or the home bar. The dialog ✕ (44 px) is sticky, so it stays in reach while a character card or the rival picker scrolls. Small text is now at least 12.8 px. The drawing canvases keep `touch-action: none`, so strokes never scroll the page.
- **Tests:** `e2e/home.mjs`'s drawing helper brings the box back into view after tapping a pencil (a taller header meant the tap could scroll the box away). The rest of home, mobile, sketch, controls, busy, twop, card, online and nearby are unchanged and pass.
- **Screens:** `/workspace/shots-mobile/` (`before_*` from `main`, `after_*` from this branch).

## The walls are the red margin line (Oct 12, 2026)

- **Bug:** walking back (A) stopped well before the notebook's red margin line, leaving paper you couldn't reach. The sim clamped the fighter's pelvis to ±2.7 figure units, but the renderer drew the margin line at a fixed 7% of the screen width, and the camera zoomed and followed with no idea where the walls were. So the line and the wall only lined up by chance.
- **Fix (sim):** `WALL_X = 3.0` is now the wall, the same place the knockout ragdoll's walls already were. A fighter's drawn body (torso and head, `rig.extent`, counted up to half a figure) stops against it, instead of its pelvis stopping at a fixed point. This is fixed-size and comes from the drawings, so online and nearby clients still agree on every screen (the lockstep checksums didn't change behaviour). The rule for big fighters stepping back from a strike uses the same bounds.
- **Fix (view):** the camera never shows more than the notebook gutter (7% of the width) past a wall. It zooms out at most to show the whole stage (unless the figures would get too tall), and a stage narrower than the screen sits in the middle. The red margin line is drawn at the left wall's screen position and a fainter line marks the right wall. The ground line and grass run from wall to wall. Canvas2D and PixiJS share this code.
- **Checks:** `e2e/walls.mjs` holds A on desktop 1280×720 (Canvas2D and PixiJS), a wide 1920×600, iPhone 13 landscape and portrait, and iPad Pro 11. The body's edge ends 0.0 px from the red line every time, and in a 2-player duel P2 walking right stops within 3 px of the right line. Bot balance (`pnpm --filter @nf/sim balance`): BOT OK, all 54 checks in range.

## Two new rivals and the heavyweights' own specials (Oct 12, 2026)

- **New rivals** in `packages/sim/src/roster.ts`, just before the Bodybuilder: **Halloween** (a carved pumpkin head with ribs, stem and a jagged grin, a ragged black cloak torn at the hem, a rope belt, straw at the cuffs; orange and black) and **Skeleton** (a skull with hollow eyes and teeth, curved ribs and a pelvis bowl, knobbly joints). Both are drawn like the others: a plain stick figure the reader understands, with the costume as decoration lines, so the rig and stats read them as ordinary bipeds. Tier 3 (heavyweights), so the order is Pehelwan, Halloween, Skeleton, Bodybuilder.
- **Signature specials** (`Signature` in `powers.ts`; a roster entry's `signature`) replace "draws itself a power to match yours" for the four heavyweights:
  - **Throw pumpkin** (Halloween): a projectile with its own gravity, aimed so it comes down on the foe's chest; it splats for 10 and a 0.5 s stagger, or splats harmlessly on the ground.
  - **Bone scatter** (Skeleton): it lies in a pile of bones for 0.55 s. Hits, shots and specials pass through it. Then it reforms up to 0.6 forward with a bony strike (8).
  - **Ground shake** (Pehelwan): a stomp sends a low shockwave along the ground. It staggers a grounded foe for 0.75 s (8 damage); an airborne foe isn't touched. The screen shakes.
  - **Mega leap** (Bodybuilder): a jump about a figure-height high, aimed with the frame's gravity to land on the foe's front. It lands in an area smash (12) or a harmless THUD, with a big screen shake.
  - All of them are fixed-step and seeded like the rest of the sim, and the checksum includes the new state (`scatter`, `slam`). Cooldowns: Easy ×1.5, Normal ×1.2, Hard ×1 (pumpkin 4.2 s, bones 5 s, quake 5.2 s, leap 6 s on Hard).
- **The computer uses them sensibly:** a pumpkin from 0.2 to 3 units away; the stomp only while you're on the ground; the leap from range (or sometimes up close); the scatter mostly as an answer to an attack it has noticed. All of these sit behind the level's special chance, and a thrower or leaper with its special ready backs off now and then to make room. In 40 s on Hard each one used its special 2 to 4 times.
- **Seen and heard:** the pumpkin tumbles with a carved face, the shockwave is a jagged crack with dust puffs, the skeleton turns into a rattling bone pile that pulls together before it stands. The sounds reuse files already in the packs (`water_1`, `swish_heavy_2`, `block_2/3`, `land_3`, `ko_boom`, `jump_2`, `wings_1`), so `CREDITS.md` is unchanged. Meters get their own stripes.
- **Cards and picker:** the character card reads "★ Throw pumpkin (every 5 s): …" and "Its own special on every level, ready again after 6.3 s on Easy, 5 s on Normal, 4.2 s on Hard". The cooldown comes from the fighter's real `coolMax`. New blurbs for the four heavyweights.
- **Fixes on the way:** the mega leap's first-frame gravity was the default, not the tuned one, so the jump was aimed wrong. The sim now sets `gNow` at the start of each step.
- **Tests:**
  - `packages/sim/test/signatures.ts` (in `pnpm test`): each special does its thing (arc, splat and stagger, ground miss; the scatter dodges a punch then strikes 0.6 forward; the shockwave hits a grounded foe and a jump clears it; the leap is 0.98 high, crosses 2.7 and smashes for 11.9); Easy > Normal > Hard cooldowns; the CPU uses each 2 to 4 times in 40 s on Hard; replays are identical.
  - `packages/sim/test/rivals.ts` (`pnpm --filter @nf/sim rivals`): the bot against every rival on every level, 170 rounds a cell. Bot wins (Easy / Normal / Hard): Halloween 68 / 35 / 42 %, Skeleton 71 / 38 / 27 %, Pehelwan 54 / 19 / 32 %, Bodybuilder 46 / 20 / 16 %, the hardest on Hard.
  - `roster.ts`: the Hard picks are the four heavyweights. `pnpm --filter @nf/sim balance`: BOT OK.
  - `e2e/rivals.mjs`: the home roster order, the cards (desktop and iPhone), the picker, and each special on screen (desktop and iPhone landscape).
- **Screens:** `/workspace/shots-rivals/` (home roster, each heavyweight's card, the picker, each special mid-move).

## How to play (Oct 12, 2026)

- **What:** `app/guide.tsx`, a paged dialog in two versions. The **touch** version (phones and tablets) shows the joystick and the on-screen buttons; the **keyboard** version (desktop) shows every key, with gamepad notes. The input-mode detection that picks the fight's controls (`data-input`, pointer: coarse) picks the version, and a Touch / Keyboard switch at the top shows the other.
- **Pages:** 1) draw (canvas, colours, ⤢ big pad, clear, + new fighter, play this / P2, delete); 2) what drawing does (darker = stronger, length and size, and the powers list read from `POWER_INFO`, plus the rivals' own specials from the roster); 3) the computer (picker, level, ⓘ card, Fight); 4) two players; 5) a room (code, Copy, Copy link, Accept / Decline); 6) play nearby (hotspot, QR both ways, paste fallback); 7) fight controls (joystick and every button, or every key: A/D, Space, S, F, G, H, E, R, arrows and J/K/L, gamepad); 8) the HUD (HP, special bar, rounds, level, Fighter card, ⟳ Rotate, ☰, K.O. replay).
- **Pictures:** `e2e/guide-shots.mjs` drives the built game with Playwright: an iPhone 13 (portrait for the notebook pages, landscape for fights) and a 1280×800 desktop. It lays labelled callouts and arrows over every button (numbered badges and a key where the HUD is crowded), crops, and writes 16 WebP files (15–75 KB, 552 KB in total) into `apps/web/public/guide/`. The service worker precaches them with the rest of the export.
- **Getting there:** a "? How to play" pill on the notebook and a "?" in the fight's top bar. In a fight the guide opens on the controls page and pauses (`__nf.paused`); online fights have no "?" (lockstep can't pause). It opens by itself once on the first visit to the notebook (`localStorage["nf:guide-seen"]`). Automated browsers skip that unless they set `nf:guide-auto`, so the other tests see the plain page. The fight page loads the guide on demand, so the sim isn't pulled into the page's first script.
- **Moving around:** Next / Back (44 px), dots for each page, swipe left / right on touch, ← → keys, Esc closes. The ✕ stays sticky. In phone landscape the picture sits beside the text.
- **Fix found by the test:** the notebook's big title overlapped the new "?" pill, so a real click landed on the heading. The kicker row now sits above it.
- **Tests:** `e2e/guide.mjs` covers desktop (keyboard guide), iPhone 13, iPad Pro 11 and a 360×640 phone (touch guide):
  - The first visit opens the guide by itself; the second visit doesn't.
  - All eight pages go by → / Next / swipe, every picture loads, and nothing scrolls sideways. The controls page lists every key or button.
  - Back, Esc and the notebook "?" work. The fight "?" opens the controls page with the frame counter frozen, and the fight resumes on close.
  - Offline, the 16 pictures come from the service worker's cache.
- **Screens:** `/workspace/shots-guide/`.
