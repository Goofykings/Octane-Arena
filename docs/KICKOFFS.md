# Kickoff formations

All match kickoff slots, scaling, formations, and shuffle bags live in
[shared/kickoff.ts](../shared/kickoff.ts). Car physics is unchanged.

The five-slot layout follows the publicly documented Soccar layout in the
[RLBot Wiki](https://wiki.rlbot.org/v5/botmaking/useful-game-values/#spawn-locations).
This implementation uses the requested diagonal variant (1952/2464 uu); the
current wiki lists 2048/2560 uu for its corner variant. The remaining three
slots use the requested 256/3840 and 0/4608 uu positions.

| Slot | Blue X | Blue Z |
| --- | ---: | ---: |
| Right diagonal | -19.52 | 24.64 |
| Left diagonal | 19.52 | 24.64 |
| Back right | -2.56 | 38.40 |
| Back left | 2.56 | 38.40 |
| Far back center | 0 | 46.08 |

These are metres for the current arena. X is multiplied by
`arena.halfWidth / 4096` and reference Y is negated and multiplied by
`arena.halfLength / 5120`. Orange negates both horizontal coordinates. Both
teams therefore have exactly mirrored geometry and equal distance to the ball.
Yaw is calculated as `atan2(x, z)` for this game's local -Z forward axis, so
cars face midfield exactly even in an arena with different proportions.
The physics rotation and visual pose use the same reset rotation.

1v1 uses all five slots once per shuffled bag. 2v2 uses eight balanced
canonical-slot combinations: two diagonals, each diagonal with either back
offset, each diagonal with center, and the two back offsets. These are balanced
combinations, rather than a claim to reproduce the exact Rocket League 2v2
formation list. No formation repeats at the boundary between bags.

`Match.kickoff` selects one formation for the whole match. `Simulation.reset`
applies it to both teams in team roster order, resets velocities and the ball,
and preserves IDs, names and teams. Humans and bots use this same path.
Kickoff boost and the three-second countdown retain their existing rules.
During countdown only visual steering changes; physics remains locked.
Free Play starts at left diagonal and advances through right diagonal, back
left, back right and far back center, then repeats. `freeplayKickoffs` references
the same canonical match formations, without duplicating coordinates or
consuming the match shuffle bag. Reset is immediate, including during a goal
celebration, with no countdown. Direct simulation resets retain their default
position.

The server includes `kickoffFormationId` with every `MatchSnapshot`, together
with the actual authoritative car transforms and reset sequence. Clients apply
those snapshots and never select a formation locally. The network view exposes
the received ID through its match state for diagnostics, without adding text
to normal gameplay.

Verification is in `tests/kickoff-formations.ts`, the server network tests and
the network browser harness. It checks all slots and combinations, collider
clearance, matching visual poses, scaling, shuffle cycles, goal resets,
countdown lock, boost, restarts, predictable Free Play, bot driving from each
slot, and the same formation ID in both clients.
