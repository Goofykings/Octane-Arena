# Gameplay feel tuning

Start in **src/config/physics.ts**. Most gameplay values live in its `P` object.
While `npm run dev` is running, save your edits, reload the browser, and enter
Free Play for a clean comparison. Change one value at a time. F3 displays physics
telemetry. Run `npm test` and `npm run build` when you settle on a change.

Distances are metres, speeds metres/second, acceleration metres/second squared,
rotation radians/second, and timers seconds. `UU = 0.01` converts reference game
units to metres. Some calibration tests intentionally enforce a particular feel;
review measured results when deliberately changing their targets.

| Feel                     | Value in `P`                                                                                                        | What to change                                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flip rotation speed      | `jump.flipMaxAngular` = **7**                                                                                       | Higher makes phywcal flips rotate faster. Previous value was 5.5; 7 is about 27% faster at the cap.                                                                                               |
| Flip spin-up             | `jump.flipPitchTorque` = 224; `flipRollTorque` = 260                                                                | Higher reaches the angular cap sooner; torque alone cannot exceed the cap.                                                                                                                        |
| Flip torque duration     | `jump.flipTime` = 0.65                                                                                              | How long flip torque applies, not the time for a full rotation. Longer also rotates farther.                                                                                                      |
| Flip cancellation        | `jump.cancelDamping` = 12                                                                                           | Higher brakes cancelled pitch rotation harder.                                                                                                                                                    |
| Forward/side dodge shove | `jump.dodgeImpulse` = 5                                                                                             | Changes translation, not rotation.                                                                                                                                                                |
| Aerial rotation          | `car.airPitch`, `airYaw`, `airRoll`, `maxAngular`                                                                   | Acceleration by axis and ordinary angular cap. The flip has its own cap.                                                                                                                          |
| Aerial braking           | `car.airDamping`                                                                                                    | Higher slows free rotation more quickly.                                                                                                                                                          |
| Jump height              | `jump.impulse`, `holdAcceleration`, `holdTime`                                                                      | Initial pop, held-jump force and maximum hold duration.                                                                                                                                           |
| Second-jump availability | `jump.window`                                                                                                       | Time window after the first jump.                                                                                                                                                                 |
| Drift rotation           | `powerslide.rotationScale` = **0.65**                                                                               | Lower turns more gently. 1 restores the pre-reduction setting.                                                                                                                                    |
| Drift response           | `powerslide.yawResponse`, `rise`, `fall`                                                                            | Turn response and how quickly handbrake engages/releases.                                                                                                                                         |
| Drift grip               | `powerslide.lateralAtForward`, `lateralAtSideways`, `slipGripFalloff`                                               | Lateral grip as the car slides sideways.                                                                                                                                                          |
| Normal turning           | `car.steeringResponse`; `curvature()` below `P`                                                                     | Response speed versus desired turning radius at each driving speed. Higher curvature means tighter turning.                                                                                       |
| Engine acceleration      | `throttleAcceleration()` below `P`                                                                                  | Speed/acceleration pairs for the engine curve; `car.throttleMaxSpeed` = 14.45 sets the unboosted limit.                                                                                           |
| Maximum driving speed    | `car.maxSpeed` = 23.2                                                                                               | Linear speed cap. Consider supersonic thresholds if changing it.                                                                                                                                  |
| Braking/coasting         | `car.brake`, `car.coast`                                                                                            | Higher sheds speed faster.                                                                                                                                                                        |
| Boost strength/use       | `car.boostGround`, `boostAir`, `boostUse`                                                                           | Acceleration on surfaces/in air and boost consumed per second.                                                                                                                                    |
| Rigid contact            | `car.contactReach`, `rayLength`, `contactSkin`, `maxContactCorrection`                                              | Detection reach, collision clearance and bounded correction. There are no suspension springs.                                                                                                     |
| Wall driving             | `car.adhesion`, `wallDriveSpeed`, `wallIdleGrip`, `ceilingAdhesionEnd`, `align`, `alignDamping`                     | Stable wheel support only; moving-wall grip and progressively reduced overhead adhesion.                                                                                                          |
| Recovery                 | `car.recoveryMaxSpeed` = 5.6, `recoveryAcceleration` = 58, `recoveryBraking` = 24; `edgeDriveGrip`, `noseInputGrip` | Roof assist starts immediately with held throttle once the inverted roof is supported, slows near upright and does not retrigger after settling. Edge/nose forces act at real contact points.     |
| Ball feel                | `ball.mass`, `restitution`, `drag`, `maxSpeed`                                                                      | Impact response, bounciness, slowing and ball speed cap.                                                                                                                                          |
| Ball hits                | `hit.dodgeHitGain` = 0.2, `dodgeHitMaxImpulse` = 250, `dodgeHitWindow` = 0.3; `angularRestitutionGain`              | Aerial hits reuse the driving strike curve through pair effective mass. A small leading-dodge bonus requires rotational approach and includes equal car recoil. Normal drive hits stay unchanged. |
| Gravity                  | `gravity` = 6.5                                                                                                     | Affects ball, jumps, aerials and wall forces together.                                                                                                                                            |
| Supersonic               | `supersonic.start`, `maintain`, `grace`                                                                             | Entry speed, maintenance speed and hysteresis duration.                                                                                                                                           |
| Demolitions              | `demolition.respawn`, `boost`, `minClosing`, `frontDot`                                                             | Respawn delay/boost and collision eligibility.                                                                                                                                                    |
| Skid effects             | `skid.lifetime`, `minSlip`, `fullSlip`                                                                              | Trail lifetime and slip thresholds for marks/audio.                                                                                                                                               |
| Kickoff/explosion        | `match.kickoffBoost`, `celebration`, `explosionNear`, `explosionFar`                                                | Starting boost, goal celebration duration and blast impulse.                                                                                                                                      |

