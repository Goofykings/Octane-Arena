# Extra Modes / Rings

Open **Play → Extra Modes → Rings**. Extra Modes replaces Ranked and sits to the
right of the normal Play cards. The extra-mode registry in `src/extra/session.ts`
supplies the menu entries and session factories. `ExtraSession` exposes lifecycle,
render scene, vehicle and readout interfaces; the main loop does not run soccer
match rules for an extra mode.

Rings has a separate Rapier world and Three scene, created only when launched.
It contains one normal `Car`, two platform colliders and 40 static ring colliders.
There is no ball, bot, stadium shell, goal, kickoff, soccer scoreboard, boost pad
or arena containment backstop in that world. Existing soccer worlds and their
physics are unchanged. The existing `GameCamera` accepts worlds without a ball;
Rings always uses Car Cam. Exit restores the previous camera position, orientation,
field of view and range, and disposes the course scene/world without recreating
the renderer or reloading the page.

## Course and physics

`src/extra/course.ts` defines a deterministic, versioned 40-ring layout. The start
deck is 45.5% of a normal field footprint, with the selected arena's palette,
surface treatment, edge strips and launch chevrons. The car faces Ring 1. The
finish deck follows Ring 40 and has an original black-and-white checker pattern.

| Rings | Color mix                | Opening radius                     | Path                                                             |
| ----- | ------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| 1–10  | 9 green, 1 yellow        | Green 6 m; yellow 3.2 m            | Wider S-bend, climbs and drops, first precision gate at 10       |
| 11–29 | 14 green, 5 yellow       | Green 6 m; yellow 3.2 m            | Sweeping turns and varying elevation with spaced precision gates |
| 30–40 | 4 green, 4 yellow, 3 red | Green 6 m; yellow 3.2 m; red 1.6 m | Tighter turns and elevation changes, isolated red challenges     |

Ring spacing narrows from 18 m to 12.5 m. Adjacent headings stay within a forward
sweep; the course contains no random generation or hidden reverse turns.

One torus geometry (10 tube divisions × 48 circular segments, 960 triangles) is
reused by a 40-instance render mesh. Each static Rapier trimesh uses the same
vertices, scale, translation and rotation as its visible torus. Both periodic
seams are welded exactly and Rapier's internal-edge normal treatment is enabled.
Each ring is one collider, rather than many boxes or capsules. Normal car CCD,
contact constraints and velocity limits apply; touching a ring does not itself
reset the run. There are no additional ring attraction or flying forces.

Unlimited boost changes availability only. Car acceleration, aerial angular
controls, jump/dodge behavior, collision response, speed limits and boost visuals
remain the shared normal implementations.

## Progress, failure and finish

The run examines the previous/current car positions in the required ring's local
frame. A forward plane crossing counts only when its interpolated intersection
falls inside the opening, allowing a small margin based on car body dimensions.
Only the current checkpoint can advance progress. Backward crossings and future
rings cannot award a skip. A swept segment can handle multiple valid crossings
in chronological order.

Moving beside or beyond a ring is allowed and never resets the attempt. A missed
ring leaves ordered progress unchanged; the player can turn back to it. Falling below the
course's −6 m failure plane resets immediately, even far from the platforms.

Ring tubes are slightly thicker, using radius 0.07 instead of 0.055 in the shared
visual/collision torus. Inner openings retain their previous sizes. A lightweight
instanced layer of white sphere clouds sits below the course. Clouds have no
colliders, and their upper edges are at least 12 m below the failure plane, so
normal falling resets the car before it reaches them.

Restart/failure calls `Car.reset`, refills boost, snaps interpolation history and
clears checkpoint/time/pause state. The session clears its fixed-step accumulator,
camera history and vehicle effect trails. Neither the renderer nor level geometry
is recreated. Restart works via the on-screen button, **R**, or the configured
training-reset binding (default **1**); Escape opens the mode menu. Settings and
focus/visibility loss pause the run.

The finish needs all 40 checkpoints and an actual platform chassis/wheel contact.
Being above the platform or landing there early cannot complete the run. Completion
freezes the result, saves the best time and provides Restart and Exit controls.

## Timing, records and visuals

The top-left HUD shows elapsed time, completed rings and farthest progress.
Timing starts with driving, jumping, boosting or actual movement, using the
browser's high-resolution `performance.now()` time. Loading/idle and paused time
are excluded; physics still advances at the normal fixed timestep. Millisecond
formatting does not assume a frame rate.

`ExtraRecords` uses the same guarded, namespaced localStorage pattern as settings
and the garage, with a course-version key: `octane-arena-extra-skyline-40-v2`.
The earlier layout's v1 records remain stored separately so its times are not
compared with the revised course.
Best progress only increases; best completed time only improves. Invalid or
unavailable storage falls back to session records. Records are local to the
browser; Rings does not add account/server synchronization.

