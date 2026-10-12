import * as T from "three";
export interface CameraViewFrame {
  car: T.Vector3;
  ball: T.Vector3;
  ballEnabled: boolean;
  position: T.Vector3;
  rotation: T.Quaternion;
}
const controllers = new WeakMap<T.Scene, CameraVisualOcclusion>();
/** Decorative objects have no gameplay colliders. Fade only individual meshes
 * intersecting actual camera-to-subject segments, never the arena/stadium. */
class CameraVisualOcclusion {
  private ray = new T.Raycaster();
  private direction = new T.Vector3();
  private lastTime = 0;
  private materials = new Map<
    T.Mesh,
    { mats: T.Material[]; opacity: number[] }
  >();
  constructor(private meshes: T.Mesh[]) {}
  update(camera: T.Camera, now: number) {
    const dt = this.lastTime
      ? Math.min(0.1, Math.max(0, now - this.lastTime))
      : 1 / 60;
    this.lastTime = now;
    const frame = camera.userData.cameraView as CameraViewFrame | undefined;
    const active =
      frame &&
      frame.position.distanceToSquared(camera.position) < 1e-8 &&
      frame.rotation.angleTo(camera.quaternion) < 1e-5;
    const blocked = new Set<T.Mesh>();
    if (active)
      for (const target of frame.ballEnabled
        ? [frame.car, frame.ball]
        : [frame.car]) {
        this.direction.copy(target).sub(camera.position);
        const length = this.direction.length();
        this.ray.set(
          camera.position,
          this.direction.divideScalar(Math.max(length, 1e-6)),
        );
        this.ray.far = Math.max(0, length - 0.3);
        for (const hit of this.ray.intersectObjects(this.meshes, false)) {
          let visible = true;
          for (let o: T.Object3D | null = hit.object; o; o = o.parent)
            visible &&= o.visible;
          if (visible) blocked.add(hit.object as T.Mesh);
        }
      }
    for (const mesh of this.meshes) {
      let entry = this.materials.get(mesh);
      if (!entry && blocked.has(mesh)) {
        const base = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        const mats = base.map((m) => m.clone());
        entry = { mats, opacity: base.map((m) => m.opacity) };
        mats.forEach((m) => {
          m.transparent = true;
          m.depthWrite = false;
        });
        mesh.material = Array.isArray(mesh.material) ? mats : mats[0];
        this.materials.set(mesh, entry);
      }
      if (!entry) continue;
      entry.mats.forEach((m, i) => {
        const goal = entry!.opacity[i] * (blocked.has(mesh) ? 0.08 : 1);
        m.opacity += (goal - m.opacity) * (1 - Math.exp(-12 * dt));
        if (Math.abs(m.opacity - goal) < 0.001) m.opacity = goal;
      });
    }
  }
}
export function registerCameraVisualOcclusion(
  scene: T.Scene,
  meshes: T.Mesh[],
) {
  meshes.forEach((mesh) => mesh.updateWorldMatrix(true, false));
  controllers.set(scene, new CameraVisualOcclusion(meshes));
}
export function updateCameraVisualOcclusion(
  scene: T.Scene,
  camera: T.Camera,
  now = performance.now() / 1000,
) {
  controllers.get(scene)?.update(camera, now);
}
