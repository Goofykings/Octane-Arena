 abnd# Browser-hosted WebRTC matches

Both players open https://goofykings.github.io/Octane-Arena/, create/join the
existing party code, choose a mode and teams, and the host selects **KICK OFF**.
The public API introduces the browsers; gameplay travels over WebRTC data
channels. For four-player games, each guest connects to the host.

## Match authority and preserved systems

The party host runs the existing `NetworkMatch` simulation in a dedicated
browser worker at the existing 120 Hz fixed step. The same ball/car physics,
boost pads, bots, demolitions, kickoff formations, scoring, clock and goal replay
rules are reused. Snapshots use the existing 30 Hz cadence and interpolation.
Guests send their own generic `PlayerInput` messages. The host never accepts a
guest-supplied player ID; input ownership is tied to that peer's authenticated
party identity. Client snapshots must match the chosen arena, match ID and roster.

`src/game/authoritative-match.ts` contains the moved shared simulation authority.
`server/src/network-match.ts` re-exports it for existing LAN code and tests.
The browser worker is `src/network/authority-worker.ts`. `src/game/network.ts`
continues to provide the same renderer-facing `NetworkClient` interface.

Supported modes are **1v1, 2v2, and 2v2 against bots**. Bots run only on the host.
The party server chooses one valid soccer arena before anyone loads the match.
Every browser receives that same arena and match ID. Single-player, Free Play,
Rings, garage, local profiles, settings and the ordinary LAN server path remain
available.

Public production parties default to `webrtc`; development and ordinary
`npm run lan` default to the existing `server` transport. `MATCH_TRANSPORT=server`
preserves the server-authoritative WebSocket path on a separately deployed API.
There is no silent switch from WebRTC gameplay to backend physics.

## Signaling and transport

`server/src/parties.ts` adds authenticated endpoints:

- `GET /api/party/rtc-config`: discovery/relay configuration with temporary credentials.
- `POST /api/party/signal`: bounded SDP/ICE messages only, for members of the same party.
- `GET /api/party/signals?after=N`: cursor-based recovery when SSE is unavailable.
- `POST /api/party/rtc-end`: host finish notification or member disconnect notification.

Signals also arrive as `event: signal` messages on the existing SSE stream.
Queues expire after 60 seconds and are bounded to 128 entries per session.
Senders cannot forge their identity, address another party, or impersonate the
host's offer role. The backend owns party membership and lifecycle metadata;
it does not run a physics world for WebRTC matches.

`src/network/rtc-peers.ts` establishes the host/guest connections. Each connection
uses three channels: reliable ordered controls, unordered live snapshots without
retransmission, and reliable chunked replays. Replay chunks stay well below the
usual SCTP message limit; transfer buffers and queued bytes are bounded. Replay
transfer does not fill the controls channel. No camera/microphone permission is
requested.

All human clients must connect and acknowledge the selected match before the
host starts its worker/countdown. Short peer failures renegotiate and resume the
same match; stale inputs become neutral after the existing 300 ms timeout.
Long failures end the match and return the party to team selection. Leaving the
party ends an active match. If the host leaves, the next member becomes party
host; the live physics match is not migrated. Browser suspension or a closed
host cannot provide an ongoing match authority.

## Public setup still required

The game has **not** been publicly deployed with a signaling/relay service by
this task. Follow [public party deployment](PUBLIC-PARTIES.md) for Node hosting,
HTTPS, exact CORS origins, `PORT`, `/health`, and the existing GitHub Actions
`VITE_API_URL` repository variable.

The additional server settings are:

| Setting           | Value                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `MATCH_TRANSPORT` | `webrtc` (production default)                                                                        |
| `STUN_URLS`       | Comma-separated STUN URLs; defaults to `stun:stun.l.google.com:19302`                                |
| `TURN_URLS`       | Your relay URLs, for example `turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp` |
| `TURN_SECRET`     | Privately configured shared secret for coturn REST authentication                                    |
| `ICE_POLICY`      | `all` normally; `relay` to verify relay-only connectivity                                            |

Run coturn (or a compatible managed relay) with REST/shared-secret authentication.
Use the same private secret on the relay and API. `server/src/rtc-config.ts`
issues one-hour HMAC-SHA1 credentials bound to the session player ID; it never
sends the permanent secret to a browser. Do not put that secret into `VITE_*`,
`public/config.json`, source files, or GitHub frontend variables.

A STUN server helps discover direct routes. A working TURN relay is needed for
networks that cannot connect directly. Configuring `TURN_URLS` without a secret,
or relay-only mode without a relay, produces a clear startup error. HTTPS/WSS
signaling setup alone does not supply a TURN relay or guarantee connectivity
on every network. Hosting/firewall/TLS configuration remains external work.

## Local testing in VS Code

To test WebRTC using separate local frontend/backend terminals, set
`MATCH_TRANSPORT=webrtc` in `server/.env`, restart the backend with
`npm run dev --prefix server`, and run `npm run dev` for the frontend. Leave
`VITE_API_URL` blank for the local API default. Open the printed Vite URL in
two sessions and use the normal party menu. No TURN service is needed to test
direct connections on this one computer. `npm run lan` keeps its original
transport unless the launch helper is explicitly configured otherwise.

Useful checks from the repository root:

```sh
npm run test:rtc
npm run build
npm run build --prefix server
npm test --prefix server
```

`tests/rtc-browser.cjs` exercises real browser peer channels, host worker
simulation, independent steering/boost, identical snapshots, large replay
transfers, reconnects, all three modes, and four player IDs with host cleanup.
`tests/public-party-browser.cjs` tests the HTTPS Pages origin against an
ephemeral local HTTPS signaling proxy and a real WebRTC shared match. Both
use the existing Playwright harness conventions (`PLAYWRIGHT_MODULE`).

These are local tests, including a simulated production origin. They are not
proof of connectivity between different internet networks or through a live
TURN service. No matchmaking, host migration, ranked security, prediction or
lag compensation was added. The host is the gameplay authority for private
casual matches.

Verified for this update: client/server production builds, 15 server regression
tests, the RTC protocol/authority tests, real-browser 1v1/2v2/2v2bots over WebRTC,
large replay transfers, peer reconnection and cleanup, and an HTTPS Pages-origin
shared match. The existing LAN browser suite also passed independent inputs,
camera framing, movable celebrations and both boost-pad pickups, goals, kickoff,
results, bot teams, reconnection and four human players over its original
WebSocket transport.
The Home/Garage camera and Free Play/VS Bot/LAN camera browser checks also passed.

The existing unrelated `tests/major-update.ts:79` powerslide assertion still
blocks the preserved Pages workflow's full test gate. That physics assertion
was not weakened or bypassed by this transport update.

References: [WebRTC peer setup](https://webrtc.org/getting-started/peer-connections),
[data channel limits](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels),
[coturn REST authentication](https://github.com/coturn/coturn/blob/master/README.turnserver).
