# Crossbar rebounds and flip cancel

The previous crossbar was a capsule protruding toward the field. Its upper
quadrant supplied upward collision normals before the vertical goal fascia
could act as the main contact. There was no custom crossbar rebound or upward
velocity correction to remove.

The bar is now a solid rounded rectangular beam: 0.44 m tall/deep, with a
0.04 m bevel, set just behind the goal fascia. Rendering and collision use the
same dimensions and placement. Posts remain rounded capsules. The goal mouth,
ball spin/friction/restitution, CCD, scoring, and arena shell remain unchanged.
Front shots primarily rebound horizontally; lower-edge/underside hits can
deflect downward; top hits from above can legitimately rebound upward.
Rebounds come entirely from Rapier contacts, without direction overrides.

Flip cancel already used angular acceleration rather than an explicit
zero-angular-velocity assignment. The abrupt feel came from pitch braking at
12/s plus ordinary aerial damping. Cancel braking is now 4/s. Opposite pitch
reduces the active pitch flip torque, then decelerates existing pitch momentum;
roll torque is independent. Aerial torque is evaluated after updating jump
ownership, so the current tick's flip/pitch lock applies immediately. The
standard angular integration still updates the rigid body once per tick.
There is no cancel-specific velocity deletion or orientation assignment.

All timing/torque settings are in `src/config/physics.ts`:

| Setting | Value |
| --- | --- |
| Active flip torque time | 0.65 s |
| Additional pitch lock | 0.30 s |
| Aerial pitch return blend | 0.12 s |
| Pitch flip acceleration | 224 rad/s² |
| Roll flip acceleration | 260 rad/s² |
| Flip angular speed cap | 7 rad/s |
| Cancel pitch damping | 4/s |
| Ordinary aerial damping | 1.7/s |
| Vertical damping interval | 0.15–0.21 s |
| Vertical damping fraction at 120 Hz | 0.35 |

For the immediate-cancel fixture, forward pitch speed continues at about
1.78 rad/s on the first cancel tick, about 0.74 rad/s after 0.15 s, and later
reverses after pitch lock permits aerial control. Delayed cancellation retains
more accumulated momentum. F3 displays flip age/remaining time, pitch lock,
pitch input/angular speed, active pitch acceleration, and cancel braking.

`tests/frame-flip-quality.ts` checks both goals at 8/25/60 m/s, varied heights
and approach angles, lower-edge sweeps, underside/top impacts, spin, restitution,
and total energy. Top geometry is isolated for approaches that would otherwise
start inside the solid fascia. Flip tests cover normal front/back/side/diagonal
flips, immediate/delayed mirrored cancellation, continuous angular momentum,
pitch lock/return, and unchanged dodge impulse. Existing vertical damping,
second-jump, air-control, scoring, ramp, landing, and containment tests remain
in the full suite.

The browser smoke harness waits for finite opening animations to finish before
measuring button bounds; this changes verification only.

Behavioral references:

- [RocketSim air torque and flip cancellation](https://github.com/ZealanL/RocketSim/blob/main/src/Sim/Car/Car.cpp)
- [RocketSim timing and torque constants](https://github.com/ZealanL/RocketSim/blob/main/src/RLConst.h)
- [RLBot goal dimensions](https://github.com/RLBot/flatbuffers-schema/blob/main/schema/gamedata.fbs)

The 6.43 m goal height retains the documented 643 uu proportion at this game's
scale. The beam is original geometry; it does not copy Rocket League assets.

Verification passed: 240 frame-impact cases, eight flip/cancel cases, the full
regression suite (including 144 ramp cases and 78 tilted landings), six server
tests, both production builds, and the browser smoke test with no runtime
errors. The old upper-crossbar regression expectation was intentionally changed
from an upward angled bounce to a primarily horizontal front rebound.
