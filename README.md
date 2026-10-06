# Octane Arena

An original, client-side 3D car-soccer game: custom arcade vehicle control,
curved walls, aerials, a physical ball, and a five-minute match against one bot.
The original procedural car, arena, ball patterns, and synthesized sounds do not
use extracted models, textures, audio, or proprietary game code.

## Run

Install Node.js 24.14+ (also required by the optional LAN server), then:

```sh
npm install
npm run dev
```

Open the printed local URL and select **PLAY → AGAINST A BOT**. **AGAINST A FRIEND**
opens the party flow; ranked and online matchmaking remain unavailable.
A desktop browser with WebGL 2 and
a keyboard or standard gamepad is required. Click PLAY to unlock browser audio.
Local games pause on focus loss. Network matches continue; unfocused clients send
neutral controls. Touch driving is not implemented.

For same-Wi-Fi network matches, install the backend dependencies once with
`npm --prefix server install`, then run **`npm run lan`**. Open
`http://localhost:8090` on this computer; other computers open the LAN address
printed in the terminal and join using the party code. The host chooses
**START GAME → mode → CONTINUE**. Everyone chooses a side, then the host selects
**KICK OFF**. Supports 1v1, 2v2 and two humans versus two bots. See the
[network match guide](docs/NETWORK-MATCHES.md) and the historical
[Phase 1 checklist](docs/LAN-PHASE1.md).

