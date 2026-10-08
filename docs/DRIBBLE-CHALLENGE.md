# Dribble Challenge

Select **Play → Extra Modes → Dribble Challenge**. This is a single-player
ball-control course with twenty original levels and permanent local checkpoints.
It uses the normal car and ball physics, the current garage preset, Ball Cam,
camera settings and mouse free look. It has no soccer goals, bot, score clock,
online account requirement or timer objective. Boost is unlimited, as in Rings.

## Levels and progression

| Level | Layout                                                               |
| ----- | -------------------------------------------------------------------- |
| 1     | Wide, short straight with no obstacles                               |
| 2     | Longer 7 m straight, narrower than Level 1                           |
| 3     | Wide straight, smooth 90-degree right turn, short finish             |
| 4     | 7 m S: right 90, short link, left 90                                 |
| 5     | 9 m left hairpin, radius 11 m, short exit                            |
| 6     | Wide straight with one 0.8 m jump wall                               |
| 7     | Two 1 m walls separated by 19 m recovery space                       |
| 8     | Right 90, wall, recovery straight, left 90, wall                     |
| 9     | 4.5 m track and a timed rotating plus                                |
| 10    | Wide straight with a 4.3 m gap and landing buffer                    |
| 11    | Wall, turn, 3.8 m gap, turn, second wall                             |
| 12-20 | Previous double hops, ramps, narrow bends and mixed courses retained |

Courses remain open floating platforms with the original blue panel pattern,
turquoise edges, arrows, gray starting patch and transparent grid finish.
Wall heights are 0.8-1 m; both starter cars can clear them while carrying a ball
using one held jump. The 4.3 m gap is 3.64 Ion car lengths. It needs more approach
speed than the original small gaps (tests use 7 m/s and a 0.2 s held jump).

Walls and rotating arms use collision membership 16 and collide with both car
and ball. The ordinary road still excludes the ball. A single kinematic body
supports the plus's two crossing arms; fixed-step next-rotation updates generate
physical angular velocity. Rendering reads that body's solved rotation rather
than running a second animation clock. Its radius is 1.8 m (3.6 m tall), arm width 0.28 m,
depth 0.55 m, and speed 0.42 rad/s. The scale leaves room for the carried ball in
the lower side openings while preventing driving around the tips. Tune
`DRIBBLE_SPINNER_SPEED` and piece dimensions in `src/extra/dribble/levels.ts`.
Reset restarts its clock; level changes remove its body and colliders.

Every level starts on a compact 5 x 6 m gray area inset into the existing
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

| Object                     | Membership bit | Collides with                 |
| -------------------------- | -------------- | ----------------------------- |
| Road                       | 1              | Car                           |
| Car                        | 2              | Road, ball and obstacles      |
| Ball                       | 4              | Car, gray start and obstacles |
| Starting-area ball support | 8              | Ball only                     |
| Walls and rotating arms    | 16             | Car and ball                  |

The gray area supports **both** objects. Its car support is the unchanged
continuous road collider beneath it; a coplanar ball-only slab adds ball support
without a duplicate car collider or a car collision seam. The main course never
supports the ball. There are no floor-overlap sensors or finish colliders.

Failure uses the exact two top triangles of each connected ribbon segment.
For the sphere center, project onto a triangle's plane; if the projection lies
inside that triangle and signed normal distance is less than **negative ball radius**,
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
The car-only traversal drives all twenty current courses, including wall jumps
and timed spinner passage. Nine isolated carried-ball jumps test the old and
new gap geometry at 4.5-7 m/s. The obstacle suite separately verifies fourteen
both-body wall carries and real rotating-arm contacts/passage. These checks
verify mechanical feasibility, not whole-course player skill.

`tests/dribble-browser.cjs` verifies menu/HUD, visible gray start and transparent
grid wall, Ball Cam/manual look, fast reset, ball-only flick completion, automatic
next level, navigation, checkpoint reload, controls and responsive Extra Modes.

Human balancing/playtesting is still needed for complete uninterrupted carries,
especially Levels 13–20 and the ramp/turn combinations in 9, 10 and 15. There
are no known undriveable road sections or impossible individual gaps in these
tests, but these automated checks are not a claim that every full course has
been completed by a human or that the difficulty curve is final.