The current ring is brighter and has a subtle colored highlight. Passed rings
dim; future rings remain visible. Green/yellow/red difficulty colors remain.
The mode uses two ordinary scene lights, one instanced ring draw, shared geometry
and materials, small generated textures and the existing graphics presets. All
course GPU resources and the physics world are released on exit.
The tested scene used 51 draw calls and 41,344 triangles across the rendering
passes. Repeated exits verified disposal of every Rings geometry, material,
texture and instanced-mesh buffer directly, rather than interpreting changing
normal-arena visibility as a mode resource leak.

## Verification and continuation audit

The menu, mode world, course, collision, state machine, HUD, persistence and finish
were already implemented before the continuation. The earlier browser acceptance
checks, normal-mode regressions and first-ten-ring flights passed. The unfinished
work was full-course flight verification, explicit rendering/resource checks,
final documentation/build and removal of temporary investigation scripts.

The temporary full-course guidance controller failed at Ring 32 because it forced
positive forward acceleration even while requesting a lower target speed. Its
thrust-derived right axis also flipped during braking. Correcting the QA controller
to permit braking with a continuous course-facing axis verified all 40 rings with
both bodies using only ordinary `PlayerInput`; no product flight physics or course
layout was changed to satisfy that test. The controller exists only in tests.

Final verification found and corrected two integration issues: exit now restores
the camera's full previous pose/projection, and the Car Cam label sits above
Restart/Menu rather than behind them. A normal LAN regression also exposed a
pre-existing production-path mismatch: the build requests `/Octane-Arena/assets/`
while LAN previously served only root assets. `server/src/lan.ts` now honors the
actual built asset prefix and provides its same-host `config.json` there. This
preserves the Pages build and configurable deployment API address. Lobby polling
now also publishes its busy state immediately, so buttons disable while actions
are blocked rather than appearing clickable and silently dropping a click.

| Original requirement                                     | Before continuation                                                   | Final status                 |
| -------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------- |
| 1. Replace Ranked; right-hand Extra Modes menu           | Implemented/browser-tested                                            | Complete                     |
| 2. Single-player open Rings mode with normal car physics | Implemented/parity-tested                                             | Complete                     |
| 3. Starting platform, detail, collision and facing spawn | Implemented/tested                                                    | Complete                     |
| 4. Green/yellow/red difficulty progression               | Implemented; first 10 flown                                           | Complete; all 40 flown       |
| 5. Deterministic varied, reachable course                | Implemented; late-course check partial                                | Complete; both cars verified |
| 6. Real rounded torus geometry/collision                 | Implemented; 20 car impacts and all ring ray/sweep tests passed       | Complete                     |
| 7. Ordered local-plane pass detection                    | Implemented/tested                                                    | Complete                     |
| 8. Missed-ring behavior                                  | Previously reset beyond missed rings                                  | Updated: bypasses do not reset |
| 9. Global failure plane                                  | Implemented/tested                                                    | Complete                     |
| 10. Immediate clean reset without reload                 | Implemented/tested                                                    | Complete                     |
| 11. Accurate top-left timer/start condition              | Implemented/tested                                                    | Complete                     |
| 12. Progress and saved farthest ring                     | Implemented/tested                                                    | Complete                     |
| 13. Current/completed/future color feedback              | Implemented                                                           | Complete                     |
| 14. Checker finish platform/collider/trigger             | Implemented/landing-tested                                            | Complete                     |
| 15. Frozen completion result, best time, restart/exit    | Implemented/browser-tested                                            | Complete                     |
| 16. No finish skipping                                   | Implemented/tested                                                    | Complete                     |
| 17. Unlimited boost with normal forces/effects           | Implemented/parity-tested                                             | Complete                     |
| 18. Existing Car Cam; safe no-ball behavior              | Implemented/tested; exit/HUD correction needed                        | Complete; exit/HUD fixed     |
| 19. No closed-arena assumptions in Rings                 | Implemented/world-tested                                              | Complete                     |
| 20. Lightweight/shared rendering and cleanup             | Implemented; explicit budget/disposal check pending                   | Complete                     |
| 21. Acceptance/regression tests and final build          | Most passed; LAN routing/polling corrections and final checks pending | Complete                     |
| 22. Reusable Extra Mode architecture and report          | Architecture complete; report missing                                 | Complete                     |

Commands:

- `npm run test:rings`: state/collision/parity tests and genuine platform-to-Ring-40
  flight with both bodies, no pose edits during flight or failure resets.
