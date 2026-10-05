import * as T from "three";
import type { Car } from "../car/car";
import { P } from "../config/physics";
import { polishMaterial } from "../render/material-polish";

/** Continuous exhaust geometry plus world-space ribbons from the rear wheels. */
export class VehicleEffects {
  private flames = new T.Group();
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
  ) {
    for (const x of [-0.22, 0.22]) {
      const outer = new T.Mesh(
        new T.ConeGeometry(0.14, 1.5, 10),
        new T.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.65,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      outer.rotation.x = Math.PI / 2;
      polishMaterial(outer.material, "boost");
      outer.position.set(x, 0, 1.4);
      this.flames.add(outer);
      const inner = new T.Mesh(
        new T.ConeGeometry(0.065, 1, 8),
        new T.MeshBasicMaterial({
          color: 0xeaffff,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      inner.rotation.x = Math.PI / 2;
      polishMaterial(inner.material, "core");
      inner.position.set(x, 0, 1.15);
      this.flames.add(inner);
    }
    this.glow = new T.PointLight(color, 0, 4, 2);
    this.glow.position.set(0, 0, 1);
    this.flames.add(this.glow);
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
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.trails.push({ points: [], positions, mesh });
    }
  }
  reset() {
    this.fade = 0;
    this.wasActive = false;
    for (const t of this.trails) {
      t.points.length = 0;
      t.mesh.visible = false;
    }
    this.flames.visible = false;
  }
  setColor(color: number) {
    this.glow.color.setHex(color);
    for (const t of this.trails) t.mesh.material.color.setHex(color);
    this.flames.children.forEach((child, i) => {
      if (child instanceof T.Mesh && i % 2 === 0)
        child.material.color.setHex(color);
    });
  }
  previewBoost(time: number, enabled: boolean) {
    this.flames.visible = enabled;
    this.flames.scale.z =
      1 + 0.17 * Math.sin(time * 67) + 0.1 * Math.sin(time * 113);
    this.flames.position.z = 0.65 * (1 - this.flames.scale.z);
    this.glow.intensity = enabled ? 2.4 : 0;
  }
  dispose() {
    for (const t of this.trails) {
      t.mesh.removeFromParent();
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
    }
  }
  update(car: Car, dt: number, time: number, active: boolean) {
    if (!active && this.wasActive) this.reset();
    this.wasActive = active;
    this.flames.visible = active && car.boosting;
    this.flames.scale.z =
      1 + 0.17 * Math.sin(time * 67) + 0.1 * Math.sin(time * 113);
    this.flames.position.z = 0.65 * (1 - this.flames.scale.z);
    this.glow.intensity = car.boosting ? 2.4 : 0;
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
