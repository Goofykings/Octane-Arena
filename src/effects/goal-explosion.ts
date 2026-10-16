import * as T from "three";
import { goalExplosionId } from "../../shared/catalog";
import { polishMaterial } from "../render/material-polish";
export const goalExplosionStyles = {
  pulse: {
    kind: "energy",
    duration: 2.8,
    count: 24,
    speed: 8,
    gravity: 0,
    color: 0x7cf9ff,
  },
  inferno: {
    kind: "fire",
    duration: 3.5,
    count: 48,
    speed: 8.5,
    gravity: 0.8,
    color: 0xff702c,
  },
  electric: {
    kind: "electric",
    duration: 2.7,
    count: 56,
    speed: 10,
    gravity: 0,
    color: 0x9be9ff,
  },
  confetti: {
    kind: "confetti",
    duration: 4,
    count: 72,
    speed: 7.5,
    gravity: 3.2,
    color: 0xffdc73,
  },
  crystal: {
    kind: "crystal",
    duration: 3.1,
    count: 40,
    speed: 9,
    gravity: 1,
    color: 0xa698ff,
  },
  bubbles: {
    kind: "bubble",
    duration: 3.8,
    count: 42,
    speed: 4.5,
    gravity: -0.7,
    color: 0x81e6db,
  },
  digital: {
    kind: "digital",
    duration: 3.2,
    count: 64,
    speed: 7,
    gravity: 0,
    color: 0x62efbd,
  },
  debris: {
    kind: "debris",
    duration: 3.8,
    count: 48,
    speed: 6.5,
    gravity: 5,
    color: 0xc39a72,
  },
  "blue-wash": {
    kind: "wash",
    duration: 4.2,
    count: 48,
    speed: 10,
    gravity: 0,
    color: 0x397aff,
  },
  "violet-wash": {
    kind: "wash",
    duration: 4.2,
    count: 48,
    speed: 10,
    gravity: 0,
    color: 0xaa58f2,
  },
} as const;
export const goalWashTuning = {
  peak: 0.96,
  fadeIn: 0.06,
  holdUntil: 1.1,
  fadeOutEnd: 3.3,
} as const;
type BlastMaterial = T.MeshBasicMaterial | T.MeshStandardMaterial;
/** Goal-only, pooled render effects. No gameplay forces or scoring logic here.
 * A scene-scoped screen tint supplies the brief full-arena wash without modifying
 * any saved material, fog, lights or map data, and works with direct/composer paths. */
