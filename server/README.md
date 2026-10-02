# Octane Arena account server

The static game stays on GitHub Pages. This separate Node.js 24.14+ TypeScript/Fastify service owns accounts and a SQLite database. No hosting addresses have been selected or deployed.

## Local setup

From the repository root, run `npm ci` first (shared schemas resolve the root development dependencies), then:

```sh
cd server
npm ci
```

Copy `.env.example` to `.env`. The defaults allow the Vite frontend at `http://127.0.0.1:5173` and `http://localhost:5173`:

```sh
npm run dev
```

In another terminal at the repository root, run `npm run dev`. Use `127.0.0.1` consistently for the frontend and API during local testing. Click the bottom-left profile to register or log in. Guest play needs no API.

For a compiled server:

```sh
npm run build
npm start
npm test
```

`server/dist/server/src/index.js` is the entry point. The build bundles the shared
schemas and existing simulation into each server entry point, including `app.js`
for integration tests. Deploy the **whole server/dist directory**, server package
files and production dependencies. Build from the full repository with both root
and server dependencies installed; old `dist/shared` files are not used by these
bundles. Rapier, Three.js and WebSocket runtime dependencies are declared in the
server package so the compiled backend can run independently.

## Production configuration

Keep `.env`, the database, backups and backend files off GitHub Pages. Put the API behind an HTTPS reverse proxy and run it as an unprivileged service on persistent storage. Example server environment (replace the example origin with your actual Pages origin):

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
DATABASE_PATH=/var/lib/octane-arena/arena.sqlite
FRONTEND_ORIGINS=https://YOUR-USER.github.io
TRUST_PROXY=false
```

CORS takes exact **origins**, not repository paths. For `https://YOUR-USER.github.io/arena/`, use `https://YOUR-USER.github.io`. Separate multiple intended origins with commas. Wildcards, paths, HTTP production origins and missing production origins are rejected at startup. Ports are validated. Leave `TRUST_PROXY=false` unless the service is reachable only through a trusted proxy that overwrites forwarding headers; otherwise attackers can bypass IP rate limits. With a reverse proxy, enable it only under those conditions. Configure TLS at the proxy; do not expose the plain HTTP listener publicly.

Set the public API address in **either**:

- `public/config.json`: `{"apiUrl":"https://YOUR-API-HOST"}`, then rebuild/upload; or
- `VITE_API_URL=https://YOUR-API-HOST` at frontend build time (takes precedence).

The included Pages workflow reads the optional repository Actions variable
`VITE_API_URL` and checks both projects before publishing the static frontend.

These addresses are public configuration, never secrets. An empty production address intentionally leaves accounts disconnected and Guest play available. Paths and assets work under a Pages repository subdirectory. There is no static session secret: sessions use cryptographically random opaque tokens with only SHA-256 token digests stored in SQLite.

Production cookies are `__Host-oa_session; Secure; HttpOnly; SameSite=None; Partitioned; Path=/`. They last seven days and have no Domain attribute. The browser fetches with credentials; mutations require an allowlisted Origin, JSON content and `X-Arena-Client: 1`, preventing ordinary cross-site form CSRF. CORS is not used as the sole mutation check. Verify the deployed HTTPS flow in your target browsers: third-party cookie policies vary. The UI detects blocked cookies. A same-site frontend/API arrangement is preferable if a target browser blocks the cross-site deployment. Every device logs in separately; cookies are never copied between devices.

## Data and API

SQLite runs in WAL mode with foreign keys and a busy timeout. Schema version 1 is explicit; unknown versions refuse startup. Tables separate accounts, profiles, owned items, presets, per-field preferences, ratings and sessions. Usernames preserve display case but uniqueness/login use lowercase ASCII; identities are independent UUIDs. New accounts have two original bodies, starter cosmetics/titles, 0 XP, level 1, and unrated 1v1/2v2/3v3 rows. Existing Guest presets remain separate on their device.

| Endpoint                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `GET /api/health`         | Liveness only                                                  |
| `POST /api/auth/register` | Validated unique username and password                         |
| `POST /api/auth/login`    | New opaque session; same error for unknown user/wrong password |
| `POST /api/auth/logout`   | Revoke current session and expire cookie                       |
| `GET /api/me`             | Restore authenticated profile, inventory, presets and settings |
| `PUT /api/me/save`        | Atomic owned-cosmetic/preferences update with revision check   |

Client saves debounce for 550 ms and serialize. Each save must match the current revision; a stale device receives 409 and offers explicit cloud reload rather than overwriting newer data. Failed saves remain in memory for retry; leaving with unsaved data prompts the browser. Offline edits are not a durable offline account queue. Logout flushes changes first. Expired sessions require login again. There are no inventory grants, XP/rank awards, admin routes, password-reset or recovery endpoints yet.

## Backup and restore

After `npm run build`, from `server/` with the correct `.env`, run:

```sh
npm run backup -- backups/arena-2026-09-27.sqlite
```

This uses SQLite's online backup API so the copy includes committed WAL data consistently. It refuses to overwrite an existing destination. A default timestamped path is used if omitted. Schedule backups outside the application process and copy them to a protected off-machine location. Restrict OS permissions and encrypt backup storage; backups contain account hashes and session digests.

To restore, stop the service, keep the existing database **and its matching `-wal`/`-shm` files** as a recovery set, and point `DATABASE_PATH` at a restored backup under a new filename. Do not mix sidecars from another database. Restart, check `/api/health`, then log in and verify profile/presets. To invalidate sessions after recovery, while stopped run `DELETE FROM sessions;` against the restored database using a local SQLite administration tool. No web admin endpoint is provided. The automated tests verify an online backup can be opened and contains the saved profile.

## Security and future networking

See [security review](../docs/ACCOUNT-SECURITY.md) and [verification](../docs/MAJOR-UPDATE.md). Future friends/party membership should reference account UUIDs. Add a separate WebSocket gateway that validates the session cookie and Origin during upgrade, enforces expiry/revocation for live connections and attaches the authenticated account ID. `createApp().authenticated()` supplies session lookup, but **does not replace** WebSocket Origin, rate, expiry or permission checks.

Future game servers should accept sequenced inputs, simulate authoritative matches, and write validated match results through internal transactions. Clients must never dictate positions, score, inventory, XP or ratings. REST remains for durable account data. Add migrations for friends/parties/matches; do not overload usernames, settings blobs or the existing save endpoint. For multiple API workers, replace in-memory rate counters with a shared limiter; current SQLite deployment targets a small single-node service with persistent disk.
