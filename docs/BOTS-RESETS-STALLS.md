# Bots, flip resets and stalls

Play > Against a Bot opens setup before starting a match. Arrow selectors choose
size and difficulty; Start Match loads a random valid arena. Both selectors fit
desktop/laptop layouts and stack on narrow windows. No map selector was added.

| Size | Blue | Orange |
| --- | --- | --- |
| 1v1 | Human | 1 bot |
| 2v2 | Human + 1 bot | 2 bots |
| 3v3 | Human + 2 bots | 3 bots |
| 1v2 | Human | 2 bots |
| 1v3 | Human | 3 bots |

The existing world/arena/ball and vehicle forces are reused. Local entity
configuration supports six unique IDs; renderer pools, stats, trio kickoffs and
replay wheel buffers now handle that count. The existing four-member party limit
is unchanged. Teammates use Blue paint and opponents Orange; identities never
depend on names. Local rematches don't rebuild the arena or change physics tuning.

## AI

`src/ai/perception.ts` caches read-only ball sphere sweeps through the existing
trajectory predictor; no extra physics worlds or neural training run. All bots
share the forecast. `decision.ts` scores intercept time, distance/turn, elevation,
shot opportunity, own-goal threat and (Advanced) opponent arrival. A jump/boost
lift estimate rejects unreachable high targets. Open goal targets avoid defenders.
Hysteresis retains roles/nearby targets instead of switching every physics tick.
`controller.ts` adapts the previous bot's steering, powerslide and actual first-
jump/release/dodge sequence into generic PlayerInput. It never sets a car's pose,
velocity, mass or acceleration.

| Difficulty | Decision rate | Forecast | Behavior |
| --- | --- | --- | --- |
| Beginner | 3 Hz | 0.8 s | Noisy simple chase/intercepts, delayed reactions, conservative boost, hops/obvious defense |
| Intermediate | 6 Hz | 1.8 s | Better shooting/approach angles, goal prediction, pads and basic aerials |
| Advanced | 10 Hz | 3 s | Opponent-race/shot value, shadow defense, rotation, boost priority, higher aerial opportunities and roof-carry attempts |

First/Second/Third roles rank actual active teammates (including the human) by
reach cost and change with position. Support stays behind play with lateral
spacing; it brakes when settled. Advanced shadows an unreachable threat instead
of charging, and neither Intermediate nor Advanced abandons an obvious goal
threat for boost. Current boost, player speed/turn/air-control limits and normal
physics constrain every bot. This is heuristic AI; final perceived difficulty
and aerial accuracy need human match feedback, not claims of expert-bot parity.

## Flip resets

All ball modes use the shared physical car-ball manifold. Wheel probes represent
static driveable surfaces, so an all-four-wheel-on-ball test would be unreliable.
Instead the reset requires airborne `supportKind=air`, a strongly downward local
contact normal (< -0.75), an actual bottom contact, and a central footprint within
75% of chassis half-width and 85% of axle length. Roof, side/nose and supported
car contacts cannot grant it. No collision impulse or ball restitution is changed.

Each contact grants once. The latch clears only after genuine geometric
separation (sphere-to-chassis gap > 0.04 m), then another valid contact can grant
again. `JumpState.resetAvailable` restores unused eligibility without rewinding
the original jump timer, triggering a flip, clearing angular velocity or reviving
first-jump hold forces. It survives indefinitely in air; use or ground contact
clears it. Existing ceiling/fall behavior and normal timed jumps remain intact.

The procedural white contact ring expands/fades in 0.3 seconds. It is additive,
unlit and visible over the contacting car/ball, without large particles. Snapshot
metadata carries sequence, age, origin and normal to remote views. A sparse
`flip-reset` replay event preserves the same effect without changing packed car
stride. No reset sound was added (the requested sound was optional).

## Stalls

Strong opposing yaw and **dedicated** directional roll, a newly pressed jump,
airborne availability and neutral forward/back dodge input select the stall.
Threshold is `P.jump.stallThreshold=0.85`; opposite inputs must engage within
`stallSimultaneousWindow=0.12` s. Generic air roll/powerslide cannot qualify.
Keyboard bindings and controller bumpers populate the same directional action
state. This uses the existing zero-direction dodge: eligibility is consumed,
horizontal impulse/flip torque cancel, and normal dodge vertical damping still
acts. Angular velocity is never assigned zero and world momentum persists.
Stalls now have **zero rotational flip duration** (`flipLeft=0`), with the linear
damping timer separate. Pitch/yaw/roll control and ordinary aerial damping resume
in the triggering physics tick; there is no normal flip/pitch lockout. The original
opposing chord is treated as neutral yaw/directional-roll intent while held.
Releasing/changing either side clears that latch immediately, allowing counter
inputs; pitch remains available even while the chord is held. No automatic angular
zero, extra upright force or short artificial rotation impulse is applied.
The independent [RocketSim car implementation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp)
also distinguishes zero-direction dodge torque from directional flips and permits
air control for stalls; our held-chord handling is an original input adaptation.
Normal front/back/side/diagonal flips and cancels retain their old selection.

Networking validates the additional optional directional action; clients cannot
submit reset eligibility. Version is 0.1.5 so older physics/input peers are rejected
by the existing version handshake. Both players must load the same updated build.

## Validation and tuning

- All 15 size/difficulty combinations: correct IDs/teams, kickoff, actual bot
  motion, speed/mass/boost parity, one challenger, role rotation, open-side aim,
  defensive boost priority, six-car stats/replay and actual decision-rate budgets.
- Both bodies: real bottom/roof/side/nose impacts, continuous-contact dedup,
  recontact, persistence beyond the old timer, ground clearing, ring fade,
  reset-to-stall, retained linear/angular momentum and input noise/delay rejection.
- Keyboard remaps/controller states and server-owned reset/stall input/snapshot
  and sparse replay metadata. Production Chrome covers every setup combination,
  responsive selectors, six visible cars/scoreboard/replay/skip, Free Play return,
  real acquisition/white effect and a late keyboard stall.
- Existing regression tests preserve camera, jump/flip/flip cancel, ramps,
  roof contacts, Heatseeker, training, Dribble, scoring and replay behavior.

Tune difficulty rates/horizons/target errors in `src/ai/perception.ts`, stall input
threshold/window in `src/config/physics.ts`, bottom tolerances in
`src/physics/car-ball.ts` and ring style in `src/effects/flip-reset.ts`.
The public [RocketSim car simulation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp)
was a behavioral reference for directionless dodges and reset state. These are
original adaptations to Octane Arena, not an exact proprietary RL implementation.
