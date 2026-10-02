# Arena collision / wall driving continuation — October 2, 2026

## Resume audit

The interrupted run had saved a closed shell, rounded goal-frame colliders,
footprint normals, speed-dependent wall grip, ceiling release, camera filtering,
kickoff steering and a containment backstop. It had not tested its final
static-only swept chassis correction. Earlier roof/side tests failed, and an
experimental global speculative CCD setting had broken demolition timing. That
experiment had already been removed before this continuation.

| Original requirement | Status when resuming |
| --- | --- |
| 1. Curves, robust impacts and backstop | PARTIAL: shell and ball cases passed; final chassis sweeps untested |
| 2. Stable wheel contact | PARTIAL: straight-wall cases passed; diagonal/goal coverage incomplete |
| 3. Wall sliding and ceiling release | COMPLETE in saved simulation checks |
| 4. Roof robustness/recovery | BROKEN/UNVERIFIED: earlier penetration failures and failed recovery fixture |
| 5. Solid rounded posts/crossbar | PARTIAL: existing frame tests passed; opposite posts and spin assertions missing |
| 6. Entire arena containment | PARTIAL: closed topology/backstop implemented; final impact verification incomplete |
| 7. Kickoff wheel steering | PARTIAL: local logic passed; new browser/server assertions not run |
| 8. Slope-related camera jitter | PARTIAL: main-wall checks passed; goal/corner driving checks missing |
| 9. Full regressions, production build and final report | NOT FINISHED |

## Root causes and resulting behavior

The previous arena consisted of independently generated wall, goal, floor and
ceiling colliders. Patch boundaries included unmatched subdivisions (T junctions)
and inconsistent winding. Those edges prevented a consistent adjacent-triangle
contact normal. The floor/ceiling boxes also extended behind the curved shell.

`src/arena/shell.ts` now builds one original closed playable shell from the
existing visible sweeps: it welds patch vertices, splits T junctions, triangulates
the actual floor/ceiling outlines, and propagates consistent inward winding.
There are 27,752 triangles and 41,628 shared edges. Every edge has two neighboring
faces with opposite edge direction; duplicate faces are rejected by tests.
Rendering retains the same surface positions. No extracted game geometry or
invisible emergency walls were added.

The previous angular cap also prevented a full-speed car from following a tight
curve fast enough. The controller now tracks the change in its stable surface
normal and permits the required contact rotation, preserving the ordinary air
and flip caps. Previously, single-ray changes and contact loss could dominate
alignment. The normal now blends the wheel-hit footprint plane with averaged
surface normals over a short 25 ms response interval. A lone landing wheel can
only establish alignment when additional nearby probes agree; it cannot invent
additional tire contacts or keep replaying a previous curve's angular velocity.

Floor tire and powerslide coefficients remain separate from surface correction.
On walls, traction depends on meaningful forward speed (full response at 4 m/s).
At rest, lateral grip falls to 2.5% of floor grip and world-down gravity produces
a slide. Adhesion fades continuously beyond vertical and is zero at a normal-Y
of -0.25, roughly 104.5 degrees from floor-up. Boost keeps its ordinary thrust;
the car can climb a wall, but cannot remain attached to the ceiling indefinitely.

## Roof / side protection and containment

The chassis dimensions and collider offsets still match the two existing bodies.
Its collider has an 8 mm contact skin. Ball and cars retain hard CCD, with up to
four CCD substeps. Rapier can leave hard CCD inactive for smaller per-step motion;
static-only corner sweeps cover that gap without changing car/car or car/ball
collision timing. Actual chassis manifolds and center-to-corner rays resolve
residual penetration on every face. Position correction is capped at 4 cm per
120 Hz step and is not converted into bounce velocity. Velocity correction only
removes movement into the contacted surface; tangential motion remains available.

The old jump exclusion skipped all clearance protection. Now only wheel support
detaches for takeoff; roof/side protection continues during jumps and flips.

The backstop tests body centers against the actual closed shell. Only a numerical
escape resets the affected body to a safe interior spawn and clears its velocity;
it does not score a goal. `Simulation.containmentRecoveries` exposes its use.
Collision/driving tests require this counter to remain zero. A separate test
deliberately places both bodies outside and verifies that recovery works.

## Frame, camera and kickoff

Both posts and each crossbar are solid capsules with 0.22 m radius, shared by
rendering and collision. Their inner tangents preserve the existing goal opening;
their rounded ends meet within the solid fascia. Normal rigid-body contacts
produce the rebound direction. Ball spin, friction and restitution were retained.

The camera briefly filters vehicle orientation while surface-driving on curves;
ordinary flat steering keeps its original response. It still uses world-up for
the horizon. Physical surface stability is addressed before camera filtering.

