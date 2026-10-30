# Remote collision proxies

This pass keeps host gameplay authority and the existing 120 Hz simulation and
30 Hz state transmission. It adds no local-player rollback or reconciliation
system; the existing local prediction world remains speculative.

## Previous behavior

The network presentation world contained dynamic car/ball bodies, but did not
step Rapier. Each render frame assigned their interpolated transforms directly.
The separate speculative world already used kinematic remote cars, but seeded
them directly from each packet and extrapolated the newest raw state at fixed
steps. Those colliders could lead the delayed remote visuals. Speculative ball
rendering could also obscure a confirmed host collision.

## Proxy movement and authority

`RemoteCollisionProxies` uses position-based kinematic bodies and sets their next
translation/rotation before each 120 Hz Rapier step. Both client worlds use the
same delayed snapshot timeline as the remote models, including bots. Read-only
`SnapshotBuffer.sampleAt()` allows fixed steps to sample that timeline without
advancing or pruning its render clock. Ordinary motion sweeps between targets;
reset epochs, respawn/enabled transitions and teleport sequences snap explicitly.

The presentation/query world contains kinematic cars and ball plus the existing
static arena. Stepping it refreshes collision/query geometry without running
gameplay simulation or producing an independent ball trajectory. The existing
speculative world may produce temporary local collision responses, but never
owns goals, demolitions, Rumble outcomes or host collision results. Its remote
cars now follow the same timeline instead of the latest packet's transform.

## Ball corrections

The ball and remote cars share the 100 ms presentation delay. Existing host
120 Hz collision checkpoints inside the 30 Hz packets preserve collision corners.
Confirmed contacts fence speculative ball rendering for 180 ms after the event;
velocity changes take effect at the event rather than gradually blending through
the impact. A checkpoint arriving late takes effect on the next presentation
update. Reset/enabled epochs immediately discard the old trajectory. A velocity
change over 4 m/s provides a fallback fence when a contact checkpoint is missing.
Active Rumble trajectories and attachments also retain host presentation.

Small ordinary ball differences still interpolate and may blend with the existing
speculative pose. Errors over 1.5 m or 4 m/s reject that pose immediately; its
influence fades near those thresholds. No impulse or corrected presentation state
is written back to the host.

## Validation and limits

`npm test` includes `tests/remote-collision-proxies.ts`: real Rapier host impacts
for straight, side, boosted, kickoff and simultaneous two-car contacts, delivered
at 30 Hz with latency. It checks continuous 120 Hz proxy movement, visual/proxy
alignment, collision proximity, authority isolation, wrong-trajectory rejection,
small-error blending, reset/teleport bypass and speculative-proxy respawn.
`tests/remote-smoothing-browser.cjs` exercises PeerJS host, guest, spectator and
bots with jitter/loss, including both client worlds' proxy alignment.
Set `OCTANE_TWO_CLIENTS=1` for its host/guest-only run. Auxiliary clients skip
WebGL drawing to reduce software-rendering load; all update loops remain active
and the measured guest draws every animation frame.

Validation completed: `npm test`, `npm run build`, the focused collision/proxy
test and existing local-prediction tests passed. The two-client PeerJS run with
55 ms artificial latency, 22 ms jitter and 4% artificial loss passed: 24.29 unique
snapshots/sec received, 359 proxy steps over approximately three seconds,
26 frames with remote movement between packets, and maximum measured remote
model/proxy differences of 0.132 m (presentation) and 0.134 m (active speculative
world). Five confirmed host contact checkpoints were observed. Software WebGL
rendered at approximately 22 FPS; this run does not certify 60 FPS hardware
rendering. Earlier three-client runs were limited by host/browser CPU load.

The normal 100 ms interpolation delay and 100 ms extrapolation cap remain.
Visuals can lead fixed-step collider targets by a fraction of a physics tick
(8.33 ms). The existing fixed-loop catch-up limit applies during stalls.
The existing speculative world pauses on stale/unacknowledged local input;
its colliders are unused until prediction resumes. Presentation/query proxies
continue stepping for every remote car during that pause and for spectators.
Packet loss beyond the extrapolation window can still freeze remote presentation; a
late host result can still require a visible correction. Kinematic query proxies
do not invent contact outcomes to conceal latency, and no full local rollback
or client-authoritative collision handling was added.

## Files in this pass

- `src/network/remote-collision-proxies.ts`: shared kinematic proxy driver.
- `src/network/authoritative-ball-correction.ts`: contact fences and ball sampling.
- `src/network/local-prediction.ts`: remote visual-timeline targets and respawn handling.
- `src/network/snapshot-buffer.ts`: read-only fixed-time sampling.
- `src/render/network-match.ts`: fixed-step presentation proxies and ball correction.
- `tests/remote-collision-proxies.ts`: real impact, authority and lifecycle tests.
- `tests/remote-smoothing-browser.cjs`: proxy checks and optional two-client fixture.
- `package.json`: includes collision/proxy coverage in `npm test`.
- `docs/REMOTE_COLLISION_PROXIES.md`: implementation, validation and limits.
