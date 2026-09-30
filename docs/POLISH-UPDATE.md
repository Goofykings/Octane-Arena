# Gameplay polish and camera update

## Root causes and implemented changes

| Area | Finding and correction |
| --- | --- |
| Camera jitter | Collision escape changed sides when a nearly vertical car's projected nose changed sign. Close/overhead ball bearings were unstable, and linear interpolation through the car invoked a hard distance snap. The camera now keeps its escape side, eases wall aiming, retains orbit near overhead balls, interpolates its relative orbit, and applies clearance along wall normals. |
| Wall boost separation | Straight vertical boosting already worked; curved entry produced outward suspension rebound. Constant local-down adhesion was insufficient once wheel reach was lost. Contact forces now use the measured surface normal, with stronger driven-wall adhesion and outward rebound damping while wheel contact exists. No position/orientation locking was added. |
| Side-balanced recovery | The recovery probe only covered the roof. Side probes now detect a low-speed, low-angular-speed stuck pose with fewer than three supporting wheels. Held throttle must persist for 0.35 s before recovery. Supported wall driving and brief tilts are excluded. |
| Flip feel | The controller already used the researched 224/260 angular accelerations, 0.65 s torque window and 5.5 rad/s cap. Measurements confirmed those values. They were retained, and the test now measures physical orientation and verifies the rendered pose rather than speeding up animation. |
| Demolitions | Previously there was only a generic bump. Added opponent/forward-bumper contact validation using pre-solver velocities, explicit demolition state, a short original flash/particle/audio effect, disabled collision participation, and timed safe team-side respawn. |
| Supersonic | Previously visuals used a raw speed comparison. One state now serves visual effects and demolition eligibility, with a 22 m/s entry threshold and a bounded 21 m/s maintenance band. |
| Goal attribution | Match messages used hard-coded team colors. Cars now carry stable IDs, team and display name. Ball contact records a player ID; goal events record scorer ID, team and own-goal status. Messages resolve the current scorer's name. |
| Goal visualization | The full-sphere score check already existed. It is now shared through goal helpers with subtle nonphysical goal-mouth planes, an analytic intersection ring and a world-space band in the ball material shader. |
| Powerslide feedback | Existing slide particles depended mostly on button state. The new tire audio and pooled rear-wheel marks use measured lateral slip and rear-wheel contact. Audio uses a continuously running filtered-noise source, not repeated playback. |
| Garage drag | Drag state did not track pointer ownership, lost capture, focus loss or DOM replacement. Capture ownership and all termination paths now clear state reliably. |
| Garage previews | Boost and goal explosion categories had no dedicated demonstrations. Boost previews exhaust, light and particles on a stationary car. Explosion items run one click-triggered ball/goal sequence in a separate scene. |
| Responsive layout | Independently positioned content and footer could occupy the same area. Garage/mode screens now reserve grid rows for heading, scrollable content and persistent navigation. Dialog bodies scroll independently of their headings/tabs. |
| Countdown layering | HUD elements relied on DOM order. Shared layer variables put countdown above normal HUD and nametags; nametags remain above the 3D world. |
| Bot reset | Both the old R binding and pause reset bypassed match flow. Competitive resets are removed; the pause button only appears in training. The old saved binding remains schema-compatible but is hidden and inactive. |

## Exact tuning and preserved values

| Quantity | Current value |
| --- | --- |
| Physics timestep | 1/120 s, unchanged |
| Base adhesion | 3.25 m/s², unchanged on flat floor/ceiling |
| Driven contact adhesion | `3.25 + 6.5 × (1 − abs(normal.y))` m/s²; 9.75 on a vertical wall |
| Driven condition | Throttle/boost requests drive, or forward speed exceeds 0.25 m/s |
| Steep-surface rebound damping | `12 × outwardNormalSpeed × (1 − abs(normal.y))` m/s² while supported |
| Side recovery dwell | 0.35 s, speed below 2 m/s and angular speed below 1.5 rad/s |
| Existing recovery | 0.4 s torque and 0.8 s cooldown, retained |
| Flip pitch/roll angular acceleration | 224 / 260 rad/s², unchanged |
| Flip torque duration / angular cap | 0.65 s / 5.5 rad/s, unchanged |
| Pitch lock extension / control return | 0.30 / 0.12 s, unchanged |
| Normal kickoff / demolition respawn boost | Exactly 33 / 33 |
| Small boost pads | Exactly +12, 4 s respawn; unchanged |
| Large boost pads | Fill to 100, 10 s respawn; unchanged |
| Boost consumption | 33.3 per second; retained floating-point state |
| Supersonic state | Enter at 22 m/s; maintain at ≥21 m/s for at most 1 s below entry speed |
| Demolition delay | 3 s |
| Skid lifetime | 0.75 s; fixed pool of 180 segments per car |
| Skid signal | Rear contact and slide input, with lateral slip above 1.2 m/s; full intensity at 10 m/s |
| Scoring plane | `z = ±51.2 m`; whole ball requires center beyond plane by radius 0.9125 m |

