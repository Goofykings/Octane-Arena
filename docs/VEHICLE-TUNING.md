# Focused vehicle tuning

This describes the initial vehicle pass. See [CONTACT-CONTROL.md](CONTACT-CONTROL.md) for the latest partial-support, recovery and aerial-strike correction. See [CONTINUATION-POLISH.md](CONTINUATION-POLISH.md) for the later grip and recovery-speed adjustments.

This change preserves rigid car/wheel geometry, arena collisions, current flip/stall/cancel timing, and unrelated game/UI/network systems.

## Recovery

Previously, pre-held throttle triggered a fixed 50 rad/s^2 roll drive for 0.6 seconds, with no angular target or slowdown at upright. Recovery now requires a new jump/throttle edge (analog threshold 0.25). A press before roof contact is consumed as input, not deferred to landing. The motor uses a stored support normal/roll axis, a 3.8 rad/s target cap, 36 rad/s^2 acceleration bound, 12/s response, and braking target sqrt(2 _ 10 _ remaining angle). It stops driving after crossing upright, brakes residual roll, and has a 1.8-second maximum duration and existing 0.8-second cooldown. No quaternion/pose snapping or velocity zeroing. Bots request the same release/repress through PlayerInput when roof-contacted; decisions/difficulty remain unchanged.

## Contact and slip

Stable support previously could persist on two touching wheels because other nearby ray hits counted toward support history. Two-wheel overhead support now cannot be promoted that way; insufficient overhead/slow misaligned wall support reduces traction to 12%. A normal-Y tolerance of -0.05 preserves legitimate vertical-wall curves despite float noise. Gravity and unilateral clearance constraints detach the car naturally.

Ordinary lateral acceleration increases with slip at the existing 24/s slope but is bounded to 28 m/s^2, rather than removing 20% of any arbitrarily large sideways speed each tick. No direct lateral velocity assignment. Strong low-slip steering remains. Fully engaged powerslide is unchanged; partial handbrake blends toward finite normal tires, so angled touchdowns and drift release settle progressively.

Input force on slow loaded tire shoulders includes steering as well as throttle. Nose-only contacts apply a load-limited tangential scrape force across ALL actual solver contact points, excluding normal driving, aerials, roof sliding and delicate input. Its actual lever arm destabilizes the pose; no upright target or automatic tipping torque. Front/rear nose and both side orientations are tested. Varying analog corrections can still maintain intentional nose balance.

## Car-ball impacts

The prior implementation already used pre-solver linear velocity plus omega cross the contact arm. The main gap was the airborne branch: it bypassed the calibrated driving strike boost and reduced the solver result to restitution 0.32. Normal driving hits are untouched.

Rotational closing motion now increases aerial restitution, bounded at 0.8; soft/unrotating touches retain their original response. A bounded dodge strike was also necessary to match the intended game feel: closing speed _ ball mass _ 0.65, capped at 750 N\*s, only during the first 0.3 seconds of an active non-stall flip, with a leading contact normal and at least 0.25 m/s of positive rotational closing. Roof support, passive aerial touches, non-leading side contact and late flips do not receive it. Every new impulse is paired with equal opposite car impulse at the same contact point. No ball-velocity multiplier, linear velocity overwrite, or flip torque/lock changes.

Deterministic examples (m/s): normal drive 34.54 unchanged; early front flip 37.42; diagonal 37.32; old airborne front flip 21.81; soft aerial 0.54. These are fixture measurements, not universal speeds or exact Rocket League constants. Flip-reset/stall/recoil, dribbles/flicks and other powers run their normal regression tests.

## UI and validation

Only the Multiplayer through LAN update-note entry was removed. Version V0.1.9 and the remaining New Car Models note/clickable dialog stay intact. Networking was not removed.

Focused tests live in tests/vehicle-tuning.ts. Older gameplay-corrections and major-update assertions were updated only where they explicitly required held-input auto-recovery or almost instant removal of large landing slip. Their replacements verify fresh presses, progressive finite grip, distinct drift, eventual recovery and wall traction. No tests were skipped.

Tune all new mechanics through src/config/physics.ts. Human feel feedback is still useful for tire force cap, recovery speed/braking and the dodge bonus. Automated fixtures do not establish controller comfort or all possible freestyle timings.
