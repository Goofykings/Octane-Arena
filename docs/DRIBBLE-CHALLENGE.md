# Dribble Challenge

Select **Play → Extra Modes → Dribble Challenge**. This is a single-player
ball-control course with twenty original levels and permanent local checkpoints.
It uses the normal car and ball physics, the current garage preset, Ball Cam,
camera settings and mouse free look. It has no soccer goals, bot, score clock,
online account requirement or timer objective. Boost is unlimited, as in Rings.

## Levels and progression

| Levels | Introduction                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------- |
| 1–4    | Wide short carry, gentle bend, left/right combination, shallow 0.35 m rise                         |
| 5–7    | Wider S, varying width and a low hill                                                              |
| 8–12   | First 0.9 m gap, ramp into turn, mixed elevations, narrower S, two hops                            |
| 13–17  | Sharper direction changes, elevated narrower paths, climb/turn/descent, 1.4 m gap and narrow turns |
| 18–20  | Ramps plus gaps, changing widths and the final mixed course                                        |

Widths decrease from 9–10 m to 4.2–5.5 m. Turns stay visible on open floating
platforms. Ramps use a smooth height profile; every jump is a real gap, marked
with an amber edge. The largest gap is 1.5 m. The floor has an original blue
panel pattern and turquoise edges/directional chevrons. A compact gray starting
patch supports the ball; a translucent pale grid wall marks the finish.

Every level starts on a compact 5 ? 6 m gray area inset into the existing
approach. The ball rests directly on that flat surface. The previous rounded
prongs/holders are removed; no ramp, pedestal, lift, or catch assistance exists.
This deliberately lets the player experiment with the existing car/ball contact
physics to scoop the ball. A slow straight drive is not guaranteed to lift it.

The HUD shows level and completed best, with a short completion message. Success
saves immediately, then advances to the next level after 0.9 seconds. The final
level opens a completion menu. **Previous / Next** buttons and bindable actions
(default **[ / ]**) revisit unlocked levels. A locked future level cannot be
selected. **R**, the training-reset binding, or **Restart** retries the current
level. Escape opens the menu/settings. Reset does not rebuild the scene or page.

On reopening the mode, it resumes the newest unlocked challenge. For example,
seven completed levels start at Level 8; earlier unlocked levels remain available.
`LocalProfile.value.challenges.dribble` records the sequential completed count
inside the existing `octane-arena-profile` localStorage record. Invalid/noninteger
or out-of-course-range counts resolve to zero. Existing identity, avatars, stats,
garage and Rings records are preserved. Unavailable storage permits session play.

## Collision filtering and failure

Rapier membership/filter pairs isolate this mode:

| Object                     | Membership bit | Collides with                      |
| -------------------------- | -------------- | ---------------------------------- |
| Road                       | 1              | Car                                |
| Car                        | 2              | Road and ball                      |
| Ball                       | 4              | Car and gray starting-area support |
| Starting-area ball support | 8              | Ball only                          |

The gray area supports **both** objects. Its car support is the unchanged
continuous road collider beneath it; a coplanar ball-only slab adds ball support
without a duplicate car collider or a car collision seam. The main course never
supports the ball. There are no floor-overlap sensors or finish colliders.

Failure uses the exact two top triangles of each connected ribbon segment.
For the sphere center, project onto a triangle's plane; if the projection lies
inside that triangle and signed normal distance is less than **?ball radius**,
the whole sphere is below that local surface and the attempt resets. This works
for elevated/sloped sections instead of assuming one world height. The gray
area is excluded. Real gaps have no floor triangles. The off-course lower height
checks the ball's top (center Y + radius); the car's existing height check and
nonfinite-state recovery remain. No normal soccer collision or force changed.

Completion is a forward **center crossing** of the vertical finish plane,
detected by sweeping previous/current ball positions each physics step. The
interpolated crossing point must fit the sphere inside the wall's width and
6 m height. Forward is course-local ?Z. Merely touching the plane, crossing
backward, or passing above/below/outside does not count. The car position and
roof contact are irrelevant. A successful crossing wins immediately, even if
the ball continues past the deck in that same tick; the existing save, feedback
and next-level flow then runs unchanged. Reset clears crossing history.

The wall uses an original procedural RGBA square-grid texture on a double-sided
transparent plane with depth writes disabled, plus a subtle pale frame. Neither
wall nor frame has a physics collider or blocks camera queries. The environment
remains visible through it, and the ball never bounces off the target.

## Reusable modules

- `src/extra/dribble/levels.ts`: declarative straight/turn/ramp/descent/gap/narrow
  pieces and the twenty definitions. Add a sequential definition for Level 21+.
- `geometry.ts`: continuous closed thick ribbons; gap sections omit all triangles.
- `physics.ts`: isolated Rapier world, collision layers, flat ball-safe spawn, local floor checks,
  shared car/ball response and finish tests.
- `run.ts`: attempt/reset/pause state, ordered unlocks and level selection.
- `view.ts`: original panel materials, edge lines, jump markings and resource cleanup.
- `session.ts`: Extra Mode lifecycle, rendering/effects and the existing GameCamera.
- `src/ui/extra-mode-panel.ts`: compact mode-specific HUD and navigation.
- `src/game/local-profile.ts`: persistent validated checkpoint count.

The mode registry in `src/extra/session.ts` retains Rings and adds Dribble. Camera
and navigation capabilities are optional ExtraSession methods so Rings retains
its original behavior. Navigation bindings use `shared/controls.ts` and the
existing Controls settings page. Future timing can use the existing readout
interface without adding a separate camera, account, or physics architecture.

## Verification and balancing limits

`npm run test:dribble` checks all twenty courses for car support, gray-area
ball rest, actual radius-delayed fall-through on flat/sloped surfaces, real gaps,
ball-only forward finishes at slow/high speed, rejected invalid shots, normal
car-fall reset, sequential unlock/save/reload, navigation locks, corrupt saves
and unchanged soccer floor support. Both car bodies drive across the gray
boundary without vertical launches; an unassisted rolling ball leaves the safe
area, visibly falls through, then fails. The previous guaranteed holder-pickup
test no longer applies because this update intentionally removes those holders.
The car-only traversal still drives every unchanged course and all eight isolated
roof-carry jumps still test gap geometry, not whole-course player skill.

`tests/dribble-browser.cjs` verifies menu/HUD, visible gray start and transparent
grid wall, Ball Cam/manual look, fast reset, ball-only flick completion, automatic
next level, navigation, checkpoint reload, controls and responsive Extra Modes.

Human balancing/playtesting is still needed for complete uninterrupted carries,
especially Levels 13–20 and the ramp/turn combinations in 9, 10 and 15. There
are no known undriveable road sections or impossible individual gaps in these
tests, but these automated checks are not a claim that every full course has
been completed by a human or that the difficulty curve is final.
