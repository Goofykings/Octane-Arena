import * as T from "three";
import type { Car } from "../car/car";
import type { ReplayClip } from "../../shared/replay";
/** Original small white expanding ring, pooled per car. */
export class FlipResetBurst {
  readonly ring = new T.Mesh(
    new T.RingGeometry(0.12, 0.17, 32),
    new T.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      toneMapped: false,
    }),
  );
  private seen = 0;
  constructor(scene: T.Scene) {
    scene.add(this.ring);
    this.ring.visible = false;
  }
  private draw(point: T.Vector3, normal: T.Vector3, age: number) {
    this.ring.visible = age >= 0 && age < 0.3;
    if (!this.ring.visible) return;
    this.ring.position.copy(point).addScaledVector(normal, 0.015);
    this.ring.quaternion.setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      normal.clone().normalize(),
    );
    this.ring.scale.setScalar(1 + age * 16);
    this.ring.material.opacity = (1 - age / 0.3) * 0.9;
  }
  update(car: Car, active: boolean) {
    const seq = car.flipResetSequence ?? 0;
    if (seq !== this.seen) this.seen = seq;
    if (active && seq > 0 && car.flipResetAge < 0.3)
      this.draw(car.flipResetOrigin, car.flipResetNormal, car.flipResetAge);
    else this.ring.visible = false;
  }
  replay(clip: ReplayClip, id: string, time: number) {
    let event: ReplayClip["events"][number] | undefined;
    for (let i = clip.events.length - 1; i >= 0; i--) {
      const e = clip.events[i];
      if (e.kind === "flip-reset" && e.playerId === id && e.time <= time) {
        event = e;
        break;
      }
    }
    if (event?.point && event.normal)
      this.draw(
        new T.Vector3().copy(event.point),
        new T.Vector3().copy(event.normal),
        time - event.time,
      );
    else this.ring.visible = false;
  }
  reset() {
    this.seen = 0;
    this.ring.visible = false;
  }
  dispose() {
    this.ring.removeFromParent();
    this.ring.geometry.dispose();
    this.ring.material.dispose();
  }
}
