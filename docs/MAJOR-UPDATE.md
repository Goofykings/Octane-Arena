# Major update verification — September 27, 2026

The starting repository was audited before implementation. Working garage/settings,
bot/free-play, match timing, wall/goal geometry, jump/dodge and effects systems were
retained. The incomplete major-update requirements and the four added fixes are
now implemented. Public hosting is pending the owner's choice of URLs.

## Gameplay and presentation

- Configurable handbrake engagement/release and slip-dependent lateral/longitudinal
  traction, with airborne prehold for sideways landings and wall contact support.
  Public RocketSim/RLBot targets and measured limitations are in [PHYSICS.md](PHYSICS.md).
- Original 80-panel sphere with nine pulsing luminous details. Both collider and
  outer visual radius are .9125 m, diameter 1.825 m. Calmer existing ball behavior
  is retained. Ion/Vector visual dimensions and their ratios are documented.
- Glass/roof separation removes the coplanar surface flicker on both car bodies.
- Camera obstruction handling shifts inward and along walls and keeps the car in
  frame. In the rendered test, separation is 5.22 m and the car occupies 6.8% of
  screen width / 19.4% of height. Zero-roll horizon behavior is preserved.
- Home buttons/profile are approximately half their previous dimensions. Original
  font, geometric controls and quick transitions carry through the garage,
  settings, account screens, pause/results and HUD. Compact team-colored scoreboard
  flashes changed scores. Pause exposes Resume, Settings, Controls, Reset and Leave.
- Slider readouts become inputs only on activation; Enter/blur commit, Escape
  cancels, invalid/empty input leaves the old value, and numbers clamp to bounds.

## Accounts

The independent TypeScript/Fastify API uses SQLite WAL with normalized account,
profile, owned-item, preset, preference, rating and session tables. Shared schemas
validate the client and server. Username identity is a UUID; names are unique
case-insensitively. Argon2id hashes and digest-only opaque sessions protect
credentials. The server owns XP, levels, inventory and future ratings.

The profile button opens registration/login and, once signed in, original avatar
and title galleries. Debounced serialized saves and revision checks synchronize
presets, colors, cosmetics, settings and profile choices between browsers. Guest
saves remain independent. UI feedback covers invalid input, duplicate names, wrong
credentials, disconnected hosting, offline API and save conflicts. Cloud reload
requires an explicit choice before discarding unsaved edits.

See [server setup and backup/restore](../server/README.md) and the
[security review](ACCOUNT-SECURITY.md).

## Checks run

| Check                                   | Result                                                                                                                                                                                                                                              |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend `npm run build`                | Passed strict TypeScript and Vite production bundle                                                                                                                                                                                                 |
| Backend `npm run build --prefix server` | Passed TypeScript compilation                                                                                                                                                                                                                       |
| `npm test`                              | Passed 51 original calibration checks, 18 earlier improvement checks, and new handling/ball/camera assertions                                                                                                                                       |
| `npm test --prefix server`              | Passed both account/security suites with registration, validation, duplicates, case handling, wrong credentials, sessions, authority, conflict, restart, expiry, backups, malformed requests, CORS/CSRF, rate limits and database failure           |
| `tests/browser-smoke.cjs`               | Passed production build under `/repository/`, fonts/assets, compact navigation, presets, settings, numeric clamping, bindings, graphics, countdown/pause/controls, steering, audio, boost, hitboxes, goals and free play; no browser runtime errors |
| `tests/accounts-browser.cjs`            | Passed real fetch/cookies with registration, saves/reload, independent session login, stale-save conflict/reload, logout restoring Guest, full browser restart/login, and playing while backend unavailable                                         |
| `tests/visual-check.cjs`                | Passed live keyboard powerslide engagement/release and rendered wall framing; captured and inspected new ball, both roofs, wall view and UI                                                                                                         |

Browser tests use temporary independent Chrome profiles and a local API/database;
they do not use personal browser sessions. Set `PLAYWRIGHT_MODULE` to an installed
Playwright package. The default Chrome path is Windows; account/visual scripts
also accept `CHROME_PATH`. Build both projects before running those scripts.
Screenshots are alongside this document; numerical base results are in
`calibration.json` and `major-calibration.json`.

## Deliberately unfinished / limits

No public backend or Pages address has been selected, so no deployment has been
performed. Configure HTTPS, exact allowed origins, persistent storage and scheduled
off-machine backups before public use. Cross-site cookies need verification in
the chosen browsers/hosting configuration; blocked cookies produce visible feedback.

Ranked matchmaking, friends, parties, authoritative WebSockets and match XP awards
remain future work. Ratings/XP/level/unlock ownership fields are real persisted
foundations, not active competitive systems. No password recovery or email system
exists yet. Offline unsaved account edits are kept in memory, not a durable queue.

The controller is an original approximation calibrated to public observations.
Scripted input and numerical tests do not replace human controller-feel testing.
The production bundle remains roughly 1 MB compressed, chiefly Three.js/Rapier;
Vite reports its existing large-chunk notice. Node 24 reports SQLite's experimental
API notice; Rapier's current compat loader emits its pre-existing init warning.
