# Camera, contact and effects update

## Resume audit

Before further edits, inspected the saved implementation and run logs against the
ten requirements in the supplied brief.

- Completed implementation with prior passing checks: wheel suspension/contact,
  Ball Cam framing, recovery contact fallback, goal mouth geometry, ball speed and
  scale verification, and pad recharge (items 1, 3–6, 8–9).
- Partially completed: flip/ball trail visual verification (2, 7), final regression
  checks and completion report (10).
- Implemented but visually broken: the first trail ribbons could be edge-on to
  the camera. A saved camera-facing correction had not yet been built. Subsequent
  screenshot inspection also showed the flip anchors could hide inside the car's
  silhouette; they now start just outside the body/wheels.
- Not started: the final consolidated report. No requested feature was absent.

Working gameplay systems were preserved. This continuation completed verification,
the small flip-trail visibility correction, and this report.

## Checklist and root causes

- [x] **1. Wheels on curves.** Fixed wheels used a constant local height while
  physics sampled suspension rays at a different lateral position. Both now use
  `wheelMount()`; rendering resolves suspension at the interpolated physical pose
  against the same static collision mesh. The tire cylinder's support radius
  includes tread width/camber, with 8 mm clearance. No car hitbox enlargement.
  Both bodies passed rim-sample clearance checks entering the ramp at initial
  speeds 3 and 23 m/s. Minimum measured clearance was 5.8–7.7 mm.
- [x] **2. Flip streaks.** Four short white ribbons follow points transformed by
  the actual rendered rigid-body pose. Emission requires `jump.flipLeft > 0`;
  ordinary aerial rotation emits nothing. History fades within 0.10 seconds.
  Ribbons face the camera and originate outside the wheel/body outline.
- [x] **3. Ball Cam.** Retained the stable orbit, wall collision avoidance,
  near-overhead bearing dead zone, and world-up horizon. Removed fixed world-space
  ball weighting and the wall blend that suppressed ball tracking. The look
  direction now bisects the angular directions to car and ball from the camera.
  A small camera-angle bias remains. Smoothed FOV expands only as necessary to
  fit both subjects and their radii, up to 120 degrees. Distance, height, car
  heading, surface avoidance, stiffness and swivel settings still participate.
  Tests cover ahead, behind, nearly overhead at ceiling height, vertical walls,
  high balls on walls, ceilings and moving wall-to-ceiling transitions at
  30/60/144 FPS. Existing camera jitter regressions also pass.
- [x] **4. Sideways recovery.** The simple side test already passed. Added actual
  near-touching static contact-manifold support to cover tilted corner support
  that a center-only side ray can miss. Existing throttle, speed, angular speed,
  orientation and dwell gates remain. Both bodies and both sides pass the
  manifold fallback test; airborne, brief-contact and normal cornering exclusions
  are checked alongside supported wall-driving regressions.
- [x] **5. Goal opening.** Previous convex entry rounding placed the shell edge
  away from the rectangular frame/scoring plane. The front mouth is now exactly
  rectangular at `z = ±51.2`, `x = ±8.93`, top `y = 6.43` metres. The shared
  render/collision mesh lofts into curved interior corners behind that mouth.
  Physical front fascia closes the adjacent arena cutout; this is not a visual
  patch over unchanged collision geometry. Both sides pass corner alignment,
  nondegenerate-mesh and existing goal traversal checks; screenshot inspected.
- [x] **6. Ball speed.** Inspected the prior custom cap of 42 m/s and verified the
  reference is 6000 uu/s. Set the cap to **60 m/s**; a real simulation step clamps
  an over-speed ball to that value. No extra impact acceleration was added.
- [x] **7. Ball trail.** Four rotating ball-local anchors leave short camera-facing
  streaks. Color follows last-touch player/team: blue, orange, or neutral. Reset
  clears touch/trail history; Free Play stays neutral. Strength rises from zero
  above 3 m/s to full configured strength at 24 m/s. A 0.22-second history gives
  speed-dependent length. Both team colors, neutral, spin, and slow-ball suppression
  are tested. Each effect uses one fixed geometry buffer, not permanent meshes.
