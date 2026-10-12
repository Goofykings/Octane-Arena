# Standard goal tunnel

`src/arena/goal.ts` builds original mirrored rectangular tunnels. The aperture
remains 17.86 m wide and 6.43 m tall at the existing scoring plane; depth stays
8.8 m. `geometry.ts` retains the `goalShell` entry point used by the renderer
and the assembled collision shell.

The interior floor/side/rear quarter-circle radius is 1.35 m (previously 2.4 m).
The field ramps still use their original 2.4 m radius. Interior rounding grows
smoothly behind the rectangular mouth. One inclined roof patch joins the upper
fillets, falling 0.55 m from front to rear, approximately 3.6 degrees.

The entrance now rounds continuously from the field wall into the side walls
and roof, using the existing goal-lip depth (1.2 m). The floor profile starts at
the field's ramp radius and blends into the compact goal interior. The outer
wall cutout is unchanged, and Soccar scoring uses its original aperture/plane.

`src/arena/posts.ts` exposes three colored face groups from the shared tunnel
mesh. They are partitioned out of the lining and are part of the single physical
shell; there are no separate forward beams, gaps, or overlapping material faces.
This supersedes the earlier beam remake, whose forward placement created a lip.
See [the flush entrance/Dribble fix](FLUSH-GOALS-DRIBBLE.md) for current details.

Rear backing uses the actual collision-shell rear faces with a separate material;
no inset backing plane overlaps the lining. Net lines fit the tighter flat rear
and inclined roof panels, with small explicit surface offsets. Existing team/Free Play
color handling remains intact.

The goals join the existing watertight collision shell. Shared vertices are
welded, patch junctions are resolved, and the shell has consistent inward
winding and Rapier internal-edge correction. There are no additional emergency
walls or new penetration/upright forces. Existing CCD, containment recovery,
car and ball tuning, scoring, replay, and kickoff logic remain in use.

## Validation

- `tests/goal-remake.ts`: unchanged aperture/scoring, inclined roof, frame/roof
  separation, twelve actual-input drive-in/climb/upper fly-out routes (both
  bodies, both goals, 3/12/23 m/s), no containment recovery.
- `tests/arena-collision.ts`: watertight topology, roof/side impacts, ball rolls
  and impacts at major curves/seams, entry/exit, frame and junction bounces,
  camera/contact stability, recovery, and kickoff steering.
- `tests/frame-flip-quality.ts`: 240 beam impacts, contact-normal sweep checks,
  restitution/spin/energy, and unchanged flip/cancel behavior. Above-bar edge
  hits now test natural bounded angled ricochets rather than the former
  covered-frame assumption of a flat rebound at every height.
- `tests/goal-remake-browser.cjs`: production blue/orange meshes, solid lining,
  beam separation, repeated top-area pixel stability, and screenshots.

The shape-only tuning controls are `P.arena.goalCurve`, `goalRoofDrop`,
`goalLip`. Human preference for tighter interior curves
and the roof pitch can still be tuned with these values without changing the
vehicle or ball mechanics.
