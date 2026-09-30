import * as T from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { qualities, type Quality } from "../game/settings";
export class Graphics {
  quality: Quality = "high";
  private applied: Quality | null = null;
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private aa = new ShaderPass(FXAAShader);
  constructor(
    public renderer: T.WebGLRenderer,
    scene: T.Scene,
    camera: T.Camera,
    private sun: T.DirectionalLight,
  ) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.aa);
  }
  apply(quality: Quality) {
    if (quality === this.applied) return;
    this.applied = quality;
    this.quality = quality;
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
    if (qualities[this.quality].aa) {
      this.renderPass.scene = scene;
      this.renderPass.camera = camera;
      this.composer.render();
    } else this.renderer.render(scene, camera);
  }
}
