import * as T from "three";
import type { Car } from "../car/car";
import { MotionTrails } from "./motion-trails";

/** One small pressure ring and two short white streaks per real first jump. */
export class JumpBurst {
  readonly ring = new T.Mesh(
    new T.RingGeometry(0.055, 0.085, 16),
    new T.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
    }),
  );
  readonly streaks: MotionTrails;
  triggers = 0;
  private seen = 0;
  private age = 1;
  private origin = new T.Vector3();
  private normal = new T.Vector3();
  private side = new T.Vector3();
  constructor(scene: T.Scene) {
    scene.add(this.ring);
    this.ring.visible = false;
    this.streaks = new MotionTrails(scene, 2, 0.12);
  }
  reset() {
    this.seen = 0;
    this.age = 1;
    this.ring.visible = false;
    this.streaks.reset();
  }
  update(car: Car, dt: number, active: boolean, camera: T.Vector3) {
    if (dt <= 0) return;
    if (car.normalJumpSequence !== this.seen) {
      this.seen = car.normalJumpSequence;
      if (active && this.seen > 0 && car.normalJumpAge < 0.18) {
        this.age = car.normalJumpAge;
        this.triggers++;
        this.origin.copy(car.normalJumpOrigin);
        this.normal.copy(car.normalJumpNormal).normalize();
        this.side.set(1, 0, 0).addScaledVector(this.normal, -this.normal.x);
        if (this.side.lengthSq() < 0.01) this.side.set(0, 0, 1);
        this.side.normalize();
        this.ring.position.copy(this.origin);
        this.ring.quaternion.setFromUnitVectors(
          new T.Vector3(0, 0, 1),
          this.normal,
        );
        this.streaks.reset();
      }
    }
    this.age += dt;
    this.ring.visible = active && this.age < 0.18;
    this.ring.scale.setScalar(1 + this.age * 8);
    this.ring.material.opacity = Math.max(0, 0.55 * (1 - this.age / 0.18));
    this.streaks.update(
      [-1, 1].map((s) =>
        this.origin
          .clone()
          .addScaledVector(this.side, s * 0.055)
          .addScaledVector(this.normal, this.age * 0.9),
      ),
      dt,
      active && this.age < 0.1,
      0xffffff,
      0.35,
      0.012,
      camera,
    );
  }
}
