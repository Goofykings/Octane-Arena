# Polish and game feel

This pass extends the existing game. It does not replace the menus, camera, networking, arena geometry, car models or established effects.

## Shared interface language

`src/ui/polish.css` centralizes panel radius, borders, spacing, type sizes, shadows, selected glow, disabled appearance, focus treatment, motion timing and hover scale. Existing cut corners, card art, fonts and responsive grids remain. These rules cover Home, Play, bot setup, party/team setup, Mutators, Garage/presets, Settings, Training/Extra Modes, spectator controls, scoreboard, results, replays and feedback.

`src/ui/motion.ts` supplies shared reveals and reversible screen transitions: 220 ms entry, 150 ms exit, 120 ms click response. Exiting panels become inert immediately; gameplay does not wait for visual completion. Superseded reveals/transitions cancel cleanly. Closed native dialogs are excluded from focus/navigation and clicks even while the browser finishes their exit fade. Reduced-motion preferences remove motion and delays.

`src/ui/interface-feedback.ts` delegates feedback across dynamic controls rather than binding an audio player to every button. It coalesces duplicate same-frame/rapid activations, uses the same path for controller-generated clicks, animates changing selector values and slider interaction, and announces genuine UI errors. It has an explicit listener/observer cleanup path.

## Original UI audio

Six synthesized cues: quiet hover, click, back, confirm/start, error and navigation/tab tick. `src/audio/ui-audio.ts` precomputes the six small PCM buffers once when the existing audio context unlocks. Eight reusable gain voices permit rapid overlapping navigation. Finished source nodes disconnect, cues are rate limited, and a saturated pool drops a quiet cue instead of truncating a waveform. No downloads, decoding, per-button Audio objects or copied audio assets are used.

The existing master and UI volume buses/settings apply, including mute. No new audio setting or external package is needed.

## Menu and gameplay feedback

- A nonnegative render-frame delta prevents startup/loader clock resets from extrapolating the Home camera out of view. Existing Home car/camera drift is preserved, with a faint compositor-only menu light wash. Low graphics/reduced motion disables the added ambient animation.
- The existing preloader now presents a translucent arena-backed loading layer and shared entry/exit motion. Readiness, generation cancellation, countdown timing and control handoff remain separate from visual fades.
- Garage keeps its scene/camera. Boost/explosion-only selection reuses the displayed car instead of disposing and rebuilding it. Geometry changes receive a short scale/rotation reveal; toppers settle down a few centimetres visually. Existing particle boost ramp-up/release and goal-explosion demonstrations remain.
- Settings/Mutators values, selected tabs, arrows and focus receive common feedback. Party setup initially focuses Gamemode; a disabled Start has an explanatory title.
- Scoreboard/player rows reveal once on opening, without restarting animation on every live-stat update. Existing award timing and MVP ownership are preserved; the badge gains a small entry animation.
- Spectator target captions reveal on changes. Replay panels and results share panel tokens; existing camera transitions and skippable replay rules remain.
- A single pooled, faint surface ripple marks a hard wheel landing. It has no physics effect, no body/wheel displacement and is disabled at low quality. Existing boost, supersonic, hit-particle, countdown/audio and goal-to-replay effects were retained where already working.

## Landing diagnosis and correction

The current car has a rigid wheel/body structure, not a spring suspension. Its unilateral normal constraints prevent inward penetration but do not provide compression/relaxation energy absorption. Ordered contact impulses can leave residual roll/pitch motion after an otherwise good touchdown. Existing orientation damping is for stable driving and curves; the deliberately free partial-contact/aerial path should not be globally damped to hide this.

The wheel support solve now iterates the complete support set in alternating order for near-aligned multi-wheel floor contact. Partial contacts and ramps retain their previous single-pass wheel path; the successful high-speed curve controller remains intact.

`src/car/landing.ts` adds a short, contact-dependent angular energy-absorption window. It arms after real airborne time, and requires at least three close physical wheel contacts, floor normals above 0.995 Y, and wheel alignment above 0.985. It ignores active jump separation, flips, recovery and car-impact grace. At the current setting it damps only roll/pitch perpendicular to the actual floor normal for at most 0.24 seconds. Yaw, tangential velocity and orientation are not directly changed. Loss of valid support removes the damping immediately.

There is no generic upright torque or pose target. One/two-wheel edges, nose, roof, wall, ceiling and airborne poses cannot activate the extra damping. Bad landings can still roll onto the roof. Existing throttle-requested roof recovery remains separate.

Tuning in `src/config/physics.ts`:

- `car.landingDamping`: 18 / second additional supported landing absorption.
- `car.landingDampingTime`: 0.24 seconds maximum window.

Center of mass, inertia tensor, mass, chassis restitution/friction, ball physics, aerial torque/damping, flip/stall constants, high-speed tire grip and powerslide tuning were not changed. No suspension springs/travel were added. RocketSim's [car control implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp) was consulted as high-level context for separating air control, contact and damping; its constants were not copied.

## Verification and practical limits

Final validation (2026-10-16): full `npm test`, frontend production build, server build and all 25 server tests passed. Both production-browser traversals passed with no page errors, using mouse and simulated Gamepad API input. Screenshots were inspected after transitions settled. Focused checks also passed 78 tilted landing cases, 144 ramp/Ball Cam runs, roof/stall/reset mechanics and live-stat/rendering regressions. The production build retains its existing large-bundle warning.

`tests/game-feel.ts` checks real supported landing energy against the same model with absorption disabled, prompt settling, physically free bad/roof/edge states, identical free-flight roll/flip/stall trajectories, finite/reused landing visuals, rapid/reduced-motion screen reversal, distinct original sound buffers and fixed voice budgets. Existing tilted landing/ramp, roof, high-speed grip, recovery, physics, mode, stats and networking suites remain enabled.

`tests/game-feel-browser.cjs` traverses the built game with mouse input, including settings tabs, Garage cosmetic previews, Mutators, feedback, gameplay/scoreboard/replay/results and real party/team setup. It checks duplicate cue suppression, car-model reuse, disabled Start explanation, reduced motion and browser errors. `tests/controller-menu-browser.cjs` traverses the existing controller paths, including Mutators; simulated button taps release inside the renderer so headless protocol latency cannot accidentally hold D-pad through the repeat interval. The party traversal checks all six supported player formats, and visual captures wait for actual rendered scoreboard/replay/results panels.

Screenshots/logs are ignored `.tools/` artifacts. Controller coverage uses the browser Gamepad API fixture, not physical hardware. Two physical multiplayer devices and subjective audio balance still need human playtesting.

A separately invoked legacy `test:edge-support` check expects aerial control to be disabled on tire-edge contact and unconditional four-wheel settling while steering. Those assumptions predate the existing free-contact/controller changes. It is outside `npm test`; its file/contract is left unchanged. The new tests explicitly verify that landing absorption does not suppress partial-contact dynamics.

The largest opportunities for a later art pass are richer mode-card illustrations, Garage lighting/backdrops and arena-specific loading artwork. Those assets were not replaced in this focused polish pass.