- [x] **8. Ball scale.** Physics radius is **0.9125 m**; maximum rendered radius
  measured **0.912500031 m**, a Float32 difference. No scale change was needed.
  Car hitboxes and art share dimensions (table below). Camera framing, not an
  artificially enlarged ball, addresses the visibility problem.
- [x] **9. Pad recharge.** Yellow/orange annular shader sectors read
  `1 - cooldown / respawnDuration`, using the gameplay timer directly. Small pads
  take exactly 4 seconds and large pads 10 seconds. At respawn the meter hides and
  the existing crystal/glow returns. Empty, half and complete timing checked.
- [x] **10. Verification.** Physics/contact/camera regressions, browser checks and
  production build completed. Evidence and qualifications are listed below.

## Exact values and dimensions

| Quantity | Final value / change |
| --- | --- |
| Ball max speed | **42 → 60 m/s** (6000 uu/s) |
| Ball physical/render radius | **0.9125 m**, unchanged |
| Ball mass / restitution / drag | **42 kg / 0.48 / 0.08**, preserved custom calmer tuning |
| Ion hitbox, length × width × height | **1.18 × 0.84 × 0.36 m**, unchanged |
| Vector hitbox, length × width × height | **1.32 × 0.86 × 0.50 m**, unchanged |
| Wheel radius / tread half-width | **0.18 / 0.0575 m**, unchanged |
| Wheel mount lateral offset | `halfWidth - 0.06` → `halfWidth + 0.005` to match art |
| Suspension rest / ray length | **0.34 / 0.65 m**, unchanged |
| Visual tire clearance | **0.008 m** along the sampled support normal |
| Recovery manifold tolerance | Contact separation below **0.025 m** |
| Recovery dwell / speed gates | **0.35 s / <2 m/s / <1.5 rad/s**, unchanged |
| Camera dynamic FOV ceiling | **120°**, smoothed at rate 8/s |
| Flip / ball trail lifetime | **0.10 / 0.22 s** |
| Small / large boost | **12 / 100**, cooldown **4 / 10 s**, unchanged |
| Flip cap / drift scale | Earlier user tuning **7 rad/s / 0.65**, preserved |

Car dimensions are collider/body-envelope dimensions; wheels, bumpers and cosmetic
details can extend outside that box. The visual ball is not uniformly rescaled.
Arena bounds remain 81.92 × 102.4 × 20.44 m, excluding goal depth.

## Verification evidence

- `npm test`: all eight suites, including `tests/framing.ts` and
  `tests/surface-effects.ts`. Existing wall adhesion, flip cancel, jump, controls,
  demolition and scoring checks remain in the run.
- `npm run build`: TypeScript and Vite production build.
- `tests/contact-browser.cjs`: live overhead/wall/ceiling framing, continuous
  team-colored ball trails, flip trail appearance/expiry, pad shader state and
  no runtime/shader errors.
- Existing `polish-browser.cjs`, `browser-smoke.cjs`, and `goal-visual.cjs` cover
  gameplay, garage, layout, goal shaders, neutral Free Play explosions and return
  to bot-match team colors.
- Screenshots: `framing-overhead.png`, `framing-wall.png`, `framing-ceiling.png`,
  `goal-mouth-alignment.png`, `ball-streaks-*.png`, `flip-streaks.png`,
  `pad-recharge.png`. Logs: `.tools/contact-*.log`.

## Reference comparison and limits

[RocketSim constants](https://github.com/ZealanL/RocketSim/blob/master/src/RLConst.h)
confirm the 6000 uu/s ball cap. Its
[car implementation](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Car/Car.cpp)
uses wheel contact and body contact when applying driving/recovery behavior.
[RLBot game values](https://wiki.rlbot.org/v4/botmaking/useful-game-values/) inform
the scale checks. [Epic's camera settings documentation](https://www.epicgames.com/help/c-37599050/c-32343914/a14443106?lang=en-US)
describes the exposed camera controls, not the full internal Ball Cam algorithm.
The angular framing solver here is an original practical approximation, not a
claim to reproduce Rocket League's private camera implementation exactly.

Wide FOV is temporary for difficult high-ball views and can distort screen edges.
Geometry occlusion can still hide a ball behind a solid wall; the camera does not
render through walls. Tests cover defined trajectories and fixtures, not every
possible collision or user camera setting. Vite's existing large-chunk advisory
remains. No requested feature is deferred.