Countdown input updates only the steering rack. Chassis pose, throttle, boost and
jump remain locked until GO. Both the local game and server match use this rule;
network snapshots already carry the steering angle.

## What this continuation completed

- Verified the saved static-only chassis sweep against all roof/side impact cases
  and confirmed demolition behavior after removal of global speculative CCD.
- Corrected the inverted-goal fixture: it now rests the roof on the slope before
  asking for recovery, instead of triggering an aerial dodge before landing.
- Added robust nearby-normal sampling for single-wheel landings and cleared stale
  curvature rotation when only one wheel remains.
- Expanded tests to diagonal corner driving, goal-curve cameras, slow corner rolls,
  exact patch seams, both sides of every frame, centered restitution and spin.
- Added `npm run test:arena` and included it in the normal gameplay test command.
- Updated the physics/tuning documentation and retained existing gameplay systems.

## Verification

The focused matrix covers 160 roof-first and 160 sideways cases across 40 major
curved surfaces, both bodies and 3/23 m/s impacts; 120 ball curve impacts at
1/15/60 m/s; 16 slow/fast corner rolls; 56 seam impacts; and 84 frame cases.
Driving checks cover low/high speed, boost, diagonal corners, goal curves,
wall stopping, ceiling release, upside-down recovery and kickoff controls.
There are separate chassis/wheel-clearance, jump, landing, powerslide, camera,
demolition, scoring and multi-player regression suites.

Final results:

| Original requirement | Final status |
| --- | --- |
| 1. Curves, high-speed impacts and safe backstop | COMPLETE |
| 2. Stable wheel contact and rigid clearance | COMPLETE |
| 3. Wall grip/sliding and progressive ceiling release | COMPLETE |
| 4. Roof/side impacts and inverted goal recovery | COMPLETE |
| 5. Volumetric posts/crossbar with angled rebounds | COMPLETE |
| 6. Closed arena and containment verification | COMPLETE for the tested matrix; no observed escapes |
| 7. Kickoff front-wheel steering with locked chassis | COMPLETE in local browser and server tests |
| 8. Physical slope stability and camera response | COMPLETE |
| 9. Production build and regression verification | COMPLETE |

- `npm test`: PASS, including the new arena matrix and all prior gameplay tests.
- `npm --prefix server test`: all six tests PASS, including countdown steering
  with unchanged pose/boost and existing account/party/network behavior.
- Browser and server production builds: PASS. Vite retains its existing bundle
  size advisory.
- `tests/browser-smoke.cjs`: PASS, including actual keyboard kickoff steering,
  unchanged chassis/boost, Free Play, VS Bot, bindings, garage/settings and effects.
- `tests/contact-browser.cjs`: PASS for curve traversal/framing, camera modes,
  effects and goal-mouth rendering; no browser/shader errors. Inspected the final
  goal-frame screenshot.
- `tests/network-browser.cjs`: PASS for 1v1, four human players, bots, shared
  goals/results, pause, reconnect and cleanup.
- Roof/side impact sampling measured **zero chassis-corner penetration** across
  the 320 cases. The test retains only a 1 mm numerical tolerance.
- Driven path wheel clearance stayed above 7.9 mm and body clearance above
  10.1 mm for both bodies. The 12 straight-wall and 16 diagonal/goal driving
  cases had no single-wheel intervals during ascent. Maximum measured camera
  rotation per 120 Hz frame was 0.033 radians in those curve tests.
- The recovery counter remained zero for all normal collision and driving cases;
  only the explicit outside-volume fixture used the backstop.

Logs are `.tools/arena-final-{tests,server-tests,build,server-build,browser,contact-browser,network-browser,penetration}.log`.
The updated compiled LAN server was launched on `0.0.0.0:8090` for local review.

No remaining arena escape was observed in this coverage. Finite tests cannot
prove every possible input sequence or contact angle; the logged backstop remains
available for rare numerical failures. Tests cover both current car bodies and
the current arena dimensions; geometry/body changes should rerun this matrix.

## Public behavioral references

- [RocketSim car implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp): independent behavioral reference for wheel-contact normals, traction and sticky force; not exact source truth for Rocket League.
- [RLBot jump physics](https://wiki.rlbot.org/v4/botmaking/jumping-physics/): gravity and wheel-relative sticky force are distinct effects.
- [Rapier colliders](https://rapier.rs/docs/user_guides/javascript/colliders/) and [rigid bodies](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/): mesh contacts, collision skin and CCD. APIs were checked against the installed 0.19.3 declarations.

Octane Arena's ceiling release and firm contact behavior follow the requested
design. No proprietary assets, collision dumps or geometry were used.
