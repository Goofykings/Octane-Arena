# Focused gameplay fixes — September 28, 2026

Working scoring, Free Play, vehicle bodies, wheel animation, flip speed, effects,
menus and accounts were preserved. Changes are limited to drift friction,
camera state/framing and arena transitions.

## Completed checklist

- [x] Sideways powerslide retains momentum but steadily loses speed. The old
  slip curve approached zero at perpendicular travel. It now has a 0.006
  minimum grip multiplier, applied through the existing speed-dependent force
  and contact support. The forward/sideways curve remains 0.1/0 with 0.8 falloff;
  the minimum prevents the zero endpoint from removing friction.
- [x] Unpowered drift has longitudinal coast drag of 0.18/s. Existing handbrake
  engagement/release rates (5/s and 2/s) and rotation scale (0.65) remain intact.
  In a 12 m/s sideways landing, held-slide speeds at 1/3/6/8/24 seconds were
  11.53/8.64/5.61/4.21/0.42 m/s. Releasing after one second reduced lateral speed
  to effectively zero by three seconds, without directly snapping velocity.
- [x] Scoring records a goal-focus position before disabling the ball. Ball Cam
  uses it throughout celebration; kickoff clears it. Both bot and Free Play
  goal sequences are covered.
- [x] A persistent `modeBlend` now interpolates both Ball Cam directions using
  the same transition setting. It blends orbit target, final aim and framing
  expansion instead of immediately switching the final look direction.
- [x] Ball Cam retains a world-up frame, smoothed heading/orbit and wall escape
  direction. It frames the car and ball using their angular separation. For
  nearby high balls, it adds up to five metres of camera distance and uses
  bounded temporary FOV fitting (120-degree maximum). Existing height, angle,
  stiffness, distance, FOV and swivel controls continue to contribute.
- [x] All eleven requested camera scenarios checked: ahead, behind, nearly
  overhead, ceiling ball, vertical wall, wall/center-field ball, floor-to-wall,
  wall-to-floor, both toggles and goal celebration. Numerical checks include
  30/60/144 fps and toggle settings 0.3/1.2/3. Browser screenshots cover these
  cases, including intermediate toggle frames and both goal directions.
- [x] Goal mouth stays rectangular. A localized smooth shoulder replaces the
  vertical end cap where the arena ramp meets the goal. Rendering and Rapier
  use the same generated geometry. Ray checks across both goal shoulders find
  at most 3.25 degrees of adjacent normal variation and under 0.015 m of offset.
- [x] Ramp radius reduced from 3.2 to 2.4 metres (25% smaller). Wheel-contact,
  wall-driving, camera clearance and goal-mouth tests pass. Ball impacts at
  three ramp angles on both sides rebound consistently around 3.80 m/s from
  an 8 m/s normal approach, without significant sideways deflection.
- [x] Production build, physics/camera regressions and Chrome rendering checks
  pass. No browser or shader errors in the exercised scenarios.

The standing-start ascent test now allows four seconds and stops at 15 metres
of height. The tighter ramp starts farther from its spawn. This measures the
intended ascent without accidentally including a later fall from the ceiling.

## Verification and tuning

- `npm test` includes `tests/focused-fixes.ts` alongside the existing suites.
- `npm run build` checks TypeScript and creates the production bundle.
- `tests/contact-browser.cjs` exercises rendered framing, transitions and effects.
- `tests/goal-visual.cjs` checks goal planes, goal focus, gray Free Play explosions
  and restoration of team colors.
- Logs: `.tools/focused-check.log`, `.tools/focused-regressions.log`,
  `.tools/focused-build.log`, `.tools/focused-browser.log`, `.tools/focused-goal.log`.
- Screenshots: `framing-*.png` and `goal-mouth-alignment.png` in this directory.
- Mechanics: `src/config/physics.ts`; explanations: [TUNING.md](TUNING.md).

## Reference and limits

[RocketSim's car implementation](https://github.com/ZealanL/RocketSim/blob/master/src/Sim/Car/Car.cpp)
informed the distinction between slip-dependent lateral friction, longitudinal
friction and gradual handbrake engagement. Its friction solver differs from this
game's force mapping, so a zero curve endpoint cannot be transferred literally.
[Epic's camera settings](https://www.epicgames.com/help/c-37599050/c-32343914/a14443106?lang=en-US)
describe the user-facing controls; the camera algorithm here is an original
approximation, not Rocket League's proprietary implementation.

The referenced goal screenshot could not be located in the supplied attachment
or the earlier reference folder, so geometry follows the written description.
No gameplay requirement is deferred, but a direct comparison with that image
remains unverified. Very wide temporary FOV can distort edges; solid geometry
can still occlude subjects. Tests cover the listed scenarios rather than every
possible camera setting and collision. Vite retains its existing bundle-size
advisory.
