# Goal replay

Competitive soccer now follows **playing → goal celebration → replay → kickoff
countdown → playing**. The existing 3.2-second movable celebration and boost-pad
pickups are retained. A winning regulation/overtime goal still shows its replay
before the result screen. Free Play keeps its existing goal/reset behavior, and
Rings never enters the soccer match/replay state machine.

## Recording and playback

`shared/replay.ts` owns the packed schema, fixed circular storage, interpolation,
slow-motion regions, playback clock and transport types. `src/replay/recorder.ts`
captures the authoritative simulation after each playing physics step, before a
goal disables the ball or applies the explosion impulse. The source rate remains
120 Hz. There are 721 reusable slots, covering six seconds including endpoints.

The buffer stores ball position/quaternion/linear and angular velocity/enabled
state; each car's ID, pose, velocities, boost, steering, contact/normal state,
wheel visual angle, airborne coast state, flip/double-jump state and demolition
state; and all 20 boost-pad cooldowns. Bounded event storage records touches with
player IDs/timestamps, pickups, demolitions and the goal. Static arena geometry,
textures, meshes and cosmetics are never stored per tick.

A four-car buffer uses about 0.68 MiB of packed numeric storage; a full goal clip
adds about 0.56 MiB. Car IDs are referenced once per buffer. Only a goal copies
the final approximately five seconds into an immutable clip. Goals scored before
five seconds of play replay the available history. Kickoff clears history, and
interpolation cannot cross a reset, demolition/respawn or large teleport.

`ReplaySampler` writes a reusable output row, with linear position/velocity
interpolation and quaternion slerp. Discrete flags come from recorded ticks.
`ReplayScenePlayback` applies this output only to the existing match models and
render-only car proxies. It has no live rigid-body setters or gameplay event
handlers. The same car body, paint, wheels, decal, boost color, player identity,
team colors and arena remain loaded; no generic replay cars are created.

The authoritative physics world, boost, pads, match clock, scoring and stats do
not advance during replay. Existing pooled boost flames, trails, wheel animation,
flip/double-jump effects, skid marks and demolition flashes are driven by recorded
state. Pad visuals use recorded cooldowns without changing the live pad objects.
At the recorded goal, a visual-only explosion plays, followed by a short 0.65-second
hold before kickoff. The preceding live celebration already includes the real
physics blast; replay does not reapply its impulse or simulate the aftermath.

## Camera and slow motion

`ReplayDirectorCamera` creates one continuous original broadcast shot. Its target
weights the ball, credited scorer and attacked goal mouth. The scorer receives
less weight at a distance; the goal receives more weight as the ball approaches.
An elevated side/rear offset uses goal direction and a modest ball-velocity lead,
never the car's orientation. Projected subject positions drive distance and a
modest 60–76° FOV adjustment. Camera positions stay inside the arena shell. Target,
position, quaternion and FOV use separate exponential damping based on real frame
time, so slow-motion playback still has a smoothly moving camera.

The credited scorer's genuine final touch produces a region from 0.5 seconds
before to 0.5 seconds after the touch. The goal region begins 0.5 seconds before
the authoritative scoring event and extends just past it. Overlapping regions,
or regions separated by at most 0.15 seconds, merge. Playback eases toward 0.4×
within these regions and returns toward 1× outside them. Recorded transforms and
physics are unchanged. Defending-team own goals use the existing credited-scorer
rule and receive only the goal region; the defender is not highlighted as scorer.

Goal speed is the actual ball velocity magnitude captured in the authoritative
goal event, before the explosion, displayed as **km/h** (m/s × 3.6). It is never
derived from replay interpolation. The bottom-center card uses the player's
existing avatar icon/color and name. The bottom-right list shows the match roster,
marks bots as non-voters, and marks humans who voted or left. Press Space or use
the skip button. A one-human VS Bot match skips immediately.

Add `replayDebug` to the URL query to display playback time/speed, slow intervals,
touch/goal time, desired/actual camera position, target and projected subject
positions. In development/test mode, the same data is available through
`window.__arena.replayView.director.debug` or the network view's replay director.

## LAN authority

The server records at its own 120-Hz physics ticks, never from 30-Hz client render
snapshots. It sends one shared clip per goal over the existing authenticated
WebSocket during celebration, before playback begins. Packed arrays are serialized
once per goal and cached for all participants. Reconnecting clients receive that
same clip. Routine snapshots contain only replay ID/time/speed and skip-vote sets.
Clients interpolate the recorded clip at server playback time; they do not advance
match physics or choose when replay ends.

`REPLAY_SKIP_REQUEST` includes match/replay IDs; the server derives the voter from
the authenticated socket rather than trusting a submitted player ID. It rejects
non-members, bots, wrong/stale IDs, non-replay requests and duplicate votes. Votes
are broadcast with authoritative snapshots. All currently eligible humans must
vote, and disconnection removes a human from that required set immediately. A
reconnection during an ongoing replay restores eligibility. Unanimity resets
kickoff immediately, including pad timers. Existing match connection grace and
party leave behavior remain unchanged.

## Verification

- `npm run test:replay`: buffer/memory bounds, transport equality, slerp, exact
  wheel state, teleport boundaries, separate/overlapping/adjacent slow regions,
  own goals, 0.4× playback at different frame rates, genuine physical ball touches
  and goal speed, immutable live physics during playback, model reuse, single
  score/stat awards, single-human skip, natural completion and Free Play.
- Director fixtures cover straight shots, long aerials, flicks and redirects at
  desktop and portrait aspect ratios, with continuous camera/FOV motion.
- `server/tests/replay.test.ts`: 1v1/2v2 authority, bots/non-members/stale and
  duplicate votes, frozen server physics, disconnection/reconnection, plus real
  WebSocket clip equality, voter spoof protection and shared immediate kickoff.
- `tests/replay-browser.cjs`: actual VS Bot and two-browser LAN playback, cosmetics,
  scorer/speed cards, skip lists, responsive panel bounds, physics immutability,
  next kickoff/driving, Free Play and Rings isolation. Run after both production
  builds with `PLAYWRIGHT_MODULE` pointing to an available Playwright installation.
- Existing physics/camera/scoring and server network suites verify preservation
  of live behavior. Client and server production builds check shared integration.

Replay effects reproduce recorded visual state using existing pooled effects;
random particle seeds and pre-clip trail history are not stored. The feature is
an automatic goal replay, not a replay-file export or full-match spectator system.

### Final results

Replay unit/physics/render tests, all ten server tests and the real VS Bot/two-client
LAN browser acceptance suite passed. Both production builds passed. Nineteen
independent existing gameplay/camera/contact/arena/Rings checks passed, including
kickoff formations and small/large celebration pickups after acknowledging the
new replay phase in those test fixtures.

Two older assertions remain incompatible with the current pre-existing physics
tuning: the umbrella `npm test` stops at `tests/major-update.ts:79` (a 180-degree
powerslide at 5 m/s within three seconds), and `tests/surface-effects.ts:139`
requires the previous 0.9125-metre ball radius while the current configured radius
is 0.95 metres. The powerslide fixture has its ball disabled and never constructs
a match/replay. Current physics values were preserved. Neither assertion was
removed or weakened for this replay update.
