# Public parties with GitHub Pages

The existing frontend stays at https://goofykings.github.io/Octane-Arena/.
The existing Node server must run on a separate public HTTPS host. This update
prepares that deployment; it does not deploy a server. The subsequent
[WebRTC match update](WEBRTC-MATCHES.md) adds browser-hosted shared gameplay
while preserving the existing LAN simulation and party menus.

## Existing architecture

- `src/game/party.ts`: HTTP JSON session/Create/Join/Leave/Kick actions and a
  fetch-based server-sent event stream at `/api/party/events` for lobby updates.
- `src/ui/party-panel.ts`, `src/ui/party-flow.ts`: existing party/lobby menus.
- `server/src/app.ts`, `server/src/parties.ts`: Fastify routes, CORS and authoritative
  in-memory sessions/parties. Six-character codes, four member slots, unique
  server session IDs, local profile UUID/name/avatar metadata. Names are never IDs.
- `shared/party.ts`: common party messages, modes and maximum size.
- Match WebSockets at `/api/match/socket` remain available for the `server`
  transport. Public production parties now default to WebRTC, with SDP/ICE
  signaling over the existing HTTP/SSE party service. See the WebRTC guide.
- The old two-second snapshot poll now only handles stream recovery/fallback.
  A healthy stream uses a ten-second lightweight presence heartbeat instead.

The browser stores its session token per tab and sends `X-Arena-Party`, including
on the SSE fetch. Public cross-site parties therefore also work when third-party
cookies are blocked. Server cookies remain compatible. Profile UUIDs persist
locally; independent sessions retain different server player IDs.

Membership changes arrive through SSE. Leaving, kicking, switching parties and
host transfer keep existing behavior. The first remaining member becomes host.
The last member leaving removes the party. Closing the page attempts a keepalive
disconnect request. If that cannot reach the server, absence of client requests
expires the session after 45 seconds, checked every five seconds. Sending SSE
heartbeats alone never renews a disconnected player's presence.

## Deploy the backend

Use a normal long-running Node host with Node.js **24.14 or newer**. Clone/upload
the **whole repository**, since the server imports shared/game modules while
building. Set the service working directory to `server`.

Build command:

```sh
npm ci --prefix ..
npm ci
npm run build
```

Production start command:

```sh
npm start
```

From the repository root, the equivalent commands are:

```sh
npm ci
npm ci --prefix server
npm run build --prefix server
npm start --prefix server
```

The root install supplies types/build dependencies for the shared physics
modules already imported by the server. It is needed at build time. The runtime
starts `server/dist/server/src/index.js`. It needs only the server's
installed runtime dependencies and compiled output, not a frontend `dist/`, a
developer's filesystem, or a database. Set these server environment variables:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGINS` | `https://goofykings.github.io,http://localhost:5173,http://127.0.0.1:5173` |
| `PORT` | Use the port supplied by your host; otherwise `8787` |
| `HOST` | Optional: defaults to `0.0.0.0` in production |
| `TRUST_PROXY` | Optional, defaults to `false`; set `true` only behind your trusted HTTPS proxy |

`FRONTEND_ORIGINS` contains exact origins, with **no repository path or trailing
slash**. Public production origins require HTTPS; loopback HTTP origins remain
supported for development. Unlisted HTTP/SSE/WebSocket origins are rejected.
No wildcard or secrets are required. `DATABASE_PATH` is a legacy setting and is
not required for the current anonymous party API.

Your host/reverse proxy must provide a valid HTTPS certificate and forward
requests to the Node port. Forward streaming responses without buffering or
caching, keep long-lived SSE connections open, and support WebSocket upgrades
for the already-existing match endpoint. The server includes
`X-Accel-Buffering: no`; any external proxy configuration must honor streaming.
The health check is `GET /health`, returning `{"status":"ok"}`. The existing
`/api/health` route remains available.

Run **one server instance**. Party state is in memory: restarting clears parties,
and multiple independent instances cannot share codes without future shared
storage. Do not deploy this as a static site or a short-lived serverless function.

## Configure GitHub Pages

1. Deploy the backend and open `https://YOUR_BACKEND/health`. Verify `status: ok`.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions →
   Variables**. Add a repository variable named **`VITE_API_URL`**.
