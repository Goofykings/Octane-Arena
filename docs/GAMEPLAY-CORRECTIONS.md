# Gameplay correction pass — September 27, 2026

This pass preserves the existing presentation, vehicle tuning, account system,
garage, cameras, and match flow. It corrects controller state, goal geometry and
training behavior.

## Root causes and corrections

| Problem | Cause | Correction |
| --- | --- | --- |
| Holding throttle before an inverted landing did not recover | Recovery listened for a new input edge | Read held throttle/jump when a short roof ray finds nearby static support. A 0.4 s recovery state and 0.8 s cooldown prevent per-tick retriggers. Unsupported cars do not self-right. |
| Driving off surfaces lost the unused aerial action | The second-action branch required a previous surface jump | Separate first-jump state from aerial-action consumption. Surface loss alone does not start a timer. |
| Landing after an un-timed aerial action could fail to restore it | Landing reset required an elapsed first-jump age even when no first jump occurred | Restore on supported landing when no first jump occurred, retaining the existing takeoff guard after a real jump. |
| Partial landings applied unwanted pitch | Falling below two wheel contacts enabled full aerial controls | Use explicit surface/transition/air states, contact debounce, and a short air-control blend. Project vehicle force axes onto the actual contact normal. |
| Upper goal corners protruded | The upper mouth sweep folded toward the field; an independent full-width lintel overlapped it | Replace that portion with a continuous rounded section and matching lintel edges. Weld shared vertices and discard degenerate triangles. Rendering and collision use the same mesh. |
| Free Play showed a countdown and match HUD | Training shared match kickoff and scoring policy | Central mode rules determine countdown, clock, scoreboard, opponent, training actions, infinite-boost eligibility, and goal reset. |
| Hidden opponent could collide in training | Disabling its body left collision participation in an existing pair | Explicitly disable collision groups in Free Play, and restore them for bot matches. Hidden scored balls receive the same treatment until reset. |

## Jump and contact state

`JumpState.used` means **performed a first surface jump**; `age` advances only
in that state. `held` retains the existing jump-hold extension. `second` records
consumption of the aerial jump/dodge. `available` is true when the aerial action
is unused and either no first jump occurred or `age <= 1.25 + held`.

| Event | Result |
| --- | --- |
| Jump edge with at least two supporting wheels | First jump; start timer and existing hold/sticky behavior |
| Lose surface contact without jumping | Keep first jump unused, age zero, aerial action available without a timeout |
| Jump edge airborne while available | Consume the aerial action; neutral input double-jumps, directional input dodges |
| First-jump window expires | Aerial action unavailable until supported landing |
| Supported landing | Restore jump state, with the existing 0.22 s guard after a real first jump |

Wheel rays and contact normals apply equally to floor, wall, ceiling, curves and
goal surfaces. Three or four contacts mean stable surface; one or two mean
transition. Any wheel contact suppresses input aerial torque. A single supporting
wheel receives reduced vehicle forces, without locking physical rotation.
Ordinary contact loss gets 25 ms debounce and a 40 ms aerial-control ramp. A real
jump bypasses that delay once airborne. Recovery suppresses competing aerial
input and does not consume the unused aerial action.

Steering, suspension, powerslide, collision impulses and existing angular
momentum remain active. Gravity can still pull a car away from the ceiling.
F3 reports contact state, whether a first jump occurred, and whether the aerial
action is available, consumed, or expired.

## Free Play controls

| Default | Bindable action | Behavior |
| --- | --- | --- |
| 1 | Free Play - Reset | Reset car/ball poses, linear/angular velocities, pads and effects immediately |
| 2 | Free Play - Take Possession | Place the ball ahead using the current car orientation; inherit car velocity |
| 3 | Free Play - Start Dribble | Place above the hood using body dimensions and ball radius; inherit car velocity |
| 4 | Free Play - Launch Ball | Add 6 m/s upward velocity per press, capped at 30 m/s upward and the existing overall ball speed limit |

These keyboard bindings use existing persistence and conflict warnings. They
operate only in active training, including after rebinding. The existing R reset
remains a match practice reset. Free Play starts immediately, hides the entire
scoreboard, and resets immediately after a goal without a score or celebration.
The existing infinite-boost preference still applies. No additional HUD text was
added.

## Files changed

