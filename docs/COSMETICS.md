# First custom body and cosmetic set

Bodies use original procedural low-poly meshes; no copied assets or model downloads.

| Body                        | Inspiration            | Shape                                      |
| --------------------------- | ---------------------- | ------------------------------------------ |
| Vector (new-preset default) | Octane                 | Sporty, chunky rally hatch                 |
| Ion                         | Dominus                | Low muscle coupe and long hood             |
| Cargo                       | Merc                   | Upright boxy van                           |
| Slicer                      | Breakout               | Sharp nose, long windshield and wedge deck |
| Wraith                      | Endo / X-Devil / Venom | Narrow canopy and angular side pods        |

Existing saved Ion and Vector presets retain their IDs and choices. Only newly created default presets start with Vector. Existing Ion/Vector collision dimensions, inertia, wheel positions and vehicle tuning are unchanged. Cargo, Slicer and Wraith use the tested Vector chassis and wheel layout, including the same length; they introduce no new hitbox or force rules. Slicer's visual roof sits below that shared collision roof by design.

## Toppers

Top Hat, Cat Ears, Birthday Hat, Pickle, Crown, Traffic Cone, Propeller Beanie, Halo Ring, Tiny UFO and Pirate Hat, plus None. Each mounts relative to the selected body's actual visual roof and cabin center. Toppers are cosmetic and do not add colliders.

## Wheels

The existing Wheels tab now has ten original designs. Apex and Orbit keep their saved IDs.

| Wheel    | Construction                                                    |
| -------- | --------------------------------------------------------------- |
| Apex     | Clean five-spoke sport rim                                      |
| Filament | Sixteen narrow spokes                                           |
| Recess   | Recessed paired spokes and deep contrasting dish                |
| Badland  | Chunky tread blocks, broad spokes and rim bolts                 |
| Vortex   | Seven swept fan blades                                          |
| Pulse    | Three separated luminous arcs and a glowing center ring         |
| Orbit    | Solid disc with segmented face accents                          |
| Aster    | Broad five-point star plate                                     |
| Heritage | Simple steel plate with eight actual circular ventilation holes |
| Gyro     | Three interlaced elliptical hoops and thin radial braces        |

All designs fit inside the unchanged 0.18 m rigid wheel radius and 0.0575 m half-width, using the existing wheel mounts on all five bodies. No per-body offsets were needed. Off-road lugs reach the same outer tire envelope; neither colliders nor vehicle tuning change. Front steering, grounded spin, airborne coast and recorded replay wheel poses use the existing animation path unchanged.

Rim components are merged by material when equipped, with at most five meshes per wheel. The annular tire sidewall stays open around the rim; spokes and steel ventilation holes are actual geometry, not painted marks or recolors. The same builder is used by garage/home/party/gameplay/replay models.

- tests/wheel-customization.ts covers all fifty combinations, size/width bounds, unchanged mounts, structural differences, persistence/schema, batching, spin and recorded steering.
- tests/wheel-render.ts checks exposed rims, outward tire normals and visible near-side rubber while steering/spinning on all fifty combinations.
- tests/wheel-render-browser.cjs checks all selections and previews, reload, home lineup, actual driving/steering and replay in the browser. Screenshots are written to ignored .tools/.

## Boosts

Only Slipstream (clean cool stream) and Heatwave (warm pulsing stream/rings) retain continuous tapered cones.

| Particle boost | Distinctive rendering and motion                                     |
| -------------- | -------------------------------------------------------------------- |
| Ember          | Uneven orange/yellow fire clumps, fast embers and rising gray smoke  |
| Ion Drive      | Broad blue vapor puffs that expand, drift and rise; low glow         |
| Arc            | Thin crackling filaments and bright, rapidly scattered streaks       |
| Plasma         | Large purple round blobs with bright cores and slow deformation      |
| Stardust       | Tiny gold four-point glints, wide dispersion and rapid twinkling     |
| Astral         | Soft green motes in slow orbital flow with small turning halos       |
| Byte Stream    | Mint square bits in separate lanes, moving in discrete segments      |
| Dune           | Dim brown dust puffs plus tumbling sandy grains that fall and spread |

The original nine boost IDs remain valid. Dune adds the new dust ID. Body/topper/paint controls and physics are unchanged.

Soft particles are analytic camera-facing quads with feathered alpha; no image assets or distortion passes are required. Each boost uses fixed instanced buffers, at most 64 particles and five draw calls, reused throughout animation and disposed on equip changes. Densities, light intensity, shape, blend mode and motion differ by style. Idle effects skip animation; garage boost previews remain continuous. The retained streams preserve material quality polish.

## Integration and verification

