# Heatseeker, Match Setup, aerial speed streaks and Reverse Cam

Party **Play** opens **Match Setup**. Guests can open a read-only view before the
host opens setup for everyone. The left carousel chooses Soccar / Heatseeker;
the right carousel chooses 1v1 / 2v2 / 2vBOTS. Both wrap without an end stop and
animate the incoming selection. CSS Grid stacks the selectors on narrow screens.
Only the host can mutate these settings or start; the server also enforces this.

**Start Match** preserves valid existing team choices and fills remaining human
slots authoritatively. The format requires 2 / 4 / 2 humans respectively;
2vBOTS puts both humans on Blue and uses the existing two Opponent instances on
Orange through the shared party roster. **Choose Sides** retains the existing
manual team-selection lobby. Too few/many humans produces an explicit error.
The server chooses a valid random arena before launching, shared by every client.

## Heatseeker physics

The behavioral reference is the [official Rocket League description](https://www.rocketleague.com/news/heatseeker-mode-launches-april-16?lang=en):
a hit makes the ball seek the opponent's goal; a defending backboard bounce
reverses the target; player/backboard hits increase speed. All numerical values
in this implementation are original calibration rather than official constants.

Tune **src/config/heatseeker.ts**:

| Setting                                              | Value                                         |
| ---------------------------------------------------- | --------------------------------------------- |
| Initial target speed                                 | 70 km/h = 19.444 m/s = 1944.4 uu/s            |
| Increase per subsequent valid touch/backboard bounce | 2.5 m/s = 9 km/h                              |
| Maximum                                              | Existing stable ball cap, 60 m/s = 216 km/h   |
| Acceleration / deceleration bound                    | 45 m/s²                                       |
| Maximum turning rate                                 | 2.2 rad/s                                     |
| Angular response                                     | 2.8 / s                                       |
| Same-player contact debounce                         | 0.15 s; continuous contact counts once        |
| Goal target                                          | Goal center height, 3 m behind the goal mouth |

All physics in this project uses SI internally; **100 uu = 1 metre**.

Each kickoff chooses its receiving side on the authority, places a neutral ball
28 m from midfield on that side, and places cars 38 m from midfield facing in.
The normal 3-2-1-GO countdown locks chassis physics. Homing remains inactive until
a real car/ball solver contact; there is no automatic launch.

A touch records the touching player's ID/team, targets the other goal, updates
ownership color and advances the desired speed tier. The physical contact impulse
runs normally. On later ticks, a bounded angular rotation toward the target plus
a bounded speed correction is applied as a delta impulse to the existing rigid
body. It never changes pose or spin and never sets velocity directly to the goal
direction. Floor, side, ceiling, post and car collisions retain the shared solver,
CCD, restitution and speed cap. Normal Soccar has no Heatseeker controller.

Backboard reversal requires a **real solver contact with the arena shell**. The
contact point must be within 0.18 m of the targeted end-wall plane, inside the
configured near-goal width/height, above the floor curve and outside the goal
opening/post region, with a predominantly longitudinal normal. Side walls,
floor/ceiling curves, goal interiors and separate post/crossbar colliders do not
qualify. Contact begins once rather than advancing tiers every tick. A reversal
changes ownership to the defending team, flips target and raises the desired
speed; the last actual touching player remains recorded separately.

The server match or WebRTC host's 120-Hz worker runs the same **NetworkMatch** and
**Simulation**. Clients only interpolate/render authoritative snapshots. Shared
snapshots include gamemode and active/owner/target/player/tier/speed/kickoff-side/
backboard-sequence state, alongside the existing ball state. The RTC receiver
validates mode against the party's chosen configuration. No guest homing runs.

Ball panels/lamps receive a team tint and mild emission; the existing trail uses
the authoritative owner (including backboard reversals) with stronger intensity
at higher tiers. Soccar's ball materials and trails retain their normal look.
Replay clips store a compact history of Heatseeker ownership/tier changes, so
recorded backboard reversals also render correctly. Existing scoring, celebration,
replay voting, post-goal movement and the next kickoff use the normal Match flow.
Next kickoff resets speed tier, ownership and homing to neutral.

## Aerial speed streaks

**src/effects/air-speed.ts** owns one canvas, capped at 960 pixels wide, and 16
(Medium) / 32 (High/Ultra) fixed streaks. Low disables it. The actual local car's
supersonic flag and existing P.supersonic.start threshold gate an airborne-only
intensity that ramps with speed and fades at landing/slowing. Radial streaks
stay clipped to the peripheral 16%; the middle remains transparent. A second
circular mask protects the projected ball even at an edge. The canvas sits below
HUD layers and never accepts pointer input. There is no blur or extra render
target. Motion direction follows camera-relative velocity, including Reverse Cam.
Menus, pause, replay and inactive sessions hide it. This bounds rendering cost;
it is not a claim of a measured framerate on every player's hardware.

## Reverse Cam

Default **B**, rebindable in Controls; the existing standard gamepad uses **right
stick press**. Input.isHeld reads the logical reverseCam action; this is never a
toggle and is never sent as car physics input. Blur/dialog capture clears or
suppresses the hold. GameCamera continues solving Ball/Car Cam normally, saves
that output, then cuts to an independent front boom aimed backward while held.
Each next frame restores the normal output before updating the usual rig, so
reverse positioning cannot contaminate its damping, FOV or Ball Cam history.
Release immediately displays that frame's current normal output. The override
uses the interpolated car model, a world-up horizon and a collision-tested boom;
there is no car-roll inheritance or transition/recenter animation. Home/Garage
and replay director cameras are not overridden. Local, network, Rings and Dribble
share the same gameplay rig and hold action.

## Verification

- npm test: existing full physics/camera/arena/Dribble suite plus Heatseeker and
  speed/reverse tests.
- npm test --prefix server: existing server suite plus host-only setup/launch,
  both transports, format/team capacity, bot rosters and arena synchronization.
- tests/match-features-browser.cjs: actual independent browser sessions for LAN
  WebSocket and WebRTC matches, looping selectors, guest read-only view,
  responsive setup, shared kickoff/arena, actual input-driven ball touch,
  synchronized ownership/tier and emissive appearance. It also tests keyboard
  Reverse Cam/rebinding, Controls entry, quality gates and transparent center.
- Existing party-flow/network browser regressions retain manual team choice,
  ready/leave/capacity/reconnect, Soccar matches and replay behavior.

Internet deployment still uses the project's existing signaling/API/TURN setup;
these checks use independent sessions on one machine, not a new public backend.
Both frontend and backend must be updated for the new gamemode endpoint.
