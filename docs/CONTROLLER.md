# Controller support

Connect a USB/Bluetooth controller, open the game, and press a controller button
to make the device available to the browser. GitHub Pages supplies HTTPS; local
development on localhost also supports the Gamepad API. On an HTTP LAN IP,
browser security policy can prevent access to controllers. No controller library,
account, external service, or network packet changes are required.

The implementation follows the browser's standard mapping rather than identifying
devices by their product name. Xbox, PlayStation and Nintendo-style controllers
work when the browser exposes that mapping. Nonstandard controllers can be rebound
using their numbered buttons/axes. See [MDN's Gamepad API guide](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API).

| Control | Default action |
| --- | --- |
| RT / R2 | Analog throttle |
| LT / L2 | Analog reverse/brake |
| Left stick X | Steering/yaw |
| Left stick Y | Aerial pitch |
| A / Cross | Jump/dodge; menu select |
| B / Circle | Boost; menu back |
| X / Square | Powerslide and generic air roll |
| LB / L1, RB / R1 | Dedicated air roll left/right |
| Y / Triangle | Ball Cam toggle |
| Right stick | Camera look; eased return on release |
| RS | Reverse Cam hold |
| Back / Share | Scoreboard hold |
| Start / Options | Pause |
| D-pad / left stick | Menu navigation |

Chat, challenge navigation, Free Play actions and other actions can also be bound
in Settings → Controls. Chat opens the existing text field; message composition
still uses a keyboard. Menu navigation uses the standard A/B/D-pad controls
independently of gameplay binds and never drives the car behind a menu. Keyboard
and mouse remain active; movement uses the strongest device value and keyboard
wins ties. Keyboard W/S retain aerial pitch; controller triggers only drive/brake.

Controls has aligned action/keyboard/controller columns. Click a controller BIND
button, release held controls, then press a new button or move a stick beyond
0.6. Small drift is ignored. Escape/Cancel exits; Unbind clears the selected
controller action. Button captures for movement retain their analog value; stick
captures store axis, sign, digital threshold and analog/digital mode. Keyboard
capture accepts only keyboard input. Reset Keyboard, Reset Controller and Reset
All work independently. Stick radial deadzone defaults to 0.12, adjustable from
0.05 to 0.30. The remaining radius is remapped continuously, not made digital.

Existing `octane-arena-settings` localStorage retains keyboard `bindings` and adds
`controller: { deadzone, bindings }`. Each controller binding is null, a button,
an analog button, or a signed axis. Legacy settings receive controller defaults
without replacing existing keyboard binds. Shared server validation accepts the
same format and migrates old preference payloads. The current local profile
continues using its independent identity storage.

`src/input/controller.ts` handles connection events, one selected device,
per-frame polling, cached action values and neutral-before-capture behavior.
`src/input/input.ts` combines those values with keyboard actions and exposes
holds, presses/releases and the unchanged `PlayerInput`. The physics, bot,
training and multiplayer authority never read raw controller indices. Dedicated
roll remains distinct from generic roll for stalls; jump timing, dodges, cancels
and resets use the same existing mechanics. Disconnect clears controller values
and leaves keyboard controls available. Reconnect is detected by polling/events.

Right-stick look uses the existing camera's view offsets/orbit, deadzone and
eased return. Mouse dragging has priority. It applies to Soccar, online matches,
training, Dribble and Rings without changing camera framing or car physics.

## Verification

`npm run test:controller` exercises simulated Xbox/PlayStation standard mappings,
analog values/deadzones, strongest-input coexistence, edges, neutral capture,
axis/button capture, drift, disconnect/reconnect, multiple devices, menu/chat
blocking, stall combinations, persistence/migration and camera return.

`tests/controller-browser.cjs` tests the production app with a simulated Gamepad
API: live status, settings columns/capture/reset/reload, A/B/D-pad menus, real
Free Play input/jumping/camera, keyboard coexistence and reconnect. Set
`PLAYWRIGHT_MODULE` if Playwright is installed outside the project. These tests
do not prove USB/Bluetooth pairing, browser/OS driver mapping or hardware timing;
those require real Xbox/PlayStation controllers.

The older `tests/chat-stats-browser.cjs` LAN harness currently waits for an
automatic party connection before pressing Create Party. The current PeerJS
client initializes that connection on Create/Join, so the old harness times out
before exercising chat. It was left unchanged in this controller pass.
`tests/controller-overlay-browser.cjs` instead bundles the actual input/overlay
modules in an isolated browser fixture to verify controller chat, typing
suppression, send/cancel and live scoreboard holds. This verifies UI behavior,
not a two-device network session; normal server authority tests remain separate.

Normal regression/build commands remain `npm test`, `npm run build`,
`npm run build --prefix server`, and `npm test --prefix server`.

## Simultaneous inputs and full menu navigation

The simultaneous-input failure came from adding generic steering-based roll to
dedicated roll: opposite steering could produce `1 + (-1) = 0`. Every binding
already had independent polling. Dedicated roll now takes precedence over that
generic remapping, while generic roll alone retains its original behavior.
Boost, steer, pitch, yaw, dedicated roll and jump can remain active together.
`tests/controller-multi-input.ts` checks all bound actions, independent releases,
boosted stalls and both car bodies' actual roll torque/boosted flip cancels.

`MenuNavigation` shares actual DOM focus with keyboard/accessibility behavior.
Menus declare `data-nav-scope`, optional defaults/back targets and cycle-widget
metadata. Context priorities isolate dialogs, pause/results, replay and party
forms. Selection is remembered by stable element attributes; returning restores
the opener. Vertical Settings rows use DOM order, binding rows retain their
keyboard/controller column, and spatial traversal handles other button grids.
Left/right adjusts sliders/selects/carousels; up/down leaves a carousel. Shoulder
buttons also switch tabs. A/Cross confirms; B/Circle backs out or exits text focus.

Meaningful controller activity enables the same highlight styles as mouse hover.
Mouse movement of at least two pixels or a click immediately yields to mouse
mode. Deadzoned stick drift, trigger noise and unchanged held controls cannot
steal that mode back. Disconnect clears controller highlighting without closing
the menu. Text composition still uses a keyboard; custom profile colors use a
temporary hex text field for controller selection, preserving the native mouse
color picker. Chat is exclusive and cannot lose focus to controller navigation.

During keyboard rebinding, B/Circle cancels. During controller rebinding, the next
button/axis remains bindable, including B/Circle: hold Start/Options for 450 ms to
cancel, or tap/release it to bind that button. Neutral-first capture prevents
already-held Options from either binding or cancelling. Unit tests exercise both
paths and browser tests verify that cancellation preserves the previous binding.

`tests/controller-menu-browser.cjs` uses simulated Gamepad input to navigate the
production app through Home, Play, Garage, Free Play/map choice, Settings controls,
graphics/audio, Extra Modes, Training/Rings/Dribble, bot size/difficulty, pause,
leave confirmation, real goal replay skip, match end, profiles and version info.
Typing names/codes/hex values is the explicit keyboard exception. Party setup,
Soccar/Heatseeker, teams and launch buttons use the actual UI with a deterministic
party fixture; this proves UI actions, not internet connectivity. Rumble is not an
existing mode in this repository and was not added in this focused input pass.

The continuation preserved the already-passing simultaneous-input fix and focus
manager. It corrected vertical Settings traversal (narrow toggles no longer skip
wide selects), verified held-Options cancellation/tap binding, respected safe
confirmation autofocus, and completed profile/custom-color/replay verification.
The production controller-only route and chat/scoreboard navigation-isolation
tests pass, as do the full frontend test/build and server build/19-test suite.
These are simulated Gamepad tests; physical controllers and a two-device PeerJS
session still require manual verification.
