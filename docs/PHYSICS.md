# Physics reference and calibration

## Public research consulted

- [RLBot useful game values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/): SI conversion, masses, speed limits, gravity, boost, bounce and pad timing.
- [RLBot jump physics](https://wiki.rlbot.org/v4/botmaking/jumping-physics/): local-up impulse, three initial sticky ticks, minimum hold bonus, held jump and second-jump window.
- [Samuel P. Mish: ground control](https://www.smish.dev/rocket_league/ground_control/): speed-dependent acceleration/curvature, braking and coasting.
- [Mish, Nevercast and tarehart: ball/car collision](https://www.smish.dev/rocket_league/ball_simulation_3/): rigid contact plus a game-specific supplemental impulse. This implementation uses an original bounded, approach-speed-based approximation, not the article's complete predictive model.

The current RLBot page reports a 91.25 uu ball radius; old wiki mirrors report
92.75 uu. We use 91.25 uu, agreeing with the supplied brief and current page.
Published aerial coefficients vary (for example yaw 9.11 vs 8.9). The brief's
36.1/12.1/8.9 angular acceleration ratios are the configurable starting point.
Community measurements describe observed behavior, not a license to use game assets.

## Implementation

Y is up; local forward is -Z. All Rapier values are in metres and seconds.
The car collider is a 1.18 × .84 × .36 m box with configurable collider and mass
offsets. Four rays determine support and contact normals. A unilateral velocity
constraint limits movement into the wheel-clearance plane. After integration,
bounded normal-only position correction clears wheels and chassis corners without
adding rebound velocity. Surface-normal adhesion and angular feedback maintain
driven wall contact; adhesion fades beyond vertical and gravity releases ceiling
contact. There is no pose lock or spring/damper suspension. See the focused
[arena collision audit](ARENA-COLLISION.md) for shell topology, roof/side CCD,
rounded goal frames, containment and verification coverage.
The floor/wall/ceiling profile has 20 segments per quarter circle and the planar
arena corners have 24. The goal opening interrupts the end-wall sweep.

Throttle interpolates 16 → 1.6 → 0 m/s² at 0 → 14 → 14.1 m/s. Steering targets
curvature × forward speed with a finite angular response. Lateral slip is damped
separately, with slip-dependent lower grip and a separate yaw target under powerslide. Ground
acceleration is applied as a controlled velocity increment; Rapier still handles
gravity, inertia, rigid contacts and integration. Angular controls likewise use
bounded angular-velocity increments, equivalent to configurable arcade torque
controllers rather than generic real-world engine/suspension mechanics.

Jump state owns button edges and one aerial second jump. A held first jump adds
acceleration for up to .2 seconds; its duration extends the second-jump window.
Only a real surface jump starts that window. Driving or falling off a surface
keeps an unused aerial action indefinitely; using it consumes it until landing.
Dodge owns a separate physical state. It applies a horizontal directional impulse,
then pitch/roll torque for 0.65 seconds. Opposite pitch scales down the pitch torque
and damps the current pitch spin; it does not inject backwards pitch torque. Pitch
stays locked for the torque window plus 0.30 seconds, then blends back over an
original 0.12-second return window. Vertical velocity is multiplied by 0.65 per
120 Hz step from 0.15-0.21 seconds, continuing for downward motion during the
remaining torque window; velocity is never set arbitrarily to zero.

Constants are calibrated from [RocketSim RLConst](https://github.com/ZealanL/RocketSim/blob/master/src/RLConst.h)
and the behavior documented in [RocketSim Car.cpp](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Car/Car.cpp),
which credits RLUtilities for the impulse model. The axes are converted to this
engine's Y-up convention. Our cancel damping and gradual control return are
explicit original approximations, not a claim of exact proprietary behavior.

Recovery checks held throttle/jump when a short roof ray detects a
nearby static support, with a 0.8-second cooldown. A small separating impulse plus 0.4 seconds of physical
roll torque helps return the wheels to that surface. It does not snap orientation
or constantly apply automatic upright alignment while airborne.

The ball has CCD, linear/angular damping, restitution and hard post-step speed
limits. Car-ball contact also receives a closing-speed impulse with face-dependent
gains, applied at the approximate contact point. A cooldown prevents repeated
energy injection during one contact. Default Rapier response contributes friction,
recoil and spin. This approximation differs from the researched game's center-only
supplemental impulse and is intentionally documented rather than claimed exact.

## Current standard-mode tuning

The follow-up tuning intentionally departs from the original reference baseline:
ball mass **42**, restitution **0.48**, linear damping **0.08**, maximum speed
**60 m/s** (restored from the earlier custom 42 m/s cap in the contact/camera update).
Front supplemental-hit gain is **0.30**, capped at **6 m/s** extra
velocity. This reduces hard-hit speed and repeated rebounds while retaining
directional strikes. Raising mass alone would not slow free-fall or bounces.

Car-to-car contacts retain Rapier rigid-body collision response, with a bounded
equal-and-opposite supplemental bump impulse above 2 m/s closing speed. Grip and
angular recovery are briefly reduced for 0.28 s so controls do not immediately
erase the impact. Valid supersonic front-bumper collisions now use the demolition
rules documented in [the polish update](POLISH-UPDATE.md).

Goal explosions apply distance-dependent 8–19 m/s velocity changes to both cars.
Player rotation, air roll, throttle and boost remain live during the 3.2 s goal
celebration. The scored ball is disabled until reset. A fixed-tick 3 s countdown
holds both bodies and clock before every point, including overtime.
These are bot-match rules. Free Play starts instantly and immediately resets on
a goal, without a scoreboard, clock or celebration.

The [gameplay correction report](GAMEPLAY-CORRECTIONS.md) documents current
surface/transition/air control states, held recovery, jump availability and the
shared goal-mesh repair. Any supporting wheel suppresses input aerial torque;
contact loss uses a short debounce/blend unless caused by a real jump. Forces
follow actual contact normals rather than assuming world-up support.

## Measured results

Run `npm test` for current results in `calibration.json`. Tests use the same
Rapier world and car controller as gameplay. Current standard-mode measurements:

| Measurement                                        | Result                  |
| -------------------------------------------------- | ----------------------- |
| Throttle speed at 3 s                              | 14.100 m/s              |
| Boost speed at 3 s                                 | 23.000 m/s              |
| Coast, 14 m/s for .25 s                            | 12.688 m/s              |
| Brake, 14 m/s for .25 s                            | 5.250 m/s               |
| Tap / held / double apex (body origin above floor) | 1.105 / 2.601 / 4.955 m |
| Boost remaining after 2 s                          | 33.4                    |
| Ball dropped from 10 m, height at .5 s             | 9.197 m                 |
| Bounce velocity ratio                              | .480                    |
| Square hit ball speed at 10 / 20 m/s               | 12.64 / 25.37 m/s       |
| Glancing hit ball speed at 10 / 20 m/s             | 8.75 / 17.91 m/s        |

Turning tests compare observed angular velocity/forward speed with the curvature
curve. The wall test accelerates from the floor onto the sidewall, measuring
height and supported vertical-wall ticks. Rendering at 30, 60 and 144 FPS feeds
identical tick inputs and yields identical final transforms.

## Known approximations / future tuning

- The firm contact constraint and surface alignment are original, not reconstructed wheel mechanics.
- Finite ramp tessellation remains an approximation at grazing contacts.
- No advanced tire-load transfer, exact proprietary air-control damping, flip reset mechanics,
  or contact-specific proprietary physics are modeled. Demolitions use a documented
  original validation model based on actual contact and supersonic state.
- The bot is an approach-point driver, not an aerial planner.
- Automated trajectory checks establish numerical behavior, not subjective handling quality.
  Real keyboard/controller playtesting is still the authority on feel.
- Debug hit normals use an approximate contact direction. Color-coded extra impulse and
  relative-velocity vectors persist briefly so tuning remains inspectable.

## Bodies, camera and goal geometry (September update)

Ion uses a 0.84 x 0.36 x 1.18 m box with a +0.04 m vertical offset. Vector uses
a 0.86 x 0.29 x 1.32 m box with a +0.025 m vertical offset. The visible roof is
inside the existing top collision plane; the original sinking issue was an art
height mismatch, not an undersized collider. Rendered wireframes read the actual
Rapier shape and world pose. Wheels use separate steering and axle-spin groups;
the visual steering angle is atan(wheelbase x curvature(speed)) x input.

The original goal bowl shares one procedural triangle mesh between collision and
visible lining. A rounded U perimeter and 2.4 m floor/ceiling curves connect the
rear wall, sidewalls and roof; the 1.2 m mouth lip softens the entry. Mirroring also
reverses triangle winding. Both goal tests drive physically from the floor, over
the back wall, onto the ceiling inverted and back out toward the field. Separate
side-to-rear wall tests maintain ray contacts through both mirrored rear corners.

Car camera uses a stable travel heading in the air and the projected nose on the
ground, shortest-angle damping, and an explicitly zero-roll world horizon.

Boost drain remains **33.3 per second**: after two seconds 33.4 is left, agreeing
with [RLBot's values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/).
Ground ribbons require live wheel contact; airborne boost exhaust is independent.

## Interpolated handbrake and ball verification (September 27)

Research consulted before changing this mechanic:
[RocketSim handbrake constants](https://github.com/ZealanL/RocketSim/blob/master/src/RLConst.h),
[RocketSim tire/contact behavior](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Car/Car.cpp),
and [RLBot dimensions](https://wiki.rlbot.org/v4/botmaking/useful-game-values/).
No proprietary source, collision meshes or artwork were used.

Handbrake rises at 5/s (.2 seconds to engage) and falls at 2/s (.5 seconds to
release), including while airborne. Preholding it therefore changes the first
touchdown's tire forces. Slip ratio is |lateral| / (|forward| + |lateral| + .001).
The reference-shaped handbrake lateral multiplier runs .1 to 0 as slip increases,
with a 1 to .2 slip falloff; longitudinal grip runs .5 to 1. Steering angles run
.39235 to .12610 radians over 0-25 m/s. A user-requested `rotationScale` of
0.65 reduces powerslide yaw targets by 35% at the same speed and input. The
effective steering angle uses `atan(tan(baseAngle) * rotationScale)` so front
wheel visuals follow the gentler turn. Normal steering and slide grip are unchanged.
These parameters live in P.powerslide.
Yaw follows surface speed and a latched travel sign during the maneuver; force
and yaw axes follow contact normals on floor/walls. Partial-contact scaling blends
in with handbrake. Ordinary acceleration, steering and full-grip behavior remain
unchanged. This is an original force-controller mapping of community targets, not
an exact reconstruction of Rocket League's tire solver.

At 120 Hz, fully engaged full-lock 180-degree maneuvers with .02 throttle:

| Initial speed | Normal / slide time to rotate 180 degrees | Normal / slide distance per radian | Normal / slide exit speed |
| ------------- | ----------------------------------------- | ---------------------------------- | ------------------------- |
| 5 m/s         | 1.667 / 1.725 s                           | 2.462 / 2.337 m                    | 4.310 / 3.461 m/s         |
| 20 m/s        | 1.642 / .683 s                            | 9.431 / 4.098 m                    | 16.005 / 17.549 m/s       |

Distance per radian is an effective steering radius. During a drift the velocity
and nose differ, so it is **not** the radius of a circular ground trajectory.
The unchanged steady normal-turn calibration gives 2.463 m at 5 m/s, 3.962 m at
10 m/s and 9.656 m at 20 m/s. At .5 seconds in the high-speed maneuver, lateral
velocity is 16.28 m/s sliding versus 1.25 m/s normally. Normal low-speed turns
remain responsive; handbrake does not guarantee a quicker maneuver at every speed.

A sideways drop beginning at 12 m/s retains 12.21 m/s after .25 seconds of ground
contact with preheld slide, versus .018 m/s normally. Releasing slide leaves the
blend at .5 after .25 seconds and lateral speed below .01 m/s after .55 seconds.
The corresponding vertical-wall slip test retains 5.39 vs .23 m/s, with four
supported wheels. These are historical spring-model measurements; the September
29 contact replacement removes suspension settling and retains separate tire
grip. See [RIGID-CONTACT.md](RIGID-CONTACT.md) for current checks.

Physics radius: **.9125 m**; maximum rendered radius: **.912500031 m** (Float32
roundoff); diameter **1.825 m**. The dark core is recessed 9 mm; curved inset
triangular panels and nine light patches share the outer radius. Luminaire
triangles replace panel triangles instead of stacking coplanar surfaces. Original
80-panel layout and neutral phase-offset pulses show spin cheaply (11 ball draws).

The original Ion model measures .975 x .508 x 1.270 m and Vector .995 x .458 x
1.410 m including wheels/bumpers. Ball diameter is 1.437 times Ion length and 1.294 times
Vector length; physical lengths remain 1.18 / 1.32 m. Arena dimensions stay
81.92 x 102.4 m. The apparent small ball was perspective/readability, not a sphere
scale error. No collider inflation was applied and the previously requested calm
ball tuning (42 kg, .48 restitution) is retained.

Roof glass is 32 mm below the painted roof surface, removing the coplanar blue/dark
flicker. Obstructed wall orbits shift into the arena along the collision normal
instead of collapsing onto the car; tested high/low mirrored wall positions keep
at least 4.89 m separation in ball camera, with zero horizon roll. Both camera
modes and render framing are covered by the new checks.
