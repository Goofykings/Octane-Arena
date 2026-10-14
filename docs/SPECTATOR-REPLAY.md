# Multiplayer spectators and goal replays

## Initial audit

- Already working: PeerJS party/session transport, host-owned physics, car IDs, bots, live stats/MVP, competitive goal replays, training replays, unanimous human skip votes, and the existing keyboard/controller/mouse abstractions.
- Required correction: party format restrictions, exact-fill start validation, replay framing that included the distant goal, and nametags hidden by replay/HUD state.
- Not previously implemented: explicit spectators, spectator cameras/input, and Free Play goal replays.

## Completed checklist

- [x] Parties support up to eight session members independently of the six-car simulation limit.
- [x] Host can select 1v1, 2v2, 3v3, 1v2, 1v3, or 2v2 against bots regardless of extra party members.
- [x] Selected sizes impose team caps. One Blue and one Orange participant suffice; bot mode supplies its two Orange bots.
- [x] Empty slots remain empty. Exceeding a team cap is rejected by both authorities and disabled in the UI.
- [x] Spectate is a third team-screen option, selectable with mouse or controller.
- [x] PartyTeam explicitly distinguishes 0, 1, spectator, and unassigned/null. Unassigned members become spectators at launch.
- [x] partyRoster contains only actual car owners and mode bots; watchers have no match car/body, boost, kickoff slot, personal nametag, stats, scoreboard row, or MVP eligibility.
- [x] Session identities are separate from active-car identities. Snapshots, scene preparation, chat, replay packets, and results still reach watchers.
- [x] Spectator car inputs are never transmitted and are rejected by authority. Roles stay fixed during a match.
- [x] Leaving a spectator session does not end the match. Disconnected watchers stop receiving state and cannot send chat.
- [x] Per-match sender metadata is retained for existing chat. Client snapshot validation keeps the initial authenticated session IDs, so messages from departed watchers do not freeze remaining clients.
- [x] Player camera cycling includes humans and bots, using the existing GameCamera rig with spectator-local look.
- [x] Ball camera follows/orbits the ball without a car target.
- [x] Free camera has no collision, floor, wall, ceiling, or arena limits.
- [x] Bottom-center arrows/caption and dedicated bindable spectatePrevious/spectateNext actions work with keyboard/controller.
- [x] Mouse capture uses existing relative deltas; starting a drag without moving the pointer preserves the view.
- [x] Chat and menus block spectator movement and camera cycling without interfering with scoreboard input.
- [x] Replay temporarily overrides spectator view, then smoothly restores its saved mode/target/free-camera position.
- [x] Active humans determine unanimous replay skip. Spectators cannot vote or block skipping.
- [x] Spectators see final scores, the active-player leaderboard, MVP, and role-appropriate post-match controls.
- [x] Soccar, Heatseeker, Rumble, bot/party matches, Free Play, and existing appropriate training goals use the replay pipeline.
- [x] Free Play preserves zero match score, neutral goal effects, and its no-countdown reset after replay completion/skip.
- [x] Dribble Challenge keeps its separate completion behavior; Rings does not acquire soccer goal replays.
- [x] Replay director starts at a closer 9 m composition rather than 13 m. The ball is always the main reference; only the scorer/ball pair around final touch can enlarge framing. The goal and other cars do not drive zoom.
- [x] Replay camera motion and FOV remain eased; slow-motion clock behavior is unchanged.
- [x] All relevant replay car labels project recorded model transforms against the replay camera, with stable IDs, display names, and team colors. A shared layer outside the hidden gameplay HUD covers local, network, and training replays.
- [x] Legacy saved preferences receive defaults for the new spectator bindings.
- [x] Car physics, map/collision geometry, presets, and gameplay tuning remain unchanged.

## Default spectator controls

- Cycle: comma/period, controller D-pad left/right, or the on-screen arrows.
- Player/ball view: mouse drag or right-stick look.
- Free camera: WASD or left stick. Forward/backward triggers are also supported.
- Up: Jump (Space / A / Cross). Down: Powerslide (Ctrl / X / Square).
- Faster: Boost (Shift / B / Circle).
- Free camera speed: bottom-center number field, 1-100 m/s; default 16 m/s, sprint multiplier 2.5. Defaults are in src/camera/spectator.ts.
- Existing control settings can remap the reused actions and the new camera-cycle actions.

## Implementation modules

- shared/party.ts and shared/peer-party.ts: caps, validation, roles, and PeerJS party authority.
- shared/match-roster.ts, shared/network.ts, shared/rtc.ts: car roster versus session metadata and six-car packet validation.
- src/game/network.ts, src/network/authority-worker.ts, src/game/authoritative-match.ts, server/src/network.ts, server/src/parties.ts: spectator delivery, input rejection, chat history, and disconnect handling.
- src/camera/spectator.ts and src/render/network-match.ts: view-only cameras and snapshot rendering.
- src/ui/party-flow.ts, src/ui/party-panel.ts, src/ui/match-overlay.ts, src/ui/ui.ts, src/main.ts, src/style.css: selection, chat identity display, controls, and role-aware HUD.
- shared/controls.ts, shared/controller.ts, shared/accounts.ts: bindable actions and preference migration.
- src/game/match.ts, shared/replay.ts, src/replay/director-camera.ts, src/replay/scene-playback.ts, src/ui/replay-nametags.ts, src/ui/replay-panel.ts: Free Play recording, neutral effects, tight camera, labels, and skip presentation.

## Verification

- npm test: passed the full existing regression sequence plus the new spectator/replay tests.
- npm run build: passed.
- npm run build --prefix server: passed.
- npm test --prefix server: 23 passed; none skipped.
- tests/replay.ts: passed close framing/ball visibility at three aspect ratios, smooth camera/FOV, real goal/replay state, Free Play scoreless reset, and replay isolation.
- tests/spectator-replay.ts: passed partial teams/caps, spectator roster and authority checks, six-car Rumble packets, all competitive replay modes, active-human voting, departing-watcher history, and preference migration.
- server/tests/spectator.test.ts: passed spectator lifecycle for both server and WebRTC party routes.
- tests/spectator-browser.cjs: real PeerJS Cloud party with three isolated Chrome sessions, native authoritative startup, controller Spectate selection, no watcher car/stats/inputs, live chat, keyboard/controller camera cycling, mouse capture, free flight above ceiling, menu input isolation, host spectating, both bot camera targets, and continued snapshots after watcher chat/departure.
- Multiplayer replay/results presentation uses deterministic Worker-message fixtures through the real PeerJS delivery path; actual goal generation and skip authority are separately exercised by the native match tests.
- tests/replay-modes-browser.cjs: actual goal -> replay -> skip/reset in Free Play/Soccar/Heatseeker/Rumble, visible local replay names, neutral Free Play explosion, frozen live physics, and shared Striker training replay labels.
- Screenshots were checked for closer readable ball/car framing and readable replay labels. No temporary product debug APIs were added.

## Practical limits

Three browser sessions were tested on this computer, including real PeerJS Cloud connections. Separate physical devices, different NATs, and physical controller hardware still need a manual check; the controller tests use the browser Gamepad API with a standard-pad fixture. Mid-match role changes remain future work as requested. Free camera speed and close replay framing may be tuned after playtesting; no unfinished implementation is known.
