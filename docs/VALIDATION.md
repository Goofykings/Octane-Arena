# Validation — 2026-09-26 update

The production TypeScript/Vite build passes. `npm test` passes **69 checks**:
51 existing calibration checks plus 18 focused regressions in `tests/improvements.ts`.
The JS bundle is approximately 2.85 MB / 995 KB gzip, including embedded Rapier WASM.
The bundled Rajdhani Bold font adds 401 KB before compression. Vite reports its
large-chunk advisory; there are no compilation errors.

## Physics and camera

- Both original bodies use their own measured collider dimensions. Inverted roof
  meshes clear the floor by approximately 0.0107 m, with no collider inflation.
- Input-driven physical recovery returns both bodies to their wheels.
- Opposite pitch cancels forward flip torque without reversing it during the lock.
  Pitch control returns after the configured lock. A 4 m/s upward velocity becomes
  approximately 2.546 m/s after one damping/gravity tick, rather than being zeroed.
- Both mirrored goals support a floor → rear wall → inverted ceiling → field exit.
  Maximum body height is approximately 6.23 m, with 53–54 supported inverted ticks.
  Separate side-to-rear corner driving tests maintain wall contacts without escape.
- Repeated aerial rolls retain a zero-roll camera horizon. Ground steering reflects
  the same speed-dependent curvature curve as the controller.
- Supersonic ground ribbons disappear when wheel contacts disappear.
- Boost pickup applies immediately and emits a short feedback event. Explosion
  impulses leave boost and aerial input active.
- Boost drain remains 33.3/s: 33.4 boost remains after two seconds.
- The existing full five-minute simulation completes with repeated scoring and
  no escaped/nonfinite bodies. Existing throttle, braking, ball bounce, collision,
  jump, wall-driving, countdown and frame-rate independence checks still pass.

## Browser verification

`tests/browser-smoke.cjs` serves the production build under `/repository/` and
tests it in temporary headless Chrome using an existing Playwright installation.

- Home buttons align; Garage and Settings have identical dimensions/shape, and
  Play is larger. The locally bundled font loads from the repository subpath.
- Garage opens, duplicates a preset and exposes all seven separate categories.
  Body, both team paints, wheels, boost, decal and selected preset survive reload.
  The car preview rotates with pointer dragging.
- Settings and custom keybindings persist. Duplicate bindings are highlighted.
  Rebinding throttle removes the original throttle key and enables the new one.
- Low versus High changes actual drawing resolution and shadow rendering.
- Front wheels visibly steer. Boost activates its audio bus; that bus fades out
  after boost stops even while the car still moves.
- The hitbox overlay reads the real collider pose and extents. Bot names render
  as screen-facing labels with clamped text sizes.
- Pad pickup animates the pad and radial HUD without delaying the boost value.
- Countdown pauses correctly. A scored goal keeps the player's boost controls
  active. Free Play disables the bot, preserves the clock and honors infinite boost.
- No browser page/console errors occurred during the checked flows.

Current screenshots: [home](home.png), [modes](modes.png), [garage](garage.png),
[customization](garage-customize.png), [camera settings](settings-camera.png),
[audio settings](settings-audio.png), [gameplay](gameplay.png),
[goal explosion](goal-explosion.png), [small viewport](home-small.png).
Other screenshots in this directory are historical captures from earlier builds.

No physical gamepad was available. Hardware feel, subjective handling and sustained
performance across other devices still need human playtesting. The camera test
establishes numerical stability during repeated rolls, not every possible collision
trajectory. Goals use finite tessellation and original arcade surface adhesion.

Rapier's compat initialization wrapper emits its existing deprecation warning;
initialization and all physics checks pass. No dependency was modified to hide it.
There is no public deployment or online account/multiplayer backend in this workspace.