export class GoalExplosion {
  private group = new T.Group();
  private age = 100;
  private styleId = "pulse";
  private style =
    goalExplosionStyles.pulse as (typeof goalExplosionStyles)[keyof typeof goalExplosionStyles];
  private flash: T.Mesh<T.SphereGeometry, T.MeshBasicMaterial>;
  private rings: T.Mesh<T.TorusGeometry, T.MeshBasicMaterial>[] = [];
  private light = new T.PointLight(0x7cf9ff, 0, 55, 1.5);
  private fragments!: T.InstancedMesh<T.BufferGeometry, BlastMaterial>;
  private smoke: T.InstancedMesh<T.SphereGeometry, T.MeshBasicMaterial>;
  private wash: T.Mesh<T.PlaneGeometry, T.ShaderMaterial>;
  private matrix = new T.Matrix4();
  private pos = new T.Vector3();
  private size = new T.Vector3();
  private rotation = new T.Quaternion();
  private euler = new T.Euler();
  private tint = new T.Color();
  private neutral = false;
  private axis = new T.Vector3(0, 0, 1);
  private direction = new T.Vector3();
  private inward = 1;
  constructor(
    private scene: T.Scene,
    scale = 1,
  ) {
    this.group.name = "goal-explosion";
    this.group.scale.setScalar(scale);
    this.flash = new T.Mesh(
      new T.SphereGeometry(1, 16, 12),
      this.mat(0x7cf9ff, 0.8),
    );
    this.flash.name = "goal-flash";
    polishMaterial(this.flash.material, "burst");
    this.group.add(this.flash);
    for (let i = 0; i < 3; i++) {
      const r = new T.Mesh(
        new T.TorusGeometry(1, 0.035, 6, 48),
        this.mat(0x7cf9ff, 0),
      );
      polishMaterial(r.material, "burst");
      this.group.add(r);
      this.rings.push(r);
    }
    this.smoke = new T.InstancedMesh(
      new T.SphereGeometry(1, 8, 6),
      new T.MeshBasicMaterial({
        color: 0x625952,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
      28,
    );
    this.smoke.name = "goal-smoke";
    this.smoke.frustumCulled = false;
    this.smoke.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.group.add(this.smoke);
    this.wash = new T.Mesh(
      new T.PlaneGeometry(2, 2),
      new T.ShaderMaterial({
        uniforms: { tint: { value: new T.Color() }, strength: { value: 0 } },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        vertexShader: `varying vec2 screenUv;void main(){screenUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
        fragmentShader: `uniform vec3 tint;uniform float strength;varying vec2 screenUv;void main(){float atmosphere=0.97+0.03*screenUv.y;gl_FragColor=vec4(tint,strength*atmosphere);
    #include <colorspace_fragment>
   }`,
      }),
    );
    this.wash.name = "goal-arena-wash";
    this.wash.frustumCulled = false;
    this.wash.renderOrder = 10000;
    scene.add(this.group, this.light, this.wash);
    this.setStyle("pulse");
    this.reset();
  }
  private mat(color: number, opacity: number) {
    return new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: T.AdditiveBlending,
      side: T.DoubleSide,
    });
  }
  setStyle(raw: string) {
    const id = goalExplosionId(raw);
    if (this.fragments && id === this.styleId) return;
    this.reset();
    this.styleId = id;
    this.style = goalExplosionStyles[id as keyof typeof goalExplosionStyles];
    if (this.fragments) {
      this.fragments.removeFromParent();
      this.fragments.geometry.dispose();
      this.fragments.material.dispose();
      this.fragments.dispose();
    }
    const kind = this.style.kind;
    let geo: T.BufferGeometry;
    if (kind === "confetti") geo = new T.BoxGeometry(0.36, 0.14, 0.025);
    else if (kind === "electric") geo = new T.BoxGeometry(0.06, 0.06, 1.7);
    else if (kind === "crystal") geo = new T.OctahedronGeometry(1);
    else if (kind === "bubble" || kind === "fire")
      geo = new T.SphereGeometry(1, 10, 8);
    else if (kind === "digital") geo = new T.BoxGeometry(0.4, 0.4, 0.18);
    else if (kind === "debris") geo = new T.DodecahedronGeometry(0.45, 0);
    else if (kind === "wash") geo = new T.TorusGeometry(0.45, 0.045, 4, 12);
    else geo = new T.TetrahedronGeometry(0.3);
    let mat: BlastMaterial = this.mat(this.style.color, 1);
    if (kind === "confetti" || kind === "debris")
      mat.blending = T.NormalBlending;
    if (kind === "bubble") {
      mat.dispose();
      mat = new T.MeshStandardMaterial({
        color: this.style.color,
        transparent: true,
        opacity: 0.65,
        roughness: 0.2,
        metalness: 0.1,
        depthWrite: false,
      });
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <opaque_fragment>",
          `diffuseColor.a*=0.12+0.88*pow(1.0-abs(dot(normalize(normal),normalize(vViewPosition))),2.0);\n#include <opaque_fragment>`,
        );
      };
      mat.customProgramCacheKey = () => "goal-bubble-rim-v1";
    }
    this.fragments = new T.InstancedMesh(geo, mat, 96);
    this.fragments.count = this.style.count;
    this.fragments.name = "goal-fragments-" + kind;
    this.fragments.frustumCulled = false;
    this.fragments.instanceMatrix.setUsage(T.DynamicDrawUsage);
    for (let i = 0; i < 96; i++)
      this.fragments.setColorAt(i, this.tint.setRGB(1, 1, 1));
    this.fragments.instanceColor!.setUsage(T.DynamicDrawUsage);
    this.group.add(this.fragments);
  }
  trigger(
    position: { x: number; y: number; z: number },
    color: number,
    id = "pulse",
    neutral = false,
  ) {
    this.setStyle(id);
    this.neutral = neutral;
    this.age = 0;
    this.inward = position.z < 0 ? 1 : -1;
    this.group.position.copy(position);
    this.light.position.copy(position);
    this.group.visible = true;
    const selected =
      this.style.kind === "energy" || neutral ? color : this.style.color;
    this.flash.material.color.setHex(selected);
    this.light.color.setHex(selected);
    this.rings.forEach((r) => r.material.color.setHex(selected));
    this.fragments.material.color.setHex(selected);
    this.wash.material.uniforms.tint.value.setHex(selected);
    for (let i = 0; i < this.fragments.count; i++) {
      this.tint.setRGB(1, 1, 1);
      if (!neutral && this.style.kind === "confetti")
        this.tint.setHSL((i * 0.618) % 1, 0.85, 0.65);
      else if (!neutral && this.style.kind === "fire")
        this.tint.setHex(i % 3 === 0 ? 0xffd986 : 0xff6222);
      // Per-instance colors are multipliers; confetti/fire use a neutral base.
      this.fragments.setColorAt(i, this.tint);
    }
    if (
      !neutral &&
      (this.style.kind === "confetti" || this.style.kind === "fire")
    )
      this.fragments.material.color.setHex(0xffffff);
    this.fragments.instanceColor!.needsUpdate = true;
    this.update(0);
  }
  get active() {
    return this.age < this.style.duration;
  }
  get selectedId() {
    return this.styleId;
  }
  get washStrength() {
    return this.wash.material.uniforms.strength.value as number;
  }
  reset() {
    this.age = 100;
    this.group.visible = false;
    this.light.intensity = 0;
    this.wash.visible = false;
    this.wash.material.uniforms.strength.value = 0;
  }
  update(dt: number) {
    this.age += Math.max(0, dt);
    const t = this.age,
      s = this.style,
      kind = s.kind;
    this.group.visible = this.active;
    if (!this.active) {
      this.light.intensity = 0;
      this.wash.visible = false;
      this.wash.material.uniforms.strength.value = 0;
      return;
    }
    const fade = Math.max(0, 1 - t / s.duration);
    this.flash.visible =
      kind === "energy" || kind === "fire" || kind === "wash";
    this.flash.scale.setScalar(0.4 + t * (kind === "fire" ? 5 : 12));
    this.flash.material.opacity = Math.max(
      0,
      (kind === "fire" ? 0.38 : 0.65) - t * (kind === "fire" ? 0.8 : 0.9),
    );
    this.light.intensity = Math.max(
      0,
      (kind === "fire" ? 48 : kind === "confetti" ? 15 : 60) * (1 - t / 1.3),
    );
    this.rings.forEach((r, i) => {
      r.visible = kind === "energy" || kind === "electric" || kind === "wash";
      r.scale.setScalar(
        1 + Math.max(0, t - i * 0.1) * (kind === "wash" ? 18 : 11 + i * 2),
      );
      r.material.opacity =
        fade *
        (kind === "electric" ? (Math.sin(t * 37 + i) > 0 ? 0.8 : 0.1) : 0.8);
      r.rotation.set(i * 0.7, i * 0.4, t * (i + 1) * 0.2);
    });
    this.fragments.material.opacity = fade * (kind === "bubble" ? 0.65 : 0.95);
    const ground = (0.12 - this.group.position.y) / this.group.scale.y;
    for (let i = 0; i < this.fragments.count; i++) {
      const seed = ((i * 73 + 19) % 101) / 101,
        a = i * 2.39996,
        v = s.speed * (0.4 + seed * 0.6);
      let travel = t;
      if (kind === "digital") travel = Math.floor(t * 12) / 12;
      let x = Math.cos(a) * v * travel * 0.9,
        y =
          (0.35 + Math.abs(Math.sin(a)) * 0.65) * v * t -
          s.gravity * t * t * 0.5,
        z = this.inward * (0.3 + seed * 0.7) * v * travel * 0.7;
      let sx = 0.6 + seed * 0.65,
        sy = sx,
        sz = sx;
      if (kind === "bubble") {
        sx = sy = sz = (0.18 + seed * 0.28) * (1 + t * 0.18);
        y += Math.sin(t * 2 + i) * 0.25;
      } else if (kind === "fire") {
        sx = sy = sz = (0.4 + seed * 0.55) * (1 + t * 0.35);
        y += t * 0.6;
      } else if (kind === "crystal") {
        sx = sz = 0.2 + seed * 0.18;
        sy = 0.5 + seed * 0.55;
      } else if (kind === "electric") {
        sx = sy = 0.6 + seed * 0.4;
        sz = 0.7 + seed * 0.8;
        x += Math.sin(Math.floor(t * 20) + i) * 0.18;
      } else if (kind === "confetti") {
        x += Math.sin(t * 4 + i) * t * 0.25;
        y += Math.sin(t * 5 + i) * 0.12;
      } else if (kind === "digital") {
        x = Math.round(x * 2) / 2;
        y = Math.round(y * 2) / 2;
      } else if (kind === "debris") {
        sx = sy = sz = 0.4 + seed * 0.8;
      }
      if (y < ground) y = ground + Math.abs(y - ground) * 0.1;
      this.pos.set(x, y, z);
      this.size.set(sx, sy, sz);
      this.euler.set(
        a + t * (1 + seed),
        i * 0.9 + t * (kind === "confetti" ? 3 : 1),
        t * 2 + a,
      );
      this.rotation.setFromEuler(this.euler);
      if (kind === "electric")
        this.rotation.setFromUnitVectors(
          this.axis,
          this.direction.copy(this.pos).normalize(),
        );
      this.matrix.compose(this.pos, this.rotation, this.size);
      this.fragments.setMatrixAt(i, this.matrix);
    }
    this.fragments.instanceMatrix.needsUpdate = true;
    const smoky = kind === "fire" || kind === "debris";
    this.smoke.visible = smoky;
    this.smoke.material.opacity = smoky
      ? Math.sin(Math.min(1, t / s.duration) * Math.PI) * 0.24
      : 0;
    for (let i = 0; smoky && i < 28; i++) {
      const a = i * 2.4,
        seed = ((i * 41) % 97) / 97;
      this.pos.set(
        Math.cos(a) * t * (2 + seed * 2),
        Math.max(ground, Math.sin(a) * t * 1.5 + t * 2),
        this.inward * t * (1 + seed * 3),
      );
      this.size.setScalar(0.4 + t * (0.6 + seed * 0.5));
      this.matrix.compose(this.pos, this.rotation, this.size);
      this.smoke.setMatrixAt(i, this.matrix);
    }
    if (smoky) this.smoke.instanceMatrix.needsUpdate = true;
    const strength =
      kind === "wash"
        ? goalWashTuning.peak *
          T.MathUtils.smoothstep(t, 0, goalWashTuning.fadeIn) *
          (1 -
            T.MathUtils.smoothstep(
              t,
              goalWashTuning.holdUntil,
              goalWashTuning.fadeOutEnd,
            ))
        : 0;
    this.wash.material.uniforms.strength.value = strength;
    this.wash.visible = strength > 0;
  }
  dispose() {
    this.reset();
    this.group.removeFromParent();
    this.light.removeFromParent();
    this.wash.removeFromParent();
    this.group.traverse((o) => {
      if (o instanceof T.Mesh) {
        if (o instanceof T.InstancedMesh) o.dispose();
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.dispose();
      }
    });
    this.wash.geometry.dispose();
    this.wash.material.dispose();
  }
}