- `node tests/rings-browser.cjs` with `PLAYWRIGHT_MODULE` set to a Playwright
  installation: real UI flow, timer/pause/settings, physical finish landing,
  persistence, repeated resource disposal and normal-mode return.
- Normal regression checks: camera rig, four-player LAN foundation, ball quality,
  gameplay corrections, browser smoke and the server network suite.
- LAN production asset/config routing and allowed-origin tests, plus real
  multi-browser party/match regression checks. The test's post-goal fixture holds
  celebration open while both software-rendered tabs observe pickups, then
  explicitly releases kickoff; production match timing is unchanged. Each lobby
  transition is acknowledged before the next action, background-tab snapshot
  assertions use interval polling, and reconnect testing waits for an open socket.
  The multi-client suite uses the existing Low graphics preset for software
  rendering; normal graphics defaults are unchanged.
- `npm run build` and `npm --prefix server run build`.

Files added: `src/extra/{course,rings,rings-view,session,storage}.ts`,
`src/ui/extra-mode-panel.ts`, `tests/{rings,rings-flight}.ts`,
`tests/rings-browser.cjs`, `server/tests/lan-static.test.ts`, this report and the
Rings screenshots. Integration changes are in `src/main.ts`, `src/ui/ui.ts`,
`src/ui/icons.ts`, `src/style.css`, `src/camera/camera.ts`, `src/game/party.ts`,
`package.json` and `server/src/lan.ts`; browser smoke expectations and the LAN
fixture were updated.
Temporary collision/flight investigation scripts and their logs were removed.

Automated flight tests establish physical reachability; they do not replace human
feedback on the final section's preferred difficulty. No remaining implementation
blockers are known. Backend hosting requirements for existing parties are unchanged.

## Rings camera and opening-course correction

The camera previously treated every static ring tube as an enclosing arena wall.
Its surface survey and boom clearance reacted to the tubes as the car passed
through them, becoming especially disruptive around the smaller openings. Rings
now provides a camera obstacle filter covering only the solid start/finish decks.
The tubes retain their full physical car collisions. Normal arenas keep their
existing camera filter and shared camera behavior.

The opening green section now follows a broad S-bend with gentle height changes,
instead of starting in a straight line. Large openings and 18-metre spacing remain.
Course version `skyline-40-v2` keeps new times separate from the old layout's saved
records; old records are retained.

Both car bodies completed all 40 rings using real physics and inputs without
resets. Maximum camera distance was 6.26 metres; the largest relative camera
offset change per frame was 0.06 metres, compared with the reproduced 7.79-metre
jump before the fix. Regression assertions cover these limits, opening turns,
camera obstacle filtering, and the unchanged physical ring collisions.

## Mixed difficulty course balance

The course now contains 27 green, 10 yellow and 3 red rings. Inner opening radii
are 6 m / 3.2 m / 1.6 m respectively (diameters 12 m / 6.4 m / 3.2 m).
Green openings are about 9–14% smaller than the old opening green section.
Yellow challenges are Rings 10, 13, 17, 20, 24, 28, 31, 34, 37 and 39.
The isolated red challenges are Rings 33, 36 and 40. Green approaches remain
throughout the middle and late course, rather than assigning whole sections a
single difficulty color.

Rings 2–5 steer right, then Rings 6–9 steer left; peak approach headings increase
from about 13 to 24 degrees. Rings 2–4 climb approximately 1.5–2 m per step, while
Rings 6–8 descend. Eighteen-metre opening spacing provides room to respond.
The middle and late path formulas, ring orientations along the path, platforms,
spawn, failure plane, checkpoint/timer/reset logic, boost and torus meshes remain
unchanged. The finish deck still follows the final ring with the same dimensions
and physical landing requirement. The course ID and record storage key remain
unchanged, preserving existing best progress and best time as requested.

Both bodies flew all 40 revised rings and physically landed on the finish deck
with ordinary jump/boost/aerial inputs, without pose edits or resets: Ion 90.92 s,
Vector 90.11 s. The QA pilot now uses a
controlled launch, closer center targeting and slower precision approaches rather
than its previous straight-course full-boost launch. No product physics was tuned
for the test. During ring flight the camera boom stayed below 6.17 m, with relative
per-frame changes below 0.09 m. The solid finish deck retains the existing camera
clearance behavior. Geometry tests check all openings, forward-facing readable normals,
spacing, elevation changes, clearance, collision seams and finish alignment.
Browser verification also passed timer/pause/reset/persistence, finish completion,
resource disposal and returns to Free Play/VS Bot without runtime errors. The
production TypeScript/Vite build passed. Temporary flight diagnostics were removed.