- `src/car/car.ts`, `src/car/dodge.ts`: recovery, contact controls and jump state.
- `src/config/physics.ts`: recovery/contact timing and training launch limits.
- `src/arena/geometry.ts`: shared visible/collision goal surface repair.
- `src/game/modes.ts` (new), `src/game/match.ts`: centralized mode rules and kickoff/goal behavior.
- `src/game/training.ts` (new): isolated training ball actions.
- `src/physics/simulation.ts`: scored-ball collision participation.
- `shared/controls.ts`: training bindings, labels and action types.
- `src/main.ts`: input dispatch, reset effects, opponent/boost mode integration.
- `src/ui/ui.ts`: mode-controlled scoreboard visibility.
- `src/debug/debug.ts`: accurate state telemetry.
- `tests/gameplay-corrections.ts` (new), `package.json`: regression checks in `npm test`.
- `tests/browser-smoke.cjs`, `tests/visual-check.cjs`: keyboard/HUD/persistence checks and goal inspection views.
- `README.md`, `docs/PHYSICS.md`, this document: controls, state behavior and verification notes.
- Generated evidence: `docs/gameplay-corrections.json`, current calibration reports and browser screenshots, including `docs/goal-corners--1.png` and `docs/goal-corners-1.png`.

## Verification completed

- `npm run build`: TypeScript and production Vite bundle passed.
- `npm run build --prefix server` and `npm test --prefix server`: passed; both
  persistence/security suites remain green with the extended shared bindings.
- `npm test`: all four suites passed. The targeted correction suite now has
  **28 passing checks**, including four additional goal-corner trajectories
  rerun after their fixture correction.
- Both held-before and pressed-after roof recovery trigger once and restore
  wheel support. Unsupported aerial cars do not recover automatically.
- Floor/wall/ceiling first jumps expire at the inspected 1.592 s state; wall and
  ceiling drive-offs retain their aerial action with first-jump age zero.
- Single-wheel input comparison produces identical angular velocity with and
  without pitch input, while retaining physical rotation. Forward-held landing,
  surface acceleration, contact debounce and immediate jump air control pass.
- Existing acceleration, braking, boost, powerslide, jump, double jump, dodge,
  cancel, air roll, wall traversal, both camera modes, goal scoring, pads,
  goal explosions and collision checks remain green.
- Both shared goal meshes have no zero-area triangles or forward upper-mouth
  protrusions; maximum measured upper shared-edge normal change is **6.32°**.
  All four upper-mouth driving runs exit into the field with 38 supported ticks
  and peak angular speed below 0.395 rad/s. Existing rear-wall-to-ceiling exits
  and side-to-rear goal driving tests still pass.
- `tests/browser-smoke.cjs`: **35 passing assertions**, including saved training
  rebinding, instant Free Play/reset, hidden scoreboard, possession, dribble,
  chained launches, camera toggle and no browser runtime errors.
- `tests/visual-check.cjs`: live keyboard powerslide, wall camera framing, both
  roof models and ball rendering pass. Both goal-corner screenshots were
  inspected. The wall car occupies about **19.5%** of screen height.
- `tests/accounts-browser.cjs`: registration, profile/preset/settings persistence,
  independent sessions, save conflicts, logout/Guest isolation, browser-restart
  login and unavailable-backend Guest play pass.

Browser tests use isolated headless Chrome against the production build; they
do not change the user's browser profile or account database. Numeric evidence
is in `gameplay-corrections.json`; browser assertions are retained in the scripts.

## Public references and limits

Compared mechanics before implementation with
[RocketSim's car controller](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Car/Car.cpp)
and [RLBot's jumping physics](https://wiki.rlbot.org/v4/botmaking/jumping-physics/).
The useful distinctions are explicit first-jump timing, an unused aerial action
after non-jump surface loss, contact-dependent control and held recovery input.
The 1.25 s window retains the existing up-to-0.2 s hold extension. Our force
controller, recovery impulse, contact blend and original goal geometry remain
approximations; this is not a claim of exact Rocket League physics.

Geometry is a finite triangle mesh, not an analytic collision surface. Automated
tests cover specified trajectories and state transitions; subjective handling,
controller hardware and performance on other machines still need human testing.
Ranked/friend modes remain unavailable as before. The production bundle retains
Vite's size advisory; this pass does not reorganize asset loading.
