# Edge support and driven side recovery

The original stalls were reproduced on both car bodies. The rectangular chassis
provided a broad flat nose face. Wheel-up rays missed sideways tire contacts;
side/nose chassis contacts therefore ran the airborne angular damper. Chassis
corrections also clamped center-of-mass descent rather than the contact-point
velocity, canceling the gravity/contact torque needed to tip around an edge.

Changes:

- `src/car/chassis.ts` creates one convex chassis with tapered bumper ends,
  retaining the catalog's outer width, height and length. The extreme bumper
  is a narrow ridge rather than a full-height supporting face. Roof/sides
  retain their main support area. CCD probes use this same vertex set; debug
  hitboxes show the actual convex shape rather than the former box.
- Unstable chassis contacts use unilateral impulses at actual chassis points
  with rotational effective mass. Center-of-mass velocity clamps remain only
  in the established stable wheel/recovery path. Bounded positional clearance
  remains separate; normal corrections do not remove tangential velocity.
- Support diagnostics distinguish stable wheels, partial tread contact,
  wheel edges, chassis contact and air. Chassis and loaded edge contacts do not
  run air damping. Two wheel rays with poor surface alignment no longer count
  as normal grounding. Only stable wheel support receives adhesion/alignment.
- Rounded rigid tire shoulders have gravity-side contact probes. Their
  point-normal impulses allow gravity to tip an isolated edge until a broader
  wheel/chassis support patch forms. A car can still rest against its chassis;
  this is not automatic self-righting with no input.
- Low-speed forward/reverse throttle can scrub the tire shoulder against the
  surface. This bounded tangential force acts at the loaded wheel point,
  producing roll through its real lever arm. Its longitudinal component follows
  throttle direction. It is capped at `mass × gravity × edgeDriveGrip` and needs
  real support, a near-sideways pose and a floor-like surface. There is no angle
  target or direct upright torque. Normal cornering, fast powersliding, wall
  driving and airborne cars cannot enable it.
- The old timed side pop/roll recovery was removed. Existing player-requested
  roof recovery, flip control and roof sliding remain. Wheels remain rigidly
  mounted; rounded tire visuals and recessed hubs match the side envelope.

Tune `car.edgeDriveGrip` (default 0.65) and `car.edgeRecoverySpeed` (2 m/s) in
`src/config/physics.ts`. F3 shows support kind, chassis/edge counts, driven edge
force, angular velocity, wheel normals, adhesion and normal corrections.
Your existing mass, drift, ball and roof-steering tuning was preserved.

Verification:

- `npm run test:edge-support`: 172 nose/side cases across both bodies and sides,
  including 85–95° nose poses and 75–105° side poses, neutral tipping,
  forward/reverse recovery, force limits, no orientation snaps or timed side
  flips, transient two-wheel cornering, powersliding, wall and air exclusions.
  Includes 72 additional forward/reverse cases at different field headings with
  full steering held, exercising the front tire shoulders during recovery.
- Existing tilted landings, full-speed/diagonal ramps and camera tests, rigid
  wheel clearance, roof sliding and boosted roof-to-wall transitions.
- Arena tests check all vertices of the actual chassis against every major
  curve, plus ball rolls, seams, goal/posts and containment without a reset.
- Ball contact, jump/flip and wheel-spin regressions; frontend/server builds,
  server network tests and browser smoke checks.

One older powerslide test assumed the original 0.006 minimum grip. With your
0.03 setting, its final speed is 0.880789 m/s after four seconds, identically
before and after this change. The assertion now accounts for configured grip.
