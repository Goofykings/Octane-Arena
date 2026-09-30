import { Quaternion, Vector3 } from "three";
import type { RigidBody } from "@dimforge/rapier3d-compat";
export class Pose {
  previous = new Vector3();
  current = new Vector3();
  previousQ = new Quaternion();
  currentQ = new Quaternion();
  constructor(public body: RigidBody) {
    this.snap();
  }
  snap() {
    this.current.copy(this.body.translation());
    this.currentQ.copy(this.body.rotation());
    this.previous.copy(this.current);
    this.previousQ.copy(this.currentQ);
  }
  before() {
    this.previous.copy(this.current);
    this.previousQ.copy(this.currentQ);
  }
  after() {
    this.current.copy(this.body.translation());
    this.currentQ.copy(this.body.rotation());
  }
  render(target: { position: Vector3; quaternion: Quaternion }, alpha: number) {
    target.position.lerpVectors(this.previous, this.current, alpha);
    target.quaternion.slerpQuaternions(this.previousQ, this.currentQ, alpha);
  }
}