3. Its value is your backend's **HTTPS base URL**, for example
   `https://api.example.com`, without `/api/party` or `/api/health`.
4. Push/run the existing **Deploy Octane Arena to GitHub Pages** workflow.
   `.github/workflows/deploy.yml` already passes `${{ vars.VITE_API_URL }}` into
   `npm run build`; this is preserved. Changing the variable needs a new build.
5. Open the Pages game in two independent devices/browsers. Create a party on
   one, enter the displayed code on the other, and verify both member lists.

`src/game/backend.ts` centrally consumes `import.meta.env.VITE_API_URL` and derives
HTTPS HTTP/SSE and WSS endpoints. A Pages build with no API setting contains no
local development backend fallback: single-player remains usable and party
actions report that multiplayer is not configured. An HTTPS page rejects an
HTTP API address. No public server URL is hard-coded in source.

Optional runtime configuration is `public/config.json` with an `apiUrl` field.
The build variable takes priority. Combined LAN hosting supplies `lan: true`
runtime configuration, which deliberately overrides a baked-in production API
and uses the exact hostname/port serving the LAN page.

## Local development

Two VS Code terminals, starting at the repository root:

```sh
# Terminal 1: backend, defaults to http://127.0.0.1:8787
npm ci
npm ci --prefix server
npm run dev --prefix server
```

```sh
# Terminal 2: frontend
npm ci
npm run dev
```

Open http://127.0.0.1:5173/Octane-Arena/. Leave `VITE_API_URL` blank to use the
development default, or set it to another local HTTP backend. Vite loads a root
`.env`; the backend loads `server/.env` when started with `--prefix server`.
If you copied the production server example locally, use
`NODE_ENV=development`, `HOST=127.0.0.1`, `PORT=8787` and the localhost origins.
Changing env files requires restarting the relevant development server.

For same-Wi-Fi hosting, `npm run lan` remains unchanged. Open its printed URLs;
no manual API address is needed. `LAN_PORT` still optionally changes its default
`8090`, separately from the API-only server's `PORT`.

Offline/invalid/full parties produce short errors. **RETRY CONNECTION** reconnects
without reloading the game; Create/Join can also be tried again. Single-player,
garage, settings and local profiles do not depend on backend availability.

## Verification and deployment limits

Relevant automated checks: `tests/backend.ts`, server tests including
`server/tests/public-party.test.ts`, and `tests/public-party-browser.cjs`.
The browser harness uses an ephemeral, local HTTPS proxy/certificate to verify
the production Pages origin, actual cross-origin SSE and cookie-free sessions.
It does not constitute internet-device testing. Production client/server builds
must pass before deployment. The existing Pages workflow and its test gates
are preserved; pre-existing unrelated test failures must also be resolved before
that workflow can publish.

External steps still required: obtain a public Node host/HTTPS address, run the
backend, set the GitHub Actions URL variable, rebuild Pages, and test from two
different internet networks. No public backend has been deployed by this task.

Verified in this update:

- Client type checking/production build and server type checking/production build.
- A separate production build with an example HTTPS `VITE_API_URL` includes that
  configured address and excludes the development localhost API fallback.
- The complete server regression suite passed; the added public-party tests also
  verify silent 45-second presence expiry and host transfer.
- The HTTPS browser harness passed Create/Join, both member lists, invalid codes,
  cookie-free SSE, presence heartbeats, leave/rejoin, browser-close cleanup,
  offline/retry, party preservation on reconnection and streaming fallback.
- `tests/party-startup.cjs` passed compiled production startup, `PORT`, `/health`
  and clean invalid-config failure.
- `tests/party-recovery-browser.cjs` passed against the normal Vite development
  page and local API, including two independent tabs.

The previous `powerslide 180 at 5` failure is resolved. The handling test now
checks substantial signed rotation, retained momentum, lateral slip and recovery
with the current gentler powerslide tuning. Stale ball-size assertions now check
configured collider/visual agreement. The full root `npm test` command passes;
gameplay physics and the Pages workflow's test gate remain unchanged.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site),
[Node environment files](https://nodejs.org/api/environment_variables.html), and
[HTTPS/mixed-content requirements](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content).
