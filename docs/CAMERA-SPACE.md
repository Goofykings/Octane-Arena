# Gameplay camera space

The old rig treated every static arena collider as a camera blocker. Its planning
stage projected the boom into nearby surface half-spaces, added a wall tangent,
and stacked up to three obstruction corrections. A final sphere cast shortened
the boom. Corners/backboards could therefore alter the intended framing twice.
Old tests explicitly required camera containment inside the gameplay shell.

`src/camera/space.ts` separates camera policy from physical collision:

| Surface | Gameplay collision | Camera behavior |
| --- | --- | --- |
| Main shell: walls, corners, ramps, backboards, ceiling | Unchanged | `ARENA_BOUNDARY`: camera can pass through |
| Goal posts/crossbar and other solid static colliders | Unchanged | `BLOCKING`: sphere/ray protection retained |
| Cars/ball | Unchanged | `IGNORE` for camera obstruction |
| Rings/Dribble obstacles | Unchanged | Existing explicit camera predicates retained |
| Decorative pillars/seating | No new physics colliders | Individual render meshes marked `FADE` |

The existing `Simulation.arenaCollider` identifies the boundary; no collider
creation, shape, material, solver, physics configuration or gameplay state was
changed. Context queries still smooth ground-heading information, but arena
normals no longer constrain the desired boom. Framing solves freely first; the
final collision stage checks only genuine blockers. Floor clearance preserves
boom length by adjusting elevation, rather than collapsing it toward the car.
There is no wall/corner/backboard/ceiling position clamp.

## Rendering an outside view

Arena walls and goal lining render their inward-facing triangles with
`FrontSide`, rather than `DoubleSide`. Near-wall back faces disappear naturally
when the camera crosses outside, while far walls and interior surfaces remain
visible with their original theme opacity/colors. This is per-triangle face
culling, not a globally transparent or hidden stadium. Render-only goal fascia
winding is corrected toward the field, and the rear backing is an inward-facing
plane occupying the same visible inner face. Shared gameplay geometry is untouched.

Some decorative exterior pillars can then lie between the outside lens and the
car. `src/render/camera-occlusion.ts` casts actual camera-to-car/ball segments
against the small registered decorative mesh set. Only intersecting, visible
meshes smoothly approach 8% of their normal opacity and restore it afterward.
Materials are cloned per affected mesh, so unrelated objects sharing the original
material do not fade. Walls do not use this fade. A captured view frame ensures
the decorative fade applies to gameplay views and restores during home/garage or
replay views rather than using stale subject positions. No debug meshes are added.

## Mouse and reference frame

Gameplay mouse drag now moves the lens around the car at its automatic boom
radius instead of only rotating the lens in place. It uses the same blocker
policy and floor clearance, retains the existing reversed input direction and
smooth release to the current automatic rig. Automatic tracking continues in
the background. Home/garage retain their existing continuous orbit and friction.
Reverse Cam uses the relaxed boundary policy but keeps its instant override and
release behavior. World up and independent yaw/pitch remain the horizon basis;
wheel normals and car roll do not rotate the camera up.

## Verification

- `tests/camera-boundary.ts`: 42 wall/corner/backboard/ceiling/goal/overhead/midfield
  framing cases, 30/60/144 FPS and landscape/portrait views; retained distance,
  outside placement, stable horizon, exact midfield comparison, spatial mouse
  orbit/return, genuine solid blocker response and identical physics snapshot.
- `tests/camera-rendering.ts`: actual render geometry visible from inside and
  passable from outside, field-facing goal fascia, opaque lower ramp material,
  gradual selective decoration fade/restore and shared-material isolation.
- Existing camera torture/framing, Reverse Cam, mouse, full-speed ramp/contact
  and normal gameplay suites remain required. Obsolete inside-shell assertions
  now verify hard camera blockers; framing, distance and continuity checks remain.
- `tests/camera-boundary-browser.cjs`: built game in Chrome, outside wall/corner/
  backboard/ceiling/goal screenshots, low/high graphics, Circuit art, actual
  pointer orbit/radius/return, Reverse Cam, selective pillar fade and restoration.
- `tests/camera-display-browser.cjs`: built Home/Garage menus, retained orbit
  momentum/friction and settled angle, unchanged car poses and navigation.

Genuine solid blockers such as a post directly behind the car can still shorten
the boom; that is intentional collision protection. Subject framing during
deliberate manual orbit follows the car, and the ball can leave the view until
release. This implements the requested concept, not Rocket League's proprietary
camera algorithm. Human feedback on unusual boundary/obstacle combinations is
still useful.
