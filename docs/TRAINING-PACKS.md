# Training Packs

Open **Play > Extra Modes > Training Packs**, then Striker, Goalie or Aerial.
Each retuned pack has ten unlocked scenarios. Use Reset Shot / R / the
training reset binding, Previous / Next, or the existing bindable `[ / ]`
actions. Escape pauses; camera switching, mouse look, reverse camera, garage
presets, camera settings and audio settings use the existing implementations.
Boost is unlimited. There is one human car and no bots, party roster or networking.

`src/extra/training/packs.ts` contains typed pack/shot data: car position/yaw,
ball position/velocity, initial freeze flag, success/failure rules and timeout.
The UI contains no scenario coordinates. Add packs there and the menu follows
the data. `run.ts` manages physics stepping, attempts, results and progression;
`session.ts` renders the existing arena and models with the existing GameCamera
and effects. The shared Extra Mode HUD has a training branch.

- **Striker:** faster rolling/airborne feeds, long approaches, offset starts and
  combined angles. Opponent goal succeeds; own goal fails. Follow-up hits are allowed.
- **Goalie:** center and side shots, then diagonals, elevated balls, corners and
  faster serves. All ten untreated serves are tested to score through the actual
  arena geometry. A meaningful real car touch succeeds when the existing
  radius-aware arena trajectory predictor forecasts a defended goal before
  contact and no immediate defended-goal threat afterward. It needs no midfield
  clearance. An actual goal fails. A light graze that leaves
  the threat intact cannot succeed.
- **Aerial:** four stationary airborne balls followed by six upward launches.
  Stationary balls keep their normal dynamic mass/collider but temporarily use
  zero gravity and velocity before first contact. The first genuine car-ball
  collision uses the normal solver/contact response. That same step restores
  gravity and stops freezing; collision velocity and spin are preserved. No
  artificial first-hit velocity is imposed. Moving shots always use ordinary
  gravity, damping and collision physics. Opponent goal succeeds; own goal fails,
  with ground follow-ups allowed before zero time.

Every attempt begins in a locked READY state with a velocity/speed arrow
(omitted for frozen zero-velocity balls). The first gameplay input starts physics
and the clock, applies that same input to the car, and hides the arrow. Camera,
scoreboard and menu controls do not start the attempt. Each shot defaults to
10 seconds, configurable with `timeLimit`; the top-left bar/number remains full
until input and returns to full on reset. At zero, play continues until actual
flat-floor contact or a goal; a late goal still succeeds. Wall, curve, ceiling,
car and frame contacts do not end zero-time play. Goalies show the natural rebound, require continuously safe
prediction plus an approximately one-second delay, then burst/disappear. Striker
and Aerial goals play the existing skippable goal replay before advancing. Failed
attempts and goalie completions show the result for 1.25 seconds. The last shot
opens TRAINING COMPLETE. Retry clears that shot's result; skipped shots contribute
zero. Best completed count and last pack are optional local records, separate from
competitive stats. See [continuation details](TRAINING-LEADERBOARD-CONTINUATION.md)
for confidence thresholds, difficulty changes, replay architecture and tests.

## Verification

- `tests/training.ts`: all 30 scenarios/reset/input-start/navigation/results/save;
  all ten Striker shots scored by ordinary throttle/steering without boost or
  ball edits (a per-shot 36-second fixture isolates geometry feasibility from the
  new 10-second challenge); all ten actual goalie serves and collision-based saves; four
  stationary-ball contact releases and six upward gravity trajectories.
- `tests/dribble-obstacles.ts`: exact layouts; 14 single-jump wall carries across
  both bodies; spinner kinematic timing and matched art/collider dimensions;
  nose, roof, wheel-side and 60 m/s ball contacts; timed ball-carry passage.
- `tests/dribble-traversal.ts`: all 20 roads driven with real inputs and nine
  isolated carried-ball gap jumps, without geometry teleportation or boost.
- `tests/training-browser.cjs`: production category menus, unlocked navigation,
  keyboard/button resets, outcomes/completion/persistence, Ball Cam, reverse,
  mouse look, no competitive stats, responsive menus, live spinner/art sync.
- `tests/zero-time.ts`: shared physical ground transitions, false-contact
  exclusions, input start/reset, late goals, regulation and sudden-death overtime.
- `tests/training-timer-browser.cjs`: production timer/bar, input exclusions,
  zero-time goal/replay/reset and ground failure, normal 0:00 goal/replay flow.
- Existing Dribble browser suite verifies finish/checkpoint/reset/reload flow.

Isolated contact fixtures and controllers establish mechanical feasibility;
they are not complete human playthroughs carrying the ball through every mixed
course or scoring every Aerial scenario. Level 9 timing, Level 11 combinations
and later moving aerial shots should receive human difficulty feedback.
