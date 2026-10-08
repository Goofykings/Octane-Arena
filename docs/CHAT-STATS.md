# Match chat, statistics and scoreboard

Competitive matches use one `MatchStats` authority for every unique player ID.
The same `Match`/`Simulation` path runs locally against bots, in LAN server matches,
and in the existing WebRTC host worker. Clients display snapshots and stat events;
they never independently award shots/saves. Free Play, Rings and Dribble remain
training modes without this competitive scoreboard.

## Chat

**T** opens a compact top-left input, **Enter** sends and **Escape** cancels.
Chat is bindable in Controls. Opening it clears queued gameplay input and sends
neutral controls; typing suppresses keyboard/gamepad/camera input. It does not
pause the physical match. Chat also works during goal celebrations and replays.

The current authenticated WebSocket or reliable WebRTC control channel carries
`chat-send`. The server or host worker binds sender ID to the authenticated
session/peer, resolves roster identity, validates and relays `chat-message` to
all players. Supplied names/teams/player IDs cannot impersonate another sender.
No new signaling system or extra socket exists for chat.

`shared/chat.ts` centralizes 180 Unicode characters, whitespace/control-character
normalization, empty-message rejection and one accepted message per player per
second. Only authority-accepted messages enter history. Twenty messages are kept;
snapshots include eight recent messages for recovery and reliable history is
sent on reconnect. DOM `textContent` renders both names and message text; no
message is interpreted as HTML. Only names use team color.

Chat becomes visible when opened or when a new message/error arrives, fades with
a short CSS opacity transition after 2.5 seconds idle, and stays visible while
typing. Reopening shows recent scrollback. Chat does not appear in single-player
training menus. Menu Tab navigation remains native outside competitive matches.

## Authoritative points and events

`shared/match-stats.ts` contains `MATCH_POINTS` and tunable timing/history limits:

| Event      | Points |
| ---------- | ------ |
| BALL_TOUCH | 2      |
| SHOT       | 10     |
| SAVE       | 50     |
| GOAL       | 100    |
| ASSIST     | 50     |

`PlayerMatchStats` has playerId, score, goals, assists, saves, shots, touches and
nullable measured ping. `MatchStatEvent` has a monotonic per-match ID, type,
playerId, team, scoreAward and game timestamp. This single event stream updates
the authority's counters and the client notification queue. Touches are silent.

Simulation adds read-only contact telemetry using the existing car/ball solver
contacts. A supporting contact pair is tracked until separation; continuous
contact counts once. Before-touch position/velocity/Heatseeker state is captured,
actual solver/custom contact impulse is recorded, and after-touch state is read
once physics caps and backboard handling finish. This adds no forces, chassis
changes or ball-physics tuning. Match stats observe a physical tick once and use
the existing goal ID/attribution once. Replay render proxies never call these
award paths; celebration and replay do not add new touch/shot/save awards.

Goals belong to the existing valid attacking scorer. The defending own-goal
last toucher receives no goal points. Assist candidates are earlier touches by
a different teammate, within **5 seconds of the scorer's scoring touch**.
Opponent touches remain in history without erasing the candidate. History order
also handles equal-time physics contacts; no self-assist is awarded. Kickoff
clears point-level touch history but retains all match counters/events. A new
match creates a fresh stat system. Finished stats remain on the results screen.

## Read-only trajectory evaluation

`src/game/ball-prediction.ts` projects temporary ball position/velocity at 60 Hz.
It uses current gravity, drag, radius, actual static arena shell and volumetric
posts/crossbar. Sphere sweeps find contact before crossing; normal restitution
handles bounces and up to three collisions consume each step's remaining time.
A whole-sphere crossing of the existing scoring plane must fit between the
posts and below the crossbar, accounting for the actual radius. Being merely
"toward goal" is insufficient. Prediction never steps the real world or changes
its ball/Heatseeker state.

Soccar's shot horizon is **3 seconds**. Heatseeker uses **6 seconds**, enough for
its slower initial full-field serves. A temporary copy of the real Heatseeker
controller applies the same bounded steering algorithm and relevant backboard
reversal; no independent straight-line Heatseeker approximation is substituted.

