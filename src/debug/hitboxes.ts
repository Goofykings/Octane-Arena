import * as T from "three";
import type { Simulation } from "../physics/simulation";
export class Hitboxes {
  group = new T.Group();
  private cars: T.Mesh[] = [];
  private ball: T.Mesh;
  constructor(scene: T.Scene) {
    const mat = new T.MeshBasicMaterial({
      color: 0x99ffff,
      wireframe: true,
      transparent: true,
      opacity: 0.65,
      depthTest: false,
    });
    for (let i = 0; i < 2; i++) {
      const mesh = new T.Mesh(new T.BoxGeometry(2, 2, 2), mat);
      this.cars.push(mesh);
      this.group.add(mesh);
    }
    this.ball = new T.Mesh(
      new T.SphereGeometry(1, 20, 12),
      new T.MeshBasicMaterial({
        color: 0xffdf94,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      }),
    );
    this.group.add(this.ball);
    scene.add(this.group);
    this.group.visible = false;
  }
  update(s: Simulation, enabled: boolean) {
    this.group.visible = enabled;
    if (!enabled) return;
    this.cars.forEach((mesh, i) => {
      const c = s.cars[i].collider;
      mesh.visible = s.cars[i].body.isEnabled();
      mesh.position.copy(c.translation());
      mesh.quaternion.copy(c.rotation());
      mesh.scale.copy(c.halfExtents()!);
    });
    this.ball.visible = s.ball.isEnabled();
    this.ball.position.copy(s.ballCollider.translation());
    this.ball.quaternion.copy(s.ballCollider.rotation());
    this.ball.scale.setScalar(s.ballCollider.radius());
  }
}
