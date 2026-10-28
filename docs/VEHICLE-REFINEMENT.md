# Vehicle refinement - 0.2.3

Focused suspension visuals, progressive wall tire friction and measured steering verification. The existing 120 Hz controller remains in place. The multiplayer build handshake advances to 0.2.3 so older builds cannot mix incompatible prediction state.

## 1. Old/new visual suspension limits

All offsets are relative to the authored wheel centre (-0.12 m local Y), with an 18 cm wheel radius.

| Visual travel | Before | After |
| --- | ---: | ---: |
| Upward compression | 180 mm | 6.3 mm |
| Downward extension | 29.5 mm | 28.8 mm |
| Total range | 209.5 mm | 35.1 mm |

The new limits are radius-scaled (3.5% compression, 16% extension). Wheel compression/extension use frame-independent exponential damping (160/s and 20/s respectively). The total result is clamped after adding the small weight-transfer bias.

## 2. Preventing clipping

The render clamp prevents the former 18 cm upward excursion. Both live and recorded wheel-animation paths now run suspension animation; previously the recorded path returned early. Tight curves also exposed excessive physical bottoming: a visual clamp alone left tread roughly 13-14 cm inside the arena. A unilateral fixed-tire bottom stop therefore limits extreme physical wheel length to 0.12 m with a 2 mm surface skin. It applies outward contact-point impulses using linear/angular velocity and bounded outward positional correction, without inward adhesion or an orientation target.

Normal flat ride height remains about 0.311185 m. Springs (500), compression/rebound damping (25/40), rest/ray travel, mass, COM and hitbox are unchanged. The new stop deliberately changes extreme-bottoming contact, rather than using oversized cosmetic travel to hide it.

Mesh checks cover five procedural bodies and four GLB bodies. Existing LowFlat trim already overlaps the outer-tread ray probe by about 14.2 mm at the authored neutral fit; maximum compression and combined lean now measure about 8.1 mm of overlap (less than the 14.2 mm authored overlap). Wedge has about 7.2 mm overlap at the extreme, compared with a clear neutral fit. These asset-fit details remain; the large suspension-induced body penetration is removed. The bodies were not remodelled.

## 3. Longitudinal weight transfer

Actual rigid-body velocity differences are converted into local acceleration and smoothed at 12/s. Forward acceleration extends the front and compresses the rear; braking/reverse acceleration reverses the effect. A separate visual chassis child supplies the tiny pitch. Wheel axle bias is at most 15.12 mm before the total travel clamp; lateral bias remains 7.56 mm. A small visual chassis lift above the former pitch limit protects the wheel arches.

## 4. Lateral weight transfer

Actual local lateral acceleration drives outside-wheel compression and inside-wheel extension, with a corresponding tiny chassis roll. No raw throttle/steering-only squat is used. Effects require grounded support with at least three wheels; they decay smoothly in air and reset on teleports or long frame gaps.

## 5. Maximum visual angles and isolation

Pitch: **0.028 rad / 1.604 degrees**. Roll: **0.021 rad / 1.203 degrees**. Longitudinal pitch and axle bias were doubled after the 3.5-times adjustment; lateral strength is unchanged. Only the visual chassis child rotates. Tests confirm identical rigid-body position, rotation, velocity and angular velocity before/after animation, correct front/rear and left/right signs, and matching smoothing at 30/60/144 FPS. Replay uses recorded wheel hits without needing a physics world.

## 6. Wall grip/slip

The old throttle gate jumped vertical-wall friction from 0.1 to 1.0 in one tick, even at 2% throttle. Tire friction now blends from the existing passive non-sticky curve toward a throttle-, slip- and speed-dependent recovery state. Sideways motion and motion opposing throttle reduce the recovery target smoothly. Recovery rises at 3.5/s and falls at 14/s. The prediction checkpoint includes this state.

No sticky-force constants were increased. Partial-contact grip/engine reductions, zero one/two-wheel sticky force, gravity and ceiling peel-off remain in force. Wall grip is capped below floor grip (maximum vertical-wall multiplier 0.847), while floor steering friction remains unchanged.

## 7. Speed-dependent wall stability

Stable recovery target rises from 0.35 to 0.83 between 0 and 20 m/s forward speed; high slip reduces it toward 25% of that value. A real vertical-wall probe started sliding downward at 3 m/s, coasted for 12 ticks, then held full throttle for 48 ticks:

| Initial forward speed | First throttle tick grip | Grip after 0.4 s |
| --- | ---: | ---: |
| 0 m/s | 0.102 | 0.161 |
| 5 m/s | 0.109 | 0.359 |
| 15 m/s | 0.118 | 0.577 |
| 23 m/s | 0.121 | 0.663 |

At 5 m/s, downward sliding persists after throttle: approximately -3.29 m/s on the first tick and -2.00 m/s after 0.4 s, rather than the former immediate grab and approximately -0.20 m/s after 0.4 s.

## 8. Measured steering

Measured in the actual Rapier simulation with full ordinary steering, a forward-speed servo preserving lateral motion, and settled yaw-rate averaging. Curvature = |yaw rate| / forward speed; radius is its reciprocal. Reference is the existing project RL-inspired curvature table, converted to metres. These are steady-state checks, not claims that every transient follows an exact circle.

| Speed (uu/s) | Steer angle (rad) | Vector yaw (rad/s) | Vector curvature (1/m) | Vector radius (m) | Reference radius (m) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 500 | 0.319300 | 1.944 | 0.3889 | 2.572 | 2.513 |
| 1000 | 0.182030 | 2.002 | 0.2002 | 4.996 | 4.255 |
| 1500 | 0.105700 | 1.695 | 0.1130 | 8.848 | 7.273 |
| 2000 | 0.074964 | 1.630 | 0.0815 | 12.267 | 10.000 |
| 2300 | 0.062837 | 1.587 | 0.0690 | 14.491 | 11.364 |

Vector, LowFlat, Boxy and Wedge share the measured handling geometry and produce the same results. Ion uses its own wheelbase:

| Speed (uu/s) | Ion yaw (rad/s) | Ion curvature (1/m) | Ion radius (m) |
| --- | ---: | ---: | ---: |
| 500 | 2.203 | 0.4405 | 2.270 |
| 1000 | 2.301 | 0.2301 | 4.346 |
| 1500 | 1.970 | 0.1313 | 7.613 |
| 2000 | 1.911 | 0.0956 | 10.465 |
| 2300 | 1.869 | 0.0813 | 12.306 |

## 9. Steering decision

**No steering or powerslide tuning changed.** At 1500-2300 uu/s all five bodies already turn wider than the project reference. Making the high-speed curve wider again was not supported by these measurements. Baseline versus final maximum radius difference across 25 body/speed cases: 0.000000000 m. The smaller Ion has a tighter low-speed turn at 500 uu/s; that is outside the requested high-speed correction.

## 10. Validation

The latest forward/back adjustment passed `npm run test:vehicle-refinement` and `npm run build`. The full-suite and browser results below are from the original refinement, before that adjustment.

- **npm test: PASS**, complete final run (exit 0), including the new vehicle-refinement suite.
- **npm run build: PASS**, TypeScript and production Vite build (exit 0). Vite retains its existing large-chunk warning.
- **npm --prefix server test: PASS**, 28 tests, 0 failures.
- **Real Chrome Free Play: PASS**, 109 sampled frames; loaded GLB vehicle, normal recorded-wheel animation, actual acceleration pitch and bounded wheel offsets, with no page errors.
- **git diff --check: PASS**. Earlier generated calibration documents were restored after validation to preserve unrelated work.

Detailed logs remain in .tools/vehicle-full-tests-final.log, .tools/vehicle-build-final.log and .tools/vehicle-server-tests.log.

Coverage includes wheel/body bounds, curved ramps, slopes and landings, acceleration/braking/turning, wall slip recovery, partial-wall and two-wheel ceiling detachment, jumping/aerials/powerslide, car-ball contact, prediction, camera, training and replay. The rigid-contact visual tread tolerance is now 5 mm (previously 1 mm) to allow a damped cosmetic wheel to trail rapidly changing contact; the physical chassis penetration threshold stays unchanged at 3 mm.

Optional inspection: existing F3 telemetry stays disabled by default. New state is inspectable as car.wallSlip, car.wallGrip and model.userData.suspensionVisual (wheel offsets in FL/FR/RL/RR order, pitch/roll). No continuous logging or new overlay is enabled.

The browser sample and validation record below reflect the original refinement; the later visual tuning is verified separately. Raw baseline/final steering and wall samples: [vehicle-refinement-measurements.json](vehicle-refinement-measurements.json).