A discrete attacking touch can yield one shot if the after-touch prediction
enters the opposing goal. A save requires a predicted own-goal threat within
**2.5 seconds** before the touch, no predicted own-goal after it, and a meaningful
velocity/contact impulse change (0.75 m/s) or genuine Heatseeker target reversal.
Only one defender gets save credit for the same team/threat in one physics tick.
Post misses, high passes and balls moving away do not qualify as incoming threats.

Heuristics still needing playtesting: coarse bounce response omits future car
interceptions and detailed spin/friction coupling; prediction horizon, minimum
save impulse and assist window are initial calibration. Simultaneous contacts
follow existing solver/scorer ordering. These are original approximations, not
claims of exact proprietary Rocket League stat logic.

## Presentation and sound

**Hold Tab** (controller View/Select) displays an original centered scoreboard;
release hides it. The binding is editable. Two team headers show current goal
scores; columns are Player, Score, Goals, Assists, Saves, Shots and Ping. Players
sort by score descending with stable roster-order ties. Local rows get a subtle
accent. Compact column labels keep portrait/laptop layouts readable. Holding it
does not suppress other driving controls. It works during play, celebration,
replay and results; menus/settings retain their own input behavior.

Local shot/save/assist/goal events queue a small top-center original SVG symbol,
label and points. A 1.3-second animation slides in, remains about one second and
slides out. A short procedural 740 Hz tone uses the existing SFX/master buses.
Remote events and ordinary touches do not play achievement sounds. Match-scoped
event IDs prevent repeat notifications from repeated snapshots or replay.

## Real ping and career totals

LAN server connections use a nonce round-trip probe on the existing WebSocket.
WebRTC periodically refreshes its nonce probe on the reliable control channel;
the host measures its RTT to each guest and passes that value to its match
worker. Updates are about once per second and snapshots synchronize the displayed
values. The P2P host has no self-network hop, and bots have none, so they display
`--`. Unknown/stale/disconnected RTT is null, not an invented zero. A measured
value may round to zero at the timer's resolution.

Local profiles migrate older saves with zero assists/saves/shots. At completed
match observation, authority totals are added once using the existing persistent
match-event dedup key. Prior legacy goal credit is subtracted if present, so a
mixed/older stream cannot double-add goals. Matches/wins/losses keep the existing
policy. New totals are not written each physics frame, and repeated finish events
or reload do not duplicate them. The profile panel displays the added totals.

Optional F3 debugging enables stat award/prediction/assist logs on the local
match or WebRTC authority worker. A server developer can enable
`game.match.stats.debug`. No noisy output is enabled by default.

## Validation

- `tests/match-stats.ts`: real arena/radius/post/high/goal-line prediction,
  Heatseeker curves/state isolation, point values, assists with intervening
  opponents, expiry/self-assist/own-goal protection, actual continuous roof
  contact, point/new-match reset, stable scoreboard order, chat bounds/rate and
  completion-only profile deduplication.
- `server/tests/chat-stats.test.ts`: authenticated WebSocket sender spoof attempt,
  rate limit without disconnect, real ping, shared authority, replay chat and
  unchanged replay counters.
- `tests/chat-stats-browser.cjs`: separate sessions on both WebSocket and WebRTC,
  keyboard focus/neutral typing, HTML text safety, names/colors, fade/typing,
  send-rate error, Tab hold/release, measured ping, actual touch synchronization,
  local row and responsive scoreboard; real LAN replay checks chat and stat totals.
- Standard frontend tests, frontend/server production builds and server tests
  must pass in the existing order.

Browser sessions are on one machine; this does not newly verify two-device
Internet connectivity or provision/change existing public signaling hosting.

Verification completed: the full npm test suite, frontend production build,
server production build and all 19 server tests passed. The profile regression
was updated to verify migration defaults for the three added career counters.
Browser checks passed for chat/stat UI on both transports and for existing
WebRTC replay/reconnect/bot/four-player behavior and LAN goals, pickups and
results. A dedicated own-goal regression ensures that an already-scored ball
remains a threat and cannot grant a false defending save.
