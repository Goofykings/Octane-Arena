# Training / leaderboard continuation

The initial audit found a clean checkout of `5d9dd3b`. Countdown, launch preview,
scenario retuning, replay integration and the rounded/translucent board were
already implemented. Runtime browser verification and updated tests were not
complete. Preserve those implementations rather than recreating them.

## Frozen local scoreboard root cause

Startup assigned the car's ID from the local profile UUID, but left the matching
`Simulation.players[0].id` as `player`. `MatchStats` initialized its keyed map
from that roster. Physical contacts and goals then carried the car's UUID, which
the authority correctly rejected as absent from the roster. This stopped human
awards before they reached the UI; it was not a stale React state or missing
scoreboard listener. Startup now assigns the same stable UUID to the canonical
roster entry and car, including `localPlayerId` metadata. Display names remain
independent, including duplicate names.

The flow is unchanged: real physics produces discrete `statTouches`; `Match.tick`
observes them while playing; `MatchStats` resolves roster IDs and awards points;
actual goals generate one goal/assist award. Local rendering uses a fresh stats
snapshot. LAN server and WebRTC host worker publish the same authority's copied
stats in match snapshots. `NetworkClient.latest` updates even while the board is
hidden. The board renders those live totals by ID when held, and its value-based
signature rerenders changed totals while open. It never derives totals from
party metadata or replays stat events on the client.

`shared/match-stats.ts` now exposes the authority's common per-kind award reducer
for deterministic testing. It retains +2 touch, +10 shot, +50 save, +50 assist,
+100 goal. Physical contact classification/deduplication, tick observation
deduplication and unique goal IDs remain on the authority. Kickoff clears rally
history without clearing totals; replay observes no contacts; a new match creates
new totals. No multiplayer message changes were required.

## Training flow retained and verified

- Each scenario uses the shared kickoff clock boundary and normal `#countdown`
  styling. No physics steps, timers or controls run during its three seconds.
  GO assigns the configured velocity and removes the arrow. Early frozen Aerial
  balls remain stationary until real contact.
- `TrainingPreview` normalizes the configured velocity; arrow length is
  `clamp(1.4 + 0.2 * speed, 1.4, 6.5)` metres. Its origin sits just beyond the ball
  radius along that vector. Zero-velocity frozen shots omit the arrow.
- Striker starts are farther and angled, with faster lateral feeds. Goalie serves
  range from 12 to over 24 m/s, including lofts, diagonals and corners with offset
  defending spawns. Aerial static heights are 3.8-5.2 m; later launches rise at
  7.5-10 m/s with lateral movement and longer approaches. All remain data-driven.
- A material defending contact identifies a save candidate. The existing arena
  predictor rechecks a five-second goal-threat horizon at 30 Hz. Safety must hold
  for 0.18 seconds, then for another approximately one second. Returning threats
  cancel the timer. This continuation adds one final live prediction before
  completing, preventing completion based on the previous cached safe result.
  The real rebound stays enabled and moving throughout. Completion emits one
  small explosion, disables the ball, and later starts the next countdown.
- Training uses the existing `ReplayRecorder`, `ReplayClock`,
  `ReplayScenePlayback`, director and `ReplayPanel`. The last recorded seconds,
  scorer, goal speed and normal slow-motion behavior are retained. Solo Space or
  Skip immediately ends replay. Navigation cannot start a countdown under a
  replay. Playback changes rendered models, never simulation bodies or stats.

The existing board container retains 12 px rounding, a 76%-opaque dark background,
subtle border and 4 px supported backdrop blur. Columns, values and hold-to-view
controls are unchanged.

## Tests

- `tests/live-stats.ts`: exact 0/2/12/62/112/212 award sequence; real physical
  touch, shot, save, goal and two-player pass/assist; UUID and duplicate-name
  mapping; one award per event; unchanged replay/kickoff totals; new-match reset.
- `tests/training.ts`: all 30 countdown locks and real initial velocities; ten
  ground-input Striker scores; all ten idle Goalie serves really score and can
  be saved by contact fixtures; four frozen contacts and six gravity launches;
  navigation, resets, results and optional records.
- `tests/training-flow.ts`: rebound motion, debounce/delay, returning threats,
  final live check, one burst, recorded goal replays, pause, solo skip, natural
  completion, unchanged physical snapshots and no duplicate results.
- `tests/training-browser.cjs`: production controls, all categories and rendered
  previews, replay camera/panel/skip, next countdown, visible save explosion,
  camera controls and competitive stat isolation.
- `tests/live-stats-browser.cjs`: real local score updates while open/closed;
  rounded/translucent board; authoritative server contact/assist/goal/save values
  synchronized into both browser boards, including duplicate display names.
- Existing chat/stats browser tests exercise both WebSocket and WebRTC, actual
  live touch synchronization, hidden-board accumulation and replay preservation.

Physics fixtures/controllers verify mechanics, not full human pack clears. Later
corner Goalie and moving Aerial scenarios still benefit from human timing/difficulty
feedback. Browser sessions run on one machine; no new public hosting or two-device
Internet guarantee is implied.
