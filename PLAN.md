# Octane Arena implementation plan

Build an original client-side car-soccer game using TypeScript strict mode, Vite,
Three.js and Rapier. Reference screenshots inform framing and readability only;
no reference image or proprietary asset is distributed with the game.

1. Establish tooling, documented physics configuration, 120 Hz loop and headless calibration runner.
2. Implement custom four-ray suspension, traction, speed-dependent throttle/steering and curved arena. Measure acceleration, braking, turning and wall transitions.
3. Implement tick-driven jump/dodge state, air control and boost. Measure jump heights, limits and consumption.
4. Add CCD ball, calibrated supplemental strikes and repeatable impact/bounce tests.
5. Add interpolated rendering, chase/ball cameras, original procedural arena/car/ball, input, audio and effects.
6. Add boost pads, input-driven opponent, scoring, kickoffs, pause and five-minute match flow.
7. Expose F3 telemetry and collision graphics; verify production build, subdirectory paths, deployment workflow and document results and approximations.

Validation must exercise the actual Rapier simulation. Gameplay feel still needs human controller playtesting; automated measurements do not establish parity with any other game.

## Completion record

- All seven implementation stages completed for the first playable build.
- 69 calibration/regression checks pass, including a full five-minute simulation with repeated goals, match completion and no escaped bodies.
- Strict TypeScript check and Vite production build pass.
- Chrome smoke test passes against `dist` served under `/repository/`, covering PLAY, drive, boost, jump inputs, camera toggle, pause/resume, reset, home and controls; no runtime console errors.
- Captured and inspected home/gameplay screenshots in `docs/`.
- GitHub Pages workflow and relative assets are ready; actual deployment requires a GitHub repository.
- Physical gamepad feel, broad device performance, and exact physics parity remain unverified. Goal tunnel bevels, exact dodge dynamics and supplemental strike response remain approximate; see `docs/PHYSICS.md`.

## Follow-up: Octane Arena

- Minimal title screen, detailed PLAY button, three-mode picker (bot playable; ranked/friend reserved for later).
- Persistent settings, available from home and pause (expanded below).
- Heavier, lower-rebound ball with reduced supplemental strike gain; measured speed reductions recorded in physics notes.
- Physical opponent bumps with brief traction recovery.
- Animated twin boost jets and rear-wheel supersonic ribbons.
- Solid, contour-marked lower ramps and original Lumen District skyline.
- Three-second kickoff before every point; goal shockwave, particle burst and physical car launch during celebration.

## Follow-up: physics, garage and interface

- Researched dodge state timing, pitch lock/cancel and multiplicative vertical damping;
  surface-supported recovery and roof/collider alignment for two original bodies.
- Stable aerial camera horizon, physical goal bowls with mirrored rear/ceiling and
  sidewall trajectory checks, live controls during goal explosions.
- Left navigation, notched mode cards, quick transitions, bundled licensed Rajdhani
  Bold typography and local Guest profile.
- Rotatable garage, local duplicated presets, seven separate cosmetic categories,
  curated blue/orange paint, Ion/Vector bodies with distinct physical dimensions.
- Five settings tabs; real camera/graphics/audio controls, keyboard rebinding with
  conflict warnings, free-play boost and actual-collider visualization.
- Ground-contact-only supersonic ribbons, boost-state audio, pickup feedback,
  radial boost gauge, speed-dependent wheel steering and curated bot nametags.
- Production build, 69 physics checks and Chrome interactions pass. See current
  screenshots and practical limits in `docs/VALIDATION.md`.

## Follow-up: major update completed

Repository audit and final requirement status: `docs/UPDATE-AUDIT.md`.
Interpolated handbrake, documented ball dimensions/original panel art, roof and
wall-camera fixes, typed slider values, compact home UI and expanded pause menu
are implemented. A separate TypeScript API and SQLite database provide real
accounts, secure sessions, cloud presets/preferences and profile galleries.
Both builds, physics suites, API security tests and three Chrome test scripts
pass. See `docs/MAJOR-UPDATE.md` and `server/README.md` for verification, hosting,
backups and intentionally future multiplayer/progression features.
