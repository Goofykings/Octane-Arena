# Gameplay camera rig

This update changes only the gameplay camera and its diagnostics/tests. SHA-256 comparisons against the start-of-task snapshot confirm that car, ball, arena, physics configuration, input definitions and shared settings/network sources are unchanged. Existing local and snapshot-rendered network matches use the same `GameCamera` implementation.

## What was replaced

The former controller mixed raw physics velocity, orbit tracking, wall-tangent side selection, two collision corrections, separate wall damping and late FOV estimation. Those stages could disagree about the final view. Translation, orientation and framing were not evaluated as one render-frame problem.

The old wall blend/timer, alternative-camera candidates, post-smoothing wall-normal push and raw-body velocity reads have been removed.

## Pipeline

1. Read interpolated car position/quaternion and interpolated ball position. Derive motion from those render samples, never 120 Hz body transforms.
2. Set the pivot to the rendered car. Survey static arena geometry with six reusable rays; blend the resulting surface reference with spherical exponential damping. Arena gravity defines a separate, level horizon.
3. Blend Ball/Car target priorities through one transition state. The horizontal ball-bearing dead zone retains orbit near the car; an unwrapped bearing and remembered turn direction handle the antipode.
4. Solve an ideal boom using camera Distance/Height settings, the continuous surface frame, and whole-boom geometric constraints. Two-subject projection determines extra distance. Evaluate both the desired and catching-up orbit; a short render-motion forecast reserves framing distance before fast passes reach the edge. The actual aim always follows the actual rendered ball.
5. Damp boom direction and length independently of orientation. Car translation feeds through immediately. Position stiffness uses exponential damping; radial change is bounded in metres per second. Swivel controls orbit response; the surface frame reduces orbit rate continuously at walls.
6. Apply final collision clearance with a 0.20 m swept sphere. This stage only shortens the boom. It never selects another orbit or pushes the final camera sideways. Clearance recovers exponentially. The cast may leave an initial tiny overlap at a resting roof pivot, but cannot move farther into an obstacle.
7. Frame car and ball as angular subjects, weighted slightly toward the ball. Include a car control envelope and full ball radius. Preserve a polar basis explicitly instead of calling `lookAt`: retain prior yaw at near-vertical looks, smoothly resume the horizontal bearing, and bound pitch inside the readable hemisphere. The camera has zero roll even when the car air-rolls.
8. Before drawing, project both subjects from the actual damped, collision-corrected view. Aim constraints take the smallest correction toward a feasible view, bounded by delta time and swivel response. FOV expansion uses the 85% target/90% reserve, caps at 120 degrees, and returns smoothly to the user's FOV. Narrow viewports receive a projection-derived distance budget. Debug state is measured again after committing the final projection.

Car Cam uses the same pivot, reference frame, boom, smoothing, collision and transition stages. Only targeting priorities change. Switching either direction does not reset the rig. Goal celebrations retain the existing goal-focus target after the ball is disabled. Home and garage controllers remain mutually exclusive with the gameplay controller.

All existing camera settings remain supported: FOV, Distance, Height, Angle, Stiffness, Swivel and Transition. No schema, settings UI or keybind changes were required.

## Diagnostics

Press **F3** in a local or network match. The existing diagnostic overlay now includes camera mode, pivot, desired/actual position, smoothed surface reference, horizon up, look direction, polar fallback, car/ball screen coordinates with depth, FOV adjustment, framing safety and collision state. Orange/purple lines show desired/actual booms; white shows viewing direction. Camera math vectors, quaternions, rays and the swept sphere are reused.

## Verification

Run `npm run test:camera` for camera regression, two-subject framing, the new rig torture suite and the existing real-physics ramp matrix. The rig suite runs A–P plus a 60 m/s close ball pass at 30/60/144 FPS across 16:9, 4:3, 9:16 and 21:9: **204 trajectory runs**. It checks subject extents every enabled Ball Cam frame, car visibility through both toggle directions, horizon stability, angular continuity, camera-to-pivot obstruction, and minimum boom clearance.

| Test   | Coverage                                                                    |
| ------ | --------------------------------------------------------------------------- |
| A      | Normal Ball Cam driving                                                     |
| B      | Full-speed powerslide trajectory around the ball                            |
| C / D  | Low-speed and fast floor-to-wall curves                                     |
| E      | Vertical wall with midfield ball                                            |
| F / G  | Direct overhead and near-ceiling ball                                       |
| H / H1 | Behind-car orbit and fast close front-to-back passes                        |
| I      | Close ball with noisy horizontal bearing                                    |
| J / K  | Continuous air-roll and aerial overhead crossing                            |
| L / M  | Wall-to-air and wall-to-floor                                               |
| N      | Inverted car; additional actual resting-roof physics checks for both bodies |
| O      | Goal focus with disabled ball                                               |
| P      | Rapid toggles, including intermediate Ball Cam frames                       |

Trajectories isolate the camera against the real collision shell. The separate unchanged ramp tests supply 144 actual physics driving runs across both bodies, arena sides, travel directions, speeds and diagonal entries. Existing arena tests cover real wall departure, goal curves and upside-down recovery. Additional tests prove identical render samples produce identical camera transforms despite different raw physics poses/velocities, noisy wheel normals and car air roll. Polar tests cover look directions nearly parallel to up and down.

Measurements are in `camera-rig.json`, `camera-stability.json` and the existing ramp/arena test output. Full `npm test`, production build and automated browser suites are run for this change; current results are reported with the update.

Final verification:

- [x] `npm test`: entire final regression suite passed.
- [x] `npm run test:camera`: 204 rig trajectories, polar/render-isolation/roof checks and 144 real-physics ramp runs passed.
- [x] Focused transition tests: both toggle directions respond to Transition Speed; both Free Play and bot goal-focus checks passed.
- [x] `npm run build`: TypeScript and production Vite build passed.
- [x] `npm --prefix server test`: all seven server tests passed.
- [x] `tests/browser-smoke.cjs`: single-player, Free Play, VS Bot, settings, garage and UI checks passed.
- [x] `tests/contact-browser.cjs`: live overhead/wall/ceiling/curve framing, both toggle directions and no browser/shader errors passed; overhead and wall screenshots inspected.
- [x] `tests/network-browser.cjs`: both snapshot-rendered cameras frame car/ball with level horizons; F3 camera diagnostics, two/four-player matches, goals and reconnects passed.
- [x] Physics/car/arena/config/shared source hashes match the task baseline.

## Limits

Screen framing does not render through opaque goal geometry or other objects. A fully obstructed boom, physically overlapping subjects, an instantaneous teleport or an extremely narrow viewport can make both subjects impossible to frame from a continuous, collision-safe pose within the FOV limit. Debug framing safety reports that limitation rather than silently claiming visibility. In tight portrait views, extreme near passes can widen the safety FOV quickly; standard gameplay returns to the configured view smoothly. No camera code changes gameplay physics to fix a view.
