# Focused gameplay continuation

The audit found gameplay mouse orbit already complete: GameCamera uses the same
MouseOrbit math as Home, with a car pivot, bounded elevation, retained radius,
and smooth release to the continuously updating Ball/Car Cam rig. That code was
preserved. The shared-hover fix and core post-goal/Dribble goal code existed but
had not completed regression or production UI verification.

Extra Modes had an ID-specific background overriding the generic mode-card
hover background. The existing shared hover selector now includes that button;
there is no separate hover design. Chrome verifies identical hovered gradient
and transform with Against a Bot.

ReplayRecorder marks the authoritative goal timestamp and continues actual
physics snapshot capture for `REPLAY_POST_GOAL = 1` second, at 120 Hz. It then
copies up to five seconds before plus exactly one second after the goal into
the existing bounded immutable clip. There is no aftermath resimulation.
Recorded car position, rotation, boost, wheel state and pickup/demolition events
continue. Goal/stat events remain single, and playback doesn't advance live
physics. The existing 3.2-second live celebration, slow motion, skip votes,
kickoff/overtime flow and transport remain intact. Training goals use the same
pending-capture flow and retain their own solo replay/advance behavior.

DribbleFinishGoal is one shared definition for every level's local orientation,
clear width/height, rounded physical left/right posts and crossbar, matching
visual capsules, transparent grid and crossing logic. Post radius is 0.18 m.
There is no new back-wall collider or net. Sphere completion needs forward
entry through the opening followed by its trailing edge crossing the plane,
with the whole sphere inside side/height bounds. Going around a post behind the
plane, going over the bar, backward travel and center-only crossing cannot win.
Only valid completion drives the frame/grid's smooth green/emissive pulse.
Reset and level changes restore the normal material. Road geometry, ball-through-
floor filtering, vehicle forces, maps and progression storage are unchanged.

Old test fixtures assuming instantaneous replay creation or center-only finish
were updated to step real physics through capture/full-sphere crossing. No test
was skipped or weakened. New deterministic tests verify actual authoritative
post-goal endpoints and interpolated replay movement in Soccar/Heatseeker, plus
all 20 goal transforms, sphere/post/bar bounces, chassis collision, rejected
crossings and green/reset state.

Production checks cover hover, visible post/bar bounces, center completion and
green/reset feedback, the preserved transparent grid, moving/boosting replay and
skip/kickoff. Existing Dribble/Training browser suites cover progression, local
records, navigation and replay isolation. The four-browser PeerJS test verifies
that every peer receives the same finalized one-second tail and single goal event.

Visual feedback brightness and frame thickness can receive human taste feedback;
automated fixtures do not claim a human playthrough of every dribble course.
