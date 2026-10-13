# Continuation audit and polish

## Prior vehicle update

Already implemented and preserved: fresh-press recovery latch, braking near upright, actual/partial ceiling contact distinction with vertical-wall tolerance, finite lateral tire force, manifold-based edge/nose input, correct omega cross contact-arm velocity, coupled leading dodge strikes, and removal of only the Multiplayer update note. Saved npm test and both build results were successful, as were 21 server tests and the production keyboard/version UI test.

The previous run stopped before an extra final recheck could execute. This continuation completed aerial-coupling, resets/stalls and ball-quality rechecks before new changes; all passed. No previous systems were rebuilt.

## Requested tuning

- Grapple: targetApproachSpeed 14 m/s, contactApproachSpeed 10 m/s, pullGain 1.5/s. Existing 38 m/s^2 cap, 6/s relative damping, 0.12 s lead, grounded lift and tire unloading remain. Native car-ball contact or lifecycle reset is still the only ending rule. Deterministic comparison with the prior 3 m/s / 2.5/s controller: ball impact 5.35 -> 11.61 m/s, cruise about 13-14 m/s, contact around 0.99 s. Moving/high-closing/side approaches remain in the Rumble regressions.
- Tires: finite lateral cap 28 -> 34 m/s^2. Small-slip slope 24/s and all powerslide coefficients unchanged. Off-angle touchdown still preserves momentum and settles progressively.
- Recovery: target roll cap 3.8 -> 4.8 rad/s; bounded acceleration 36 -> 44 rad/s^2; response 12 -> 15/s; braking 10 -> 16 rad/s^2; maximum duration 1.8 -> 1.35 s. Input gating, no retrigger while held and no quaternion snapping remain. The flat-floor test settles around 0.78 s without a full-turn overshoot.
- Heatseeker: active homing applies partial gravity compensation (0.65) through its existing bounded impulse. Target, steering rates, speed tiers, touch rules and collision spin remain. The predictor uses the same Heatseeker.steer function, so stats and bots see the updated trajectory. A 1.67 s flight fixture dips to about 2.83 m instead of 1.14 m, with identical target speed; world gravity/Soccar remain unchanged.

## Visuals

src/render/arena-markings.ts builds one original white hex tile and maps existing shell vertices into unfolded ceiling X/Z coordinates. The upper wall-to-ceiling fillet has exactly matching UVs at its roof edge. A matching inward-facing ceiling pattern uses the existing inner ceiling outline. Distance fading/mipmaps reduce distant clutter. No colliders, arena dimensions, goal meshes or physics-shell vertices change.

All four soccer arena styles receive the same 0.65 m painted center ring (blue +Z, orange -Z halves) and 9 m-radius goal semicircles. Existing base turf, center line/dot, circuit field art and boost locations stay. Paint sits below ball indicators and uses a lower transparent render order. Free Play keeps neutral goals while the decorative floor painting stays colored. Open Extra Mode courses do not gain enclosing soccer walls.

Rings uses a 0.35 m WORLD tube radius (0.7 m band diameter). Only the opening diameter changes. One instanced torus shader cancels tube scaling; native ring vertices use the identical deformation. Openings, centers, turns, colors, height-only death and camera obstacle exclusions are preserved. The visual/collision tube stays consistent and all periodic seams remain welded.

Supersonic streaks move 50% faster, are about 37% wider/longer, and have slightly higher opacity. Existing quality, active/air-only gates, central clear area and ball mask stay intact. No extra particles/render targets.

## Party flow

Match Setup has one Continue action. The existing stage=teams message chooses and broadcasts one preview matchArenaId; clients prepare that arena using the existing loading/shader workflow BEFORE displaying team selection. The final host Start Match stays disabled until every member has selected a team AND the chosen format's team slots are filled. Controller defaults select Continue, then team choice, then the enabled Start Match. Launch retains the preview arena rather than randomly changing it again.

End/disconnect/return prepares a next arena for the teams stage, preventing a hidden/unloadable team menu. Rematch retains its existing host-only behavior and fresh match state. Shared TypeScript schemas/stages and the PeerJS/data-channel gameplay architecture remain intact.

## Verification

- tests/continuation-polish.ts: prior/current grapple comparison, constant approach, tighter finite grip, faster non-overshooting recovery, exact constant tube thickness/opening, wall/ceiling UV continuity and unchanged shell, homing comparison and stronger speed-effect dimensions.
- tests/rumble-update.ts, vehicle-tuning.ts and rings.ts/rings-flight.ts retain physical contact/termination, lateral approaches, rigid/contact recovery and all ring collision/camera checks.
- tests/continuation-visual-browser.cjs: production Chrome renders all four maps, close wall/ceiling curve and Rings without shader errors; checks color/width and unchanged collider counts. High-quality supersonic canvas has visible wider animated strokes and an empty center. Images remain ignored under .tools.
- tests/continuation-party-browser.cjs: two isolated Chrome sessions use real PeerJS Cloud and bidirectional channels; Continue and Start use mocked Gamepad API navigation. Both clients load the same arena, capacity/team state synchronizes, and disconnect returns to a usable disabled-start team screen. This is not a physical two-device/NAT claim.
- The camera-rendering test's canvas stub gained the normal drawing methods used by the new procedural texture. Assertions were not skipped. Old Rings proportional-thickness assertions now validate constant world units and still query actual inner/outer normals and high-speed car impacts.

Human feel tuning remains useful for grapple contact speed, grip cap, recovery braking and homing lift. These are original Octane Arena tuning values, not exact Rocket League constants. No debug gameplay code, generated images or external credentials were committed.
