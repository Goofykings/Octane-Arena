# Heatseeker visual pass

The supplied ball/trail photographs guide brightness and composition only. All
materials, ribbon geometry and shader effects are original procedural work.
Homing, touches, backboards, scoring, increments, maximum speed and authority
remain unchanged.

## Ball and color states

`src/effects/heatseeker-ball.ts` preserves the original ball geometry and caches
its Soccar material/vertex settings for exact restoration. Heatseeker panels are
bright white with small gray variations, darker recessed seams, normal lighting
and faint emissive highlights. Blue/orange affect panels, seam core, emissive
materials and lamps together. `HEAT_VISUAL` contains the original colors and a
0.18-second eased color transition. Emissive strength also blends rather than
flashing with an ownership/speed update.

Maximum appearance uses `state.active && state.ownerTeam !== null` and
`state.speed >= HEATSEEKER.maxSpeed - 1e-6`. The epsilon only accommodates numeric
precision; there is no independent hit counter. `state.speed` is the existing
gameplay speed progression, rather than a transient collision velocity. Pink
overrides presentation only: owner, target, last toucher and tier remain intact
and continue changing on valid touches/backboards. New neutral state immediately
restores white and clears the preceding trail, including maximum appearance.

## Long trail

`src/effects/heatseeker-trail.ts` stores ball centroid positions in world space,
independent of ball rotation. A fixed 192-entry typed ring buffer samples the
interpolated render path at 60 Hz, with up to 3.2 seconds of storage. The displayed
history uses a smoothly changing 1.25-2.6-second lifetime and a 32-96 m path-length
cap. Actual visible length also depends on how fast the ball traveled.

A reusable camera-facing ribbon tapers and fades toward older points. An
additive shader gives it a bright core/soft edges. High/Ultra add two narrow,
lightly waving energy streaks in the same geometry and draw call. There are no
particle pools, volumetric passes or per-frame arrays/meshes. All vertex buffers
are fixed and rewritten in place; the effect uses approximately 71 KiB of typed
CPU storage per ball. Pause preserves history, discontinuous teleports discard
connectors, and resets/hidden balls discard the trail.

Quality point budgets are Low 48, Medium 96, High 160, Ultra 192. Low and Medium
use the core ribbon; High/Ultra use three ribbons. The core remains visible on
all qualities. Speed progression smoothly expands lifetime, length, width,
opacity and core energy. Ownership transitions recolor the recent trail over
0.18 seconds. Maximum state shares the ball's pink/purple color condition.

`BallTrails` selects this effect only when a Heatseeker state exists. Soccar keeps
the original 0.22-second trails. Local rendering, both multiplayer transports
and goal replay consume the existing state and ball transforms. Quality follows
the existing settings, including network replay. No shared message fields or
network traffic were added; no trail geometry is sent.

## Verification

- Material tests: white/detail, smooth blue/orange transitions, maximum pink,
  max-speed touch ownership switches, neutral reset, exact Soccar restoration.
- Trail tests: curved paths at 30/60/144 FPS, fixed buffer identities/capacity,
  bounded geometry, quality budgets, smooth colors, pause, teleports and resets.
- Existing Heatseeker physics/speed tests: unchanged gameplay and calibration.
- Production Chrome renderer: actual shader compilation and white/team/pink
  appearance, every quality, ownership/reset/Soccar checks. Curved screenshot
  paths are explicit render fixtures, not a claim of a full played rally.
- Existing multiplayer browser tests: real input-driven first contact and
  synchronized white/team material plus visible history trail on LAN/WebRTC.

Snapshots: `docs/heatseeker-white.png` and `docs/heatseeker-pink-trail.png`.
