# Arena variants

Choose an arena in **Play → Arena**, then select **Free Play** or **Against a
Bot**. The choice previews immediately and is remembered on this browser.
Returning home or replaying a match retains it.

- **Lumen District:** the existing city skyline, lit windows, skybridges and
  teal turf remain. Clean inset lane accents supplement the existing stripes
  and center-circle markings.
- **Sunbreak Coast:** warm sand with fine original grain and alternating swept
  bands, slate field markings, palms, beach pavilions, umbrellas, dunes,
  boardwalk, ocean ripples and simple clouds under bright coastal lighting.
- **Crown Stadium:** green turf grain and mowing bands, painted field markings,
  tiered stands on all four sides, blue/orange seating, roof canopies, display
  panels and 1,728 stylized egg spectators rendered in one instanced mesh.

`src/render/arena-themes.ts` contains names, colors, lighting and atmosphere.
`arena-environments.ts` creates decorative surroundings with no colliders.
`arena.ts` retains one floor, wall mesh, goal geometry and visual shell while
swapping textures and disposing the old environment. Instanced palms/crowds
share geometry; each procedural floor texture is 512 × 512. No new lights,
postprocessing passes, downloaded textures or proprietary assets are added.

Physics, gameplay dimensions, boost-pad positions, kickoff layouts and rounded
posts remain shared. No map-specific physics simulation exists. Dark pad
backings and a ball-indicator outline improve contrast on sand.

There was no existing LAN arena selection field. This update keeps selection
as a local visual preference: the chosen surroundings also appear in a LAN
match, but do not change the server simulation or impose a map on other
clients. Players can choose the same theme independently in Play. Shared
host-selected map metadata can be added separately if wanted.

Verification:

- `tests/arena-variants-browser.cjs` loads all themes in Free Play and VS Bot,
  checks texture variation and theme props, confirms the same mesh/collider
  instances and boost positions, compares an identical driving sequence,
  tests reload persistence and all four graphics tiers, repeats switching,
  checks desktop/mobile controls and captures screenshots.
- `tests/arena-collision.ts` covers the unchanged closed shell, roof/side
  impacts, corner rolls, seams, goal transitions, rounded posts, wall sliding,
  ceiling detachment, wheel steering and containment.
- Production TypeScript/Vite build and graphics shader checks.

Screenshots and measured state are in `docs/arena-*-gameplay.png`,
`docs/arena-*-overview.png`, `docs/arena-selection*.png`, and
`docs/arena-variants-verification.json`. Browser verification uses software
rendering; it is not a hardware frame-rate benchmark.
