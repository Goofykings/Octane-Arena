# Gameplay feel tuning

Start in **src/config/physics.ts**. Most gameplay values live in its `P` object.
While `npm run dev` is running, save your edits, reload the browser, and enter
Free Play for a clean comparison. Change one value at a time. F3 displays physics
telemetry. Run `npm test` and `npm run build` when you settle on a change.

Distances are metres, speeds metres/second, acceleration metres/second squared,
rotation radians/second, and timers seconds. `UU = 0.01` converts reference game
units to metres. Some calibration tests intentionally enforce a particular feel;
review measured results when deliberately changing their targets.

| Feel | Value in `P` | What to change |
| --- | --- | --- |
| Flip rotation speed | `jump.flipMaxAngular` = **7** | Higher makes phywcal flips rotate faster. Previous value was 5.5; 7 is about 27% faster at the cap. |
| Flip spin-up | `jump.flipPitchTorque` = 224; `flipRollTorque` = 260 | Higher reaches the angular cap sooner; torque alone cannot exceed the cap. |
| Flip torque duration | `jump.flipTime` = 0.65 | How long flip torque applies, not the time for a full rotation. Longer also rotates farther. |
| Flip cancellation | `jump.cancelDamping` = 12 | Higher brakes cancelled pitch rotation harder. |
| Forward/side dodge shove | `jump.dodgeImpulse` = 5 | Changes translation, not rotation. |
| Aerial rotation | `car.airPitch`, `airYaw`, `airRoll`, `maxAngular` | Acceleration by axis and ordinary angular cap. The flip has its own cap. |
| Aerial braking | `car.airDamping` | Higher slows free rotation more quickly. |
| Jump height | `jump.impulse`, `holdAcceleration`, `holdTime` | Initial pop, held-jump force and maximum hold duration. |
| Second-jump availability | `jump.window` | Time window after the first jump. |
| Drift rotation | `powerslide.rotationScale` = **0.65** | Lower turns more gently. 1 restores the pre-reduction setting. |
| Drift response | `powerslide.yawResponse`, `rise`, `fall` | Turn response and how quickly handbrake engages/releases. |
| Drift grip | `powerslide.lateralAtForward`, `lateralAtSideways`, `slipGripFalloff` | Lateral grip as the car slides sideways. |
| Normal turning | `car.steeringResponse`; `curvature()` below `P` | Response speed versus desired turning radius at each driving speed. Higher curvature means tighter turning. |
| Engine acceleration | `throttleAcceleration()` below `P` | Speed/acceleration pairs for the engine curve. |
| Maximum driving speed | `car.maxSpeed` = 23 | Linear speed cap. Consider supersonic thresholds if changing it. |
| Braking/coasting | `car.brake`, `car.coast` | Higher sheds speed faster. |
| Boost strength/use | `car.boostGround`, `boostAir`, `boostUse` | Acceleration on surfaces/in air and boost consumed per second. |
| Rigid contact | `car.contactReach`, `rayLength`, `contactSkin`, `maxContactCorrection` | Detection reach, collision clearance and bounded correction. There are no suspension springs. |
| Wall driving | `car.adhesion`, `wallDriveSpeed`, `wallIdleGrip`, `ceilingAdhesionEnd`, `align`, `alignDamping` | Stable wheel support only; moving-wall grip and progressively reduced overhead adhesion. |
| Recovery | `car.edgeRecoverySpeed`, `edgeDriveGrip`, `recoveryCooldown` | Speed limit and load-limited tire-shoulder grip for driven edge recovery; existing roof-flip cooldown. |
| Ball feel | `ball.mass`, `restitution`, `drag`, `maxSpeed` | Impact response, bounciness, slowing and ball speed cap. |
| Ball hits | `hit.frontGain`, `sideGain`, `roofGain`, `maxExtra` | Extra gameplay impulse applied to ball hits. |
| Gravity | `gravity` = 6.5 | Affects ball, jumps, aerials and wall forces together. |
| Supersonic | `supersonic.start`, `maintain`, `grace` | Entry speed, maintenance speed and hysteresis duration. |
| Demolitions | `demolition.respawn`, `boost`, `minClosing`, `frontDot` | Respawn delay/boost and collision eligibility. |
| Skid effects | `skid.lifetime`, `minSlip`, `fullSlip` | Trail lifetime and slip thresholds for marks/audio. |
| Kickoff/explosion | `match.kickoffBoost`, `celebration`, `explosionNear`, `explosionFar` | Starting boost, goal celebration duration and blast impulse. |

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
