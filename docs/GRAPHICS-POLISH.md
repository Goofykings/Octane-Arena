# Lightweight graphics polish and turf rollback

The original deterministic 512 × 512 teal turf texture and its original mowing-band meshes are restored. The photographic texture, bump mapping, and generated grass asset were removed. Ground collision and arena geometry remain unchanged.

| Effect | Low / Medium | High | Ultra |
| --- | --- | --- | --- |
| Car/ball grazing-angle highlight | Existing materials | Subtle Fresnel | Slightly stronger Fresnel |
| Field color/roughness variation | Original texture/material | Very faint procedural variation | Slightly stronger variation |
| Wall highlight/transparency | Existing material | Faint rim | Rim and tiny edge opacity variation |
| Boost core and soft flame edge | Existing boost | Brighter emissive core, fading edge | Slightly stronger |
| Goal frame/explosion and city lights | Existing effects | Controlled emissive enhancement | Slightly stronger |
| Bloom/color finish | Existing pipeline | Restrained bloom and grade | Restrained bloom/grade and weak vignette |
| Atmospheric depth | Existing distance fog | Existing distance fog | Existing distance fog |

The effects augment existing materials through `onBeforeCompile`; paint color, metalness, base roughness, opacity and animation settings remain owned by their existing systems. No displacement or new physical surface is introduced. Highlights use view direction, surface normals, and configurable exponent/intensities in `src/render/material-polish.ts`. Programs and uniforms are shared by material kind, including local cars, network cars, and garage previews. Switching between High and Ultra changes shared uniform values; switching to Low/Medium removes the added shader code.

The new post-processing adds **two draws**: a quarter-resolution bright extraction/blur before the existing OutputPass, followed by one full-resolution composite that combines bloom, color grading, and Ultra vignette. Five fixed taps are used per stage; there are no blur loops, repeated scene rendering, ray tracing, SSR, SSAO, displacement, or volumetric effects. The bloom texture is capped at 512 pixels on its longest edge and reused across frames. The existing FXAA/resolution/shadow presets are preserved.

Bloom favors bright colored emitters and suppresses neutral whites. The High/Ultra bloom strengths are 0.055/0.095; thresholds are 1.8/1.85. Grading is mild and contrast preserves black/white endpoints. The Ultra vignette darkens the outermost corners by at most 3.5%. Goal glow follows the existing explosion visibility and fade timers, so it does not linger after the explosion.

Without HDR color-buffer support, bloom is skipped while material/grade effects continue. An optional shader compilation failure disables the added material/post effects and returns to the original pipeline; the quality menu stays usable. A post-processing exception falls back to direct standard rendering. This extends the existing game's WebGL 2 baseline rather than adding support for devices unable to run the original game.

Verification includes `npm run test:graphics`, production build, real browser quality toggling, four rendered cars, active boost, ball movement at 60 m/s, goal explosion cleanup, unavailable-HDR behavior, and a deliberately invalid optional shader that triggers automatic fallback. Visual captures are `docs/polish-medium.png`, `docs/polish-high.png`, `docs/polish-ultra.png`, and `docs/polish-goal.png`.

Frame timing samples are in `docs/graphics-polish-timing.json`. Headless Chrome uses software SwiftShader; requestAnimationFrame samples are approximately 16.7 ms and are a regression smoke check, **not a hardware GPU benchmark or a performance guarantee**. Ultra's existing 1.3 resolution scale and 4096-pixel shadows remain the main performance-sensitive settings. Higher resolution also increases the cost of the full-screen composite, although bloom extraction stays capped.

Only the Lumen District city stadium, its walls and bleachers exist in this repository. Separate beach/stadium map variants could not be tested because they are not implemented; no additional arenas were created for this effects pass.
