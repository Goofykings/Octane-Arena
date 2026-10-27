# Gameplay feel tuning

Start in **src/config/physics.ts**. Gameplay values live in its `P` object and
follow Rocket League's RocketSim constants (see [PHYSICS.md](PHYSICS.md)); most
are commented "RL". While `npm run dev` is running, save an edit, reload, and
compare in Free Play. Change one value at a time. F3 shows physics and camera
telemetry. Run `npm test` and `npm run build` when you settle on a change.

Distances are metres, speeds m/s, accelerations m/s², rotation rad/s and timers
seconds. `UU = 0.01` converts Rocket League units to metres. Calibration tests
enforce the RL references; review them when you deliberately move a target.

| Feel | Value in `P` | What it does |
| --- | --- | --- |
| Top speeds | `car.throttleMaxSpeed`, `maxSpeed`, `sonic` | 14.1 / 23 / 22 m/s throttle, boost and supersonic |
| Engine and braking | `tire.engine`, `tire.brake`, `car.coast`, `tire.stopSpeed` | Per-wheel drive/brake (four wheels give the RL curves), coasting |
| Turning | `STEER_ANGLE_CURVE`, `LATERAL_FRICTION_CURVE` below `P`; `tire.lateral` | Speed-dependent steering angle; lateral tire impulse |
| Powerslide | `powerslide.rise`, `fall`, `lateralFactor`, `longitudinal*` | Handbrake engage/release rates and sliding friction |
| Suspension | `suspension.stiffness`, `compressionDamping`, `relaxationDamping`, `travel` | Ride, landing absorption and wall-transition compression |
| Bump stop | `suspension.subtraction`, `pushbackErp`, `splitPushback` | Hard stop depth and strength; split mode makes landings deader but bleeds speed on transitions |
| Contact states | `car.groundedWheels`, `loadedTravel`, `coherentNormal`, `suspension.minContactDot` | When a wheel counts as touching and when the car is GROUNDED |
| Partial contact | `car.partialSticky`, `partialGrip`, `tire.partialEngine` | Sticky/grip/drive with 1–2 wheels (sticky 0 keeps cars from clinging on two wheels) |
| Wall/ceiling stick | `sticky.base`, `sticky.driving` | 0.5 g + (1 − \|n.y\|) g while driving; a flat ceiling releases |
| Jump | `jump.impulse`, `holdAcceleration`, `holdTime`, `minTime`, `window` | Pop, held jump, minimum jump and second-jump/dodge window |
| Dodge | `jump.dodgeImpulse`, `flipPitchTorque`, `flipRollTorque`, `flipTime`, `pitchLockExtra` | Flip impulse, spin-up and lock |
| Air control | `car.airPitch`, `airYaw`, `airRoll`, `air*Damping`, `maxAngular` | RL per-axis torque, damping and the 5.5 rad/s cap |
| Landing assist | `car.landingDamping`, `landingDampingTime`, `landingAlignment`, `landingFirstContact` | One-way anti-tilt damping after a clean wheels-down touchdown only |
| Chassis guard | `car.contactSkin`, `maxContactCorrection` | Hull corner speculative contact and bounded positional correction |
| Ball | `ball.radius`, `mass`, `restitution`, `friction`, `drag`, `maxSpeed`, `maxAngular` | Bounce, roll and speed limits |
| Car-ball hits | `hit.friction`, `restitution`, `extraZScale`, `extraForwardScale`, `extraMinRelative`; `EXTRA_HIT_CURVE` | Rigid contact material and RL's extra impulse; the minimum keeps resting dribbles calm |
| Boost | `car.boostGround`, `boostAir`, `boostUse`, `boostMinTime` | Acceleration and use (33.3 per second) |
| Gravity | `gravity` = 6.5 | Ball, jumps, aerials and wall forces together |
| Supersonic | `supersonic.start`, `maintain`, `grace` | Entry, maintenance speed and hysteresis |
| Demolitions | `demolition.*` | Respawn, boost and eligibility |
| Kickoff/explosion | `match.*` | Starting boost, celebration and blast impulse |

Camera feel is in **Settings → Camera** (FOV, Distance, Height, Angle, Stiffness,
Swivel, Transition, Shake; RL defaults 110/270/100/−3/0.40/5.0/1.3/Off). Rig
internals (follow rates, view-rate limits, surface-frame thresholds) are
`CAMERA_RIG` in `src/camera/camera.ts`; see [CAMERA-RIG.md](CAMERA-RIG.md).

Other locations:

- **shared/catalog.ts**: per-body hitbox dimensions and wheel mounts.
- **src/game/pads.ts**: boost pad amounts and respawn timing.
- **src/game/modes.ts**: bot/Free Play rules.
- **src/config/rumble.ts**: Rumble power impulses and timers ([RUMBLE.md](RUMBLE.md)).
- **src/render/models.ts**: body and wheel visuals, not driving physics.

Leave `dt` (120 Hz) and `maxSteps` alone: they control simulation timing and
the RL constants assume 120 Hz.

F3 shows AIRBORNE / PARTIAL_CONTACT / GROUNDED, per-wheel FL/FR/RL/RR
compression, force and contact, FLOOR/WALL/CEILING, landing assist, COM, car-ball
contact (closing speed, extra impulse) and the camera rig state.
