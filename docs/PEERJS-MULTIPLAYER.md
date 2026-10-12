# PeerJS multiplayer

Both players use the normal GitHub Pages URL:
https://goofykings.github.io/Octane-Arena/

The current build uses PeerJS 1.5.5 DataConnections with `new Peer(code, {
secure: true })` for the host and `new Peer({ secure: true })` for guests.
PeerJS defaults select `0.peerjs.com:443`. No API address, local server, PeerServer
account, microphone, camera or manually exchanged SDP/ICE is needed. This code
must be committed/pushed and the Pages deployment completed before the public URL
serves it; local verification does not publish the build.

## Party and identity

- Host presses Create Party. Six symbols are generated with cryptographic random
  bytes from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. The code becomes the host's
  signaling peer ID and is displayed only after PeerJS emits `open`.
- An occupied ID destroys the failed Peer and tries a new code, at most seven
  times. Timeout/network failures end the busy state with a useful message.
- Join Party uppercases and removes spaces, requires exactly six allowed symbols,
  creates an independent automatic signaling peer ID, then connects to the code.
- HELLO contains exact `GAME_VERSION`, validated local profile UUID/name/avatar,
  and the selected preset. WELCOME contains version, assigned slot, roster, host
  and current setup. A mismatch, duplicate profile, invalid preset or full party
  is rejected before membership. Normal tabs sharing one browser profile can
  have the same local UUID; use different devices/profiles/incognito contexts.
- Game identity is the local profile UUID. Neither the signaling code nor guest
  signaling ID becomes a permanent player ID. Transport associates a connection
  with the validated UUID and resolves input/chat/vote senders from that binding.

`shared/peer-party.ts` implements host-owned lobby rules, capacities, ready/team
changes, 1v1/2v2/two humans versus bots, Soccar/Heatseeker and random shared arena
selection. `src/game/party.ts` keeps the existing party UI interface but replaces
the HTTP/SSE/session/signaling path with PeerJS lobby messages.

## Preserved gameplay

`src/network/peer-transport.ts` owns every Peer/DataConnection, connection map,
messages, error mapping, ping/pong, latency, buffering and replay chunks.
`src/network/rtc-peers.ts` is only a compatibility adapter; it creates no native
RTCPeerConnection, SDP, ICE candidates or extra channels.

The topology is host plus up to three guests. Each guest has one connection to
the host; guests do not connect to each other. Bidirectional nonce ping/pong is
verified before the existing gameplay authority starts. The host's existing
120 Hz authority worker, simulation, input validation, 30 Hz snapshots,
interpolation, pads, goals, stats, chat, Heatseeker and replay votes are preserved.
Normal objects travel through DataConnections. Existing bounded chunk utilities
remain for multi-megabyte replay payloads. Fast snapshots can be dropped before
sending when a connection is backed up; bulk chunks are paced and interleaved.

The obsolete frontend WebSocket match connection and manual SDP/ICE transport
were removed. No frontend party request reaches the old Node API. The `server/`
project remains optional static hosting and legacy regression tooling; its old
routes are not used by PeerJS and are not required on GitHub Pages.

## Disconnects and networks

Leaving/kicking removes the connection and member. A disconnect during a match
ends that match and returns remaining party members to the lobby. Host leave
closes the entire party with HOST DISCONNECTED, without migration. A new party
registers a new random code. Code availability follows the lifetime of that Peer.

Signaling disconnect is separate from WebRTC connection failure. Open data
connections and the match stay alive while signaling reconnects. PeerJS reconnect
is retried and the status clears once healthy. Unresponsive links expire using
their ping/data activity. PeerJS failures map to short UI messages, including
PARTY NOT FOUND, CONNECTION FAILED and signaling-service errors.

The library's default ICE configuration is unchanged. It includes Google STUN
and PeerJS's published provider TURN defaults; no private credentials or random
third-party relay services were added. A restrictive network can still block
WebRTC. PeerJS signaling does not simulate the game, and WebRTC may negotiate a
relay rather than a direct route when its normal ICE configuration requires one.

Optional diagnostics, without profile contents or SDP/candidate addresses:

```js
window.octaneArenaNetwork.diagnostics();
window.octaneArenaNetwork.setDebug(true); // false turns logging off
```

## Verification

- `tests/peer-party.ts`: random six-symbol codes, schema validation, four unique
  stable IDs, host permissions, capacities, ready/mode/team state, shared arenas,
  disconnect and bot roster.
- `tests/peerjs-browser.cjs`: real public cloud, independent contexts, registration,
  occupied-ID retry, different guest peer ID, HELLO/WELCOME, bidirectional probes,
  invalid/missing/duplicate profile cases, signaling reconnect, actual driving,
  ball touch/stat sync, chat/board, leave/rejoin, host closure and zero API requests.
- `tests/peerjs-four-browser.cjs`: real four-context cloud star, shared teams/ready,
  four cars, actual input/touch, Heatseeker goal, identical scores and replay,
  chunk transfer, four-human skip, synchronized kickoff and disconnect cleanup.
- `tests/peerjs-pages-browser.cjs`: local production assets served through an
  intercepted HTTPS Pages origin/base path, real cloud signaling/data, no test
  hooks for host/guest, and clean version mismatch. This is an HTTPS rehearsal,
  not a deployment or test of the currently published bundle.

These tests used independent browser contexts on one computer. Separate physical
devices and unrelated Wi-Fi/mobile networks still require manual verification.

## Two-device procedure

1. Deploy the changed repository through the existing GitHub Actions workflow.
2. On both devices open the Pages URL above and reload to the same game version.
3. Device A: Create Party; wait for the six-character code.
4. Device B: Join Party; enter that code. Both should show the two profiles.
5. Host: Play / Start Game, choose the existing match setup, then start the match.
   Use Choose Sides when desired, or the existing automatic team assignment.
6. Verify both cars, steering/boost/jump, the shared ball, scores, chat, scoreboard,
   goal replay and skip. Leave on B and check removal; leave on A and check that
   B returns to the menu with HOST DISCONNECTED.
7. Repeat with up to four independent profiles for 2v2, then on another ordinary
   network. Report the UI error/diagnostics if connectivity is blocked.
