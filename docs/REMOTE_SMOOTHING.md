# Remote car snapshot smoothing

This pass changes remote entity presentation and network snapshot timing. The existing 120 Hz physics, host/ball authority, collision rules, modes, replay playback, and local prediction/reconciliation implementation are retained.

## Inspection

- Authority: `src/network/authority-worker.ts` advances the existing 120 Hz fixed loop and publishes one state for each four-tick bucket: **30 Hz**, plus bootstrap. It does not send 120 states/sec.
- Wire: `SnapshotPublisher` sends essential motion at that cadence; larger roster/UI/event metadata is normally **5 Hz**, with immediate event updates. Both packet variants already have authoritative `tick`, simulation `time`, and reset epoch. No new protocol fields are needed.
- Reception: packets are delivered by the data-channel callback, not a 10 Hz polling loop. The existing ~33 ms control pump handles input/readiness, not snapshot rendering. Actual reception varies with load, latency and loss.
- Rendering already had interpolation, but remote transforms could then be blended toward speculative collider proxies. Teleport bypass also followed each newest packet until delayed playback caught up, allowing a subsequent backward correction.
- Spectator rigs already accept rendered car models. That path is retained and exercised in the browser test.

## Changes

Remote cars and bots now have a separate, bounded **32-snapshot** timeline containing actual state packets. Collision checkpoints used by the ball stay on their existing timeline and cannot replace remote visual fields. Every rendered frame samples this timeline, interpolates position and velocity, and slerps rotation. Remote visuals are no longer overwritten by prediction proxies.

Playback targets **100 ms behind estimated authoritative time**. When available, half the existing measured peer RTT compensates the packet transit bias in the clock estimate (capped at 100 ms). Without RTT, the conservative arrival-time clock is used. The existing bounded clock adjustment prevents packet jitter from rewinding playback.

Remote extrapolation uses linear/angular velocity and stops after **100 ms**; then it holds until another usable packet arrives. The existing ball/local prediction extrapolation tuning is unchanged.

Kickoff/goal reset epochs clear the timeline. Demolition/respawn visibility changes and explicit per-car `teleportSequence` changes (including Swapper and deliberate teleport markers) snap immediately. A per-car lifetime anchor holds the first new pose until delayed playback reaches it, preventing interpolation through the discontinuity or rollback into old history. Other cars keep their own interpolation history.

Packets are ordered by authoritative tick. Duplicates are ignored, useful late packets can fill history, and packets older than usable history or a previous reset are dropped. Out-of-order and duplicate counts are recorded. Normal history pruning no longer counts as packet loss. Reliable metadata arriving behind a newer motion packet can still contribute its transform to remote history without rewinding the latest gameplay state.

The existing optional overlay is enabled by adding `?netdebug` (or `&netdebug`) to the URL. It shows send/receive Hz, RTT, render FPS, 120 Hz physics target, 100 ms interpolation, buffer count, dropped/out-of-order/duplicate packets, and the 100 ms remote extrapolation limit. It remains absent by default. Send metrics now count a successfully transmitted fast motion frame even if its accompanying reliable metadata packet cannot be queued.

## Files in this pass

- `shared/network-tuning.ts`
- `src/network/snapshot-buffer.ts`
- `src/network/remote-car-smoother.ts`
- `src/game/network.ts`
- `src/render/network-match.ts`
- `tests/network-smoothing.ts`
- `tests/remote-smoothing-browser.cjs`
- `docs/REMOTE_SMOOTHING.md`

## Validation

`tests/network-smoothing.ts` runs six remote cars at 30/60/144 render FPS with 30/60/100 ms one-way latency, jitter, loss, duplicates and reordering. It checks position/quaternion continuity, movement on over 97% of render frames, a 100 ms extrapolation stop, teleport/respawn/reset fences without rollback, and independent collision checkpoints. It also retains existing packet validation and 30 Hz publication tests.

`tests/remote-smoothing-browser.cjs` uses real Chrome and an isolated local PeerJS signaling server: host, guest, spectator and two authority-controlled bots. It verifies movement between network arrivals, jitter/loss handling, absence of remote prediction-proxy calls, spectator following the rendered model, an opt-in debug overlay and bounded buffers. The final three-browser software-rendered run received 25.6 unique states/sec and rendered 25.6 FPS under load; it recorded 29 remote movements between packet arrivals, measured RTT of 32 ms, and 120.2 observed simulation ticks/sec. These software-rendering numbers are not a claim of 60 FPS on that test machine. Deterministic 60/144 FPS tests verify that remote motion progresses at those render cadences when rendering can sustain them.

Run the browser check with `PLAYWRIGHT_MODULE` pointing to the local Playwright installation; its local signaling helper uses the existing `.tools/peer-test/node_modules/peer` package. Unit coverage is included in `npm test`. Completion statuses for the production build and full regression command are recorded in the task report.

Completion: **PASS** `npm test`, **PASS** `npm run build`, **PASS** focused smoothing tests, **PASS** final three-client PeerJS browser test (all exit 0). The production build retains its existing large-bundle warning. Generated benchmark JSON was restored after tests. Prior topper work remains intact.
