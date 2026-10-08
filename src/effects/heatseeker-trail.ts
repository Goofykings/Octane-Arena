import * as T from "three";
import type { HeatseekerState } from "../../shared/soccer";
import type { Quality } from "../../shared/settings";
import { heatColor, heatIntensity, HEAT_VISUAL } from "./heatseeker-ball";

/** World-space centroid history, independent of ball spin and gameplay state.
 * One bounded ring buffer and one reusable mesh; no network geometry or particles. */
export class HeatseekerTrail {
  static readonly capacity = 192;
  readonly mesh: T.Mesh<T.BufferGeometry, T.ShaderMaterial>;
  readonly history = new Float32Array(HeatseekerTrail.capacity * 3);
  readonly timestamps = new Float64Array(HeatseekerTrail.capacity);
  count = 0;
  private head = -1;
  private time = 0;
  private sampleTime = 0;
  private last = new T.Vector3();
  private a = new T.Vector3();
  private b = new T.Vector3();
  private tangent = new T.Vector3();
  private side = new T.Vector3();
  private view = new T.Vector3();
  private color = new T.Color(HEAT_VISUAL.neutral);
  private from = this.color.clone();
  private target = this.color.clone();
  private colorHex = -1;
  private colorTime = 0;
  private heat = 0;
  private owned = false;
  private power = 0;
  private positions = new Float32Array(192 * 6 * 3 * 3);
  private alpha = new Float32Array(192 * 6 * 3);
  private across = new Float32Array(192 * 6 * 3);
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
    geometry.setAttribute("across", new T.BufferAttribute(this.across, 1));
    this.mesh = new T.Mesh(
      geometry,
      new T.ShaderMaterial({
        uniforms: { color: { value: this.color }, energy: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        vertexShader: `attribute float trailAlpha; attribute float across; varying float opacity; varying float edge; void main(){opacity=trailAlpha;edge=across;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader: `uniform vec3 color;uniform float energy;varying float opacity;varying float edge;void main(){float glow=pow(max(0.,1.-abs(edge)),.85);float core=pow(max(0.,1.-abs(edge)),8.);gl_FragColor=vec4(mix(color,vec3(1.),core*(.15+.15*energy)),opacity*glow);}`,
      }),
    );
    this.mesh.name = "heatseeker-history-trail";
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }
  reset() {
    this.count = 0;
    this.head = -1;
    this.sampleTime = this.time;
    this.heat = 0;
    this.power = 0;
    this.owned = false;
    this.colorHex = -1;
    this.mesh.visible = false;
    this.mesh.geometry.setDrawRange(0, 0);
  }
  private store(x: number, y: number, z: number, time: number) {
    this.head = (this.head + 1) % HeatseekerTrail.capacity;
    this.history[this.head * 3] = x;
    this.history[this.head * 3 + 1] = y;
    this.history[this.head * 3 + 2] = z;
    this.timestamps[this.head] = time;
    this.count = Math.min(this.count + 1, HeatseekerTrail.capacity);
  }
  update(
    point: T.Vector3,
    dt: number,
    enabled: boolean,
    state: HeatseekerState,
    camera?: T.Vector3,
    quality: Quality = "high",
  ) {
    if (dt <= 0) return;
    if (!enabled) {
      this.reset();
      return;
    }
    const owned = state.active && state.ownerTeam !== null;
    const discontinuity =
      this.count > 0 && point.distanceTo(this.last) > 3 + 90 * dt;
    if (discontinuity || (this.owned && !owned)) this.reset();
    this.owned = owned;
    const start = this.time;
    this.time += Math.min(dt, 0.1);
    if (!this.count) {
      this.last.copy(point);
      this.sampleTime = start;
      this.store(point.x, point.y, point.z, start);
    }
    // Interpolated 60 Hz samples keep trail length independent of render FPS.
    while (this.sampleTime + 1 / 60 <= this.time + 1e-9) {
      this.sampleTime += 1 / 60;
      const t = T.MathUtils.clamp(
        (this.sampleTime - start) / Math.min(dt, 0.1),
        0,
        1,
      );
      this.store(
        this.last.x + (point.x - this.last.x) * t,
        this.last.y + (point.y - this.last.y) * t,
        this.last.z + (point.z - this.last.z) * t,
        this.sampleTime,
      );
    }
    this.last.copy(point);
    const hex = heatColor(state);
    if (this.colorHex < 0 || !owned) {
      this.color.setHex(hex);
      this.from.copy(this.color);
      this.target.copy(this.color);
      this.colorHex = hex;
      this.colorTime = HEAT_VISUAL.transition;
    } else if (hex !== this.colorHex) {
      this.from.copy(this.color);
      this.target.setHex(hex);
      this.colorHex = hex;
      this.colorTime = 0;
    }
    this.colorTime = Math.min(HEAT_VISUAL.transition, this.colorTime + dt);
    this.color.lerpColors(
      this.from,
      this.target,
      T.MathUtils.smoothstep(this.colorTime, 0, HEAT_VISUAL.transition),
    );
    this.heat +=
      (heatIntensity(state) - this.heat) * (1 - Math.exp(-dt / 0.18));
    this.power += ((owned ? 1 : 0) - this.power) * (1 - Math.exp(-dt / 0.08));
    this.mesh.material.uniforms.energy.value = this.heat;
    const maxLength = 32 + 64 * this.heat,
      lifetime = 1.25 + 1.35 * this.heat;
    const points =
      quality === "low"
        ? 48
        : quality === "medium"
          ? 96
          : quality === "high"
            ? 160
            : 192;
    const stride = Math.max(
      1,
      Math.ceil(Math.min(this.count, lifetime * 60) / points),
    );
    const ribbons = quality === "high" || quality === "ultra" ? 3 : 1;
    const width = 0.09 + 0.11 * this.power + 0.3 * this.heat,
      strength = 0.2 + 0.35 * this.power + 0.3 * this.heat;
    let vertex = 0,
      length = 0,
      previousFade = 1;
    this.a.copy(point);
    for (let age = 0; age < this.count; age += stride) {
      const index =
        (this.head - age + HeatseekerTrail.capacity) % HeatseekerTrail.capacity;
      const elapsed = this.time - this.timestamps[index];
      if (elapsed > lifetime) break;
      this.b.fromArray(this.history, index * 3);
      this.tangent.copy(this.b).sub(this.a);
      const distance = this.tangent.length();
      if (distance < 0.0001) continue;
      const remaining = maxLength - length;
      if (remaining <= 0) break;
      if (distance > remaining) {
        this.b.copy(this.a).addScaledVector(this.tangent, remaining / distance);
      }
      length += Math.min(distance, remaining);
      const fade = Math.max(
        0,
        Math.min(1 - length / maxLength, 1 - elapsed / lifetime),
      );
      this.view.copy(camera ?? this.a).sub(this.a);
      if (!camera) this.view.set(0, 1, 0);
      this.side.copy(this.tangent).cross(this.view);
      if (this.side.lengthSq() < 1e-8) this.side.set(1, 0, 0);
      this.side.normalize();
      for (let ribbon = 0; ribbon < ribbons; ribbon++) {
        const thin = ribbon > 0,
          offset = thin
            ? (ribbon === 1 ? -1 : 1) *
              width *
              (1.6 + 0.2 * Math.sin(length * 0.6 - this.time * 2))
            : 0;
        const radius = thin ? 0.035 + 0.025 * this.heat : width;
        for (let v = 0; v < 6; v++) {
          const old = v === 2 || v === 3 || v === 5,
            sign = v === 0 || v === 2 || v === 3 ? -1 : 1;
          const p = old ? this.b : this.a,
            f = old ? fade : previousFade;
          const shift = (offset + sign * radius) * Math.pow(f, 0.7);
          const at = vertex * 3;
          this.positions[at] = p.x + this.side.x * shift;
          this.positions[at + 1] = p.y + this.side.y * shift;
          this.positions[at + 2] = p.z + this.side.z * shift;
          this.alpha[vertex] = strength * f * f * (thin ? 0.35 : 1);
          this.across[vertex] = sign;
          vertex++;
        }
      }
      this.a.copy(this.b);
      previousFade = fade;
      if (distance > remaining) break;
    }
    this.mesh.geometry.setDrawRange(0, vertex);
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.trailAlpha.needsUpdate = true;
    this.mesh.geometry.attributes.across.needsUpdate = true;
    this.mesh.visible = vertex > 0;
  }
}
