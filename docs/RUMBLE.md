# Rumble and match results (0.1.9)

Rumble is a standard gamemode beside Soccar and Heatseeker. Select **Play > Against a Bot > Gamemode > Rumble**, or **Create Party > Start Game > Gamemode > Rumble**. Match formats, random standard arenas, cars, pads, goals, scoring, countdowns, zero-second play, overtime, stats and goal replay use the existing systems. Extra Modes remain unchanged.

Default **Use power-up**: keyboard **F**, controller **left-stick click (LS/L3)**. Both can be rebound in the existing Controls settings and are persisted. Legacy preferences acquire the new defaults without losing other bindings. The HUD displays cooldown, ready icon/name/binding, and remaining active time. Grapple displays ACTIVE until real ball contact. Haymaker/Grapple/Plunger have a fading camera-facing ball target only inside activation range. The HUD sits above the existing camera label.

## Tuning and reference distinction

Edit **src/config/rumble.ts**, the single RUMBLE_CONFIG module. SI distances are metres, time seconds, impulses N\*s, acceleration m/s^2. This game's ball mass is 50 kg, car mass 150 kg; existing caps remain 60 m/s ball and 23 m/s car. The grapple approach target does not override the existing global car speed cap.

The requested standard cooldown is **10 s per player**; equal initial item weights are 1:1:1:1:1:1. Active effects must finish before the next cooldown. A ready item never times out or rerolls. Timers freeze through countdown, pause and replay. Goals, kickoffs, demos, disconnects and match end remove powers/joints. At zero seconds, existing powers remain usable, but no new grants occur until overtime.

| Power          | Initial Octane Arena tuning estimates                                                                                   | Implementation                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haymaker       | range 22 m, impulse 1,750 N\*s (35 m/s added for a 50 kg ball before the usual cap)                                     | Native additive ball impulse, exact car-to-ball direction at use; spin/momentum retained. Original red fist travels in 0.08 s; gameplay impulse is synchronous at activation, independent of visual travel.                                                                                                                                                                                                 |
| Grappling Hook | range 26 m, lead 0.12 s, pull gain 1.5/s, velocity damping 6/s, acceleration cap 38 m/s^2, target approach 14 m/s, near-contact target 10 m/s (safety cap 16 m/s) | COM impulses pursue current ball position and velocity with a short lead; closing target decreases with distance, lateral relative velocity is damped. Grounded lift bias 3.5 m/s^2 and temporary tire-load scale 0.08 avoid lateral tire lock; base driving remains unchanged. NO timeout/proximity end: actual owner contact or exceptional lifecycle cancellation only. Thick tapered team-color tube.   |
| Power Hitter   | duration 6 s, total normal contact impulse x3, extra impulse cap 2,250 N\*s                                             | Adds directional impulse at the actual contact point with recoil. Applies once per distinct impact, not continuously. Any real opponent body contact demos, including already ongoing contact; teammates are safe. Existing ordinary demos can still demolish the powered car. Original electric arcs/tone.                                                                                                 |
| Plunger        | range 24 m, spring 110 N/m, damping 65 N\*s/m, max force 2,500 N, duration 2 s (tuning estimate)                        | Ball attraction follows the current car using bounded spring/damping impulses, preserving sideways motion. No direct car acceleration; ends on real owner contact. Thick tapered team-color tube/suction tone.                                                                                                                                                                                              |
| Spikes         | duration 6 s, attachment tolerance 0.06 m, protection 1 s, break impulse 500 N\*s                                       | Actual roof/side/front/underside contact stored in local space. Native fixed joint couples two dynamic bodies, giving the ball real mass/handling effect. Arena/opponent collisions remain active; only the owner's ball contact is disabled. Release uses car COM linear velocity + angular contact velocity. Original roof/side/end spikes with extension animation and separate attachment impact sound. |

The break threshold is **impulse**, rather than force, so it has a consistent meaning across physics steps. Strong outside hits after protection consume Spikes; Haymaker can break or accelerate a carrier, Plunger interacts through the same dynamic joint, Grapple tracks an attached ball, and Power Hitter can demo its carrier. Body/ball containment recovery also ends attachment before moving bodies.

