import * as T from "three";
import { P } from "../config/physics";
import { wheelMount } from "../car/wheels";
import type { Car } from "../car/car";

/** Short world-space histories; one fixed buffer per effect, never new meshes per tick. */
export class MotionTrails {
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  readonly tracks: { point: T.Vector3; time: number }[][];
  private time = 0;
  private positions: Float32Array;
  private alphas: Float32Array;
  constructor(
    scene: T.Scene,
    count: number,
    readonly lifetime: number,
  ) {
    this.tracks = Array.from({ length: count }, () => []);
    this.positions = new Float32Array(count * 48 * 18);
    this.alphas = new Float32Array(count * 48 * 6);
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.BufferAttribute(this.positions, 3));
    geometry.setAttribute("trailAlpha", new T.BufferAttribute(this.alphas, 1));
    this.mesh = new T.Mesh(
      geometry,
      new T.ShaderMaterial({
        uniforms: { color: { value: new T.Color(0xffffff) } },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        vertexShader: `attribute float trailAlpha; varying float opacity; void main(){opacity=trailAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 color; varying float opacity; void main(){gl_FragColor=vec4(color,opacity);}`,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  reset() {
    this.tracks.forEach((t) => (t.length = 0));
    this.mesh.visible = false;
  }
  update(
    points: T.Vector3[],
    dt: number,
    enabled: boolean,
    color: number,
    strength: number,
    width: number,
    camera?: T.Vector3,
  ) {
    if (dt <= 0) return;
    this.time += dt;
    this.mesh.material.uniforms.color.value.setHex(color);
    let vertex = 0;
    this.tracks.forEach((track, index) => {
      const point = points[index];
      if (enabled && point) {
        if (track.length && point.distanceTo(track[0].point) > 12)
          track.length = 0;
        track.unshift({ point: point.clone(), time: this.time });
      }
      while (
        track.length &&
        (this.time - track[track.length - 1].time > this.lifetime ||
          track.length > 48)
      )
        track.pop();
      for (let i = 0; i < track.length - 1; i++) {
        const a = track[i],
          b = track[i + 1],
          tangent = b.point.clone().sub(a.point);
        if (tangent.lengthSq() < 1e-8) continue;
        const side = tangent.cross(
          camera ? camera.clone().sub(a.point) : new T.Vector3(0, 1, 0),
        );
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        side.normalize().multiplyScalar(width);
        for (const [sample, sign] of [
          [a, -1],
          [a, 1],
          [b, -1],
          [b, -1],
          [a, 1],
          [b, 1],
        ] as const) {
          const fade = Math.max(
            0,
            1 - (this.time - sample.time) / this.lifetime,
          );
          const p = sample.point.clone().addScaledVector(side, sign * fade);
          this.positions.set(p.toArray(), vertex * 3);
          this.alphas[vertex++] = strength * fade * fade;
        }
      }
    });
    this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.trailAlpha.needsUpdate = true;
    this.mesh.visible = vertex > 0;
  }
}
export class BallTrails extends MotionTrails {
  constructor(scene: T.Scene) {
    super(scene, 4, 0.22);
  }
  updateBall(
    ball: T.Object3D,
    speed: number,
    team: number | null,
    dt: number,
    active: boolean,
    camera?: T.Vector3,
    heat = 0,
  ) {
    const strength = T.MathUtils.smoothstep(speed, 3, 24) * (0.65 + heat * 0.2);
    const points = Array.from({ length: 4 }, (_, i) => {
      const angle = (i * Math.PI) / 2;
      return new T.Vector3(
        Math.cos(angle) * 0.84,
        (i % 2 ? 1 : -1) * 0.3,
        Math.sin(angle) * 0.84,
      )
        .multiplyScalar(P.ball.radius)
        .applyQuaternion(ball.quaternion)
        .add(ball.position);
    });
    this.update(
      points,
      dt,
      active && speed > 3,
      team === 0 ? 0x69cfff : team === 1 ? 0xffa34a : 0xc4c4c4,
      strength,
      0.035 + strength * 0.04,
      camera,
    );
  }
}
export class FlipTrails extends MotionTrails {
  constructor(scene: T.Scene) {
    super(scene, 4, 0.1);
  }
  updateCar(
    car: Car,
    pose: T.Object3D,
    dt: number,
    active: boolean,
    camera?: T.Vector3,
  ) {
    const mounts = pose.userData.wheelMounts as T.Object3D[] | undefined;
    const points = Array.from({ length: 4 }, (_, i) =>
      (mounts?.[i]?.position.clone() ?? wheelMount(car.bodyId, i).setY(-0.12))
        .applyQuaternion(pose.quaternion)
        .add(pose.position),
    );
    this.update(
      points,
      dt,
      active && car.jump.flipLeft > 0,
      0xffffff,
      0.65,
      0.035,
      camera,
    );
  }
}
