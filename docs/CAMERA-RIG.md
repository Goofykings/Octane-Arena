# Gameplay camera rig

`GameCamera` (`src/camera/camera.ts`) is the one gameplay camera for local,
replay, spectator and snapshot-rendered network matches. It follows Rocket
League's camera model: a fixed boom and FOV defined by the camera settings, a
view that rolls with the surface under the wheels, and Car Cam / Ball Cam as two
aims of the same rig. It replaces the earlier level-horizon rig with adaptive
FOV zoom and framing-driven boom changes.

## Settings

| Setting | Default (RL) | Effect |
| --- | --- | --- |
| FOV | 110° | Horizontal at 16:9; wider screens keep that vertical FOV, narrower ones keep the horizontal FOV down to 4:3 |
| Distance / Height | 270 / 100 uu | Boom behind and above the car, in the reference frame |
| Angle | −3° | Car Cam look pitch |
| Stiffness | 0.40 | Positional lag of the pivot (0.05 s at 0, rigid at 1) and Car Cam heading follow rate |
| Swivel | 5.0 | Free-look response |
| Transition | 1.3 | Car ↔ Ball Cam blend speed (0.55 s at 1.0), both directions |
| Shake | Off | Optional impact/supersonic shake |

Older saved camera blocks are reset to these defaults by the settings migration.

## Pipeline (one rendered frame)

1. **Render poses only.** Car and ball come from interpolated render transforms;
   physics supplies arena queries and whether the ball is enabled.
2. **Reference up.** A ray along the car's down axis finds the surface under the
   wheels (≤ 0.7 m). When the car is wheels-down on it for 0.1 s, and its up is
   not turning relative to that surface's normal faster than 3 rad/s (low-passed,
   so curve facets don't count but tumbling past a wall does), the reference up
   eases to that normal (7/s); otherwise to world up (2.6/s). Roll is capped at
   6 rad/s. Headings are parallel-transported with the frame, so walls and the
   ceiling roll the view as in RL and the view never rolls off its own up.
3. **Car Cam heading.** The nose on a surface, the travel direction in the air;
   rate 9 + 9 × stiffness per s, capped at 4.5 rad/s.
4. **Ball Cam bearing.** Behind the car, opposite the ball. Near overhead the
   bearing's authority fades smoothly out, so there is no singularity flip.
5. **Transition.** One continuous blend at the Transition Speed rate in both
   directions. It starts from the current rendered transform and both targets
   keep updating while blending. The rendered view turns at most
   3.5 × Transition rad/s while switching and 8 rad/s otherwise, so nothing snaps.
6. **Boom.** Fixed length √(Distance² + Height²) along the blended heading.
7. **Aim.** Car Cam looks along the heading at Angle. Ball Cam aims at the ball,
   with pitch and yaw clamped so the car stays inside 80% of the half-FOV. A very
   high ball pitches the view up only that far and may leave the top edge, as in
   RL. A hard readability bound keeps the car's centre inside ±0.84 of the frame
   even while the view lags.
8. **Free look.** The right stick or mouse sets a position-based yaw/pitch target
   (small deadzone, smoothing by Swivel). The boom orbits the car itself, keeping
   its length, and returns exactly on release.
9. **Collision.** The arena shell is see-through and never shortens the boom.
   Floor clearance raises the boom while preserving its length, and the final
   look is re-aimed so the car stays readable. Only hard blockers (goal frames,
   extra-mode obstacles) shorten the boom, via a swept sphere that reopens
   smoothly, so there are no jumps.

## Diagnostics

**F3** shows camera mode and blend, settings, reference up, pivot, desired and
actual boom, look direction, singularity, car/ball screen positions, framing
safety and collision state, with booms and view direction drawn in the world.

## Verification

`npm run test:camera` and the camera files in `npm test`:

- `camera-rig.ts`: 204 torture trajectories (A–P plus fast passes, at 30/60/144
  FPS and 16:9, 4:3, 9:16 and 21:9). Checks a readable car and no roll off the
  reference up in every frame, the ball framed whenever it is within 35° of the
  reference plane, the view rate ≤ 8 rad/s, no blocker crossing and a full boom.
- `framing.ts`, `camera-stability.ts`, `camera-boundary.ts` and `ramp-quality.ts`:
  overhead, wall and ceiling framing, wall↔ceiling transitions, and 144 real-physics
  ramp runs with Ball Cam.
- `arena-collision.ts`: view-turn and roll steps per tick through real wall,
  corner and goal-curve driving.
