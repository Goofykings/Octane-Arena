# Partial contact, recovery and aerial strikes

This focused pass preserves chassis/wheel geometry, unilateral clearance constraints,
normal driving/powerslide curves, arena meshes, jump/dodge/stall/reset timing and input bindings.

## Contact ownership

Previously every wheel transition, roof manifold and wheel-shoulder probe set aerialControl
to zero. grounded independently accepted two ray contacts even when stableContact was false.
Those contacts also retained full ground tire response and strong yaw braking. Together these
paths made narrow supports resist motion while removing the player's rotation controls.

Grounded now means stable driving support: coherent wheel normals, close chassis alignment
and at least three valid wheel contacts. A narrowly defined continuation preserves already
established fast curved driving with briefly unloaded wheels and at least three nearby footprint rays (at most 0.1s).
It cannot start from partial landing, persist on a straight edge, or support two-wheel overhead contact.
The existing curved footprint-plane fit/short normal smoothing and curve response are preserved.
Flat-floor support requires at least three rays within supportReach (0.38m);
detection out to 0.5m alone cannot carry driving load. Flat floor normals are not
tilted to match rays spanning different step heights. Partial wheel constraints
act at real support points rather than cancelling center-of-mass descent.
The existing floor-normal projection is retained for a verified coplanar footprint
of at least three wheels; it cannot hold the center of mass up from a narrow pair.

Partial wheel grip scales with count, alignment and surface inclination. A two-wheel aligned
flat patch has at most half tire force; on a vertical/overhead surface its maximum is 6%.
No adhesion or alignment/damping controller applies outside stable driving support.
Gravity and existing unilateral point constraints still determine physical support and tipping.

Nose, shoulder, partial tread and chassis contact retain commanded pitch/yaw/roll. Passive air
damping is disabled across these loaded contacts; damping applies only on commanded axes.
Full support owns ground steering; a briefly missing ray retains its existing debounce, but
leaving a partial contact never re-locks aerial controls. Existing load-limited nose/shoulder
forces and roof steering remain; roof steering does not double-apply when aerial yaw is supplied.
A separate jumpSupported state allows a normal surface jump/landing reset from
a genuinely loaded and aligned tread pair, without promoting that pair to full
driving support. Nose, shoulder and partial overhead contacts do not qualify.
No generic unstick kick, upright pose snap or new automatic balancing torque was added.

## Deliberate roof recovery

The fresh-press gate and 0.8s cooldown remain. Tuning in src/config/physics.ts changes maximum
assist duration 1.35 -> 1.05s, angular target 4.8 -> 5.6 rad/s, acceleration cap 44 -> 58 rad/s^2,
response 15 -> 20/s, and braking 16 -> 24 rad/s^2. The existing remaining-angle braking target
still tapers and stops after upright; held input cannot trigger another turn.

Both starting bodies and both roll directions settle in 0.91-0.98s in deterministic roof tests,
compared with 1.05-1.14s using the previous recovery tuning. These are physics fixtures rather
than exact timing guarantees for arbitrary moving/curved landings.

## Ball hits

Pre-solver contact-point velocity (linear velocity + angular velocity cross COM contact arm)
was already implemented and remains. The weakness was a separate aerial branch that corrected
to restitution only, omitting the ground strike curve. Partial contacts could also choose the
wrong branch because supportKind was being used as an airborne gate.

All non-driving contacts now use the coupled airborne path. Its restitution target includes
the same speed/normal-approach strike contribution used on the ground, transformed through
pair effective mass. Ball and car receive opposite impulses at the actual contact point.
Normal approach, onset and relative-speed limits preserve soft/glancing control; the existing
rearm/cooldown prevents stacking a strike each tick. The grounded branch is unchanged.

Angular closing already influences approach and restitution. The remaining leading-flip bonus
is reduced from gain 0.65/cap 750 to gain 0.2/cap 250 N\*s. It requires a valid early leading
non-stall dodge with positive rotational closing. No flip-label ball-velocity multiplier.

Representative 23 m/s approach fixtures: ground 34.54 m/s (unchanged), aerial 34.58,
front flip 40.92, diagonal flip 40.63. A 0.6 m/s soft aerial remains below 1 m/s.
Values depend on hit angle/timing and are original tuning, not exact Rocket League constants.

## Verification

New tests/contact-control.ts covers real nose/roof/shoulder and two-wheel floor/wall/ceiling
support, steering/roll effects, gravity release, supported input ownership, partial release,
faster bounded fresh-press recovery, matched-speed ground/aerial hits, leading flips, soft
touches and coupled momentum. Existing partial-pitch lock and weaker-hit thresholds are updated
to the requested behavior; the rest of their assertions remain. The Dribble
traversal pilot now checks actual surface-jump availability and uses the full
symmetric spinner opening from a closer waiting point. Its real-input-only,
no-fall/no-teleport assertions and all 20 courses/nine carry jumps remain intact.

Verified: npm test, npm run build, npm run build --prefix server and
npm test --prefix server (24 passed). The production Chrome keyboard test also
passed held-input recovery gating, fresh-press recovery and wheel-edge air-roll.
The full suite includes 144 high-speed/diagonal ramp/camera runs, wall/ceiling,
tilted landing, roof sliding, powerslide, flip reset, stall/cancel, dribble/flick,
bot/controller, all 20 Dribble roads/nine ball-carry jumps, training and live stats.
Human gameplay feedback may still refine recovery speed or the small dodge bonus.
