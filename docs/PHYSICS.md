# Physics reference

The vehicle and ball model follows the public
[RocketSim](https://github.com/ZealanL/RocketSim) reconstruction of Rocket League
(`RLConst.h`, `Car.cpp`, `btVehicleRL.cpp`), converted to this engine's metres,
seconds and Y-up axes (100 uu = 1 m). `src/config/physics.ts` is the single
source of live values; this page explains the architecture and the deliberate
differences from RL. Older update notes in `docs/` (adhesion, alignment torque,
roof friction switching, pose alignment, level-horizon camera) describe
systems that have since been removed.

## Public research consulted

- [RocketSim](https://github.com/ZealanL/RocketSim): constants, suspension, tire, sticky force, jump/dodge, air control and car-ball extra impulse.
- [RLBot useful game values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/): masses, speeds, gravity, boost.
- [RLBot jump physics](https://wiki.rlbot.org/v4/botmaking/jumping-physics/): impulse, held jump, minimum jump time, second-jump window.
- [Samuel P. Mish: ground control](https://www.smish.dev/rocket_league/ground_control/): throttle/brake/coast and curvature tables.
- [Mish, Nevercast and tarehart: ball/car collision](https://www.smish.dev/rocket_league/ball_simulation_3/): rigid contact plus RL's supplemental impulse.

## Simulation

- Fixed 120 Hz tick (`P.dt`), gravity 6.5 m/s². Rendering interpolates poses; 30/60/144 FPS feed identical ticks.
- Rapier 3D (WASM) integrates rigid bodies. The car's tire, suspension, sticky,
  jump and air forces are computed in `Car.tick()` before each world step.
- Car 180 kg; ball 30 kg, radius 0.95 m, restitution 0.6, friction 0.35, max
  speed 60 m/s, max angular speed 6 rad/s.

## Car (`src/car/car.ts`, `suspension.ts`, `chassis-guard.ts`)

**Chassis.** 1.18 × 0.84 × 0.36 m box. COM on the hitbox bottom face, 20% of the
axle half-span behind the wheelbase midpoint (RL Octane). Bullet box inertia.

**Suspension.** Four stateless raycast wheels (RocketSim `btVehicleRL`):
force = (k·(rest − length)·inv − c·velocity)·share·m, clamped ≥ 0, with
k = 500, compression damping 25, rebound damping 40, travel 0.12 m and a rest
length that includes the 1.5 g static load. The bump stop is Bullet's
`resolveSingleCollision` (ERP 0.2) once the trace passes rest + radius − 2.5 uu.
As in RL it is applied only together with a non-zero suspension force, so a
wheel rebounding fast enough to clamp its spring to zero gets no extra push.
Grazing hits (contact normal · suspension axis < 0.6) are not tire contacts.

A separate unilateral fixed-tire bottom stop prevents extreme compression below
0.12 m wheel length (2 mm surface skin). It acts at actual wheel points using
linear and angular contact velocity, followed by bounded outward correction.
It cannot pull the car toward a surface or set its orientation. Ordinary ride
height, ray travel, springs and dampers remain unchanged.

**Contact states.** AIRBORNE (no loaded wheel), PARTIAL_CONTACT (1–2) and
GROUNDED (3–4 coherent wheels, within 60° of their average normal). Only
GROUNDED grants full floor tire grip, steering authority, sticky force, jumping
from the surface and landing assist. Wall/ceiling tire grip remains reduced
and recovers progressively with throttle, forward speed and low slip.
Partial contact keeps reduced grip
(40%/60%, then RL's non-sticky curve on walls/ceilings) and a quarter of engine
force, so one or two wheels can never hold a car on a wall or ceiling.

**Tires.** Per-wheel lateral impulse −v_lat·m_eff·friction at COM height (RL's
roll-influence fix), per-wheel engine (400 uu/s² each) and brake, RL coasting
and stop logic, speed-dependent steering angle with analog input. Powerslide
uses RocketSim's handbrake rise/fall (5/2 per s) and lateral factor 0.1; it is
the sliding mechanic; ordinary high-speed floor steering keeps full lateral grip.
On walls, the original passive non-sticky multiplier (0.1 on a vertical wall)
blends toward a slip- and speed-dependent target. Stable full-throttle recovery
ranges from 0.35 to 0.83 as forward speed rises to 20 m/s, with high slip reducing
that target to 25%. Lateral recovery is exponential (3.5/s rise, 4/s fall);
final vertical-wall lateral grip is capped at 0.847. Longitudinal drive uses a
separate smooth recovery, with a 0.72-0.90 speed-dependent target, so a slipping
car can regain enough drive to climb against gravity. Wall braking is softened
and blended out toward the floor. These change tire impulses, not adhesion. Both
recovery states are included in prediction checkpoints.

**Sticky force.** 0.5 g toward the surface plus (1 − |n.y|) g while throttling
or rolling, along the average wheel normal, only while GROUNDED. A flat
ceiling therefore releases (0.5 g < 1 g), as in RL.

**Jump / dodge** (`dodge.ts`). Impulse 2.92 m/s along car up; held 14.58 m/s²
for up to 0.2 s (62% during the 0.025 s minimum); second jump/dodge within
1.25 s. Dodges use RL's 5 m/s impulse with backward/side speed scaling, flip
torque 224/260 rad/s² for 0.65 s, pitch lock +0.3 s, cancel, stall and the RL
vertical-velocity damping window. Driving off a surface leaves the aerial action
available.

**Air control.** RL per-axis torque (pitch 12.5, yaw 9.1, roll 38.4 rad/s²) and
damping (2.9, 1.9, 4.8 per s; pitch/yaw scale with 1 − |input|), roll > pitch >
yaw. Angular speed cap 5.5 rad/s; while wheels follow a curved transition the
cap adds the surface's own turn rate, so tight Dropshot/Hoops curves are
followed at supersonic speed instead of rammed.

**Landing** (`landing.ts`). No pose targets, no midair righting. Only a clean
touchdown (first contact wheels within ~25° of the surface, descending, 3–4
coherent wheels, no flip, no strong input, ω < 4 rad/s) gets 0.2 s of one-way
damping of spin that tilts the car away from the surface. Roof, nose, side and
dirty landings get nothing until the next real flight.

**Auto-roll / recovery.** RL auto-roll for a nearly stationary car on its side
with throttle; RL auto-flip equivalent for a car on its roof.

**Chassis guard.** Rapier's discrete contacts let a fast or tumbling hull push
a corner up to one tick of travel into static geometry. Before the step each of
the 12 hull vertices casts along its velocity; a vertex that would cross a
static surface has its approach limited to arrive exactly there (unilateral,
normal-only). After the step any residual penetration is corrected positionally
(≤ 4 cm, no velocity change). It never touches wheels or orientation.

**Visual suspension.** A separate chassis child pitches/rolls from smoothed
actual local acceleration only during supported driving. Maximum pitch is
0.028 rad (1.604 deg), roll 0.021 rad (1.203 deg). Total wheel offsets, including
weight transfer, are clamped to 6.3 mm up / 28.8 mm down from authored mounts.
When pitch exceeds 0.014 rad, a small visual-only chassis lift preserves wheel-arch clearance.
The visual code never changes the rigid body, collider or COM. See
[VEHICLE-REFINEMENT.md](VEHICLE-REFINEMENT.md) for measured steering and validation.

## Ball and car-ball contact (`src/physics/car-ball.ts`)

Rapier solves the pair on a dedicated ball shell with RL's car-ball material
(friction 2, restitution 0), so the rigid response already uses the contact-point
velocities v + ω × r of both bodies. RL's extra impulse is then added to the
ball only: along car→ball with the vertical part ×0.35 and the car-forward part
×0.65, scaled by RL's relative-speed curve, at most every other tick, and only
on a fresh or migrated contact. A resting dribble (relative speed < 0.25 m/s)
gets none. Flip hits are stronger through ω × r alone; there is no flip bonus.

## Measured results

From `.tools/rl-probe.ts` and `.tools/ball-probe.ts` (same world and car code as gameplay):

| Measurement | Result |
| --- | --- |
| Throttle / boost top speed | 14.10 / 23.00 m/s |
| Coast / brake deceleration | 5.25 / 35.00 m/s² |
| Curvature vs RL table, 2–23 m/s | 0.92–0.98 |
| Jump apex: tap / held / double | 75 / 219 / 449 uu |
| Dodge Δv: forward / back / side | 5.01 / 8.74 / 6.91 m/s |
| Landing settle (flat, 15°, 35°, nose 25°, side 80°) | ≤ 0.5 s, roof landing stays on roof |
| Boosted floor→wall climb | 4 wheels on the wall to the ceiling |
| Wall ride: throttle / none | holds / slides down |
| Ceiling: 4 wheels / 2 wheels | peels after 0.18 s / never grounded |
| Drive hit at 10 / 23 m/s | ball 13.6 / 29.8 m/s |
| Flip vs drive hit at 10 m/s | 22.5 vs 13.6 m/s |
| Soft touch at 1 m/s | ball 1.7 m/s |

## Known differences from Rocket League

- RL applies the sticky force with any wheel touching and gives no air control
  with 1–2 wheels; here partial contact gets no sticky force (no 2-wheel ceiling
  or wall cling) but keeps player air torque.
- The bump stop is split among the wheels whose rays touch (RL always divides by four).
- Angular cap adds the surface turn rate on curves (RL is a flat 5.5 rad/s).
- Ball radius 95 uu (RL 91.25 uu).
- The chassis guard, fixed-tire hard bottom stop and clean-landing anti-tilt damper have no RL equivalent.
- Wall tire friction recovers progressively and stays below floor grip.
- Arena meshes are original approximations of the RL shells.
