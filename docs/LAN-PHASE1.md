# LAN Phase 1: lobby foundation

## Current continuation — October 1, 2026

The Phase 1 foundation was already implemented. This continuation preserves it
and checks the final saved build. The preceding, separately requested playable
network-match work was also present and has been retained. No additional network
features or public hosting were added in this continuation.

**Everything below the September 30 heading is a historical Phase 1 record.**
Its statements that network matches are not implemented describe that earlier
version, not the current game. See [Network matches](NETWORK-MATCHES.md) for the
current implementation, launch instructions, and limits.

Inspection checklist:

| Requirement | Status at inspection |
| --- | --- |
| 1. Preserve local game, Free Play, bot, physics, garage, settings, accounts | PARTIALLY COMPLETE: final saved-build regression checks pending |
| 2. Generic PlayerInput | COMPLETE |
| 3. Independent unique-ID entities | COMPLETE |
| 4. LAN server foundation | COMPLETE |
| 5. Short-code Create / Join Party | COMPLETE |
| 6. 1v1 / 2v2 lobby | COMPLETE |
| 7. Shared membership, teams, ready, mode, host | COMPLETE; final browser confirmation pending |
| 8. Shared TypeScript contracts | COMPLETE |
| 9. Four cars, ID-based ownership/scoring | COMPLETE |
| 10. Connect/disconnect/leave cleanup | COMPLETE; final browser confirmation pending |
| 11. npm run lan | COMPLETE; fresh launcher verification pending |
| 12. Future-authority architecture; no new synchronized physics | Preserved prior authorized match implementation; no expansion in this continuation |

BROKEN / NEEDS CORRECTION at inspection: the server build omitted the `app.js`
entry imported by account integration tests, allowing a stale artifact or a clean
build failure; network visual cars did not update their right vector, collapsing
skid-mark width; documentation linked a missing network guide and described the
older lobby-only version as current. These were corrected without changing
simulation forces or local input handling.

NOT STARTED, deliberately excluded: prediction/reconciliation, lag compensation,
matchmaking, ranked queues, public backend deployment, anti-cheat, voice chat.

Changed in this continuation: `server/build.mjs`, `src/render/network-match.ts`,
`server/README.md`, `docs/NETWORK-MATCHES.md`, this audit, and generated browser
verification screenshots. No tests or gameplay forces needed changes.

### Final verification

Requirements **1–11 are COMPLETE**, implemented and checked on the final build.
For requirement **12**, the architecture is preserved and no further networking
features were added; previously authorized playable network matches remain in
the repository. The game is therefore no longer a lobby-only Phase 1 build.

- Frontend production build and server TypeScript/bundle build: PASS.
- `npm test`: PASS, including contact/physics regressions, four independently
  controlled entities, actual collision participant IDs, name-independent
  scoring, and the identical 480-tick array/ID-input physics replay.
- `npm --prefix server test`: all six tests PASS.
- `npm run lan`: PASS; fresh server bound to `0.0.0.0:8090`, with frontend and
  same-origin API available at `http://192.168.1.27:8090` on this network.
- `tests/browser-smoke.cjs`: PASS; local gameplay, Free Play, bot, garage,
  settings/bindings, boost, training and no runtime errors.
- `tests/accounts-browser.cjs`: PASS using the freshly bundled app entry;
  registration, persistence, independent sessions, save conflicts, logout,
  restart login, and unavailable-backend Guest play.
- `tests/lan-browser.cjs`: PASS; separate tabs, codes, four IDs/cars, capacity,
  responsive lobby, appearance updates, kicks, tab close, local modes,
  host transfer and offline/reconnect, with no runtime errors.
- `tests/party-flow-browser.cjs`: PASS; shared modes, Continue/team selection,
  ready and team events with polling blocked, capacity enforcement, bot slots,
  and shared back navigation.
- `tests/network-browser.cjs`: PASS preservation check; shared 1v1, four human
  controls, server bots, goals/results, pause behavior, reconnect and cleanup.
  Inspected the generated bot-match screenshot as well.

The initial concurrent browser runs timed out. Running the same suites
sequentially passed without test relaxation or additional production changes.
Logs: `.tools/phase1-oct1-{physics,server,lan-launch,smoke,accounts,lobby,flow,network-browser}.log`.

Remaining limits: no second physical computer/router path was tested; party and
match state are memory-only; the public backend is not deployed, so GitHub Pages
still needs a separately configured HTTPS backend. The build retains its large
bundle advisory. Phase 2 should start with real-device latency and disconnect
testing of the retained match code, followed by performance work and, only when
requested, prediction/reconciliation. The original networking exclusions were
not implemented in this continuation.

