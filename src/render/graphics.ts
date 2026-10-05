import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { qualities, type Quality } from "../game/settings";
import { setMaterialPolish } from "./material-polish";
import { GlowExtractPass, compositePolishPass } from "./polish-pass";
export class Graphics {
  quality: Quality = "high";
  private applied: Quality | null = null;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private aa = new ShaderPass(FXAAShader);
  readonly glow = new GlowExtractPass();
  readonly polish = compositePolishPass();
  effectsUnavailable = false;
  private directFallback = false;
  private bloomSupported: boolean;
  constructor(
    public renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.Camera,
    private sun: T.DirectionalLight,
  ) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.glow);
    this.composer.addPass(new OutputPass());
    this.polish.enabled = false;
    this.composer.addPass(this.polish);
    this.composer.addPass(this.aa);
    this.bloomSupported = renderer.extensions.has("EXT_color_buffer_float");
    const previousError = renderer.debug.onShaderError;
    renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      if (gl.getShaderSource(fragment)?.includes("OCTANE_POLISH")) {
        this.effectsUnavailable = true;
        console.warn(
          "Optional graphics effects were disabled after a shader error.",
        );
      } else if (previousError) previousError(gl, program, vertex, fragment);
      else
        console.error(
          "Shader compilation failed",
          gl.getProgramInfoLog(program),
          gl.getShaderInfoLog(fragment),
        );
    };
  }
  apply(quality: Quality) {
    if (quality === this.applied) return;
    this.applied = quality;
    this.quality = quality;
    this.configurePolish();
    const q = qualities[quality];
    this.renderer.shadowMap.enabled = q.shadows > 0;
    if (this.sun.shadow.mapSize.x !== q.shadows && q.shadows) {
      this.sun.shadow.mapSize.set(q.shadows, q.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.needsUpdate = true;
    }
    this.resize();
  }
  private configurePolish() {
    const enabled =
      !this.effectsUnavailable &&
      (this.quality === "high" || this.quality === "ultra");
    const ultra = this.quality === "ultra";
    setMaterialPolish(enabled ? this.quality : null);
    this.glow.enabled = enabled && this.bloomSupported;
    this.polish.enabled = enabled;
    this.glow.setThreshold(ultra ? 1.85 : 1.8);
    this.polish.uniforms.strength.value = this.glow.enabled
      ? ultra
        ? 0.095
        : 0.055
      : 0;
    this.polish.uniforms.contrast.value = ultra ? 1.03 : 1.018;
    this.polish.uniforms.saturation.value = ultra ? 1.035 : 1.02;
    this.polish.uniforms.vignette.value = ultra ? 0.035 : 0;
  }
  resize() {
    const ratio =
      Math.min(devicePixelRatio, 1.75) * qualities[this.quality].scale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(innerWidth, innerHeight);
    this.aa.uniforms.resolution.value.set(
      1 / (innerWidth * ratio),
      1 / (innerHeight * ratio),
    );
  }
  render(scene: T.Scene, camera: T.Camera) {
    if (this.effectsUnavailable && this.polish.enabled) this.configurePolish();
    if (qualities[this.quality].aa && !this.directFallback) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      if (this.glow.target) {
        this.polish.uniforms.glow.value = this.glow.target.texture;
        this.polish.uniforms.glowTexel.value.set(
          1.5 / this.glow.target.width,
          1.5 / this.glow.target.height,
        );
      }
      try {
        this.composer.render();
      } catch {
        this.effectsUnavailable = true;
        this.directFallback = true;
        this.configurePolish();
        this.renderer.render(scene, camera);
        console.warn("Post-processing unavailable; using standard rendering.");
      }
    } else this.renderer.render(scene, camera);
  }
}