At rest on a vertical wall, gravity still produces sliding; on ceiling surfaces,
gravity can separate the car. Jump takeoff suppresses wheel contact and therefore
bypasses the new contact forces. Previously requested calm ball tuning is preserved.

Stationary jump/forward-dodge measurements, relative to the first dodge tick:

| Elapsed time | Integrated physical rotation |
| --- | --- |
| 0.10 s | 0.535 rad / 30.7° |
| 0.20 s | 1.085 rad / 62.2° |
| 0.40 s | 2.185 rad / 125.2° |
| 0.65 s | 3.560 rad / 204.0° |

Peak angular speed is 5.5 rad/s. The 0.65 s value is the **torque window**, not a
claim that the car completes 360° in that time. Rotation can continue afterward.
Existing flip-cancel and pitch-lock regressions remain part of `npm test`.

## Demolition rules

Both cars follow the same rules. A real collision event must have an active
supersonic attacker and an active opposing-team victim. The attacker's nose and
velocity must point toward the victim (0.7 dot-product threshold), closing speed
must exceed 2 m/s, and the actual contact manifold must include the forward
bumper region (forward 80% of collider half-length, contact separation below 3 cm).
Side rubbing, backwards travel, equal-speed following, teammate and low-speed
contact do not qualify.

The victim's identity persists. Its collider groups and body are disabled during
demolition; controls, pads and AI cannot move or interact with it. After 3 s, it
tries randomized positions at x = −30, −22, 22 or 30 m, z = ±43 m on its own
side. Spawn selection rejects nearby active cars and the ball. If blocked, the
respawning state retries rather than overlapping another object. Poses, velocities,
jump/recovery state and boost reset. Kickoff also clears pending demolition state.

Goals during the respawn interval preserve score and scorer identity. In this
1v1 game an own goal is credited to the opposing player and marked in the event.
Future team modes will need their own team-level assist/own-goal attribution.

## Changed implementation files

- `src/camera/camera.ts`: stable orbit, wall transitions and clearance.
- `src/car/car.ts`, `src/config/physics.ts`: contact forces, stuck recovery, slip,
  supersonic and demolition state, configurable values.
- `src/physics/simulation.ts`, `src/game/demolition.ts`: contact validation,
  demolition/respawn lifecycle and last-touch identity.
- `src/game/match.ts`, `src/game/goals.ts`: scoring plane, attribution and kickoff boost.
- `src/effects/skid-marks.ts`, `src/effects/goal-plane.ts`,
  `src/effects/demolition-flash.ts`: new pooled/visual-only effects.
- `src/effects/vehicle-effects.ts`, `src/effects/goal-explosion.ts`: shared
  supersonic state, preview exhaust and scaled preview explosion.
- `src/audio/audio.ts`: contact/slip-driven tire audio.
- `src/render/garage-preview.ts`, `src/ui/garage-panel.ts`: robust pointer lifecycle,
  stationary boost and one-shot miniature goal previews.
- `src/main.ts`: integration, training-only reset, bot identity, demolished-car handling.
- `src/ui/ui.ts`, `src/ui/settings-panel.ts`, `shared/controls.ts`: training-only
  reset presentation and legacy-binding compatibility.
