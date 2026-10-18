# Multiplayer smoothing and prediction

The existing secure PeerJS Cloud party/signaling path remains unchanged. Players still use the normal GitHub Pages URL and party codes. The host worker (or existing LAN server) owns ball physics, bots, car collisions, scoring, stats, Dropshot damage and Rumble outcomes. Physics constants and contact forces were not retuned.

## Measured baseline and new cadence

The former sender intended 30 Hz, but required four _additional_ ticks after each actual send. Timer overshoot accumulated. Timed three-second native profiles measured 26.92 / 24.60 / 26.54 Hz for two / four / six cars, with 37.0 / 40.3 / 36.5 ms mean packet intervals and 8.3 / 27.0 / 7.5 ms interval jitter. Idle JSON snapshots averaged 3,451 / 5,961 / 8,393 bytes, including repeated roster, cosmetics and UI state. Physics progression was about 113-120 ticks/sec in those runs; the fixed timestep was and remains 1/120 second.

The new tick-bucket scheduler sends the latest state once per four-tick bucket without accumulating overshoot. The same profile measured 29.94 / 30.00 / 30.07 snapshots/sec with mean intervals near 33.3 ms and physics progression near 119-120 Hz. The new per-recipient average wire payload, including periodic full metadata, was 1,640 / 2,472 / 3,215 bytes (roughly 49 / 74 / 97 KB/sec per recipient, before transport overhead). These are idle baseline measurements, not a worst-case bandwidth guarantee. Collisions, changing stats and mode events can cause additional full metadata packets.

Motion packets use bounded JSON numeric arrays, not a new binary protocol. Existing MatchSnapshot and CarSnapshot types remain the decoded interface used by UI, effects, cameras and replays. Full roster/settings/stats/chat/mode metadata sends about 5 Hz and immediately on phase/score/ownership/teleport/damage/powerup events. Periodic full Dropshot reconciliation is never discarded. Only the receiving driver's car includes its prediction checkpoint; spectators receive none. Match publishers and delayed QA packets clean up on exit.

## Remote rendering

Previously an eight-snapshot buffer sampled latest authoritative time plus time since the newest arrival minus 50 ms. Each packet re-anchored the render target, so packet jitter became presentation jitter; late snapshots held motion until another arrival. There was no extrapolation or local prediction.

The new shared world buffer holds at most 32 ordered snapshots. Rendering runs 100 ms behind a stable, gently corrected authoritative clock. Duplicate, old and reordered packets are handled without rewinding the displayed clock. Scene-loading pauses re-anchor the clock rather than leaving an obsolete time offset. Position and velocity interpolate between authoritative samples; rotation uses quaternion slerp. Surface normals and wheel motion interpolate too. Ball interpolation stays piecewise linear to preserve real rebounds without Hermite overshoot. No client decides ball contacts, goals or tile damage.

If the next sample is late, position and quaternion extrapolate using the last linear/angular velocities for at most 120 ms, then hold. Global reset counters, teleport sequences, demolition visibility and respawn transitions prevent interpolation across intentional jumps. The local and spectator cameras read rendered model/body poses, not packet-arrival transforms.

## Local car prediction

A separate world contains only the local car and the existing static arena shell. Its ball is disabled; it does not execute full Simulation.step, bot AI, gameplay contacts, scores, demos, Rumble logic or floor damage. The predictor calls the same Car.tick/contact constraints and speed limits at 120 Hz, with the same body and mutators. No parallel client ball authority exists.

Each render input has a monotonic sequence. The authority acknowledges the last input actually applied, not merely received. Compact validated checkpoints preserve jump/dodge/reset ownership, surface/recovery history and landing state. On each authoritative update the predictor restores that car state, drops acknowledged inputs and replays pending fixed steps. It preserves a decaying position/quaternion render offset so ordinary corrections are gradual (about 83 ms response, about 42 ms for errors over one metre). Errors over six metres and explicit resets/teleports snap. Pending storage is limited to 120 steps. Actual prediction lead is capped at 250 ms even if fresh snapshots arrive but input acknowledgements stall; prediction also stops after 250 ms without valid state. Continuous boost/jump/roll respond before a host reply.

Deterministic 30/60/100 ms one-way-latency runs converged to under 8 cm after input settled, with no repeated hard corrections. Fast collisions and host-only powerups can still produce necessary corrections, especially at high RTT; smoothing cannot remove actual network delay.

## Diagnostics and artificial conditions

Append `?netdebug` (or `&netdebug`) to show the optional network overlay. It is absent by default. The console API `octaneArenaNetwork.diagnostics()` reports RTT, target/measured physics and snapshot cadence, mean interval, jitter, serialized payload bytes, render FPS, buffer length, dropped/duplicate/reordered packets and local correction distance/count. Host send cadence counts one tick once rather than multiplying by connected clients. Byte counts describe serialized JSON, excluding PeerJS/SCTP overhead.

On a development/test launch with `?test`, QA can explicitly configure incoming conditions:

`__arena.network.testNetwork.configure({ latencyMs: 60, jitterMs: 18, loss: 0.06 })`

Reset using `configure({})`. Defaults are zero; no artificial delay or loss is active in ordinary play. Loss applies only to replaceable motion frames. Reliable metadata/replay/control is delayed but never intentionally lost. The queue is bounded and cleared on match exit.

## Verification

Verified 2026-10-18: the complete `npm test` sequence passed; the final focused networking suite passed after the prediction-lead guard. `npm run build`, `npm run build --prefix server` and all 28 tests from `npm test --prefix server` passed. Real PeerJS browser checks passed across all five modes, spectator views, 2v2 bots and four-human 2v2 with artificial delay/jitter/loss. The final four-browser check also passed on the capped-prediction production build. These sessions rendered roughly 49-60 FPS on the software-rendered test machine and received roughly 27-29 motion updates/sec under injected loss, with demonstrated ball/car motion between packet arrivals. No physical two-device/NAT test is claimed.

- `tests/network-smoothing.ts`: 30/60/144 render FPS with 30/60/100 ms latency, jitter, loss, duplicates/reordering, monotonic render motion, bounded extrapolation, teleports, compact round-trips and malformed payload rejection.
- `tests/local-prediction.ts`: immediate throttle/boost/jump/aerial input in all five modes, prediction authority isolation, input-ack replay, convergence, speed/history caps, stale-state hold and hard teleports.
- `tests/network-mode-motion.ts`: actual six-car 3v3 with four host-only bots in every standard mode, high-speed Heatseeker and aerial motion, per-ID frame decoding and demolition visibility.
- `tests/network-smoothing-browser.cjs`: real PeerJS Cloud host/guest/spectator sessions, 1v1 and 2v2 bots, all five standard modes, 60 ms incoming delay, jitter and 6% motion loss. Explicitly checks ball/car movement between arrivals, predicted local car only, spectator camera, bounded buffers, no default overlay and cleanup.
- `tests/network-four-browser.cjs`: four independent browser players in a shared 2v2, 100 ms artificial delay, jitter/loss, per-ID local prediction, shared match state and leave cleanup.
- Server socket regression decodes both packet types, compares shared authoritative state, and verifies per-recipient prediction data.

Browser tests use isolated sessions on one machine, not physical devices on separate networks. Software-rendered FPS is a test-machine measurement, not a general hardware FPS guarantee. No new TURN/server configuration is required by these rendering/prediction changes.

Tuning lives in `shared/network-tuning.ts`. Run `npm run test:network-smoothing`, the normal `npm test` and production/server build/test commands. Generated profiles and browser logs live under ignored `.tools/`.
