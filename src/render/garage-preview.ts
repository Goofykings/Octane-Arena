import * as T from "three";
import { carModel, ballModel, disposeModel, material } from "./models";
import { isArenaCarBody } from "./arena-car-model";
import { animateTopper } from "./toppers";
import type { Preset, Team } from "../game/inventory";
import { VehicleEffects } from "../effects/vehicle-effects";
import { GoalExplosion } from "../effects/goal-explosion";
import { MouseOrbit, type MouseLook } from "../camera/mouse-look";
export class GaragePreview {
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(37, 1, 0.05, 60);
  private car = new T.Group();
  private angle = -0.55;
  private readonly motionPreference = matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  private modelKey = "";
  private boostId = "";
  private selectionAge = 1;
  private topperY = 0;
  mouseLook?: MouseLook;
  private mouseOrbit = new MouseOrbit();
  private mouseFocus = new T.Vector3(0, 0.25, 0);
  get dragging() {
    return this.mouseLook?.dragging ?? false;
  }
  private category = "body";
  private boostEffects: VehicleEffects | null = null;
  private color = 0x69e9ff;
  private time = 0;
  private goalScene = new T.Scene();
  private goalBall = ballModel();
  private goalExplosion = new GoalExplosion(this.goalScene, 0.25);
  private previewAge = -1;
  private exploded = false;
  private explosionId = "pulse";
  private explosionColor = 0x69e9ff;
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
    host.addEventListener("preview-reset", () => this.stopDrag());
    host.addEventListener("preview-explosion", () => {
      this.setCategory("explosion");
      this.previewAge = 0;
      this.exploded = false;
      this.goalExplosion.reset();
      this.goalBall.visible = true;
      this.goalBall.position.set(0, 0.365, 2);
    });
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
    this.mouseLook?.end();
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
    this.explosionId = p.explosion;
    this.goalExplosion.setStyle(p.explosion);
    this.explosionColor = team === "blue" ? 0x69e9ff : 0xffb654;
    const modelKey = [p.body, p.wheels, p.topper, p[team]].join("|");
    if (modelKey === this.modelKey) {
      if (p.boost !== this.boostId) {
        this.boostEffects?.setStyle(p.boost);
        if (p.boost === "standard") this.boostEffects?.setColor(0x69e9ff);
        this.boostId = p.boost;
      }
      return;
    }
    this.modelKey = modelKey;
    this.boostId = p.boost;
    this.selectionAge = 0;
    this.boostEffects?.dispose();
    this.scene.remove(this.car);
    disposeModel(this.car);
    this.car = carModel(
      new T.Color(p[team]).getHex(),
      p.body,
      p.wheels,
      p.topper,
    );
    this.topperY = (this.car.userData.topper as T.Object3D).position.y;
    this.car.position.y = 0.31;
    this.scene.add(this.car);
    this.color = p.boost === "ember" ? 0xffa548 : 0x69e9ff;
    this.boostEffects = new VehicleEffects(
      this.car,
      this.scene,
      this.color,
      p.boost,
    );
  }
  update(width: number, height: number, dt = 1 / 60, category = "body") {
    this.setCategory(category);
    this.time += dt;
    this.selectionAge = Math.min(1, this.selectionAge + dt / 0.18);
    const ease = 1 - Math.pow(1 - this.selectionAge, 3);
    const reduced = this.motionPreference.matches;
    this.car.scale.setScalar(reduced ? 1 : 0.97 + 0.03 * ease);
    const topper = this.car.userData.topper as T.Object3D | undefined;
    // A short cosmetic airborne/landing demonstration; never moves the actual car.
    animateTopper(
      topper,
      dt,
      reduced || category !== "topper" || this.time % 5 > 2.5,
    );
    if (topper)
      topper.position.y =
        this.topperY +
        (!reduced && category === "topper" ? 0.08 * (1 - ease) : 0);
    this.car.rotation.y =
      this.angle +
      (isArenaCarBody(this.car.userData.bodyId) ? Math.PI : 0) +
      (reduced ? 0 : (1 - ease) * 0.08);
    this.boostEffects?.previewBoost(this.time, category === "boost");
    if (category === "explosion") {
      if (this.previewAge >= 0) {
        this.previewAge += dt;
        this.goalBall.position.z = Math.max(-3.7, 2 - this.previewAge * 4);
        this.goalBall.rotation.x -= dt * 4;
        if (!this.exploded && this.goalBall.position.z < -3.365) {
          this.exploded = true;
          this.goalBall.visible = false;
          this.goalExplosion.trigger(
            this.goalBall.position,
            this.explosionColor,
            this.explosionId,
          );
        }
        if (this.exploded && !this.goalExplosion.active) {
          this.previewAge = -1;
          this.goalBall.visible = true;
          this.goalBall.position.set(0, 0.365, 2);
        }
      }
      this.goalExplosion.update(dt);
      this.camera.position.set(7, 4, 8);
      this.camera.lookAt(0, 0.6, -2);
    } else if (category === "topper") {
      // Closer roof inspection keeps small details and the carton decal readable.
      this.camera.position.set(1.35, 1.3, 1.95);
      this.camera.lookAt(0, 0.6, 0);
    } else {
      this.camera.position.set(2.15, 1.5, 3.15);
      this.camera.lookAt(0, 0.25, 0);
    }
    this.camera.aspect = width / height;
    this.camera.setViewOffset(width, height, -width * 0.2, 0, width, height);
    this.camera.updateProjectionMatrix();
    this.mouseFocus.y = category === "topper" ? 0.6 : 0.25;
    if (category !== "explosion")
      this.mouseOrbit.apply(
        this.camera,
        this.mouseFocus,
        this.mouseLook,
        dt,
        undefined,
        0.16,
      );
  }
}
