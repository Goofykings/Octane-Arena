# Flush goal entrances and Dribble overlap completion

Soccar posts/crossbar are no longer separate beams or colliders ahead of the wall.
`goal.ts` sweeps a tangent quarter-turn from the field wall into the goal sides,
and rounds the crossbar into the inclined roof. Floor fillets match the field
ramp at the outer edge and blend into the compact interior radius. Former
planar fascia/shoulder patches have been removed.

`ArenaMesh.frame` labels actual entrance faces. Rendering partitions those faces
out of the lining and applies team-colored surface materials; there are no
duplicate colored surfaces, floating gaps, or overlapping trim decals. Free Play
neutral color handling remains supported. Rapier uses one welded, consistently
wound collision shell with internal-edge correction and the existing CCD. Car,
ball and scoring mechanics remain unchanged.

Dribble previously required forward entry, a full-sphere crossing and a centre
above the floor. It now uses swept sphere/opening-box overlap, with the trigger
extended one ball radius below the course. It accepts stationary, reverse, low
and falling overlaps. Exterior centre masks reject outside-post/over-bar hits;
no lower centre-height, grounded or velocity-direction gate remains.

Success is emitted once and latched until reset. Run completion precedes falling
failure, and green feedback starts in the first success frame, retaining the
existing emissive pulse and reset behavior.

Tests cover 24 wall/post/crossbar traversals, 8 boosted boundary climbs, 12 floor
entry/climb/fly-out routes, closed-shell topology, 720 normal/glancing sphere
impacts, and all 20 Dribble goal orientations with real low/falling balls,
partial overlaps, exterior rejects and success persistence. Production Chrome
checks shared-face geometry, team colors and top-pixel stability. Full regression
and client/server builds remain part of verification.

Version 0.1.6 distinguishes the new collision geometry from older multiplayer builds.
