import assert from "node:assert/strict";
import * as T from "three";
import {
  polishMaterial,
  setMaterialPolish,
  type PolishKind,
} from "../src/render/material-polish";
import { GlowExtractPass } from "../src/render/polish-pass";
for (const kind of [
  "car",
  "ball",
  "ground",
  "wall",
  "boost",
  "core",
  "goal",
  "burst",
  "light",
] as PolishKind[]) {
  setMaterialPolish("low");
  const standard = ["car", "ball", "ground", "wall"].includes(kind);
  const source = standard ? T.ShaderLib.standard : T.ShaderLib.basic;
  const material = polishMaterial(
    standard
      ? new T.MeshStandardMaterial({ color: 0x437c91, roughness: 0.7 })
      : new T.MeshBasicMaterial({ color: 0x437c91 }),
    kind,
  );
  const compile = () => {
    const shader = {
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms: {},
    } as Parameters<T.Material["onBeforeCompile"]>[0];
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    return shader;
  };
  for (const quality of ["low", "medium"] as const) {
    setMaterialPolish(quality);
    const shader = compile();
    assert.equal(shader.vertexShader, source.vertexShader);
    assert.equal(shader.fragmentShader, source.fragmentShader);
  }
  setMaterialPolish("high");
  const shader = compile(),
    key = material.customProgramCacheKey(),
    version = material.version;
  assert.ok(shader.fragmentShader.includes("OCTANE_POLISH"));
  assert.equal(shader.uniforms.polishTier.value, 1);
  setMaterialPolish("ultra");
  assert.equal(shader.uniforms.polishTier.value, 2);
  assert.equal(material.version, version, "high/ultra share programs");
  assert.equal(material.customProgramCacheKey(), key);
  assert.equal(
    material.color.getHex(),
    0x437c91,
    "original paint is preserved",
  );
  setMaterialPolish(null);
  assert.equal(
    compile().fragmentShader,
    source.fragmentShader,
    "fallback removes shader modifications",
  );
  material.dispose();
  const disposed = material.version;
  setMaterialPolish("high");
  assert.equal(
    material.version,
    disposed,
    "disposed materials leave the registry",
  );
}
setMaterialPolish(null);
const glow = new GlowExtractPass();
glow.setSize(3840, 2160);
assert.equal(glow.target, null, "no optional texture allocated on low/medium");
glow.enabled = true;
glow.setSize(3840, 2160);
assert.equal(glow.target!.width, 512);
assert.equal(glow.target!.height, 288);
const target = glow.target;
glow.setSize(3840, 2160);
assert.equal(glow.target, target, "fixed target reused");
glow.setSize(800, 600);
assert.equal(glow.target!.width, 200);
assert.equal(glow.target!.height, 150);
glow.dispose();
console.log(
  "PASS all material effects reversible on low/medium/fallback, paint preserved, shared high/ultra programs, dispose cleanup, quarter-resolution capped bloom allocation",
);
