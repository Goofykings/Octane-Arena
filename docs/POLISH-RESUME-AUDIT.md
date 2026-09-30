# Resumed update audit — September 28, 2026

Compared the original 30-item polish brief with the implementation, existing
verification artifacts, and fresh test runs before making changes.

## Status at resumption

- **Fully implemented:** requirements 1–28. Source inspection and fresh tests
  confirm the prior implementation remains working; no gameplay rewrite was needed.
- **Partially complete handoff:** requirements 29–30 had saved passing tests and
  a technical report, but the interrupted session lacked a final user checklist.
  Fresh verification and this checklist complete that handoff.
- **Not started:** no required feature found in this category.
- **Implemented but broken:** none found in the inspected code or fresh tests.
- Both local development services were stopped. Restarted the game and account
  API, then verified HTTP 200 and the API health response. Existing account data
  was preserved; account tests use a temporary database.

No application source changes were necessary during this continuation.

## Original requirement checklist

Each checked item is implemented and covered by the verification listed below.

- [x] **1. Powerslide audio:** rear contact and actual slip drive a continuous sound with smooth fades.
- [x] **2. Rear skid marks:** actual rear contact paths, pooled segments, configurable 0.75-second expiry.
- [x] **3. Goal planes:** subtle visual-only goal-mouth planes.
- [x] **4. Ball intersection:** shader band and analytic ring follow the actual scoring plane on both goals.
- [x] **5. Whole-ball scoring:** shared plane/radius calculation rejects center-only crossing.
- [x] **6. Countdown layering:** countdown above HUD and nametags; tags remain above the world.
- [x] **7. Garage rotation:** pointer ownership, outside release, cancel, lost capture, blur, tab changes and synthetic touch verified.
- [x] **8. Boost preview:** stationary car with continuous exhaust, particles and light.
- [x] **9. Goal explosion preview:** dedicated miniature scene; one sequence per click, clean replay.
- [x] **10. Responsive layout:** seven viewport sizes; paint and persistent Back controls do not overlap.
- [x] **11. Interface audit:** home, play, garage/customization/paint, settings, pause, post-game, accounts and both HUDs. Friends/party is not implemented and was conditional in the brief.
- [x] **12. Bot-match reset:** hidden and inactive; Free Play tools retained.
- [x] **13. Scorer names:** stable player IDs and current names; NOVA, TURBO and Quasar tested.
- [x] **14. Flip calibration:** physical orientation measured; existing reference-shaped torque/cap retained; visual pose and flip cancellation verified.
- [x] **15. Side recovery:** both sides recover under held throttle after dwell; wall driving does not falsely recover.
- [x] **16. Boosted wall driving:** supported surface-normal forces damp curved-entry rebound.
- [x] **17. Wall adhesion:** slow/fast/boosted entry, gravity slide, jump departure and ceiling approach verified.
- [x] **18. Kickoff boost:** configurable 33 for human and bot; Free Play exception retained.
- [x] **19. Boost pads:** small +12/4 seconds; large 100/10 seconds.
- [x] **20. Boost precision:** fractional state preserved through consumption and pad collection.
- [x] **21. Demolition eligibility:** actual forward-bumper collision, opposing teams, supersonic state and closing direction/speed checks.
- [x] **22. Supersonic state:** shared gameplay/visual state with hysteresis.
- [x] **23. Demolition effect:** short original flash/particles/audio; victim hidden.
- [x] **24. Respawn:** three-second delay, randomized safe team-side positions, restored physics and 33 boost.
- [x] **25. Demolition lifecycle:** explicit states, collision/control exclusion and preserved player identity.
- [x] **26. Bot support:** actual collisions tested with each car as attacker and victim.
- [x] **27. Goal interaction:** goal during demolition preserves attribution and normal kickoff flow.
- [x] **28. Debug telemetry:** slip, rear contact, surface state/normal, supersonic/demo state, respawn and flip/angular data.
- [x] **29. Feature verification:** physics, browser interaction, shader and layout checks rerun successfully.
- [x] **30. Regression/build/report:** existing gameplay/UI/account regressions and frontend/backend builds pass; detailed root causes and tuning remain in [POLISH-UPDATE.md](POLISH-UPDATE.md).

## Fresh verification

- `npm test`: 137 passing results across six suites, including 20 polish checks
  and 19 camera stability checks.
- Frontend and account-server production builds passed.
- Account-server tests: both suites passed. Their intentional failure-injection
  test logs an internal-error message; the suite still passes.
- `tests/polish-browser.cjs`: 98 passing checks.
- `tests/goal-visual.cjs`: 14 passing checks, including shader views and match HUD.
- `tests/browser-smoke.cjs`: 35 passing checks.
- `tests/accounts-browser.cjs`: six passing account persistence/isolation checks.
- Fresh screenshots inspected for mobile paint/footer, miniature goal preview
  and the ball's goal-plane shader band.
- Resolutions: 1920×1080, 2560×1440, 1366×768, 1280×720, 2560×1080,
  900×600 and 390×844.

Run logs: `.tools/resume-*.log`. Measured physics data:
`docs/polish-calibration.json` and `docs/camera-stability.json`.

## Remaining limits

No unfinished feature from this brief was identified. Hardware-controller feel
and real touchscreen interaction were not manually tested; browser touch tests
are synthetic. Mobile driving, multiplayer/ranked, and public hosting remain
future work, as before. Bots obey demolition rules but do not deliberately hunt
demolitions. Vite still reports its existing large-bundle advisory.

Local play: **http://127.0.0.1:5173/** while the development server is running.
If stopped, run `npm run dev` from the project root. The optional account API
starts with `npm start --prefix server` after its build.
