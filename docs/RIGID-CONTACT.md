# Rigid contact replacement — September 29, 2026

## Resume audit

Before resuming, spring/damper acceleration and wall rebound damping had been
removed. A first draft of pre/post-step normal constraints existed but had never
been verified. The wheel renderer still imported the removed `wheelSuspension`
name, breaking the build. Chassis-corner protection, firm wheel visuals, dedicated
tests and the final report had not been completed. Existing tire grip, powerslide,
scoring, camera and other systems were preserved.

## Implementation

1. Removed spring compression acceleration (`spring = 260`), point-speed damping
   (`damper = 24`), the suspension rest-length parameter and the extra wall
   separation/rebound damper (`wallSeparationDamping = 12`).
2. Replaced them with a unilateral constraint: before the physics step, wheel
   rays limit incoming normal speed to the available clearance, accounting for
   gravity. After integration, a separate position correction resolves clearance
   error without turning that error into launch/rebound velocity.
3. Wheel clearance is 0.31 m, detection reach 0.5 m, and tread/chassis skin 8 mm.
   Chassis corners are checked as well as wheel rays to catch bumpers on tight
   curves. Total positional correction is capped at 4 cm per 120 Hz tick. Rapier
   retains the dynamic collider, CCD, gravity, collision impulses and inertia.
4. Surface adhesion remains finite and only acts while contact is detected.
   Driven adhesion now includes inverted surfaces. Physical angular feedback
   aligns the car; neither rotation nor tangential position is locked. Jumps
   bypass wheel constraints for their takeoff interval. Outward impulses are
   not cancelled by the normal constraint, allowing impacts to detach the car.
5. Tire forces and powerslide coefficients are unchanged. Corrections project
   along each contacted surface normal, preserving that surface's tangential
   velocity. Ground landings intentionally absorb normal approach without spring
   rebound. Car/car and ball collision handling remain in Rapier and the existing
   impact code.

Visual wheels have no spring or droop animation. They retain their normal mount
height or retract only enough to clear the surface. Centre and tread-edge probes
use the rendered pose and static collision mesh, accounting for camber, tread
width and concave curves. This geometric fit is independent of tire traction.

## Completed checklist

- [x] Stationary floor contact, acceleration and 23 m/s driving: both bodies hold
  constant height (0.310197 m), with zero measured vertical velocity after settling.
- [x] Powerslide: the same planted height; direct constraint test preserves
  sideways/forward velocity exactly. Existing drift-decay/release tests pass.
- [x] Floor-to-curve-to-wall driving, with and without boost: existing speed
  variants pass; dedicated full boosted paths cover both car bodies.
- [x] Vertical wall and boosted wall driving retain contact.
- [x] Wall-to-ceiling transition and ceiling driving: both bodies complete the
  physical path and continue inverted. Loss of contact still produces a fall.
- [x] Floor and wall jumps detach normally (over 0.45 m normal separation in the
  measured takeoff interval).
- [x] Straight aerial and sideways powerslide landings settle without measured
  upward rebound; sideways momentum remains available for sliding.
- [x] Goal interior curves: both bodies and both goals remain driveable, with
  sampled wheel/chassis clearance above 7.9 mm.
- [x] Wheel/body clipping checks: boosted full-path tests sample tire surfaces
  and chassis corners against the analytic arena profile. Minimum clearances
  remain positive: about 5.3/5.6 mm for wheels and 5.1/4.0 mm for Ion/Vector bodies.
- [x] Outward impacts detach the car. Existing collision, demolition, jump,
  recovery, ball, camera, scoring and powerslide regression suites pass.
- [x] Production TypeScript/Vite build and isolated Chrome rendering checks pass.

No requested item is deferred. Tests cover the specified scenarios, both current
bodies and selected speeds; they cannot prove every arbitrary impact pose.

## Verification artifacts

- `npm test` includes the new `tests/rigid-contact.ts` suite.
- `npm run build` passes; Vite retains its existing bundle-size advisory.
- `tests/rigid-browser.cjs` renders physical driving snapshots for both cars on
  floor, ramp, wall and ceiling; no runtime or shader errors.
- Logs: `.tools/rigid-contact.log`, `.tools/rigid-regression.log`,
  `.tools/rigid-build.log`, `.tools/rigid-browser.log`.
- Images: `docs/rigid-{ion,vector}-{floor,curve,wall,ceiling}.png`.
- Tuning: [TUNING.md](TUNING.md), `src/config/physics.ts`.
