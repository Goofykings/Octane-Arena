import * as T from "three";
import type { DribbleCourse } from "./levels";
export const DRIBBLE_GOAL_RADIUS = 0.18;
/** One shared local-space goal definition for colliders, art and sphere crossing.
 * width/height describe the clear opening, preserving existing course widths. */
export class DribbleFinishGoal {
  readonly rotation: T.Quaternion;
  readonly parts: {
    name: string;
    center: T.Vector3;
    rotation: T.Quaternion;
    halfHeight: number;
  }[];
  private completed = false;
  constructor(
    readonly finish: DribbleCourse["finish"],
    readonly radius = DRIBBLE_GOAL_RADIUS,
  ) {
    this.rotation = new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      -finish.heading,
    );
    this.parts = [
      ...[-1, 1].map((side) => ({
        name: side < 0 ? "left-post" : "right-post",
        center: new T.Vector3(
          side * (finish.width / 2 + radius),
          (finish.height + radius) / 2,
          0,
        ),
        rotation: new T.Quaternion(),
        halfHeight: (finish.height - radius) / 2,
      })),
      {
        name: "crossbar",
        center: new T.Vector3(0, finish.height + radius, 0),
        rotation: new T.Quaternion().setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          -Math.PI / 2,
        ),
        halfHeight: finish.width / 2 + radius,
      },
    ];
  }
  worldPart(part: (typeof this.parts)[number]) {
    return {
      position: part.center
        .clone()
        .applyQuaternion(this.rotation)
        .add(this.finish.center),
      rotation: this.rotation.clone().multiply(part.rotation),
    };
  }
  local(p: T.Vector3) {
    return p
      .clone()
      .sub(this.finish.center)
      .applyQuaternion(this.rotation.clone().invert());
  }
  reset() {
    this.completed = false;
  }
  /** Swept sphere vs shallow opening volume. Centre masks reject the outside
   * of posts/above the bar; no lower centre/grounded/full-sphere crossing gate. */
  crossed(beforeWorld: T.Vector3, afterWorld: T.Vector3, r: number) {
    if (
      this.completed ||
      ![...beforeWorld.toArray(), ...afterWorld.toArray(), r].every(
        Number.isFinite,
      ) ||
      r <= 0
    )
      return false;
    const before = this.local(beforeWorld),
      after = this.local(afterWorld);
    const delta = after.clone().sub(before),
      half = this.finish.width / 2;
    let lo = 0,
      hi = 1;
    const clip = (a: number, d: number, min: number, max: number) => {
      if (Math.abs(d) < 1e-12) return a >= min && a <= max;
      const t0 = (min - a) / d,
        t1 = (max - a) / d;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      return lo <= hi;
    };
    if (
      !clip(before.x, delta.x, -half, half) ||
      !clip(before.y, delta.y, -2 * r, this.finish.height) ||
      !clip(before.z, delta.z, -this.radius - r, this.radius + r)
    )
      return false;
    const distance = (t: number) => {
      const y = before.y + delta.y * t,
        z = before.z + delta.z * t;
      const dy = Math.max(-r - y, 0, y - this.finish.height);
      const dz = Math.max(Math.abs(z) - this.radius, 0);
      return dy * dy + dz * dz;
    };
    // Squared distance to a convex box is convex along the segment. Minimize it
    // to catch grazing/fast swept overlaps instead of sampling just endpoints.
    let left = lo,
      right = hi;
    for (let i = 0; i < 48; i++) {
      const a = left + (right - left) / 3,
        b = right - (right - left) / 3;
      if (distance(a) < distance(b)) right = b;
      else left = a;
    }
    if (
      Math.min(distance(lo), distance(hi), distance((left + right) / 2)) >
      r * r + 1e-10
    )
      return false;
    this.completed = true;
    return true;
  }
}
export class DribbleFinishGoalView {
  readonly group = new T.Group();
  readonly material = new T.MeshStandardMaterial({
    color: 0xc4e5e7,
    metalness: 0.35,
    roughness: 0.4,
    emissive: 0x25444a,
    emissiveIntensity: 0.15,
  });
  readonly gridMaterial: T.MeshBasicMaterial;
  private progress = 0;
  private age = 0;
  private green = new T.Color(0x56ff91);
  constructor(readonly definition: DribbleFinishGoal) {
    const f = definition.finish;
    this.group.name = "dribble-finish-wall";
    this.group.position.copy(f.center);
    this.group.quaternion.copy(definition.rotation);
    for (const part of definition.parts) {
      const mesh = new T.Mesh(
        new T.CapsuleGeometry(definition.radius, part.halfHeight * 2, 8, 16),
        this.material,
      );
      mesh.name = `dribble-goal-${part.name}`;
      mesh.position.copy(part.center);
      mesh.quaternion.copy(part.rotation);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const size = 64,
      pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++)
        pixels.set(
          [216, 235, 240, x % 16 < 1 || y % 16 < 1 ? 115 : 18],
          (y * size + x) * 4,
        );
    const texture = new T.DataTexture(pixels, size, size);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.magFilter = T.LinearFilter;
    texture.minFilter = T.LinearMipmapLinearFilter;
    texture.generateMipmaps = true;
    texture.repeat.set(f.width / 2, f.height / 2);
    texture.needsUpdate = true;
    this.gridMaterial = new T.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const plane = new T.Mesh(
      new T.PlaneGeometry(f.width, f.height),
      this.gridMaterial,
    );
    plane.name = "dribble-goal-grid";
    plane.position.y = f.height / 2;
    this.group.add(plane);
  }
  reset() {
    this.progress = this.age = 0;
    this.paint();
  }
  update(success: boolean, dt: number) {
    if (success && this.progress === 0) this.progress = 1;
    this.progress +=
      (Number(success) - this.progress) * (1 - Math.exp(-16 * Math.max(0, dt)));
    this.age = success ? this.age + dt : 0;
    this.paint();
  }
  private paint() {
    this.material.color.setHex(0xc4e5e7).lerp(this.green, this.progress);
    this.material.emissive.setHex(0x25444a).lerp(this.green, this.progress);
    this.material.emissiveIntensity =
      0.15 + this.progress * (0.65 + 0.25 * Math.exp(-this.age * 4));
    this.gridMaterial.color.setHex(0xffffff).lerp(this.green, this.progress);
  }
}