## Continuation verification — September 30, 2026

Inspection found the Phase 1 implementation and the newer setup screens already
present. The interrupted work was final verification; no working feature was
rebuilt. The previous test server had stopped and its old LAN IP no longer
matched this computer. The current `npm run lan` launch rebuilt both projects
and bound to `0.0.0.0:8090`, printing `http://172.20.10.2:8090` for this network.

| Requirement | Inspection status | Final status |
| --- | --- | --- |
| 1. Preserve local game, Free Play, bot, physics, garage, settings, accounts | COMPLETE; final regression confirmation pending | COMPLETE |
| 2. Generic PlayerInput, no device reads in physics | COMPLETE | COMPLETE |
| 3. Independent entities with unique IDs | COMPLETE | COMPLETE |
| 4. LAN server/client hosting | COMPLETE; test process stopped | COMPLETE |
| 5. Short-code Create / Join Party | COMPLETE | COMPLETE |
| 6. 1v1 / 2v2 lobby | COMPLETE; newer setup verification partial | COMPLETE |
| 7. Membership, team, ready, mode and host synchronization | PARTIALLY COMPLETE verification of live event channel | COMPLETE |
| 8. Shared client/server TypeScript types | COMPLETE | COMPLETE |
| 9. Four-player representation and ID-based scoring | COMPLETE | COMPLETE |
| 10. Leave/disconnect/reconnect | PARTIALLY COMPLETE final event-channel regression verification | COMPLETE |
| 11. npm run lan | COMPLETE | COMPLETE |
| 12. Future authority boundary, no synchronized physics | COMPLETE | COMPLETE |

No Phase 1 feature was missing. One browser test still addressed the removed
mode dropdown: corrected it to use Start Game and the mode cards. Added a
two-client ready-state assertion while polling is blocked, proving that ready
state also travels over the event stream. The Ready button stays removed as
requested; the protocol capability remains tested. The 2 vs 2 Bots option
reserves slots in setup only, without implementing a synchronized bot match.

Completed checks:

- `npm run lan`: frontend and server builds passed; actual LAN-IP client loads passed.
- `npm test`: all gameplay/physics suites passed, including four entities,
  collision participants, ID-based goal credit and the identical 480-tick input replay.
- `npm --prefix server test`: all three account/security/party suites passed.
- `tests/party-flow-browser.cjs`: shared mode/Continue screens, 1v1 capacity,
  live teams and ready with polling blocked, two-human/two-bot setup and back navigation passed.
- `tests/lan-browser.cjs`: ordinary-tab identities, code joining, four cars,
  four responsive layouts, fifth-member rejection, garage updates, tab close,
  kick, Free Play, VS Bot, host transfer and offline/reconnect passed without runtime errors.
- `tests/accounts-browser.cjs`: persistence, independent sessions, save conflicts,
  logout, restart login and Guest fallback passed.
- The previously interrupted `tests/browser-smoke.cjs` had completed successfully;
  its saved log confirms bindings, settings, boost and training behavior.
- Inspected the final mode-screen screenshot; cards, selection and navigation render correctly.

Changed in this continuation: `tests/lan-browser.cjs`,
`tests/party-flow-browser.cjs`, this document, and generated verification
screenshots under `docs/`. No gameplay or production modules needed new edits.
Logs: `.tools/lan-continuation-physics.log`, `.tools/lan-continuation-server.log`,
`.tools/lan-continuation-accounts.log`, `.tools/party-flow-browser.log`,
`.tools/party-flow-lan.log`, `.tools/party-flow-smoke.log`.

The LAN tests used multiple browser clients on this computer through its LAN
address. A second physical computer's Wi-Fi/firewall path is still unverified.
Network simulation and other excluded Phase 2 features remain NOT STARTED by design.

## Updated party setup flow

The home party controls now sit lower and show **Start Game** instead of the
mode/team selectors and Ready button. The host opens a full mode screen with
**1 vs 1**, **2 vs 2**, and **2 vs 2 Bots** cards, then chooses **Continue**.
Everyone in the party sees the shared team-selection board over the arena.
Players choose Blue or Orange there. The server enforces one player per side in
1v1 and two per side in 2v2, including concurrent requests. Entering team selection
clears previous assignments so each player can choose. Two-player modes reject
parties larger than two rather than silently dropping members.

For **2 vs 2 Bots**, two human slots are on Blue and two reserved bot slots are on
Orange. This is pre-game setup only: synchronized human/bot matches still require
Phase 2. The host can change mode or return everyone home; guests can leave.
Host departure transfers setup control to the next remaining member.

