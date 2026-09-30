import * as T from "three";
import type { Car } from "../car/car";
import { P } from "../config/physics";

/** Fixed segment pool; each segment keeps its original wheel path and fades independently. */
export class SkidMarks {
  readonly capacity = 180;
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  private positions = new Float32Array(this.capacity * 18);
  private births = new Float32Array(this.capacity * 6).fill(-100);
  private strengths = new Float32Array(this.capacity * 6);
  private previous: (T.Vector3 | null)[] = [null, null];
  private cursor = 0;
  private time = 0;
  constructor(scene: T.Scene) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "born",
      new T.BufferAttribute(this.births, 1).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "strength",
      new T.BufferAttribute(this.strengths, 1).setUsage(T.DynamicDrawUsage),
    );
    this.mesh = new T.Mesh(
      geometry,
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        uniforms: { time: { value: 0 }, lifetime: { value: P.skid.lifetime } },
        vertexShader: `attribute float born; attribute float strength; varying float age; varying float intensity; uniform float time;
        void main(){ age=time-born; intensity=strength; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `varying float age; varying float intensity; uniform float lifetime;
        void main(){float fade=1.0-clamp(age/lifetime,0.0,1.0); if(fade<=0.0)discard; gl_FragColor=vec4(.035,.045,.055,fade*fade*intensity*.48);}`,
      }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  reset() {
    this.births.fill(-100);
    this.mesh.geometry.attributes.born.needsUpdate = true;
    this.previous = [null, null];
  }
  update(car: Car, dt: number, active: boolean) {
    this.time += dt;
    this.mesh.material.uniforms.time.value = this.time;
    for (let wheel = 0; wheel < 2; wheel++) {
      if (!active || car.skidIntensity <= 0 || !car.wheelContact[wheel + 2]) {
        this.previous[wheel] = null;
        continue;
      }
      const point = car.wheelHits[wheel + 2]
        .clone()
        .addScaledVector(car.normal, 0.018);
      const previous = this.previous[wheel];
      if (previous && point.distanceTo(previous) < 0.025) continue;
      if (previous && point.distanceTo(previous) < 2) {
        const width = car.right
          .clone()
          .addScaledVector(car.normal, -car.right.dot(car.normal))
          .normalize()
          .multiplyScalar(0.045 + car.skidIntensity * 0.025);
        let offset = this.cursor * 18;
        for (const [p, side] of [
          [previous, -1],
          [previous, 1],
          [point, -1],
          [point, -1],
          [previous, 1],
          [point, 1],
        ] as const) {
          this.positions[offset++] = p.x + width.x * side;
          this.positions[offset++] = p.y + width.y * side;
          this.positions[offset++] = p.z + width.z * side;
        }
        this.births.fill(this.time, this.cursor * 6, this.cursor * 6 + 6);
        this.strengths.fill(
          car.skidIntensity,
          this.cursor * 6,
          this.cursor * 6 + 6,
        );
        this.cursor = (this.cursor + 1) % this.capacity;
        for (const attribute of Object.values(this.mesh.geometry.attributes))
          attribute.needsUpdate = true;
      }
      this.previous[wheel] = point;
    }
  }
}
