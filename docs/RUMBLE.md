# Rumble (0.1.7)

Rumble is a standard gamemode beside Soccar and Heatseeker. Select **Play > Against a Bot > Gamemode > Rumble**, or **Create Party > Start Game > Gamemode > Rumble**. Match formats, random standard arenas, cars, pads, goals, scoring, countdowns, zero-second play, overtime, stats and goal replay use the existing systems. Extra Modes remain unchanged.

Default **Use power-up**: keyboard **F**, controller **left-stick click (LS/L3)**. Both can be rebound in the existing Controls settings and are persisted. Legacy preferences acquire the new defaults without losing other bindings. The HUD displays cooldown, ready icon/name/binding, and remaining active time. Haymaker/Grapple/Plunger have a fading camera-facing ball target only inside activation range. The HUD sits above the existing camera label.

## Tuning and reference distinction

Edit **src/config/rumble.ts**, the single RUMBLE_CONFIG module. SI distances are metres, time seconds, impulses N*s, acceleration m/s^2. This game's ball mass is 50 kg, car mass 150 kg; existing caps remain 60 m/s ball and 23 m/s car. Changing the grapple pull cap alone does not override the existing global car speed cap.

The requested standard cooldown is **10 s per player**; equal initial item weights are 1:1:1:1:1. Active effects must finish before the next cooldown. A ready item never times out or rerolls. Timers freeze through countdown, pause and replay. Goals, kickoffs, demos, disconnects and match end remove powers/joints. At zero seconds, existing powers remain usable, but no new grants occur until overtime.

| Power | Initial Octane Arena tuning estimates | Implementation |
| --- | --- | --- |
| Haymaker | range 22 m, impulse 1,750 N*s (35 m/s added for a 50 kg ball before the usual cap) | Native additive ball impulse, exact car-to-ball direction at use; spin/momentum retained. Original shock ring/impact tone. |
| Grappling Hook | range 26 m, acceleration 65 m/s^2, pull speed 23 m/s, timeout 3.5 s | Pulls the car through its COM toward the current moving ball; no special ball acceleration, no rotation lock. Ends on real owner contact. Original cyan tether/tone. |
| Power Hitter | duration 6 s, total normal contact impulse x3, extra impulse cap 2,250 N*s | Adds directional impulse at the actual contact point with recoil. Applies once per distinct impact, not continuously. Any real opponent body contact demos, including already ongoing contact; teammates are safe. Existing ordinary demos can still demolish the powered car. Original electric arcs/tone. |
| Plunger | range 24 m, spring 110 N/m, damping 65 N*s/m, max force 2,500 N, duration 3 s | Ball attraction follows the current car using bounded spring/damping impulses, preserving sideways motion. No direct car acceleration; ends on real owner contact. Original orange tether/suction tone. |
| Spikes | duration 6 s, attachment tolerance 0.06 m, protection 1 s, break impulse 500 N*s | Actual roof/side/front/underside contact stored in local space. Native fixed joint couples two dynamic bodies, giving the ball real mass/handling effect. Arena/opponent collisions remain active; only the owner's ball contact is disabled. Release uses car COM linear velocity + angular contact velocity. Original roof/side/end spikes with extension animation and separate attachment impact sound. |

The break threshold is **impulse**, rather than force, so it has a consistent meaning across physics steps. Strong outside hits after protection consume Spikes; Haymaker can break or accelerate a carrier, Plunger interacts through the same dynamic joint, Grapple tracks an attached ball, and Power Hitter can demo its carrier. Body/ball containment recovery also ends attachment before moving bodies.