Server-sent events now deliver changed lobby snapshots at up to 100ms intervals.
The existing two-second poll remains for reconnection, presence and fallback.
Outgoing stream traffic does not renew presence, so broken connections still
expire. No physics messages were added. The original audit below describes the
prior Phase 1 completion; its Ready control has since been replaced by this flow.

The checklist below follows the twelve requirements in the continuation request.
The separate original LAN attachment was not available; the accessible earlier
attachment covered the home screen and parties.

## Audit and final status

| Requirement | State at inspection | Final status and verification |
| --- | --- | --- |
| Preserve single-player, Free Play, bot, physics, garage, settings and accounts | Working baseline | COMPLETE: simulation regressions, browser smoke and account browser suites pass. |
| Generic PlayerInput into car physics | COMPLETE: existing input object, no keyboard reads in car physics | COMPLETE: shared type with compatibility alias; 480-tick array/ID input replay has identical position, velocity and rotation. |
| Independent entities with unique player IDs | PARTIALLY COMPLETE: IDs existed, simulation assumed two cars | COMPLETE: validated roster of up to four, independent ID-addressed inputs and reset; duplicate IDs rejected. |
| LAN server foundation | PARTIALLY COMPLETE: account API and party endpoints existed | COMPLETE: production client and API served together on 0.0.0.0; actual LAN-IP browser requests pass. |
| Create / Join with short code | PARTIALLY COMPLETE: basic server operations | COMPLETE: six-character code, normalization, invalid/full party handling, stable code and separate-tab joining tested. |
| 1v1 / 2v2 lobby | NOT STARTED | COMPLETE: mode, team capacity, unassigned members and ready rules tested. |
| Server synchronization of membership, teams, ready, mode and host | PARTIALLY COMPLETE: basic membership polling | COMPLETE: multiple browser clients observe updates; host departure transfers ownership. |
| Shared TypeScript network/message types | PARTIALLY COMPLETE | COMPLETE: shared party state, replies, actions and player/input descriptors consumed by client/server. Both builds pass. |
| Four cars without player/bot assumptions | BROKEN / NEEDS CORRECTION: collision bookkeeping assumed first two cars | COMPLETE: four rendered lobby cars and four independent physics entities; collisions between third/fourth cars and ID-based scoring tested. |
| Connection / disconnection | BROKEN / NEEDS CORRECTION: shared-cookie identity across tabs; incomplete cleanup | COMPLETE: tab-specific identity, explicit leave/disconnect, page-close removal, host transfer, offline/reconnect and stale-session cleanup. |
| Simple LAN launch | NOT STARTED | COMPLETE: npm run lan builds and starts the combined service; command executed successfully. |
| Preserve future authority boundary without network physics | PARTIALLY COMPLETE | COMPLETE for Phase 1: shared inputs/IDs and server-owned lobby state; gameplay remains local. |

## Start and join

Use Node.js 24.14 or newer. In the project folder, install dependencies once:

```sh
npm install
npm --prefix server install
```

Then start each LAN session with:

```sh
npm run lan
```

Keep that terminal open. On the host computer open `http://localhost:8090`.
The terminal also prints the host's current LAN address. Another computer on the
same Wi-Fi opens that printed address, for example `http://192.168.1.20:8090`.
It does not run npm and should not use its own localhost address.

Choose **Create Party** on the host, then **Join Party** on the other computer
and enter the displayed code. The host selects **Start Game**, picks a mode and
presses **Continue**. Players then choose their side in the shared lobby.
These controls prepare a lobby, not a synchronized match.

If Windows asks, allow Node on the private network. A Wi-Fi network with client
isolation can prevent devices from reaching each other. No public hosting or
router port forwarding is part of this phase.

The default port is 8090. To change it in PowerShell:

```powershell
$env:LAN_PORT = "8091"
npm run lan
```

Accounts use the existing `server/data/arena.sqlite` database by default.
`DATABASE_PATH` can select another database. LAN mode supplies its own same-origin
client configuration, so no backend URL setup is needed.

The LAN server marks `/config.json` with `lan: true`. Both accounts and parties
then use the page's exact origin (scheme, hostname and port), overriding any
deployment URL baked into the build. Live party events use that same API base.
The shared endpoint resolver derives `ws:` / `wss:` from it for future WebSocket
transport; the current lobby uses server-sent events, not WebSockets.
On GitHub Pages or other non-LAN deployments, `VITE_API_URL` still takes precedence
over `config.json`'s `apiUrl`. Local DNS hostnames are accepted for same-origin
LAN requests without adding them manually to the API origin list.