- Definitions and allowed IDs: shared/catalog.ts; shared/accounts.ts validates the same catalog for party/network presets.
- Body recipes and roof/exhaust attachments: src/render/body-styles.ts and src/render/models.ts.
- Toppers: src/render/toppers.ts. Boosts: src/effects/boost-styles.ts and VehicleEffects.
- The same shell/topper builder is used in the garage, home/party lineup, solo/network matches, extra modes and training. Replays retain those models and animate recorded poses.
- tests/cosmetics.ts covers all 55 body/topper combinations, wheel alignment and finite mesh bounds, all ten boosts on all bodies, fixed buffer reuse, preset/schema persistence, legacy Ion saves and identical driving trajectories for the three shared-chassis bodies.
- tests/boost-variety.ts verifies the two-stream limit, distinct particle motion/density, rising vapor, falling sand, round plasma, electric streaks, twinkling glitter, stepped data, saved IDs and buffer/budget stability.
- tests/cosmetics-browser.cjs exercises the real garage selections, previews, reload, home lineup, gameplay and replay; screenshots go to ignored .tools/.

Minor topper overhang and the intentionally shared collision roof can be tuned later in the centralized body recipes. No unusable clipping was found in the checked combinations.

## Goal explosions and legacy presets

The six Garage tabs are Body, Paint, Wheels, Boost, Topper and Goal Explosions. Car decals are removed from rendering, inventory, UI and newly saved presets. Legacy local/network presets discard the old decal field; missing or invalid explosion IDs fall back to Pulse. The account database drops the legacy decal column and removes old owned decal items on startup without changing other cosmetics.

| Explosion      | Shape and flying objects                              |
| -------------- | ----------------------------------------------------- |
| Pulse          | Energy flash, expanding rings and small angular chips |
| Afterburn      | Fiery clumps, embers and lingering smoke              |
| Arcstorm       | Thin electric streaks and flickering waves            |
| Confetti       | Colorful fluttering paper pieces                      |
| Prism Bloom    | Elongated glowing crystal shards                      |
| Bubble Pop     | Soft translucent spherical bubbles                    |
| Databurst      | Square fragments moving in discrete steps             |
| Quarry         | Heavy chunks with gravity, bounce and dusty smoke     |
| Blue Horizon   | Flying rings and a temporary blue arena wash          |
| Violet Eclipse | Flying rings and a temporary purple arena wash        |

The two special washes flash in over 0.06 seconds, hold near 96% opacity until 1.1 seconds, and fade smoothly to zero by 3.3 seconds. Faint silhouettes remain visible under the near-total color flood. A screen-space overlay tints the arena without mutating materials, lighting or fog; reset, replay end and disposal clear it. Free Play retains neutral gray effects.

The scorer is resolved by stable player ID. Their selected effect is captured with the goal, included in authoritative snapshots and serialized into replay metadata, so changing a preset later cannot alter an existing goal replay. Bots without a selected preset use Pulse. Training goals use the selected preset too.

Entering the category or selecting an item starts one Garage demo shot. After the effect finishes, the ball resets and the preview waits; it does not loop. Particle instances and transform buffers are reused, with at most 72 active fragments plus 28 smoke instances. Style geometry is prepared when equipped and disposed when replaced.

Verification: tests/goal-explosions.ts covers preset migration, ownership by stable ID across Soccar/Heatseeker/Rumble/Free Play, replay capture, fixed buffers and wash cleanup. server/tests/explosion-presets.test.ts checks legacy account migration and persistence. tests/goal-explosions-browser.cjs checks all ten real Garage previews, reload, actual scoring, replay selection and full-map wash cleanup without shader errors. Screenshots stay in ignored .tools/. Confetti and Bubble Pop are intentionally subtler than the energy effects; particle density and brightness can be tuned after player feedback.

## Particle boost emission

Only the eight particle boosts use the emission lifecycle: Ember, Ion Drive, Arc, Plasma, Stardust, Astral, Byte Stream and Dune. Slipstream and Heatwave retain their existing instantaneous tapered streams. Particle instances begin at the two exhaust outlets, emit continuously into fixed pools, and travel over a 0.5-second lifetime. The nominal range is 1.65 times the original style length (about 2.4 to 3.1 world units), at roughly 4.8 to 6.3 units per second; compact flame tongues remain shorter accents. No extra particles or draw calls were added.

Releasing boost stops emission while existing particles travel, dim and shrink away for up to another 0.5 seconds. Each slot retains its interpolated emitter birth transform and inherited translational velocity, so fast movement and rotation do not drag old particles into a newly rotated line or leave a detached nozzle gap. Reset, teleport and backwards playback-time changes clear the pool. Garage, gameplay and render-only replay proxies use the same lifecycle.

`tests/boost-emission.ts` verifies growth, range, finite lifetime, continuous emission/restart, fixed buffers, fast movement, rotation continuity, reset and unchanged stream behavior. `tests/boost-emission-browser.cjs` checks all eight Garage previews, actual Free Play and VS Bot input/release, and a captured goal replay with both emission and release tails.