- `src/style.css`: responsive layout constraints and shared render layers.
- `src/debug/debug.ts`: slip, rear contact, supersonic/demo state and respawn telemetry.
- `tests/camera-stability.ts`, `tests/polish.ts`, `tests/polish-browser.cjs`,
  `tests/goal-visual.cjs`, `tests/improvements.ts`, `package.json`: repeatable coverage and state-aware fixture.
- `README.md`, `docs/PHYSICS.md`, this report and generated JSON/screenshots: documentation/evidence.

## Verification completed

- `npm test`: all six suites passed, including **20 new polish checks** and
  **19 camera checks**. The run printed 137 passing results, with some existing
  results grouping multiple assertions.
- `npm run build`, `npm run build --prefix server`, and
  `npm test --prefix server`: passed; both account persistence/security suites passed.
- Actual ramp-entry trajectories at initial speeds 0, 14 and 23 m/s, each with
  and without boost: no lost-support ticks in the measured vertical section
  between 4 and 15 m height. Before correction, the boosted 23 m/s entry lost
  support for 54 measured ticks. All runs also check against false recovery.
- Stopped-wall gravity slide, wall jump departure, ceiling transitions,
  both directions of side-balanced recovery, and prior inverted recovery tests passed.
- Forward-dodge orientation samples and cap checks passed. Rendered car quaternion
  matches the physical pose; existing double jump, directional dodge, flip cancel,
  aerial roll, wall/goal traversal and control-state tests remain green.
- Actual forward collisions demolish either player; negative eligibility cases,
  three-second respawn, restored boost/identity and a goal during demolition passed.
- Exact pad quantities/cooldowns, scorer names NOVA/TURBO/Quasar, whole-sphere
  scoring on both sides, supersonic hysteresis and pooled skid expiry passed.
- `tests/polish-browser.cjs`: **98 passing checks**, including real keyboard skid
  sound activation/fade, rear marks, no airborne skid emission, demolition hiding
  and respawn, training-only resets, pointer loss/blur/DOM replacement, repeated
  dragging, synthetic touch, boost preview and replayable one-shot explosions.
- Layout audit: **1920×1080, 2560×1440, 1366×768, 1280×720, 2560×1080,
  900×600 and 390×844**. Home, modes, garage, paint/footer, settings, account,
  pause, post-game and Free Play HUD checks pass. Match HUD bounds at all seven
  sizes also pass in `tests/goal-visual.cjs`.
- `tests/goal-visual.cjs`: outside, half-crossed and almost-crossed shader views
  on both goals pass; screenshots inspected; no shader or browser errors.
- `tests/browser-smoke.cjs`: **35 existing gameplay/UI assertions passed**.
- `tests/accounts-browser.cjs`: persistent profiles/presets/settings, independent
  sessions, conflict handling, logout/Guest isolation, browser restart and offline
  Guest play passed.
- Camera transitions tested at 30/60/144 FPS, both mirrored walls and both camera
  modes. Near-vertical jitter and near-overhead orbit drift reproduce before the
  fix and are zero in their controlled regression fixtures afterward. Live browser
  wall framing keeps the car around 20.5% of viewport height.

Evidence is stored in `camera-stability.json`, `polish-calibration.json`, existing
calibration reports, and screenshots including `paint-390.png`, `paint-1280.png`,
`garage-boost-preview.png`, `garage-goal-preview.png`, `demolition.png`,
`skid-marks.png` and `goal-plane-*.png`. Headless Chrome uses isolated test profiles;
account browser tests use a temporary database rather than the user's saved data.

## Research and remaining limits

Compared the affected mechanics against
[RocketSim's car controller](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Car/Car.cpp),
[its collision/demo handling](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Arena/Arena.cpp),
[published constants](https://github.com/ZealanL/RocketSim/blob/master/src/RLConst.h),
and [RLBot's game values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/).
The source distinguishes supported contact forces, timed dodge torque, supersonic
state and a forward collision from arbitrary car contact. Our wheel solver,
rebound damping and geometry are original approximations. No proprietary assets
or collision meshes are used.

The bot can demolish through valid collisions but does not deliberately hunt
demolitions. Multiplayer/ranked remain unimplemented. Mobile layouts are readable,
but driving still requires keyboard/gamepad. Automated tests and synthetic touch
checks do not replace hardware-controller testing or subjective handling review.
The production bundle still emits Vite's existing large-chunk advisory.
