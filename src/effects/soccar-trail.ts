import * as T from "three";
import { P } from "../config/physics";

/** A small world-space ribbon: fixed 60 Hz history, bounded by age and arc length.
 * Ball rotation never moves the history off its actual flight path. */
export class SoccarTrail {
  static readonly capacity = 192;
  static readonly colors = [0x69cfff, 0xffa34a];
  readonly maxLength = 10 * P.ball.radius;
  readonly lifetime = 2.5;
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  readonly history = new Float32Array(SoccarTrail.capacity * 3);
  readonly timestamps = new Float64Array(SoccarTrail.capacity);
  count = 0;
  renderedLength = 0;
  private head = -1;
  private time = 0;
  private sampleTime = 0;
  private last = new T.Vector3();
  private a = new T.Vector3();
  private b = new T.Vector3();
  private tangent = new T.Vector3();
  private side = new T.Vector3();
  private view = new T.Vector3();
  private color = new T.Color(0xc4c4c4);
  private target = this.color.clone();
  private owner: number | null = null;
  private positions = new Float32Array(SoccarTrail.capacity * 18);
  private alpha = new Float32Array(SoccarTrail.capacity * 6);
  private across = new Float32Array(SoccarTrail.capacity * 6);
  constructor(scene: T.Scene) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "trailAlpha",
      new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage),
    );
    geometry.setAttribute(
      "across",
      new T.BufferAttribute(this.across, 1).setUsage(T.DynamicDrawUsage),
    );
    this.mesh = new T.Mesh(
      geometry,
      new T.ShaderMaterial({
        uniforms: { color: { value: this.color } },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        vertexShader: `attribute float trailAlpha;attribute float across;varying float opacity;varying float edge;void main(){opacity=trailAlpha;edge=across;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 color;varying float opacity;varying float edge;void main(){float soft=max(0.,1.-abs(edge));gl_FragColor=vec4(color,opacity*soft*soft);}`,
      }),
    );
    this.mesh.name = "soccar-history-trail";
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    geometry.setDrawRange(0, 0);
    scene.add(this.mesh);
  }
  reset() {
    this.count = 0;
    this.head = -1;
    this.sampleTime = this.time;
    this.renderedLength = 0;
    this.owner = null;
    this.color.setHex(0xc4c4c4);
    this.target.copy(this.color);
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }
  private store(x: number, y: number, z: number, time: number) {
    this.head = (this.head + 1) % SoccarTrail.capacity;
    this.history[this.head * 3] = x;
    this.history[this.head * 3 + 1] = y;
    this.history[this.head * 3 + 2] = z;
    this.timestamps[this.head] = time;
    this.count = Math.min(this.count + 1, SoccarTrail.capacity);
  }
  updatePath(
    point: T.Vector3,
    speed: number,
    team: number | null,
    dt: number,
    active: boolean,
    camera?: T.Vector3,
  ) {
    if (dt <= 0) return;
    if (!active) {
      this.reset();
      return;
    }
    if (this.count && point.distanceTo(this.last) > 3 + 100 * dt) this.reset();
    const step = Math.min(dt, 0.1),
      start = this.time;
    this.time += step;
    if (!this.count) {
      this.last.copy(point);
      this.sampleTime = start;
      this.store(point.x, point.y, point.z, start);
    }
    while (this.sampleTime + 1 / 60 <= this.time + 1e-9) {
      this.sampleTime += 1 / 60;
      const t = T.MathUtils.clamp((this.sampleTime - start) / step, 0, 1);
      this.store(
        this.last.x + (point.x - this.last.x) * t,
        this.last.y + (point.y - this.last.y) * t,
        this.last.z + (point.z - this.last.z) * t,
        this.sampleTime,
      );
    }
    this.last.copy(point);
    const owner = team === 0 || team === 1 ? team : null;
    this.target.setHex(owner === null ? 0xc4c4c4 : SoccarTrail.colors[owner]);
    if (this.count <= 2) this.color.copy(this.target);
    else this.color.lerp(this.target, 1 - Math.exp(-step / 0.1));
    this.owner = owner;
    const strength =
      T.MathUtils.smoothstep(speed, 1, 12) * (this.owner === null ? 0.12 : 0.5);
    let vertex = 0,
      length = 0,
      previousFade = 1;
    this.a.copy(point);
    for (let age = 0; age < this.count; age++) {
      const index =
        (this.head - age + SoccarTrail.capacity) % SoccarTrail.capacity;
      const elapsed = this.time - this.timestamps[index];
      if (elapsed >= this.lifetime) break;
      this.b.fromArray(this.history, index * 3);
      this.tangent.copy(this.b).sub(this.a);
      const distance = this.tangent.length(),
        remaining = this.maxLength - length;
      if (remaining <= 0) break;
      if (distance < 1e-5) continue;
      if (distance > remaining)
        this.b.copy(this.a).addScaledVector(this.tangent, remaining / distance);
      length += Math.min(distance, remaining);
      const fade = Math.max(
        0,
        Math.min(1 - length / this.maxLength, 1 - elapsed / this.lifetime),
      );
      if (camera) this.view.copy(camera).sub(this.a);
      else this.view.set(0, 1, 0);
      this.side.copy(this.tangent).cross(this.view);
      if (this.side.lengthSq() < 1e-8) this.side.set(1, 0, 0);
      this.side.normalize();
      for (let v = 0; v < 6; v++) {
        const old = v === 2 || v === 3 || v === 5,
          sign = v === 0 || v === 2 || v === 3 ? -1 : 1;
        const p = old ? this.b : this.a,
          f = old ? fade : previousFade;
        const shift = sign * P.ball.radius * 0.09 * Math.pow(f, 0.7),
          at = vertex * 3;
        this.positions[at] = p.x + this.side.x * shift;
        this.positions[at + 1] = p.y + this.side.y * shift;
        this.positions[at + 2] = p.z + this.side.z * shift;
        this.alpha[vertex] = strength * f * f;
        this.across[vertex++] = sign;
      }
      this.a.copy(this.b);
      previousFade = fade;
      if (distance >= remaining) break;
    }
    this.renderedLength = length;
    this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.trailAlpha.needsUpdate = true;
    this.mesh.geometry.attributes.across.needsUpdate = true;
    this.mesh.visible = vertex > 0 && strength > 0;
  }
}
