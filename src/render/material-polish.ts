import * as T from "three";
import type { Quality } from "../game/settings";

export type PolishKind =
  | "car"
  | "ball"
  | "ground"
  | "wall"
  | "boost"
  | "core"
  | "goal"
  | "burst"
  | "light";
// Shared uniforms/programs across all cars and both local/network effects.
const tier = { value: 0 };
const materials = new Set<T.Material>();
export const polishTuning = {
  rimExponent: { value: 3.5 },
  carRim: { value: 0.12 },
  ballRim: { value: 0.09 },
};
export function setMaterialPolish(quality: Quality | null) {
  const next = quality === "ultra" ? 2 : quality === "high" ? 1 : 0;
  const recompile = Boolean(next) !== Boolean(tier.value);
  tier.value = next;
  if (recompile)
    materials.forEach((m) => {
      m.needsUpdate = true;
    });
}
export function polishMaterial<M extends T.Material>(
  material: M,
  kind: PolishKind,
): M {
  if (materials.has(material)) return material;
  materials.add(material);
  material.addEventListener("dispose", () => materials.delete(material));
  material.userData.polishKind = kind;
  const original = material.onBeforeCompile,
    cacheKey = material.customProgramCacheKey();
  material.customProgramCacheKey = () =>
    `${cacheKey}:polish:${kind}:${Boolean(tier.value)}`;
  material.onBeforeCompile = (shader, renderer) => {
    original.call(material, shader, renderer);
    if (!tier.value) return;
    shader.uniforms.polishTier = tier;
    shader.uniforms.polishExponent = polishTuning.rimExponent;
    shader.uniforms.polishCarRim = polishTuning.carRim;
    shader.uniforms.polishBallRim = polishTuning.ballRim;
    const header = `// OCTANE_POLISH
      uniform float polishTier, polishExponent, polishCarRim, polishBallRim;
      varying vec3 vPolishPosition;`;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vPolishPosition;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPolishPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\n${header}`,
    );
    if (kind === "ground") {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <map_fragment>",
          `#include <map_fragment>
        float polishVariation = sin(vPolishPosition.x * 0.23 + vPolishPosition.z * 0.09) * sin(vPolishPosition.z * 0.19);
        diffuseColor.rgb *= 1.0 + polishVariation * (0.008 + polishTier * 0.008);`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor + polishVariation * 0.025 * polishTier, 0.86, 1.0);`,
        );
    } else if (["car", "ball", "wall"].includes(kind)) {
      const intensity =
        kind === "car"
          ? "polishCarRim"
          : kind === "ball"
            ? "polishBallRim"
            : "0.026";
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float polishFresnel = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), polishExponent);
        totalEmissiveRadiance += vec3(0.66, 0.83, 0.91) * polishFresnel * ${intensity} * (0.8 + polishTier * 0.2);
        ${kind === "wall" ? "diffuseColor.a = min(1.0, diffuseColor.a + polishFresnel * 0.025 * max(0.0, polishTier - 1.0));" : ""}`,
      );
      if (kind === "ball")
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <roughnessmap_fragment>",
          `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + sin(vPolishPosition.x * 2.0 + vPolishPosition.y) * 0.008 * polishTier, 0.4, 1.0);`,
        );
    } else {
      const gain =
        kind === "core"
          ? "(1.9 + 0.45 * polishTier)"
          : kind === "burst"
            ? "(1.7 + 0.35 * polishTier)"
            : kind === "light"
              ? "(1.8 + 0.45 * polishTier)"
              : kind === "boost"
                ? "(1.15 + 0.2 * polishTier)"
                : "(1.0 + 0.08 * polishTier)";
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `outgoingLight *= ${gain};\n#include <opaque_fragment>`,
      );
      if (kind === "boost") {
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vPolishNormal, vPolishView;",
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvPolishNormal = normalize(normalMatrix * normal);\nvPolishView = -(modelViewMatrix * vec4(transformed, 1.0)).xyz;",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying vec3 vPolishNormal, vPolishView;",
          )
          .replace(
            "#include <color_fragment>",
            "#include <color_fragment>\ndiffuseColor.a *= 0.75 + 0.25 * abs(dot(normalize(vPolishNormal), normalize(vPolishView)));",
          );
      }
    }
  };
  return material;
}
