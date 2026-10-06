# Octane Arena party/match server

The game uses browser-local profiles. This server runs anonymous LAN parties and
network matches; registration, login, logout and cloud-account save routes have
been removed. It does not create online accounts or store local profile stats.

From the repository root, with Node.js 24.14+ installed:

```sh
npm install
npm --prefix server install
npm run lan
```

Open the printed localhost address on this computer, or the printed LAN address
on another computer connected to the same Wi-Fi. Create/Join Party still uses a
short code. The page automatically uses the hostname serving it for party and
match connections. `VITE_API_URL` remains available for separate frontend/server
deployments.

The client sends a validated local UUID, name, avatar and preset. The server assigns
an independent session/player ID to each connection, including two tabs that
share one local profile. Name/avatar updates change lobby metadata; they do not
change session IDs or active match rosters. Anonymous party session cookies and
`X-Arena-Party` tokens remain for lobby/WebSocket continuity; they are not online
account authentication. Client stats are never used for match rules.

For a separately configured service, `npm --prefix server run build` and
`npm --prefix server start` still use HOST/PORT, FRONTEND_ORIGINS and TRUST_PROXY.
Keep the existing allowed-origin configuration for a separate HTTPS frontend.

For GitHub Pages and public party hosting, follow
[the public party deployment guide](../docs/PUBLIC-PARTIES.md). `npm start`
runs the compiled server without requiring build tools at runtime. Run
`npm run build` first; Node.js 24.14+ is required. The production process serves
only the API, while GitHub Pages serves the game. `/health` reports readiness.
Production parties default to browser-hosted WebRTC matches; ordinary LAN
hosting keeps the existing server simulation. Configure discovery/relay servers
as described in [WebRTC matches](../docs/WEBRTC-MATCHES.md).

Run server regression tests from the repository root after a client build:

```sh
npm run build
npx tsx --test server/tests/*.test.ts
```

Legacy database/backup modules are retained only to avoid deleting old saved
account data. They are not opened or used by the running party/match API.
