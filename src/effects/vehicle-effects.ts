import * as T from "three";
import type { Car } from "../car/car";
import { BoostPlume } from "./boost-styles";
import { FlipResetBurst } from "./flip-reset";

/** Pooled exhaust effects plus world-space ribbons from the rear wheels. */
export class VehicleEffects {
  readonly flipReset: FlipResetBurst;
  private flames: BoostPlume;
  private glow: T.PointLight;
  private trails: {
    points: T.Vector3[];
    positions: Float32Array;
    mesh: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>;
  }[] = [];
  private sampleTime = 0;
  private fade = 0;
  private wasActive = false;
  constructor(
    private model: T.Group,
    scene: T.Scene,
    color: number,
    style = "standard",
  ) {
    this.flipReset = new FlipResetBurst(scene);
    this.flames = new BoostPlume(
      style,
      style === "standard" ? color : undefined,
    );
    this.glow = new T.PointLight(color, 0, 4, 2);
    this.glow.position.set(0, 0, 1);
    // A stable scene light budget avoids recompiling every lit material when boost toggles.
    scene.add(this.glow);
    model.add(this.flames);
    for (let wheel = 0; wheel < 2; wheel++) {
      const positions = new Float32Array(48 * 6 * 3),
        geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(positions, 3));
      const mesh = new T.Mesh(
        geo,
        new T.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.7,
          side: T.DoubleSide,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      mesh.name = "supersonic-tire-trail";
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.trails.push({ points: [], positions, mesh });
    }
    if (style !== "standard") this.setColor(this.flames.color);
  }
  reset() {
    this.flipReset.reset();
    this.fade = 0;
    this.wasActive = false;
    for (const t of this.trails) {
      t.points.length = 0;
      t.mesh.visible = false;
    }
    this.flames.resetParticles();
    this.glow.intensity = 0;
  }
  setColor(color: number) {
    this.glow.color.setHex(color);
    for (const t of this.trails) t.mesh.material.color.setHex(color);
    this.flames.setColor(color);
  }
  setStyle(id: string) {
    this.flames.setStyle(id);
    this.setColor(this.flames.color);
  }
  private animateBoost(time: number, emitting: boolean) {
    const shell = this.model.userData.exhaust
      ? this.model
      : this.model.children.find((c) => c.userData.exhaust);
    const outlet = shell?.userData.exhaust as T.Vector3 | undefined;
    this.flames.position.copy(outlet ?? this.defaultOutlet);
    this.flames.animate(time, emitting);
    this.placeGlow();
  }
  private defaultOutlet = new T.Vector3(0, -0.025, 0.7);
  private placeGlow() {
    this.glow.position.copy(this.flames.position);
    this.glow.position.z += 0.3;
    this.model.localToWorld(this.glow.position);
  }
  previewBoost(time: number, enabled: boolean) {
    this.animateBoost(time, enabled);
    this.glow.intensity = enabled ? this.flames.lightIntensity : 0;
  }
  dispose() {
    this.glow.removeFromParent();
    this.flames.removeFromParent();
    this.flames.dispose();
    this.flipReset.dispose();
    for (const t of this.trails) {
      t.mesh.removeFromParent();
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    }
  }
  update(car: Car, dt: number, time: number, active: boolean) {
    if (!active && this.wasActive) this.reset();
    this.wasActive = active;
    this.flipReset.update(car, active);
    if (active) this.animateBoost(time, car.boosting);
    this.glow.intensity =
      active && car.boosting ? this.flames.lightIntensity : 0;
    const sonic = active && car.wheelContact.some(Boolean) && car.supersonic;
    if (!car.wheelContact.some(Boolean)) {
      this.fade = 0;
      this.trails.forEach((t) => (t.points.length = 0));
    }
    this.fade = T.MathUtils.lerp(
      this.fade,
      sonic ? 1 : 0,
      1 - Math.exp(-dt * (sonic ? 14 : 5)),
    );
    this.sampleTime += dt;
    if (this.sampleTime >= 1 / 90) {
      this.sampleTime = 0;
      this.trails.forEach((t, i) => {
        const index = car.wheelContact[i + 2] ? i + 2 : i;
        const p = car.wheelHits[index]
          .clone()
          .addScaledVector(car.normal, 0.025);
        if (t.points.length && p.distanceTo(t.points[0]) > 4)
          t.points.length = 0;
        t.points.unshift(p);
        if (t.points.length > 48) t.points.pop();
      });
    }
    const right = new T.Vector3(1, 0, 0).applyQuaternion(this.model.quaternion);
    for (const t of this.trails) {
      t.mesh.visible =
        this.fade > 0.02 && active && car.wheelContact.some(Boolean);
      t.mesh.material.opacity = this.fade * 0.7;
      let k = 0;
      for (let i = 0; i < t.points.length - 1; i++) {
        const width = 0.07 * (1 - i / 48),
          a = t.points[i],
          b = t.points[i + 1];
        for (const [p, side] of [
          [a, -1],
          [a, 1],
          [b, -1],
          [b, -1],
          [a, 1],
          [b, 1],
        ] as const) {
          t.positions[k++] = p.x + right.x * width * side;
          t.positions[k++] = p.y + right.y * width * side;
          t.positions[k++] = p.z + right.z * width * side;
        }
      }
      t.mesh.geometry.setDrawRange(0, k / 3);
      t.mesh.geometry.attributes.position.needsUpdate = true;
    }
  }
}
