import * as T from "three";
/** Small, short-lived original flash; one pooled instance per car. */
export class DemolitionFlash {
  private age = 1;
  private mesh = new T.Mesh(
    new T.IcosahedronGeometry(1, 1),
    new T.MeshBasicMaterial({
      color: 0xffd191,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    }),
  );
  private light = new T.PointLight(0xffb067, 0, 12);
  constructor(scene: T.Scene) {
    scene.add(this.mesh, this.light);
    this.mesh.visible = false;
  }
  trigger(position: T.Vector3) {
    this.age = 0;
    this.mesh.position.copy(position);
    this.light.position.copy(position);
  }
  reset() {
    this.age = 1;
    this.mesh.visible = false;
    this.light.intensity = 0;
  }
  update(dt: number) {
    this.age += dt;
    this.mesh.visible = this.age < 0.45;
    const fade = Math.max(0, 1 - this.age / 0.45);
    this.mesh.scale.setScalar(0.5 + this.age * 5);
    this.mesh.material.opacity = fade * 0.8;
    this.light.intensity = fade * 12;
  }
}
