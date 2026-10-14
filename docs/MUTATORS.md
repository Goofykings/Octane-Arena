# Garage presets and match mutators

Garage presets now have small rename/delete controls on every saved row. Rename uses a focused dialog (Enter saves, Escape cancels), trims names, rejects empty/control-character names and caps names at 32 characters. Names and stable preset IDs survive the existing garage save/load. Delete requires confirmation, operates on the preset ID, and chooses another equipped preset if needed. The final remaining preset cannot be deleted. Existing cosmetics and profile storage are preserved. Controller navigation uses the game's existing focus manager; native text entry uses a keyboard as in existing name fields.

## Setup

Against Bots -> MUTATORS. Party -> START GAME -> MATCH SETUP -> MUTATORS.
Nine compact carousel rows in two side-by-side lists, Back, and Reset to Default. All rows fit without scrolling. Controller D-pad/stick moves between rows; Left/Right changes the selected option; A activates buttons and B goes back. Party guests see a read-only view of host settings. Set options before entering team selection; return to Match Setup to change them.

Local choices are saved in octane-arena-mutators. Hosts initialize a new party with their local choices. Guest party state never writes guest preferences. No mutators are exposed in Free Play, Rings, Dribble or Training; these retain the default world. Normal public matchmaking remains unchanged.

## Options and tuning

These are original game tuning values, not Rocket League engine constants. Menu names (except custom extensions below) follow the historical official options listed in [Rocket League v1.08](https://www.rocketleague.com/news/patch-notes-v1-08?lang=en).

| Mutator         | Choices / numerical mapping                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Match Length    | 5 Minutes = 300s, 10 = 600s, 20 = 1200s, Unlimited = no countdown/end/zero-second/overtime rule; existing Leave Match still works                                                             |
| Boost Amount    | Default: normal pads/consumption. No Boost: zero, no pickup. Unlimited: 100, no consumption. Recharge Slow: +5 points/s. Recharge Fast: +15 points/s; both retain normal pads and consumption |
| Boost Strength  | 1x / 1.5x / 2x / 10x multiplies boost ground/air acceleration only. Car speed cap = base cap x square root of multiplier                                                                      |
| Gravity         | Default 1x / Low 0.5x / High 1.5x / Super High 2.5x                                                                                                                                           |
| Air Jumps       | Default: existing timed dodge/reset behavior. 2 / 3 usable actions after the surface jump. Infinite: one action per valid press edge, unlimited count                                         |
| Ball Max Speed  | Default 1x / Slow 0.6x / Fast 1.3x / Super Fast 1.75x                                                                                                                                         |
| Ball Physics    | Very Heavy 3x / Heavy 1.75x / Default 1x / Light 0.65x / Very Light 0.35x mass; gravity unchanged                                                                                             |
| Ball Size       | Small 0.7x / Default 1x / Large 1.3x / Gigantic 1.65x radius, collider and model                                                                                                              |
| Ball Bounciness | Low 0.5x / Default 1x / High 1.25x / Super High 1.5x restitution; capped at 0.92                                                                                                              |

Baseline: gravity 6.5 m/s^2, car cap 23 m/s, ground boost 9.91666 m/s^2, airborne boost 10.58333 m/s^2. For current baseline ball mass/radius/cap/restitution see src/config/physics.ts. Adjust ratios/options centrally in shared/mutators.ts; derived match-scoped physics lives in src/config/mutators.ts. Selecting all defaults returns the exact baseline physics object. No shared P constants are written by gameplay mutators.

Air Jumps and Very Heavy are custom extensions. Very Light corresponds to the historical Super Light option. Approximate gravity/weight/size/bounce/speed ratios need subjective play tuning; they are deliberately not claimed as exact Rocket League values. Strong boost raises only the final speed cap, preserving throttle acceleration and steering/grip parameters. Supplemental strike impulses remain calibrated to baseline mass, allowing actual rigid-body mass to control velocity change; support reactions use actual mass.

## Authority and modes

One validated, immutable MatchMutators configuration is published with party state. Only the host can change it; changes clear ready flags and are rejected after entering team selection/match. The same config is passed to the existing authority worker or LAN/server NetworkMatch at startup, carried in snapshots, and checked against party configuration by guests. Clients render the host's ball size/config and never choose their own physics. Replay clips preserve the match config and apply the recorded ball size.

Bots and humans share the same simulation config. Predictions/stat threat checks use the current gravity, ball radius, restitution, mass and cap. Goal-plane/fully-crossed detection and height/camera framing use the mutated radius. Arena and goal meshes, collision shell, pad positions and kickoff coordinates are unchanged.

Heatseeker deliberately scales its starting speed, progression and maximum by the ball-speed ratio. Homing impulses compensate the current mass/gravity to preserve the mode's intended steering curve; physical collision response still uses the selected mass/bounce/size. Rumble radius-sensitive attachments/range checks use current radius and existing impulses use the actual selected mass. Neither mode silently overrides the selected timer, boost, jumps, gravity or collider. Unlimited Rumble still grants power-ups normally.

Returning Home resets the local world and ball visual to baseline. Every new match gets its own config; Free Play explicitly restores defaults. Extreme combinations remain novelty settings: AI skill is unchanged and cannot be expected to exploit infinite jumps or 10x boost optimally.

## Verification

npm run test:mutators covers every individual selection, boost consumption/recharge/pads, physical gravity/boost response, finite/infinite press-edge counts, real flip resets, stalls, default equivalence, mass/launch/recoil ordering, restitution rebound ordering, radius-aware goal rejection/prediction, both requested combinations in the real arena, host authority/snapshot parsing, Heatseeker/Rumble and replay config preservation. Each extreme combination runs 2,400 physics ticks with finite-state and zero containment-recovery assertions. This verifies the specified scenarios, not every possible extreme-angle trajectory.

server/tests/mutators.test.ts covers validated host-only updates, guest visibility, immutable match config and native authoritative physics.

tests/mutators-browser.cjs serves the production dist build and exercises garage dialogs, local persistence, empty-name rejection, cancel/delete/fallback, simulated Gamepad API navigation, four window sizes, local Bot/Free Play/Home flows, two isolated browser contexts with real PeerJS Cloud signaling and data channels, live host/guest mutator updates, denied guest mutation, authority-worker match startup, and shared ball size/gravity/boost/timer. It does not prove two physical devices across different NATs. It uses no fabricated gameplay snapshots.

Run browser validation after building: set PLAYWRIGHT_MODULE to an available Playwright package and run node tests/mutators-browser.cjs. It uses installed Chrome and a temporary local static server; generated screenshots/logs stay in ignored .tools.

Final verification: full npm test passed; frontend production build passed; server build passed; server test suite passed all 24 tests. Production Chrome browser validation passed both garage/local flows and two actual PeerJS sessions with native authority-worker match startup. The screenshot was visually inspected. Controller navigation was tested through a simulated browser Gamepad API device, not physical controller hardware. Two physical devices across different NATs remain a manual connection check.
