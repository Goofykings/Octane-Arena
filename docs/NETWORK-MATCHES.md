# Network matches

The network-match implementation was added after the original LAN Phase 1, at the
user's request to make matches playable. The October 1 continuation preserves it;
it does not add another networking phase or deploy a public server.

## Start and join

Use Node.js 24.14 or newer. From the project folder, install dependencies once:

```sh
npm install
npm --prefix server install
```

Start the game server with:

```sh
npm run lan
```

On the host computer, open `http://localhost:8090`. Friends on the same Wi-Fi
open the LAN URL printed by the command. The IP can change between networks;
clients automatically use the host that served the page for HTTP and WebSocket
traffic. Keep the server terminal running.

1. Create a party and share its code; friends select Join Party.
2. The host selects Start Game, a mode, and Continue.
3. Everyone chooses a team. The server enforces team capacity.
4. Once the teams are full, the host selects Kick Off.

Modes: 1v1 (two humans), 2v2 (four humans), and 2 vs 2 Bots (two humans on Blue,
two server-controlled bots on Orange). Against a Friend in the Play menu also
opens the party flow. Free Play and VS Bot remain local modes.

## Existing implementation

The server runs the existing simulation at its fixed 120 Hz step and sends
snapshots at approximately 30 Hz. Cars, ball, collisions, boost pads, demolition,
goals, countdowns, clock and results belong to the server. Clients send sequenced,
validated PlayerInput messages through an authenticated WebSocket connection.
Their player identity comes from the party session, not a player ID in an input.

The client interpolates snapshots with a short buffer. It does not predict or
reconcile physics. The camera follows the local player's ID; all cars use their
team paint and saved presets. Wheel clearance, steering, boost, trails, skid
marks, demolition flashes and goal effects use the shared state.

Escape opens a local menu; it never pauses everyone else's match. An unfocused
client sends neutral input. Stale input also becomes neutral on the server.
Brief WebSocket drops can reconnect under the same party identity. A missing
connection ends the match after the disconnect grace period (up to about 15
seconds including detection). Leaving the party or closing its page ends the
match immediately and returns remaining players to team selection. After a
normal result, the host can return everyone to the lobby.

## Limits

- Designed and tested first for LAN. No prediction, reconciliation or lag
  compensation: higher latency is noticeable.
- No matchmaking, ranked queues, rewards, anti-cheat system or voice chat.
- No public backend has been deployed. GitHub Pages still requires a separately
  hosted HTTPS backend; configure `VITE_API_URL` when that is available.
- Party/match state is in memory and does not survive a server restart.
- Match launch requires full teams. There is no mid-match joining or bot takeover.
- Host-process shutdown stops all matches. There is no host migration between servers.
- Verification uses multiple browser clients on one machine via its LAN IP;
  a second physical computer's router/firewall path remains unverified.

## Verification commands

```sh
npm test
npm --prefix server test
npm run build
npm --prefix server run build
```

Optional browser tests require an installed Playwright package and Chrome.
`PLAYWRIGHT_MODULE` can name that package's absolute path.
`tests/network-browser.cjs` starts an isolated in-memory test server on port 8096
and verifies 1v1, four humans, bots, shared goals/results, pause, reconnect and
leave cleanup. It manipulates its in-process fixture to verify goals/results;
there is no client-accessible teleport or scoring endpoint.

`tests/lan-browser.cjs` and `tests/party-flow-browser.cjs` cover the party/lobby
foundation. Set `LAN_URL` and `GAME_URL` respectively to a running LAN server.
`tests/browser-smoke.cjs` and `tests/accounts-browser.cjs` cover existing local
gameplay and accounts.