Other locations:

- **shared/catalog.ts**: per-body dimensions used by both rendering and hitboxes.
- **src/game/pads.ts**: boost pad quantities and respawn timing (small 12/4 s,
  large 100/10 s).
- **src/game/modes.ts**: bot/Free Play rules.
- **Settings → Camera**: camera feel can already be adjusted in-game.
- **src/render/models.ts**: body shapes and wheel visuals, not driving physics.

Leave `dt` and `maxSteps` alone for feel tuning: they control simulation timing.
The 7 rad/s flip cap is intentional custom tuning requested after the original
5.5 rad/s reference calibration; older calibration reports describe that earlier setting.

Rumble power ranges, impulses, timers, bot use and effects live in **src/config/rumble.ts**. See [RUMBLE.md](RUMBLE.md) for units, current estimates, authority and tests.

Normal lateral tire acceleration starts at `car.lateralMaxAcceleration` (34 m/s^2), with response `car.grip` (24/s). For stable, low-slip contact, `highSpeedGripStart` (14 m/s) through `highSpeedGripEnd` (23 m/s) smoothly adds up to `highSpeedGripGain` (18%) response and `highSpeedForceGain` (15%) force limit. The extra grip fades out for large sideways slip and is disabled on partial support. Fully engaged powerslide keeps its previous friction curve; released tires return progressively to finite ordinary grip.

Partial overhead contact uses `car.overheadPartialNormal` (-0.05) and `overheadPartialSupport` (0.12). The tolerance avoids misclassifying vertical walls from float noise. Inferred nearby ray hits cannot promote two-wheel overhead contact to stable support. Wheel/chassis normal constraints remain unilateral, with no suspension or automatic side/nose alignment.

## Landing/contact tuning

Mass properties are centralized in `src/config/physics.ts`. Mass remains 150 kg.
Rapier adds the collider's hitbox offset to its collider-local COM:

| Body                          | Previous body-local COM Y | New body-local COM Y |    Shift |
| ----------------------------- | ------------------------: | -------------------: | -------: |
| Ion                           |                       0 m |            -0.0072 m | -0.72 cm |
| Vector, Cargo, Slicer, Wraith |                    0.09 m |               0.08 m |    -1 cm |

`comLowerHeightFraction` is 0.02 (2% of chassis height). An initial 8% shift made
the taller chassis rest on its bumper bevel in the nose-tipping regression, so
the smaller tested shift preserves recovery without changing collider geometry. Changing body shape
reapplies its mass properties. Hitbox, visual model and rigid wheel mounts do not move.
Pitch/roll inertia increased from 25/20 to 27/21.6 kg m^2; yaw stays 35.
Aerial and flip controls already specify angular acceleration directly, so they
retain their response without multiplying their control constants.

Chassis restitution decreased from 0.05 to 0.02. Wheel support remains a
unilateral, zero-restitution contact constraint, with alternating support-point
iterations and bounded positional correction. There is no spring suspension or
independent wheel displacement in this game; none was introduced by this pass.
Global body angular damping stays zero; air damping (1.7/s), driving alignment
(100, damping 16/s), finite tire grip and powerslide curves are unchanged.

Full grounding requires at least three coherent wheel contacts, a near-aligned
chassis and three consecutive support samples (25 ms at 120 Hz). Loss of the
required contacts exits full grounding immediately. Nearby unloaded rays may fit
a continuous curve but cannot prolong grounded state on a wheel pair. Ceiling
support additionally needs at least three loaded rays inside supportReach. The
existing ceiling adhesion fade stays in place: a four-wheel car can traverse the
upper curve and briefly steer on the ceiling, but cannot hang there indefinitely.
Partial contacts retain aerial controls and only reduced tire forces, with no
adhesion or grounded alignment. An aligned real tread pair may still jump.

The short landing window is 0.24 s. It requires a recent descending impact,
at least three near-contact coherent wheels, alignment above 0.985, angular speed
below 3.5 rad/s, no active dodge torque, no recent jump detachment, no recovery or
impact stun, and no pitch/yaw/roll input over 0.5. It works relative to floor,
wall or ceiling normals. Contact loss removes the assist immediately. The assist
uses a bounded torque impulse: alignment strength 18 plus pitch/roll energy
absorption at 18/s, capped at 45 rad/s^2; yaw is preserved. Rotation is never set.
One/two-wheel, roof, nose, side, violent and commanded aerial contacts receive no
landing assist. Existing partial-contact physical settling remains responsible
for bringing the other wheels down.

F3 toggles the existing optional diagnostics. It now includes explicit
AIRBORNE / PARTIAL_CONTACT / GROUNDED, FL/FR/RL/RR, FLOOR/WALL/CEILING,
landing-assist ON/OFF, COM Y and a yellow world-space COM cross. It is off by default.

Regression coverage: `tests/landing-contact-quality.ts`, `tilted-landings.ts`,
`contact-control.ts`, `game-feel.ts`, `rigid-contact.ts`,
`ramp-quality.ts` and the mechanics/network suites.
