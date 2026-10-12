# Training input start, zero-time play and aerial contact

Training now holds its initial physical pose in READY without stepping the
simulation. The first non-neutral throttle, steering, jump, boost, slide or aerial
axis starts the shot; that same input is passed to the first physical step.
Camera, scoreboard, chat and pause controls are not `PlayerInput` gameplay axes.
The launch preview disappears on start. Frozen aerial targets still release only
on their first genuine car contact, preserving their existing training behavior.

Each shot has an optional `timeLimit` in `src/extra/training/packs.ts`, defaulting
to 10 seconds. `TrainingRun` owns elapsed time, remaining time and READY/zero-time
state. The top-left HUD reads those values, clamps the number at 0.0 and smoothly
depletes the small bar. Reset restores READY and the full duration.

`BallGroundContact` in `src/physics/ball-ground.ts` supplies one physical signal
after each Rapier step. It checks ball contacts with the actual arena shell,
requires a near-touching manifold distance and upward/downward flat-floor normal,
and verifies the arena-side contact point lies on a flat floor triangle at floor
height. Using that point instead of the solver midpoint handles penetration
during real low/high-speed impacts without missing the collision.
Curves, walls and ceiling are excluded; posts and cars use different colliders.
It exposes grounded state, a one-step contact-start flag and monotonic sequence.
Resting on the floor does not repeatedly emit starts. The flat calibration arena
uses its real floor cuboid. No ball-center height threshold is used.

Training fails on that genuine floor contact at zero, while an airborne goal
still succeeds and plays its normal replay. Timed Soccar and Heatseeker use the
same signal. A leading goal at 0:00 ends the match after celebration/replay; a
tying goal starts sudden-death overtime directly. A tied dead ball at zero starts
overtime, and floor contact during sudden death does not end a tied match.
Free Play, Rings and Dribble Challenge completion rules are unchanged.

## Aerial contact diagnosis and correction

Configured and measured masses remain **car 150, ball 50**. Rapier already
resolved car/ball contacts using the ball's **0.48** restitution. The custom speed
curve then added another impulse to the ball alone, including in midair. This
injected extra pair momentum without corresponding car recoil. Actual sampled
contact velocity already included linear velocity plus angular velocity crossed
with the contact arm; that useful behavior is retained.

For true airborne car contacts only, the extra speed bonus is replaced by a
bounded residual normal impulse targeting **0.32** aerial restitution. Effective
inverse mass includes both bodies' rotational inertia at the contact point. The
calculation compares the sampled pre-solver approach with post-solver contact
velocity and applies only the remaining correction, which can remove excessive
rebound. It applies equal-and-opposite impulses at the real contact point to both
rigid bodies, affecting linear and angular velocity. Existing impact arming and
cooldown prevent reapplying the correction every resting-contact tick.

Ground/partial/chassis-supported contacts retain their existing response; roof
dribble shaping, gravity, global restitution and ball speed cap are unchanged.
Removing airborne bonus momentum also reduces some old flick peak speeds, but
both car bodies still produce useful lift and acceleration in four directions.
The old assertion that flicks must exceed the legacy assisted peak by 8% was
replaced with checks for acceleration above initial carry speed, actual lift,
angular contact contribution and retained flip/speed caps.

Do not interpret this as increased absolute car recoil in every case: reduced
restitution can reduce both bodies' rebound. It restores physical coupling
instead of adding unbalanced ball momentum. In isolated measured 12 m/s frontal
contact, ball speed is about 11.81 m/s and car velocity changes about 3.94 m/s.
A 0.6 m/s soft contact gives about 0.59 m/s ball speed. Side/corner/roof fixtures
also produce actual chassis rotation. Tune `P.hit.airRestitution` in
`src/config/physics.ts` after human aerial/flick feedback; keep mass/inertia and
equal-and-opposite impulse handling intact.

## Verification

- `tests/zero-time.ts`: actual floor transitions/resting dedup, false-contact
  exclusions, both timed modes' zero goals/ground endings/overtime, all first
  gameplay input variants, trigger-input application and training reset.
- `tests/aerial-coupling.ts`: physical soft/frontal/glancing/side/corner/roof hits,
  momentum conservation, measured masses and real linear/angular car reaction.
- Existing physics suites: roof catches, moving dribbles, four-direction flicks,
  wall/goal/post/curve collisions, full-speed ramp and recovery behavior.
- Production browser fixtures: real keyboard start and input exclusions,
  bar/number display, late goal/replay/reset, actual ground failure, normal
  regulation goal/replay finish and existing training navigation/save flow.

Menu/navigation/replay-skip inputs are consumed before applying that frame's
gameplay sample, so Space used to skip a replay cannot also launch/jump in the
following training shot.

Deterministic contact fixtures establish mechanical behavior, not a complete
human playthrough of every 10-second training challenge. Later shots and aerial
restitution remain appropriate candidates for feel-based tuning.