Behavioral sources: [Epic's official Rumble power descriptions](https://www.epicgames.com/help/c-37599050/c-32343914/a24486133?lang=en-US), [Psyonix's Tactical Rumble descriptions](https://www.rocketleague.com/news/new-ltm-tactical-rumble-starts-june-3?lang=en), and [RLBot's useful game values](https://wiki.rlbot.org/v5/botmaking/useful-game-values/) for scale. Tactical Rumble's alternative cooldown groups are not used as standard Rumble constants. These sources support the qualitative behaviors, not exact force/range/active-duration values. No reliable primary exact Power Hitter duration was found; **6 s is an initial estimate**. The protection window is also the requested initial approximation. No proprietary geometry, models, textures or icons were copied.

## Authority, input and replay

The existing PeerJS host worker or LAN server runs the same NetworkMatch/Simulation/Rumble at 120 Hz. Each player has independent state keyed by stable player ID. Only that authority rolls items, runs timers, validates range/input and applies forces, attachment/detachment and demos. Clients send the optional usePowerup input through existing sequenced packets. Quick press/release is latched once; held input cannot activate the next grant. Injected client item/impulse fields and invalid IDs are rejected. Shared snapshot validation checks unique roster IDs for powers/events too.

Snapshots include bounded power states and POWERUP_GRANTED/USED/STARTED/ENDED SPIKE_ATTACHED/DETACHED and SWAP events. Clients build effects locally: six reusable mesh/buffer slots, pooled tapered cylinder tethers, simple original SVG icons, no rope physics or streamed geometry. Repeated event IDs cannot replay sounds. Goal history records bounded power snapshots at 20 Hz and at event changes. Replay renders stored effects/local attachments without creating joints, rerolling, applying impulses, repeating demos or scoring. Live powers clear on the scored goal; the preceding visual history remains in the clip.

Bots use basic range/alignment/position checks: useful-direction punches, moving-ball intercept grapples, nearby challenges with Power Hitter, forward/defensive Plunger pulls, near-ball Spikes and Swapper when an in-range opponent is closer to the ball. No perfect strategy or new bot skill tier was introduced.

## Verification

- npm test: full current gameplay regressions, including Rumble tests.
- npm run build: production frontend/host-worker build.
- npm run build --prefix server; npm test --prefix server: server build and 21 tests, including host-only Rumble setup, shared state, bot rosters and both transport modes.
- npm run test:rumble: deterministic timers/held-item/edge tests; additive momentum/direction/range/caps; moving grapple/car-only force and natural hit; moving Plunger/ball-only force and natural hit; real stronger Power Hitter impacts, continuous-contact suppression, slow demos, teammate safety and ordinary demo vulnerability; both car bodies with all four Spikes contact sides, aerial rotation, release/protection/break/reset, exact release-plus-punch impulse retention and all cross-power joint interactions; zero-second rules; actual goal/replay scoring/cleanup; immutable histories; reusable effects and sound deduplication.
- Rumble without active powers produces exactly identical car translation/rotation and ball velocity to Soccar over a deterministic 600-step throttle/boost/powerslide run.
- tests/rumble-browser.cjs: production Play selection at 1920x1080, 1366x768, 1280x720 and 600x720; countdown timer lock, random ready HUD, actual keyboard activation and mocked Gamepad API LS activation, in/out-of-range target, all five rendered effects, existing controls menu, zero browser errors. Screenshots: rumble-hud.png and rumble-spikes.png.
- tests/rumble-peer-browser.cjs: **two isolated Chrome sessions on this computer** used actual PeerJS Cloud signaling and WebRTC. Verified create/join, bidirectional ping/pong, synchronized Rumble selection, same roster/arena and host-owned random grants, real host input activation visible on both clients, HUD and clean leave. Static Pages-path assets made no application API requests. This is not a physical two-device, different-network, deployed-site or restrictive NAT test.

Optional browser tests need Playwright (PLAYWRIGHT_MODULE may point to an installed Playwright package) and Chrome. Build first, then run node tests/rumble-browser.cjs and node tests/rumble-peer-browser.cjs. The latter needs internet access to the existing PeerJS Cloud service and is not part of deterministic npm test.

Remaining manual tuning: all six initial force/range/duration estimates should be balanced through human play, especially grapple wall/aerial feel, the Plunger spring, Power Hitter strength and Spikes mass/break threshold. The automated checks do not replace real-controller comfort testing, long-duration multiplayer matches or two-device NAT testing. Existing bundle-size and Rapier initialization warnings are non-failing.

## Two-device test after deploying the new build

1. Both players load the updated normal GitHub Pages game (version 0.1.7); refresh cached old clients.
2. Host Create Party; guest Join Party with its six-character code.
3. Host Start Game, choose Rumble and a player format, then start or choose teams through existing setup.
4. After GO, each HUD starts its own 10-second timer. Confirm each receives an item, which remains held until used.
5. Move into range for targeted items and press F or rebound controller Use power-up. Observe authoritative ball/car response and matching effects on the other device.
6. Score: powers clear, existing goal replay plays, fresh kickoff timers start. Leave/rejoin and ensure roster, connection, HUD and power state are clean.

The existing PeerJS Cloud signaling dependency remains; no new account, keys or API URL were introduced for Rumble. These local changes have not been pushed or deployed.

## Swapper

Swapper is the sixth equally weighted power. Authority selects the nearest enabled, non-demolished, connected opponent within **28 m**, ignoring teammates; a **0.75 m** hysteresis keeps near-equal targets steady. The HUD projects that authoritative target's ID, never independently selects a target. No valid target means no activation or consumption.

The receiving car's convex collider is tested at the destination using its own orientation. Bounded position-only correction adds a 0.015 m clearance; placements needing over 2 m or entering goal interiors/outside the arena are rejected atomically. Both bodies exchange only locations; each retains its own quaternion and linear/angular velocities. Attached Spikes detach first to prevent a stretched joint. Contact history is invalidated; per-car teleport sequences prevent live and replay interpolation from streaking the cars across the field, including short swaps.

One authoritative SWAP event contains source/destination and both IDs. Clients render pooled endpoint flashes, a connecting warp tube, and arrival pulse for **0.3 s**. Clients never execute the swap themselves. Version 0.1.9 prevents mixing incompatible replay strides/power enums.

## Final results

The same MatchOverlay scoreboard moves into the final results shell; rows read final authority stats by stable player ID. BLUE/ORANGE final score stays visible until a choice is made. MVP sorts all players by score, goals, assists, saves, shots, then original roster order. A row badge and one top notification use the existing 200 ms enter / 1000 ms hold / 200 ms exit award animation, without granting points.

Play Again is single-player or host-only. A single authority rematch action creates a fresh match ID, reuses mode/team roster and applies the existing non-repeating random arena selection. Local bot difficulty/format are retained. New Match/Simulation state clears scores, stats, powers and replay; renderer preparation/readiness is repeated for all clients. Home preserves the party: the host returns the party home; a guest may browse home while retaining its connection and rejoins presentation when the host starts a new match. Leave Party uses existing disconnect cleanup. Results buttons use the existing controller focus scopes.

## Focused verification

- tests/rumble-update.ts: enemy targeting/hysteresis/demo/disconnect, placement, exact preserved pose/momentum, bounded pursuit on floor and moving/fast/lateral approaches with real Rapier contact, no-contact indefinite grapple, shorter Plunger, deterministic MVP and short-swap replay discontinuity.
- tests/rumble-effects.ts: fixed buffers/object count, team-colored thick tethers, 80 ms fist travel, 300 ms warp/endpoints and disposal.
- tests/results-rumble-browser.cjs: production UI, actual Swapper input/lock-on, final rows/score/MVP animation timing, responsive results and controller navigation, local fresh Rumble rematch/Home.
- tests/results-peer-browser.cjs: two isolated browsers with real PeerJS Cloud/DataChannels; a test-only final-snapshot boundary fixture exercises host-to-client results replication, guest Home, host rematch/reloading, host Home and Leave Party. The fixture does not claim a naturally played full match or physical two-device/NAT verification.
- server/tests/rumble.test.ts: server/WebRTC rematch authority, settings, fresh match ID, stats and arena rules.

All powers remain initial Octane Arena tuning values. Human feel testing can adjust the centralized config, particularly pursuit gains/lift and Swapper range; no exact Rocket League active-duration claim is made.

Grapple continuation tuning retains a stronger final approach instead of decelerating toward 3 m/s. The 14 m/s cruise target tapers to 10 m/s near contact, with the same bounded pursuit/lateral damping and actual-contact termination. See [CONTINUATION-POLISH.md](CONTINUATION-POLISH.md).
