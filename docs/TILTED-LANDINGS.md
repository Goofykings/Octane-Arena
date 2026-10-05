# Tilted landing correction

The reproducible regression was strongest with combined pitch and roll: at
35 degrees in both axes, a first wheel could remain the only loaded wheel for
several seconds. Three mechanisms interacted:

- A lone first ray substituted chassis-up for the actual surface normal. Full
  contact angular damping was nevertheless active, suppressing settling roll.
- Wheel contact alone enabled sticky acceleration and orientation feedback.
- Post-step wheel clearance zeroed inward **center-of-mass** velocity. During
  rotation about a supporting wheel, the center should descend even while the
  wheel stays clear of the floor. Removing that descent prevented gravity from
  generating repeated settling impulses at the actual wheel point.

Wheel touching and stable driving support are now separate. The stable frame
requires three contacts and alignment within about 11 degrees; established
driving tolerates alignment within about 20 degrees and brief wheel unloading
if the nearby footprint still supplies at least three geometric samples.
Partial landings retain independent tire traction and powerslide, but disable
sticky acceleration and surface alignment/damping. Existing wheel-point
normal constraints provide physical settling torque. No new upright torque,
spring suspension, rotation assignment, or orientation snap was added.

Flat-floor ray normals immediately replace obsolete frame history and do not
produce a false curve angular target. Tilted, unsettled wheel contacts retain
center descent; fully aligned or stable support keeps the existing planted
clearance behavior. Bounded positional penetration correction remains active.

`tests/tilted-landings.ts` covers both bodies, level and tilted drops, combined
pitch/roll, throttle, powerslide, severe-angle physical release, quaternion
continuity, and floor touchdown retaining an actual previous wall frame. A
severe impact beyond the physical tipping point can legitimately fall onto the
side; the test does not require automatic upright recovery.

The existing player-requested roof recovery now applies its roll torque for
0.6 seconds rather than 0.4, so it can finish its half-turn without relying on
driving alignment during partial touchdown. Side recovery stays at 0.4 seconds.
Both car bodies are tested in both goal slopes. This recovery requires player
input and roof contact; ordinary wheel landings never invoke it.

F3 reports stable versus partial support, wheel count and normals, adhesion,
normal/position correction, and roll angular velocity. The existing 144-run
ramp/Ball Cam matrix remains part of the standard regression suite.

Verification: 78 landing cases passed, with supported cases settling within
0.450 seconds from first wheel contact. Both bodies recovered on both goal
slopes. The full regression suite passed, including 144 ramp/Ball Cam runs,
wall and ceiling release, side recovery, roof/side impacts, ball seams and goal
posts, and arena containment. Client/server production builds and all six
server tests passed. The browser smoke test passed when run independently,
with no runtime errors; a concurrent run missed a timed boost assertion during
a goal celebration.
