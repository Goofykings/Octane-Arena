# Mouse look and upcoming updates

Hold the left mouse button and drag in the Home car area, Garage preview or
soccer viewport. Horizontal input controls yaw; vertical input controls pitch.
In gameplay, release to return smoothly. Home and Garage instead coast briefly
with friction and retain the settled view. Pointer lock is never used. Buttons, form fields,
customization cards, dialogs and party controls do not begin camera dragging.
Pointer release, cancellation, lost capture, leaving the window and focus loss
end the interaction. Screen changes clear the offset.

`src/camera/mouse-look.ts` owns reusable mouse-look state. `MOUSE_LOOK` exposes
sensitivity (radians per CSS-pixel), gameplay yaw range (180 degrees each way) and pitch
range. Home/Garage yaw is unlimited; `orbitFriction` controls how quickly released
spin slows and `orbitMaxSpeed` caps fling speed. Outward limited movement approaches the limit exponentially; reverse movement
immediately moves inward. Gameplay has no accumulated unlimited rotation or hidden
input that has to be unwound after reaching an edge.

During gameplay, `GameCamera` performs its existing tracking, position, collision,
framing and FOV calculations first. Mouse look is applied afterward using world
yaw and a stable camera-right quaternion rotation. Its internal automatic
yaw/pitch histories remain independent. Ball Cam stays enabled and follows the
moving ball in the background. Release therefore follows the current automatic
view rather than a frozen view from the drag start. Pitch fades toward a safe
upright range instead of crossing the camera poles.

`MouseLook.update` uses exponential time damping. During drag, existing Swivel
Speed controls responsiveness. During return, the rate is the existing Transition
Speed multiplied by five, consistent with the existing camera transition scale.
Tiny residual offsets are cleared to zero. There is no separate return-speed
setting or physics change.

Home and Garage use `MouseOrbit` around the displayed car/group. The
display angles wrap continuously without horizontal stops. Drag velocity drives
release momentum with exponential friction; holding still before releasing
prevents an old fling. Opening a dialog preserves the display angle. Entering
gameplay clears it and restores limited free look with automatic return. The
underlying Home position is stored separately so its normal camera never feeds back the
temporary orbit. Home orbit uses the existing `CameraClearance` sphere cast
against the arena. Both display orbits approach the floor smoothly and retain a
world-up horizon. Garage now changes camera position instead of rotating the car.
Dedicated goal-explosion previews, replay cameras and Rings cameras are preserved.

`src/input/camera-drag.ts` owns pointer capture and interaction cleanup. A single
look state is assigned to the appropriate local or LAN camera; offsets are local
view state and do not travel over the network. The old Garage visibility observer
was removed because it would cancel the shared look while Garage was hidden.

`src/config/version.ts` is the single source for `GAME_VERSION` and the concise
`upcomingUpdates` array. `src/ui/version-panel.ts` displays the subtle Home-only
version button and a modal panel with the requested LAN/new-car entries, close
and Back buttons. CSS sizes the label and panel responsively. Future version or
upcoming-note edits belong in the configuration file.

## Verification

- `npm run test:mouse-look`: soft limits/reversal, frame-rate-independent return,
  Transition Speed differences, current Ball/Car Cam target restoration, wall
  and aerial horizons, unchanged camera position/FOV/physics and safe Home orbit.
- `npm run test:camera`: existing stability, framing, camera rig and ramp tests.
- `tests/mouse-look-browser.cjs`: six viewport sizes, clickable version panel,
  Home/Garage orbit, UI exclusion, car immutability, pointer cleanup, Free Play,
  VS Bot and independent LAN client mouse look. Requires built client/server
  and an available Playwright installation through `PLAYWRIGHT_MODULE`.
- `npm run build`: production client/type checking.
