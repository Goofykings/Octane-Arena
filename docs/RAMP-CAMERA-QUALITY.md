# Ramp physics and Ball Cam quality

## Diagnosis

The previous corner tests approached the rounded arena corners along their
normal. They did not cover full-boost oblique entries into a straight side-wall
ramp. A dedicated baseline reproduction did: both cars, both side walls, and
0°, 15°, 30°, 45° and 75° entry angles at 23 m/s.

At 30–45°, changing contact counts exposed three related issues:

- A single remaining wheel froze the surface normal and cleared curvature
  feed-forward. Rotation then lagged behind the surface; the ordinary aerial
  cap could also apply during that reduced-contact curve state.
- Fitting a plane only to currently loaded wheels changed the frame whenever
  a wheel unloaded. The baseline measured normal jumps up to 1.37 radians.
- Wheel-clearance velocity constraints changed the whole chassis's linear
  velocity, without accounting for velocity and rotational response at that
  wheel. This could support one front corner while lifting the rear.

The baseline's worst contact-free/one-wheel stretch lasted 136 physics ticks
(1.13 seconds). It reproduced the reported failure. Boost already acts through
the centre of mass along the actual forward vector, so no boost offset or new
outward force was needed. The closed arena collision shell was retained.

## Surface frame and support

Each valid nearby wheel ray now stores its normal. The combined frame weights
normals by clearance and blends a whole-footprint plane when all four geometric
samples are available. Nearby unloaded rays can describe the surface, but do
not create tire contact flags or tire traction. A lone first ray cannot
establish a frame without sufficient surrounding samples. An established frame
continues following a real remaining contact rather than freezing.

The existing 40/s exponential filter remains short (25 ms). The angular support
controller compensates that measured filter delay using the contact-derived
curvature rate, with a bounded 0.25-radian prediction. Alignment/damping respond
more quickly only while the frame turns through a curve. No chassis quaternion
is snapped or locked to the surface. The existing curve rotation cap applies
through reduced contact as well; ordinary aerial and flip caps are unchanged.

On curved/tilted surfaces, each wheel's unilateral normal-velocity constraint
uses velocity at its contact point, the centre of mass and the actual inverse
inertia tensor. A normal impulse therefore supports both translation and
rotation. The existing flat-floor constraint is retained exactly, including
zero-bounce landings. Positional penetration correction remains bounded and
does not turn position error into spring energy. Roof/body CCD and containment
remain active. Tangential grip and powerslide forces remain separate.

Sticky force remains separate from tire forces. Its strength was not increased.
The same speed-dependent wall grip, downward sliding at low speed, overhead
adhesion fade and ceiling detachment remain. The controller's geometry tracking
does not disappear merely because a wheel unloads.

Behavioral references: [RocketSim car support/traction implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp)
and [RLBot sticky force and world gravity](https://wiki.rlbot.org/v5/botmaking/jumping-physics/).
These are references for separated forces and reduced contact, not exact source
truth or copied arena geometry.

## Ball Cam

Physical orientation, the camera's filtered surface normal, arena-up reference
and ball bearing are separate. Near a wall, the heading guide uses travel
projected onto the filtered surface plane, rather than inheriting instantaneous
body roll/pitch. Flat driving retains its existing nose-heading response.
Wall/floor/airborne contact changes do not rotate the horizon.

Wall avoidance now blends continuously with slope instead of switching at a
single surface-normal threshold. The angular car/ball framing path retains
dynamic FOV and distance handling. Opposite subject rays have a ball-priority
fallback; an almost vertical look keeps its previous yaw. Camera position,
heading, aim and FOV damping remain exponential and frame-rate independent.
FOV, distance, height, angle, stiffness, swivel and transition settings retain
their existing roles.

## Verification

`tests/ramp-quality.ts` runs 144 real-physics entries: both body shapes, both
side walls, both along-wall travel directions, and 30/60/144 FPS. Each includes
slow straight, maximum throttle-only, full-boost straight, full-boost 30°,
full-boost 45°, and nearly parallel 75° entries. The same runs verify visible
ball/car centres, a level horizon, adequate camera distance, bounded normal
changes, and no containment recovery.

The measured matrix had:

| Measurement                   |                    Result |
| ----------------------------- | ------------------------: |
| Longest one-wheel interval    |           6 ticks / 50 ms |
| Contact-free ejections        |                         0 |
| Largest surface-normal step   |             0.096 radians |
| Largest camera angular rate   |            2.54 radians/s |
| Maximum sticky acceleration   | 9.75 m/s², original limit |
| Maximum positional correction |                   0.020 m |

The suite also checks midfield/high/low/behind-wall targets, nearly parallel
up/down bearings, and real wall-to-floor and wall-jump aerial transitions on
both sides at all three frame rates. Existing regressions verify flat driving,
powerslide, turning, floor/wall jump, dodge, air roll, boost, upside-down
recovery, ceiling release, ball collisions and all major arena seams.

F3 now shows wheel normals, combined frame, support count, angular velocity,
sticky acceleration, normal velocity correction and camera up. Loaded normals
are cyan; nearby unloaded samples are orange; adhesion is purple. Acceleration
values can be multiplied by car mass to obtain equivalent forces.

## Remaining limits

Rigid cars can briefly unload a wheel on tight curvature; measured intervals
up to 50 ms are retained honestly rather than forcing four contact flags.
Ceiling contact still releases intentionally. These tests cover the reported
entries and existing collision suite, rather than every possible impact or
camera-setting combination.
