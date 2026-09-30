import * as T from "three";
import { carModel, ballModel, disposeModel, material } from "./models";
import type { Preset, Team } from "../game/inventory";
import { VehicleEffects } from "../effects/vehicle-effects";
import { Effects } from "../effects/effects";
import { GoalExplosion } from "../effects/goal-explosion";
export class GaragePreview {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(37, 1, 0.05, 60);
  private car = new T.Group();
  private angle = -0.55;
  private dragging = false;
  private x = 0;
  private pointer: number | null = null;
  private category = "body";
  private boostEffects: VehicleEffects | null = null;
  private particles = new Effects(this.scene);
  private color = 0x69e9ff;
  private time = 0;
  private goalScene = new T.Scene();
  private goalBall = ballModel();
  private goalExplosion = new GoalExplosion(this.goalScene, 0.25);
  private previewAge = -1;
  private exploded = false;
  get renderScene() {
    return this.category === "explosion" ? this.goalScene : this.scene;
  }
  constructor(private host: HTMLElement) {
    this.scene.background = new T.Color(0x101e2e);
    this.scene.fog = new T.Fog(0x101e2e, 8, 22);
    this.scene.add(new T.HemisphereLight(0xc8edff, 0x37444e, 2));
    const key = new T.DirectionalLight(0xd2f8ff, 2.2);
    key.position.set(3, 5, 2);
    this.scene.add(key);
    const rim = new T.DirectionalLight(0x439cf5, 1.5);
    rim.position.set(-3, 2, -4);
    this.scene.add(rim);
    const pad = new T.Mesh(
      new T.CylinderGeometry(2.6, 2.65, 0.12, 80),
      material(0x294053, 0.25, 0.7),
    );
    pad.position.y = -0.06;
    this.scene.add(pad);
    const ring = new T.Mesh(
      new T.TorusGeometry(2.4, 0.015, 8, 100),
      new T.MeshBasicMaterial({ color: 0x5cd4e9 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.013;
    this.scene.add(ring);
    const floor = new T.Mesh(
      new T.PlaneGeometry(80, 80),
      material(0x152438, 0.3, 0.6),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.13;
    this.scene.add(floor);
    this.scene.add(this.car);
    this.camera.position.set(2.15, 1.5, 3.15);
    this.camera.lookAt(0, 0.25, 0);
    host.addEventListener("pointerdown", (e) => {
      if (
        (e.target as HTMLElement).id !== "preview-drag" ||
        e.button !== 0 ||
        this.category === "explosion"
      )
        return;
      this.stopDrag();
      this.dragging = true;
      this.pointer = e.pointerId;
      this.x = e.clientX;
      host.setPointerCapture(e.pointerId);
    });
    host.addEventListener("pointermove", (e) => {
      if (this.dragging && e.pointerId === this.pointer) {
        if (e.pointerType === "mouse" && e.buttons === 0) {
          this.stopDrag();
          return;
        }
        this.angle += (e.clientX - this.x) * 0.012;
        this.x = e.clientX;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointer) this.stopDrag();
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    host.addEventListener("lostpointercapture", end);
    window.addEventListener("blur", () => this.stopDrag());
    host.addEventListener("preview-reset", () => this.stopDrag());
    host.addEventListener("preview-explosion", () => {
      this.setCategory("explosion");
      this.previewAge = 0;
      this.exploded = false;
      this.goalExplosion.reset();
      this.goalBall.visible = true;
      this.goalBall.position.set(0, 0.365, 2);
    });
    new MutationObserver(() => {
      if (host.hidden) this.stopDrag();
    }).observe(host, { attributes: true, attributeFilter: ["hidden"] });
    this.goalScene.background = new T.Color(0x101e2e);
    this.goalScene.add(new T.HemisphereLight(0xd5f4ff, 0x354c43, 3));
    const field = new T.Mesh(new T.PlaneGeometry(10, 14), material(0x1b514b));
    field.rotation.x = -Math.PI / 2;
    this.goalScene.add(field);
    for (const x of [-2.3, 2.3]) {
      const post = new T.Mesh(
        new T.BoxGeometry(0.1, 2, 0.1),
        new T.MeshBasicMaterial({ color: 0x69e9ff }),
      );
      post.position.set(x, 1, -3);
      this.goalScene.add(post);
    }
    const bar = new T.Mesh(
      new T.BoxGeometry(4.7, 0.1, 0.1),
      new T.MeshBasicMaterial({ color: 0x69e9ff }),
    );
    bar.position.set(0, 2, -3);
    this.goalScene.add(bar);
    const net = new T.Mesh(
      new T.BoxGeometry(4.6, 2, 1.2),
      new T.MeshBasicMaterial({
        color: 0x438a95,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
      }),
    );
    net.position.set(0, 1, -3.6);
    this.goalScene.add(net);
    this.goalBall.scale.setScalar(0.4);
    this.goalBall.position.set(0, 0.365, 2);
    this.goalScene.add(this.goalBall);
  }
  stopDrag() {
    const pointer = this.pointer;
    this.pointer = null;
    this.dragging = false;
    if (pointer !== null && this.host.hasPointerCapture(pointer))
      this.host.releasePointerCapture(pointer);
  }
  setCategory(category: string) {
    if (category === this.category) return;
    this.stopDrag();
    this.category = category;
    this.host.dataset.preview = category;
    this.previewAge = -1;
    this.exploded = false;
    this.goalExplosion.reset();
    this.goalBall.visible = true;
    this.goalBall.position.set(0, 0.365, 2);
  }
  setPreset(p: Preset, team: Team) {
    this.boostEffects?.dispose();
    this.scene.remove(this.car);
    disposeModel(this.car);
    this.car = carModel(
      new T.Color(p[team]).getHex(),
      p.body,
      p.wheels,
      p.decal,
    );
    this.car.position.y = 0.31;
    this.scene.add(this.car);
    this.color = p.boost === "ember" ? 0xffa548 : 0x69e9ff;
    this.boostEffects = new VehicleEffects(this.car, this.scene, this.color);
  }
  update(width: number, height: number, dt = 1 / 60, category = "body") {
    this.setCategory(category);
    this.time += dt;
    this.car.rotation.y = this.angle;
    this.boostEffects?.previewBoost(this.time, category === "boost");
    if (category === "boost")
      this.particles.emit(
        new T.Vector3(0, 0, 1.5)
          .applyQuaternion(this.car.quaternion)
          .add(this.car.position),
        new T.Vector3(0, 0.05, 2).applyQuaternion(this.car.quaternion),
        this.color,
        2,
      );
    this.particles.update(dt);
    if (category === "explosion") {
      if (this.previewAge >= 0) {
        this.previewAge += dt;
        this.goalBall.position.z = Math.max(-3.7, 2 - this.previewAge * 4);
        this.goalBall.rotation.x -= dt * 4;
        if (!this.exploded && this.goalBall.position.z < -3.365) {
          this.exploded = true;
          this.goalBall.visible = false;
          this.goalExplosion.trigger(this.goalBall.position, 0x69e9ff);
        }
        if (this.previewAge > 4.3) this.previewAge = -1;
      }
      this.goalExplosion.update(dt);
      this.camera.position.set(7, 4, 8);
      this.camera.lookAt(0, 0.6, -2);
    } else {
      this.camera.position.set(2.15, 1.5, 3.15);
      this.camera.lookAt(0, 0.25, 0);
    }
    this.camera.aspect = width / height;
    this.camera.setViewOffset(width, height, -width * 0.2, 0, width, height);
    this.camera.updateProjectionMatrix();
  }
}
