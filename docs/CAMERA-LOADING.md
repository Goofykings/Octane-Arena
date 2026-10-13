# Camera controls and match preparation (0.1.8)

Horizontal mouse drag is mirrored only in gameplay. Home/Garage keep their existing direction and momentum/friction, and vertical drag, boom length, sensitivity, smoothing and mouse release are unchanged. Pointer-down still never writes the camera pose.

Right-stick position maps directly to target yaw +/-144 degrees and pitch +/-0.9 radians (about 52 degrees), rather than accumulating angular velocity. MOUSE_LOOK in src/camera/mouse-look.ts contains these tunables. Exponential response rate is 24/s (95% response in about 125 ms); stick-center uses that same responsive eased return. Mouse dragging keeps priority. The existing configurable radial deadzone is preserved, default 0.12, with the remainder remapped to 0..1. Keyboard/controller binding persistence is unchanged.

The previous mode transition ran separate mode-blend, boom, aim and FOV dampers; a framing safety reserve could instantly widen FOV, and automatic cached angles did not describe the rendered manual-orbit pose. GameCamera now computes its targets on a private camera and commits one final pose. Mode changes capture the actual visible pose, including free-look. While switching, the old mode-specific dampers are bypassed and one spherical boom/relative-aim/FOV transition follows the current target at exponential rate 6 * the configured transition value, with angular/radial travel capped at 3 radians/s and 6 metres/s per unit of that setting. Position follows an arc around the car rather than cutting through it. Final hard-blocker handling follows the transition, preserving the working arena-boundary policy. Regular tracking and framing remain unchanged when not switching. The old torture test's immediate two-subject framing requirement during a deliberate mode switch contradicted smooth transitions; strict framing remains after settling, with new explicit tests for both transition speeds, continuous first steps, manual/wall switches and rapid reversals. Physics was not changed.

## Startup measurements

These are rough measurements in headless Chrome, SwiftShader software rendering, 1280x720, low quality, advanced bots. They are not hardware FPS promises. Before/after runs used the same test harness. Frame maximum is from the first five wall-clock seconds of controllable play; shader preparation is moved before those seconds.

| Mode | Before worst frame (ms) | After worst frame (ms) | Shader program count increase during play | Shader prep before play (ms) |
| --- | ---: | ---: | --- | ---: |
| freeplay | 1503 | 150 | 13 -> 0 | 291 |
| 1v1 | 1270 | 33 | 29 -> 0 | 329 |
| 2v2 | 2088 | 34 | 53 -> 0 | 597 |
| 3v3 | 1921 | 50 | 39 -> 0 | 1153 |

Raw reports: match-startup-before.json and match-startup-after.json. Bot input worst measured CPU time in 3v3 fell from 18.3 ms to 6.9 ms. Some occasional software-renderer frame delays remain (notably the 150 ms Free Play sample); real hardware and high/ultra settings still need user testing.

The dominant measured hitches were render/shader first use. Vehicle boost lights lived inside flame groups whose visibility changed with boost, changing Three.js's lighting shader variants. Goal lights similarly changed visibility. Those lights now keep a stable scene layout, with intensity zero when inactive; their positions/effects are retained. New car/physics/model/pool creation, replay allocation, bot controllers/roles/prediction buffers and first shader/texture use also occurred at or after entry.

One shared MatchLoading queue now handles local and PeerJS scene preparation, yielding loading frames between physics, each car/effect slot, arena, match/replay/UI resources, bot preparation, audio and shaders. Car slots/effect pools and unchanged bot models are reused. Replay buffers and scoreboard rows are allocated before kickoff. Shader compilation uses compileAsync plus a hidden warm render for pooled geometry/textures; a final loading frame precedes READY. The camera is prepared before the first visible kickoff. Audio is synthesized tones/noise already unlocked through Play, so there are no audio files to decode and optional music does not hold kickoff. Timings are stored silently for tests; no per-frame logging remains.

Bots allocate controllers, targets and reusable decimated trajectory vectors before play. Shared perception keeps its original difficulty frequencies (3/6/10 Hz); per-bot planning phases are staggered evenly through that period without reducing the decision rate. No physics step is used to prewarm the bots. Existing tire, jump, flip, boost, map/collision and difficulty tuning is preserved.

PeerJS retains its existing channel readiness handshake, then sends a scene-ready message after resources are prepared. The host worker publishes the initial snapshot but does not start its timer until its own scene and all required guests are ready. Snapshot state stays available during loading; the first visible client frame uses the current authoritative state. The direct server constructor prewarms its own physics/bot/replay resources before starting; its existing server test protocol remains intact. Version 0.1.8 prevents old clients from silently waiting on a handshake they do not understand. No new signaling service or hosting configuration was introduced.

## Verification

- npm test, npm run build, npm run build --prefix server, npm test --prefix server.
- tests/camera-controls-loading.ts: proportional stick/no accumulation, response at 30/60/144 Hz, both mode speeds, manual/wall transitions and return, constant light budget, no physics changes during prewarm, buffer reuse and fair staggered 10 Hz decisions.
- tests/camera-shot-notice-browser.cjs: retains the previous exact click-only edge/corner camera fix and queued one-second notifications, with the new horizontal direction.
- tests/match-loading-peer-browser.cjs: real PeerJS Cloud and WebRTC with two isolated Chrome sessions; deliberately pause guest preparation and verify host tick/countdown are frozen until all scenes are ready, then verify shared Rumble play and clean leave. Not a physical two-device/NAT test.
- tests/camera-controls-browser.cjs: actual production loading/READY screen and mocked Gamepad API drift, half/full targets, vertical control, mode toggle while looking and smooth release.
- tests/match-startup-browser.cjs: first-five-second profiling for Free Play/1v1/2v2/3v3. Build before browser tests; set PLAYWRIGHT_MODULE if Playwright is installed outside the project. Reports and logs come only from test harnesses.

Remaining tuning: thumbstick maximum yaw/pitch/response and transition setting are subjective; test on a physical controller. Startup numbers should also be checked on the target computer/GPU and high/ultra graphics. No public deployment or physical two-device test was performed for this update.
