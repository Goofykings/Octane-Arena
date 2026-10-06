# Circuit Field

Select **Play → Arena → Circuit Field**. This is an additional visual style of
Crown Stadium, using its existing environment, turf, lighting and field markings.
The other arena styles remain available, and selection uses the existing saved
map choice.

The layout takes inspiration from `Reference Images/dfh-stadium.png`, without
using that image as a texture or copying its geometry. Original mirrored angular
ribbons, staggered lanes, cut-corner panels and quiet hex seams sit over the green
turf. Positive-Z territory is blue, matching the blue goal; negative-Z territory
is orange. The center circle, central cross and every boost-pad socket are kept
unpainted. The measured colored regions cover 19.4% of the overlay image.

Lower ramp coloring is a vertex-color gradient on the existing shared wall mesh.
It fades to the normal wall material by 2.15 m and fades out near midfield. No
vertices are displaced; wall and goal geometry, normals, indices, collisions,
arena dimensions, boost locations, kickoff definitions and physics are unchanged.

Implementation: `src/render/field-art.ts` creates one cached 1024×1536 canvas
texture and a visual-only painted plane. It receives shadows and sits below the
existing markings. `src/render/arena.ts` enables the artwork/ramp colors only for
this style; switching away hides the plane and restores ordinary wall shading.
`src/render/arena-themes.ts` supplies the additional selector entry, and
`src/style.css` supplies its preview swatch.

Verification: the production build and `tests/arena-variants-browser.cjs` passed.
The browser suite checks all four styles in Free Play and VS Bot, shared physical
meshes/collider, unchanged boost positions, identical driving trajectories,
neutral center/pad areas, both team colors, ramp fade, ball-indicator visibility,
saved selection, all graphics tiers, repeated swaps/resource stability and mobile
controls. No runtime or shader errors were reported.

Screenshots: `arena-circuit-overview.png`, `arena-circuit-gameplay.png`, and the
updated arena-selection screenshots. Test measurements are saved in
`arena-variants-verification.json`.
