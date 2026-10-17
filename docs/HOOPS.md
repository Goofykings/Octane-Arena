# Hoops: Neighborhood Court

Hoops uses the normal gamemode carousel in Against Bots and party match setup. There is no dedicated Hoops button or page. Selecting Hoops defaults to 2v2; existing size controls still allow other formats. Free Play retains its Hoops arena selection. The same mode, rules, court and basketball skin are used in solo play, parties, spectating and replays.

## Court and hoop geometry

Dimensions remain centralized in `shared/hoops.ts` (`HOOPS_CONFIG`): court 59.3334 x 71.62 m, ceiling 18.2 m, rim height 3.64 m, front arc radius 6.55 m, pipe diameter 0.42 m. Kickoff positions, boost pads and court shell are unchanged by this polish pass.

The giant solid bank has been removed from both rendering and physics. Each hoop is now an exposed front semicircle with two straight side rails ending in the back wall. There is no rear circular rim or hidden rear collider. Rounded static capsules follow the same centerline as the visible pipe. The backboard remains flush with the arena wall.

A thin translucent line grid and faint mesh veil surround the lower basket. The shared net vertices also define the ball-only static collider. Its foot curls outward only 0.32 m over 0.4 m of height; it is not a launch ramp. No cloth simulation or dynamic net bodies are needed. Open net triangles use two-sided contact rather than the closed-shell pseudo-normal flags, so balls rebound from either side. The watertight court retains its existing internal-edge handling.

Hoops-only collision memberships distinguish cars (1), ball (2) and nets (4). Net filters accept only ball membership. All rigid wheel-clearance, wheel-contact, chassis sweep and camera queries also exclude nets; masks alone would not stop custom raycasts from treating a net as a surface. Arena/rim and car/ball contacts remain enabled. Resets, player rebuilds and demolition respawns preserve these memberships. Other modes retain their original masks and contact behavior.

Scoring sweeps the downward crossing of the rim plane and checks full mutated-ball clearance against the D-shaped aperture. Upward/underneath/outside entries do not score. Both the exposed front arc and wall-side opening are supported; there is no obsolete full-circle rear scoring boundary. Existing scores, stats, goal explosions, replay flow and overtime are reused.

## Neighborhood art and visibility

Original low-poly apartments, houses, shop awnings/signs, roof trim/vents, sidewalks, streets, streetlights, planters, trees and parked decorative cars sit outside the court. Most buildings are neutral, with subdued blue or orange signs, awnings and lamps on their corresponding halves. These objects have no physics colliders. Shared box geometry/materials and instanced windows keep the exterior inexpensive; no extra shadow-casting light array is used.

The hardwood court retains subtle panel grain, center rings, basket paint and clear boundaries. Team-colored perimeter strips, lower wall panels and angular midcourt accents identify each half without flooding the floor. Upper wall/ceiling visuals are transparent while their existing collision shell stays intact.

Buildings are set back from the court and registered with the existing camera obstruction fading system. Cameras can still cross gameplay walls; the net does not shorten the camera boom or alter surface orientation queries. Lighting restores correctly when switching back to another arena.

## Verification

`npm test` includes `tests/hoops.ts`: swept scoring, large-ball/gravity mutators, watertight shell, kickoff lock/jump ball, pads, car passage through both nets at floor and flight heights in both directions, exact trajectories compared with nets removed, two-sided ball/net rebounds, exposed rim contacts, no hidden rear rim, scoring/replays/stats, host snapshots, ordinary-input bots, camera stability and Soccar restoration.

`tests/hoops-browser.cjs` checks the rendered net/neighborhood, normal bot-mode carousel, Free Play driving/controls, scoring, replay/reset, live stats and returning to Soccar/training. `tests/hoops-peer-browser.cjs` checks real PeerJS Cloud/WebRTC between three isolated browser sessions, host-only Hoops selection, synchronized court/pads, driving, spectators and cleanup. Screenshots are ignored artifacts in `.tools/`.

These browser tests are not a physical two-device/NAT or controller hardware test. Visual net deformation is intentionally omitted; ball response is physical while the lightweight net grid remains static. Bot shot consistency and net restitution can still benefit from human gameplay tuning.
