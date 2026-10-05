import * as T from "three";
import { polishMaterial } from "../render/material-polish";
export class GoalExplosion {
  private group = new T.Group();
  private age = 10;
  private flash: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>;
  private rings: T.Mesh<T.TorusGeometry, T.MeshBasicMaterial>[] = [];
  private light = new T.PointLight(0x7cf9ff, 0, 55, 1.5);
  constructor(scene: T.Scene, scale = 1) {
    this.group.scale.setScalar(scale);
    this.flash = new T.Mesh(
      new T.SphereGeometry(1, 24, 16),
      new T.MeshBasicMaterial({
        color: 0x7cf9ff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.DoubleSide,
      }),
    );
    this.group.add(this.flash, this.light);
    polishMaterial(this.flash.material, "burst");
    for (let i = 0; i < 3; i++) {
      const ring = new T.Mesh(
        new T.TorusGeometry(1, 0.035, 6, 80),
        new T.MeshBasicMaterial({
          color: 0x7cf9ff,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      ring.rotation.set(i * 0.7, i * 0.4, 0);
      polishMaterial(ring.material, "burst");
      this.group.add(ring);
      this.rings.push(ring);
    }
    scene.add(this.group);
    this.group.visible = false;
  }
  trigger(position: { x: number; y: number; z: number }, color: number) {
    this.age = 0;
    this.group.position.copy(position);
    this.group.visible = true;
    this.flash.material.color.setHex(color);
    this.light.color.setHex(color);
    this.rings.forEach((r) => r.material.color.setHex(color));
  }
  reset() {
    this.age = 10;
    this.group.visible = false;
  }
  update(dt: number) {
    this.age += dt;
    this.group.visible = this.age < 2.8;
    if (!this.group.visible) return;
    const t = this.age;
    this.flash.scale.setScalar(0.4 + t * 12);
    this.flash.material.opacity = Math.max(0, 0.65 - t * 0.65);
    this.light.intensity = Math.max(0, 70 * (1 - t / 1.6));
    this.rings.forEach((r, i) => {
      r.scale.setScalar(1 + Math.max(0, t - i * 0.1) * (11 + i * 2));
      r.material.opacity = Math.max(0, 1 - t / 2.8);
      r.rotation.z += dt * (i + 1) * 0.2;
    });
  }
}