If Create Party reports that the party server needs an update, an older backend
is still running without the party routes. Stop that backend and restart it with
`npm --prefix server start` (which now builds before starting), or use
`npm run lan` and its printed game address. Restarting Vite alone does not restart
the separate backend. The party client retries when the updated API is available.

## Work completed in this continuation

- Kept the existing input semantics and physics tuning; extracted the shared
  PlayerInput contract and generalized simulation rosters, kickoff placement,
  per-car collision state and actual collision participant selection.
- Finished authoritative lobby mode, team and ready operations, capacity checks,
  host permissions, departure and stale-session cleanup.
- Fixed ordinary tabs sharing a player identity by using tab-specific session
  tokens, while retaining the existing account login flow.
- Connected lobby controls and four-car presentation to server state, including
  appearance updates, host transfer and recoverable connection errors.
- Added the combined LAN launcher and same-origin client/API configuration.
- Added LAN simulation/server/browser coverage and adapted existing browser
  checks to the intended leave-confirmation dialog.

## Modules changed

| Area | Files |
| --- | --- |
| Shared contracts / physics | `shared/player.ts`, `shared/party.ts`, `src/input/types.ts`, `src/car/car.ts`, `src/physics/simulation.ts` |
| LAN and party backend | `server/src/lan.ts`, `server/src/parties.ts`, `server/src/app.ts`, `server/src/config.ts` |
| Client integration | `src/game/party.ts`, `src/game/accounts.ts`, `src/main.ts`, `src/input/input.ts` |
| Lobby and menu integration | `src/ui/party-panel.ts`, `src/render/home-lobby.ts`, `src/ui/ui.ts`, `src/style.css` |
| Launch / documentation | `package.json`, `README.md`, `docs/LAN-PHASE1.md` |
| Verification | `tests/lan-foundation.ts`, `tests/lan-browser.cjs`, `server/tests/parties.test.ts`, `tests/browser-smoke.cjs`, `tests/polish-browser.cjs`, `tests/goal-visual.cjs` |

## Verification performed

- Entire existing physics/gameplay test command plus LAN foundation tests passed.
- Server tests passed, including account persistence/security and party cases.
- Frontend production build and server TypeScript build passed.
- `npm run lan` launched on `0.0.0.0:8093` with an isolated in-memory test database.
- Browser clients loaded from `http://192.168.1.20:8093`, not just localhost.
- Multi-tab tests covered codes, distinct identities, four members/cars, fifth
  member rejection, mode/team/ready synchronization, host permissions, leaving,
  closing a tab, kicking, host transfer and offline/reconnect without crashes.
- Lobby presentation was checked at 1280x800, 1920x1080, 900x600 and 390x844.
- Free Play movement, VS Bot, pause/leave behavior, settings, garage changes,
  custom bindings and boost effects passed browser checks.
- Account registration, persistence, concurrent-save conflict handling, logout,
  login and unavailable-backend Guest gameplay passed browser checks.
- Four-car simulation tests checked independent inputs, third/fourth-car
  collisions, custom-ID scoring and reset. The 480-tick replay compared legacy
  array inputs against ID-map inputs exactly on every tick.

Logs are in `.tools/lan-*.log`; lobby screenshots are in `docs/lan-lobby-*.png`.
The older polish and goal-visual scripts were updated for the confirmation
dialog but were not separately rerun; their overlapping behavior was exercised
by browser smoke and the simulation suite.

## Remaining limits and Phase 2

- Testing used multiple browser clients on the host's LAN IP. A second physical
  computer and the router/firewall path still need a real-device check.
- Lobby updates use a live event stream with a two-second recovery poll. Abrupt connection loss removes a stale
  member after 45 seconds, plus up to the five-second cleanup interval. Normal
  leave/page close sends an immediate disconnect request.
- Parties are in memory and disappear on server restart. Reloading a page leaves
  its party; this phase does not implement persistent/rejoinable match sessions.
- Four players can share the lobby, but Free Play and VS Bot still run locally.
  Team selection does not launch a network match.
- The production bundle retains Vite's large-chunk advisory; builds succeed.

Phase 2 should connect lobby rosters to a server-owned match lifecycle and a
fixed-tick simulation, with sequenced player inputs and state snapshots. Remote
car/ball rendering and interpolation should follow, with latency testing before
prediction/reconciliation. None of that network physics is implemented here.
Matchmaking, ranked queues, public hosting, anti-cheat and voice chat remain out
of scope.
