# Free Play and goal polish

Free Play references the canonical formations in `shared/kickoff.ts`, cycling
left diagonal, right diagonal, back left, back right and center. Starting a new
session restarts the cycle. Reset uses the existing match reset path, preserving
boost rules and clearing velocities, goal timers and camera focus without a
countdown. It also clears explosion meshes, particle lifetimes, trails and goal
sound voices. Only Free Play permits the training reset during a celebration.

Double jumps publish a sequence number, age, origin and car-up
normal from the actual second-jump action. The renderer uses this event for a
small white ring and two short streaks lasting less than 0.2 seconds. Network
snapshots carry the same event, with old events ignored. Falling, aerial
rotation, first jumps and dodges do not publish this event. The existing
`normalJump` snapshot field carries it for compatibility. No jump forces changed.

Flip trails now use the rendered wheel mount positions, including their
contact placement, for both car bodies. Flip forces and timing are unchanged.

The goal's exterior floor fillet formerly reduced its depth at the post while
retaining its full height, leaving a vertical pocket. Its entire radius now
tapers smoothly to zero at the post. The lower fascia follows that radius;
above the arena ramp height the original broad planar fascia is retained.
This avoids skinny full-height facets interfering with glancing post contacts.
Rendering and physics share the same welded shell. The rounded volumetric
posts, crossbar, goal interior and scoring plane are preserved.

The leave confirmation uses an explicit content height, compact text and two
equal buttons. Its existing modal backdrop and paused-game behavior remain.

Verification:

- `tests/practice-polish.ts`: repeated kickoff/reset cycles at different goal
  celebration times; real double jumps and wall double jumps; no effects from first jumps or falling
  off a wall; wheel attachments for four flip directions on both bodies.
- `tests/practice-polish-browser.cjs`: actual reset key, explosion cancellation,
  no countdown, compact centered modal, paused clock, Stay/Leave interactions,
  visible jump burst and goal-front screenshots.
- `tests/arena-collision.ts`: closed shell with no gaps, duplicate faces,
  winding conflicts or non-manifold edges; 320 roof/side curve impacts, 120 ball
  curve cases, corner rolls and seam impacts, 24 former-divot ball impacts,
  eight goal entry/exit runs and 84 post/crossbar impact cases. Containment
  recovery must stay unused during normal collision cases.
- Existing ramp, tilted-landing, flip-cancel, camera, single-player, Free Play,
  LAN foundation and server tests remain part of regression verification.

Visual captures: `leave-confirm-small.png`, `normal-jump-burst.png` and
`goal-front-clean.png` in this directory.