Behavioral sources: [Epic's official Rumble power descriptions](https://www.epicgames.com/help/c-37599050/c-32343914/a24486133?lang=en-US), [Psyonix's Tactical Rumble descriptions](https://www.rocketleague.com/news/new-ltm-tactical-rumble-starts-june-3?lang=en), and [RLBot's useful game values](https://wiki.rlbot.org/v5/botmaking/useful-game-values/) for scale. Tactical Rumble's alternative cooldown groups are not used as standard Rumble constants. These sources support the qualitative behaviors, not exact force/range/active-duration values. No reliable primary exact Power Hitter duration was found; **6 s is an initial estimate**. The protection window is also the requested initial approximation. No proprietary geometry, models, textures or icons were copied.

## Authority, input and replay

The existing PeerJS host worker or LAN server runs the same NetworkMatch/Simulation/Rumble at 120 Hz. Each player has independent state keyed by stable player ID. Only that authority rolls items, runs timers, validates range/input and applies forces, attachment/detachment and demos. Clients send the optional usePowerup input through existing sequenced packets. Quick press/release is latched once; held input cannot activate the next grant. Injected client item/impulse fields and invalid IDs are rejected. Shared snapshot validation checks unique roster IDs for powers/events too.

Snapshots include bounded power states and POWERUP_GRANTED/USED/STARTED/ENDED and SPIKE_ATTACHED/DETACHED events. Clients build effects locally: six reusable mesh/buffer slots, dynamic two-point tethers, simple original SVG icons, no rope physics or streamed geometry. Repeated event IDs cannot replay sounds. Goal history records bounded power snapshots at 20 Hz and at event changes. Replay renders stored effects/local attachments without creating joints, rerolling, applying impulses, repeating demos or scoring. Live powers clear on the scored goal; the preceding visual history remains in the clip.

Bots use basic range/alignment/position checks: useful-direction punches, moving-ball intercept grapples, nearby challenges with Power Hitter, forward/defensive Plunger pulls and near-ball Spikes. No perfect strategy or new bot skill tier was introduced.

## Verification

- npm test: full current gameplay regressions, including Rumble tests.
- npm run build: production frontend/host-worker build.
- npm run build --prefix server; npm test --prefix server: server build and 21 tests, including host-only Rumble setup, shared state, bot rosters and both transport modes.
- npm run test:rumble: deterministic timers/held-item/edge tests; additive momentum/direction/range/caps; moving grapple/car-only force and natural hit; moving Plunger/ball-only force and natural hit; real stronger Power Hitter impacts, continuous-contact suppression, slow demos, teammate safety and ordinary demo vulnerability; both car bodies with all four Spikes contact sides, aerial rotation, release/protection/break/reset, exact release-plus-punch impulse retention and all cross-power joint interactions; zero-second rules; actual goal/replay scoring/cleanup; immutable histories; reusable effects and sound deduplication.
- Rumble without active powers produces exactly identical car translation/rotation and ball velocity to Soccar over a deterministic 600-step throttle/boost/powerslide run.
- tests/rumble-browser.cjs: production Play selection at 1920x1080, 1366x768, 1280x720 and 600x720; countdown timer lock, random ready HUD, actual keyboard activation and mocked Gamepad API LS activation, in/out-of-range target, all five rendered effects, existing controls menu, zero browser errors. Screenshots: rumble-hud.png and rumble-spikes.png.
- tests/rumble-peer-browser.cjs: **two isolated Chrome sessions on this computer** used actual PeerJS Cloud signaling and WebRTC. Verified create/join, bidirectional ping/pong, synchronized Rumble selection, same roster/arena and host-owned random grants, real host input activation visible on both clients, HUD and clean leave. Static Pages-path assets made no application API requests. This is not a physical two-device, different-network, deployed-site or restrictive NAT test.

Optional browser tests need Playwright (PLAYWRIGHT_MODULE may point to an installed Playwright package) and Chrome. Build first, then run node tests/rumble-browser.cjs and node tests/rumble-peer-browser.cjs. The latter needs internet access to the existing PeerJS Cloud service and is not part of deterministic npm test.

Remaining manual tuning: all five initial force/range/duration estimates should be balanced through human play, especially grapple wall/aerial feel, the Plunger spring, Power Hitter strength and Spikes mass/break threshold. The automated checks do not replace real-controller comfort testing, long-duration multiplayer matches or two-device NAT testing. Existing bundle-size and Rapier initialization warnings are non-failing.

## Two-device test after deploying the new build

1. Both players load the updated normal GitHub Pages game (version 0.1.7); refresh cached old clients.
2. Host Create Party; guest Join Party with its six-character code.
3. Host Start Game, choose Rumble and a player format, then start or choose teams through existing setup.
4. After GO, each HUD starts its own 10-second timer. Confirm each receives an item, which remains held until used.
5. Move into range for targeted items and press F or rebound controller Use power-up. Observe authoritative ball/car response and matching effects on the other device.
6. Score: powers clear, existing goal replay plays, fresh kickoff timers start. Leave/rejoin and ensure roster, connection, HUD and power state are clean.

The existing PeerJS Cloud signaling dependency remains; no new account, keys or API URL were introduced for Rumble. These local changes have not been pushed or deployed.