The home screen has Play, Garage and Settings on the left, plus a compact clickable Guest/account
profile. Garage includes two original starter bodies (Ion and Vector), curated
team paint, two wheel styles, two boost effects, a Circuit decal and local presets.
Ion keeps the original low, slim profile. Vector is a taller rally hatch with a
short hood, upright split windows, broad shoulders, wheel-arch flares and a roof
spoiler. Future bodies should vary their silhouettes (buggy, truck, van, etc.)
while following the taller design direction, rather than stretching one model.
The variety seen in [Rocket League's car designs](https://www.rocketleague.com/news/the-fit-check-community-contest-finale)
is a reference for that direction; the game uses its own procedural geometry.
Topper and goal-explosion slots begin with None and Pulse respectively. Drag the
preview to rotate it. Settings has Gameplay, Camera, Controls, Graphics and Audio
tabs. Keyboard bindings, camera tuning, quality, audio and presets save locally.
Quick chat is only a saved future preference. Click any slider value to type a
number; Enter or blur applies it, Escape cancels, and values clamp to the range.

Customize Account edits your browser-local name. Click its profile picture to choose an icon and icon color; these choices save immediately. Player tags have been removed. Profile identity, completed-match stats and play time are stored in `octane-arena-profile`; garage and settings keep their existing local saves. There is no online login or cloud sync. Clearing site data can erase your profile. LAN parties still use the optional server described in [server/README.md](server/README.md).

The arena's original **Lumen District** theme includes a twilight skyline,
illuminated buildings and skybridges. Lower wall curves are opaque and marked
with contour bands. Twin animated exhaust jets indicate boosting, and rear-wheel
light trails activate at supersonic speed (22 m/s) while wheel contacts touch the
playing surface. Boost exhaust still works in the air.

```sh
npm test          # repeatable tests against the actual Rapier simulation
npm run build    # strict type check and production bundle
npm run preview  # serve the production build locally
```

## Controls

To adjust gameplay feel, edit `src/config/physics.ts`. See the
[tuning guide](docs/TUNING.md) for flips, drifting, driving, boost, jumps and ball physics.

The [camera/contact update](docs/CONTACT-CAMERA-UPDATE.md) adds two-subject
Ball Cam framing, contact-driven wheel suspension, rotating ball and flip streaks,
an aligned rectangular goal mouth, and boost-pad recharge meters.
The subsequent [rigid contact replacement](docs/RIGID-CONTACT.md) removes spring
suspension, adds firm wheel/chassis clearance, and verifies floor, wall, ceiling
and goal driving while preserving powerslide and jump behavior.

| Keyboard                   | Action                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| W / S                      | Throttle / reverse; aerial pitch                                      |
| A / D                      | Steer; aerial yaw                                                     |
| Space                      | Jump; hold for height; release and press again to double jump / dodge |
| W/S/A/D + second jump      | Forward, backward, side, or diagonal dodge                            |
| Opposite pitch during flip | Flip cancellation                                                     |
| Shift                      | Boost                                                                 |
| Ctrl                       | Powerslide; hold with A/D for air roll                                |
| Q / E                      | Air roll                                                              |
| C                          | Ball / car camera                                                     |
| 1 / 2 / 3 / 4              | Free Play: reset / take possession / start dribble / launch ball      |
| Escape                     | Pause / resume                                                        |
| F3                         | Physics telemetry and collision graphics                              |

Standard gamepad: RT/LT drive, left stick steer/pitch, A jump, B boost, X
powerslide, LB/RB roll, Y camera, Menu pause. The left stick selects gamepad dodge
direction independently of throttle; release it for a neutral double jump.

Each point starts with a **3–2–1–GO** countdown; cars and the match clock remain
stationary until GO. Goals trigger an expanding shockwave and particles, with
physical impulses that launch both cars away. The world continues simulating
through the celebration before the next kickoff, with player aerial controls and boost active.

You are cyan, defending the cyan goal and attacking amber. Gold pads give 12
boost or a full refill; respawn times are four and ten seconds. At 0:00 the ball
remains live until it lands. A tied match enters sudden-death overtime.

## GitHub Pages

1. Commit the project and lockfile to your GitHub repository on `main`.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
3. Push to `main`, or run the included Deploy workflow manually.
4. The deploy job reports your Pages URL.

`vite.config.ts` uses `base: '/Octane-Arena/'` for this repository's Pages URL.
The LAN launcher also serves that built asset prefix. Rapier's compat package embeds its WASM payload; there is no
absolute WASM URL or external asset service. All visual/audio assets are created
locally, apart from the bundled open-license font. Serve `dist/` over HTTP; do not open it with `file://`.

The workflow is supplied; this workspace is not connected to a GitHub repository
and no public deployment has been performed.

GitHub Pages cannot run the party server. To enable public Create/Join Party,
deploy the existing Node backend separately and set the repository Actions
variable `VITE_API_URL` to its HTTPS base address before rebuilding Pages.
See [public party deployment and local setup](docs/PUBLIC-PARTIES.md).
Public shared matches now support browser-hosted WebRTC for 1v1, 2v2 and
two players against bots. See [WebRTC setup and verification](docs/WEBRTC-MATCHES.md).

## Architecture and tuning

- `src/config/physics.ts`: units, measured starting constants, throttle/curvature curves, and explicitly tunable approximations.
- `src/car/`: firm raycast contact constraints, chassis clearance, surface-normal alignment, traction, jump/dodge state, and aerial angular control. Decorative meshes never determine collision.
- `src/physics/`: Rapier world, fixed-step accumulator, interpolated transforms, ball CCD, and supplemental strikes.
- `src/arena/`: shared original rounded shell geometry for rendering and collision.
- `src/input/`, `src/ai/`: device state and bot decisions produce the same controls.
- `src/game/`: scoring, clock, overtime, pause, boost pads and account/save coordination.
- `server/`: Fastify party/match server with anonymous session IDs; online account routes are removed.
- `shared/`: validated local identity, catalog, preferences and network types shared by client and server.
- `src/render/`, `src/camera/`, `src/effects/`, `src/audio/`, `src/ui/`: presentation independent of physics.
- `src/debug/`: F3 telemetry, collider wireframes, wheel rays, normals and hit impulses.
- `tests/calibration.ts`: measurements saved to `docs/calibration.json`.

Physics runs at 120 Hz with a bounded accumulator and previous/current pose
interpolation. Units are metres, with 100 reference game units per metre.
Read [physics sources and approximations](docs/PHYSICS.md) before changing gains.
The highest-value tuning controls are surface clearance, grip and P.powerslide,
contact alignment, dodge rate/cancellation, strike gains and camera smoothing.

## Credits and limitations

Three.js (MIT), Rapier (Apache-2.0), Vite (MIT), TypeScript (Apache-2.0), tsx (MIT).
Package licenses are distributed with their npm packages. Rajdhani Bold is distributed under the SIL Open Font License; see
[the bundled license](public/fonts/OFL.txt). Art and synthesized audio are original. User reference screenshots are ignored by version control
and are not part of the deployed game.

This is a playable first implementation, not a claim of exact physics parity.
Suspension, wall adhesion, powerslide, flip torque and strike gains are original
approximations. AI is intentionally basic. Gamepad hardware feel and sustained
performance on other devices need human playtesting. See the physics notes for
measured behavior and the remaining approximations.

The Graphics presets change resolution scale, shadow-map size, particle density
and FXAA. Audio has separate master/music/SFX/engine/UI buses; menu music is a
quiet original synthesized loop. Gameplay includes Show Hitboxes and infinite
boost for Free Play. All keyboard actions can be rebound in Controls; duplicate
bindings are highlighted. Arrow keys provide additional pitch/yaw bindings and
Alt is a dedicated air-roll modifier. Controller defaults remain unchanged.

See [validation results](docs/VALIDATION.md) and the current screenshots there.

## Latest update

Wall entry/boost contact, side-balanced recovery and camera transitions are
improved. Matches now start at 33 boost and support opponent demolitions with
three-second team-side respawns. Free Play is the only mode with reset controls.
Powerslides have slip-driven tire audio and temporary rear-wheel skid marks.
Subtle scoring planes show the ball intersection, and goals name the scorer.
Garage includes boost and click-to-play goal-explosion previews, robust dragging,
and scrollable layouts that keep Back accessible.
See [polish changes, physics measurements and verification](docs/POLISH-UPDATE.md).

Free Play now starts and resets instantly, without a match scoreboard or clock.
Both goals and their goal-line effects are neutral gray. Scoring plays a gray
goal explosion before resetting the field without a countdown or team score.
Goals reset training immediately. Its four training actions can be rebound in
Settings → Controls; repeated launch presses stack upward velocity. Surface-loss
dodges, held-throttle recovery, landing controls and upper goal corners are corrected.
See [gameplay corrections, changed files and verification](docs/GAMEPLAY-CORRECTIONS.md).

See [resume audit](docs/UPDATE-AUDIT.md), [implementation and verification](docs/MAJOR-UPDATE.md), [physics calibration](docs/PHYSICS.md), and [local profile replacement](docs/LOCAL-PROFILE.md).
