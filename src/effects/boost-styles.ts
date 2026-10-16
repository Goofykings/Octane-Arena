import * as T from "three";
import { polishMaterial } from "../render/material-polish";
export const boostStyles = {
  standard: {
    color: 0x84d8ff,
    core: 0xedfaff,
    length: 1.3,
    detail: "stream",
    stream: true,
    glow: 1.6,
  },
  thermal: {
    color: 0xff5861,
    core: 0xffcf84,
    length: 1.7,
    detail: "thermal",
    stream: true,
    glow: 2.2,
  },
  ember: {
    color: 0xff8738,
    core: 0xffe8a6,
    length: 1.55,
    detail: "flame",
    stream: false,
    glow: 2.3,
  },
  ion: {
    color: 0x6b9cff,
    core: 0xd5eaff,
    length: 1.7,
    detail: "vapor",
    stream: false,
    glow: 0.55,
  },
  lightning: {
    color: 0x89dfff,
    core: 0xf3fdff,
    length: 1.85,
    detail: "electric",
    stream: false,
    glow: 1.9,
  },
  plasma: {
    color: 0xc378ff,
    core: 0xf3dfff,
    length: 1.6,
    detail: "plasma",
    stream: false,
    glow: 1.7,
  },
  sparkles: {
    color: 0xffcd65,
    core: 0xfff2c5,
    length: 1.8,
    detail: "sparkles",
    stream: false,
    glow: 0.8,
  },
  sacred: {
    color: 0x85efbf,
    core: 0xe5fff3,
    length: 1.9,
    detail: "sacred",
    stream: false,
    glow: 1.1,
  },
  datastream: {
    color: 0x57f2cc,
    core: 0xc7fff5,
    length: 1.7,
    detail: "digital",
    stream: false,
    glow: 0.9,
  },
  dust: {
    color: 0xc69a66,
    core: 0xe0c293,
    length: 1.45,
    detail: "dust",
    stream: false,
    glow: 0.15,
  },
} as const;
export type BoostId = keyof typeof boostStyles;
export const boostStyle = (id: string) =>
  boostStyles[id as BoostId] ?? boostStyles.standard;
type LayerKind =
  | "vapor"
  | "fire"
  | "tongue"
  | "smoke"
  | "arc"
  | "spark"
  | "blob"
  | "glitter"
  | "mote"
  | "halo"
  | "bit"
  | "grain"
  | "sand"
  | "ring";
interface Layer {
  kind: LayerKind;
  mesh: T.InstancedMesh;
  colored: boolean;
  born: Float64Array;
  origins: Float32Array;
  velocities: Float32Array;
  cursor: number;
  nextEmission: number;
}
export const particleBoostTuning = {
  lifetime: 0.5,
  rangeMultiplier: 1.65,
} as const;
/** Fixed-budget emission pools rebuilt only on equip. Analytic soft sprites;
 * birth transforms retain a continuous moving/rotating emitter path. */
export class BoostPlume extends T.Group {
  private style = boostStyles.standard as (typeof boostStyles)[BoostId];
  private particleLayers: Layer[] = [];
  private streams: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[] = [];
  private instanceTransform = new T.Matrix4();
  private positionScratch = new T.Vector3();
  private scaleScratch = new T.Vector3();
  private rotationScratch = new T.Quaternion();
  private eulerScratch = new T.Euler();
  private tint = new T.Color();
  private particleTint = new T.Color();
  private lastTime: number | null = null;
  private emitting = false;
  private live = false;
  private previousWorld = new T.Matrix4();
  private inverseWorld = new T.Matrix4();
  private birthWorld = new T.Matrix4();
  private oldPosition = new T.Vector3();
  private newPosition = new T.Vector3();
  private oldRotation = new T.Quaternion();
  private newRotation = new T.Quaternion();
  private oldScale = new T.Vector3();
  private newScale = new T.Vector3();
  private birthPosition = new T.Vector3();
  private birthRotation = new T.Quaternion();
  private birthScale = new T.Vector3();
  private inheritedVelocity = new T.Vector3();
  get streamStyle() {
    return this.style.stream;
  }
  get activeParticles() {
    return this.live;
  }
  resetParticles() {
    this.lastTime = null;
    this.emitting = this.live = false;
    this.visible = false;
    for (const layer of this.particleLayers) {
      layer.born.fill(-Infinity);
      layer.cursor = 0;
      layer.nextEmission = 0;
      for (let i = 0; i < layer.mesh.count; i++) {
        this.instanceTransform.makeScale(0, 0, 0);
        layer.mesh.setMatrixAt(i, this.instanceTransform);
      }
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  constructor(id = "standard", color?: number) {
    super();
    this.name = "boost-plume";
    this.setStyle(id);
    if (color !== undefined) this.setColor(color);
  }
  private mat(color: number, opacity: number) {
    return new T.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
  }
  private softMaterial(
    color: number,
    opacity: number,
    shape: "puff" | "orb" | "star",
    additive = true,
  ) {
    return new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
      uniforms: {
        tint: { value: new T.Color(color) },
        core: { value: new T.Color(this.style.core) },
        opacity: { value: opacity },
        shape: { value: shape === "star" ? 2 : shape === "orb" ? 1 : 0 },
      },
      vertexShader: `varying vec2 particleUv;
    varying vec3 particleColor;
    void main(){
     particleUv=uv;particleColor=vec3(1.0);
     #ifdef USE_INSTANCING_COLOR
      particleColor=instanceColor;
     #endif
     // Project instance centers, expanding quads in camera space for soft puffs.
     vec4 center=modelViewMatrix*instanceMatrix*vec4(0.0,0.0,0.0,1.0);
     vec2 size=vec2(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz));
     size*=length(modelMatrix[0].xyz);
     center.xy+=position.xy*size;
     gl_Position=projectionMatrix*center;
    }`,
      fragmentShader: `uniform vec3 tint,core;uniform float opacity,shape;
    varying vec2 particleUv;varying vec3 particleColor;
    void main(){
     vec2 p=particleUv*2.0-1.0;float r=length(p);
     float a=exp(-r*r*3.8)*(1.0-smoothstep(0.35,1.0,r));
     if(shape>0.5&&shape<1.5)a=(1.0-smoothstep(0.15,1.0,r))*0.7+exp(-r*r*16.0)*0.3;
     if(shape>1.5){vec2 q=abs(p);a=max(exp(-r*r*35.0),max(pow(max(0.0,1.0-q.x),24.0)*pow(max(0.0,1.0-q.y),2.0),pow(max(0.0,1.0-q.y),24.0)*pow(max(0.0,1.0-q.x),2.0)));}
     if(a<0.006)discard;
     vec3 color=mix(tint,core,shape>0.5?pow(max(0.0,1.0-r),4.0)*0.6:0.0);
     float brightness=max(particleColor.r,max(particleColor.g,particleColor.b));
     vec3 hue=particleColor/max(brightness,0.0001);
     gl_FragColor=vec4(color*hue,a*opacity*brightness);
     #include <tonemapping_fragment>
     #include <colorspace_fragment>
    }`,
    });
  }
  private addLayer(
    kind: LayerKind,
    count: number,
    geo: T.BufferGeometry,
    mat: T.Material,
    colored = true,
  ) {
    const mesh = new T.InstancedMesh(geo, mat, count);
    mesh.name = "boost-" + kind;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    // Allocate color buffers on equip, never in the animation loop.
    for (let i = 0; i < count; i++)
      mesh.setColorAt(i, this.particleTint.setRGB(1, 1, 1));
    mesh.instanceColor!.setUsage(T.DynamicDrawUsage);
    this.particleLayers.push({
      kind,
      mesh,
      colored,
      born: new Float64Array(count).fill(-Infinity),
      origins: new Float32Array(count * 16),
      velocities: new Float32Array(count * 3),
      cursor: 0,
      nextEmission: 0,
    });
    this.add(mesh);
  }
  setStyle(id: string) {
    this.dispose();
    this.clear();
    this.particleLayers = [];
    this.streams = [];
    this.style = boostStyle(id);
    const s = this.style;
    if (s.stream) {
      for (const x of [-0.21, 0.21]) {
        const width = s.detail === "thermal" ? 0.1 : 0.065;
        const outer = new T.Mesh(
          new T.ConeGeometry(width, s.length, 8),
          this.mat(s.color, 0.42),
        );
        outer.rotation.x = Math.PI / 2;
        outer.position.set(x, 0, s.length / 2);
        polishMaterial(outer.material, "boost");
        this.add(outer);
        this.streams.push(outer);
        const core = new T.Mesh(
          new T.ConeGeometry(width * 0.36, s.length * 0.72, 6),
          this.mat(s.core, 0.8),
        );
        core.rotation.x = Math.PI / 2;
        core.position.set(x, 0, s.length * 0.36);
        polishMaterial(core.material, "core");
        this.add(core);
      }
      this.addLayer(
        "ring",
        s.detail === "thermal" ? 12 : 6,
        new T.TorusGeometry(
          s.detail === "thermal" ? 0.07 : 0.035,
          0.007,
          4,
          12,
        ),
        this.mat(s.color, 0.6),
      );
    } else if (s.detail === "flame") {
      this.addLayer(
        "fire",
        24,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(s.color, 0.7, "orb"),
      );
      this.addLayer(
        "tongue",
        10,
        new T.SphereGeometry(1, 7, 5),
        this.mat(0xff7c25, 0.45),
        false,
      );
      this.addLayer(
        "spark",
        10,
        new T.TetrahedronGeometry(1),
        this.mat(s.core, 0.8),
        false,
      );
      this.addLayer(
        "smoke",
        12,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(0x6c6565, 0.22, "puff", false),
        false,
      );
    } else if (s.detail === "vapor") {
      this.addLayer(
        "vapor",
        32,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(s.color, 0.28, "puff", false),
      );
    } else if (s.detail === "electric") {
      const path = new T.CatmullRomCurve3([
        new T.Vector3(0, 0, 0),
        new T.Vector3(0.7, 0.25, 0.35),
        new T.Vector3(-0.5, -0.2, 0.7),
        new T.Vector3(0, 0, 1),
      ]);
      this.addLayer(
        "arc",
        16,
        new T.TubeGeometry(path, 6, 0.04, 3, false),
        this.mat(s.color, 0.9),
      );
      this.addLayer(
        "spark",
        20,
        new T.BoxGeometry(1, 1, 1),
        this.mat(s.core, 0.9),
        false,
      );
    } else if (s.detail === "plasma") {
      this.addLayer(
        "blob",
        20,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(s.color, 0.7, "orb"),
      );
    } else if (s.detail === "sparkles") {
      this.addLayer(
        "glitter",
        42,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(s.color, 0.95, "star"),
      );
    } else if (s.detail === "sacred") {
      this.addLayer(
        "mote",
        24,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(s.color, 0.44, "puff"),
      );
      this.addLayer(
        "halo",
        8,
        new T.TorusGeometry(1, 0.065, 4, 16),
        this.mat(s.core, 0.55),
        false,
      );
    } else if (s.detail === "digital") {
      this.addLayer(
        "bit",
        36,
        new T.BoxGeometry(1, 1, 1),
        this.mat(s.color, 0.8),
      );
    } else {
      this.addLayer(
        "sand",
        20,
        new T.PlaneGeometry(1, 1),
        this.softMaterial(s.color, 0.24, "puff", false),
      );
      this.addLayer(
        "grain",
        32,
        new T.TetrahedronGeometry(1),
        new T.MeshBasicMaterial({
          color: s.core,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        }),
        false,
      );
    }
    this.setColor(s.color);
    this.resetParticles();
  }
  setColor(color: number) {
    this.tint.setHex(color);
    for (const mesh of this.streams) mesh.material.color.copy(this.tint);
    for (const layer of this.particleLayers) {
      if (!layer.colored) continue;
      const mat = layer.mesh.material;
      if (mat instanceof T.ShaderMaterial)
        mat.uniforms.tint.value.copy(this.tint);
      else if (mat instanceof T.MeshBasicMaterial) mat.color.copy(this.tint);
    }
  }
  get color() {
    return this.tint.getHex();
  }
  get lightIntensity() {
    return this.style.glow;
  }
  animate(time: number, emitting = true) {
    const s = this.style;
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(
      this.newPosition,
      this.newRotation,
      this.newScale,
    );
    let dt = this.lastTime === null ? 0 : time - this.lastTime;
    if (
      dt < 0 ||
      (this.lastTime !== null &&
        this.newPosition.distanceToSquared(this.oldPosition) > 64)
    ) {
      this.resetParticles();
      dt = 0;
    }
    if (this.lastTime === null) this.previousWorld.copy(this.matrixWorld);
    this.previousWorld.decompose(
      this.oldPosition,
      this.oldRotation,
      this.oldScale,
    );
    this.inheritedVelocity.copy(this.newPosition).sub(this.oldPosition);
    if (dt > 0) this.inheritedVelocity.divideScalar(dt);
    else this.inheritedVelocity.set(0, 0, 0);
    this.inverseWorld.copy(this.matrixWorld).invert();
    const started = emitting && !this.emitting;
    this.live = false;
    this.scale.z = s.stream
      ? 1 + 0.06 * Math.sin(time * (s.detail === "thermal" ? 32 : 22))
      : 1;
    for (const layer of this.particleLayers) {
      const { kind, mesh } = layer;
      if (!s.stream && emitting) {
        const interval = particleBoostTuning.lifetime / mesh.count;
        if (started) layer.nextEmission = time;
        // Catch up only the surviving portion after a long render gap.
        layer.nextEmission = Math.max(
          layer.nextEmission,
          time - particleBoostTuning.lifetime,
        );
        while (layer.nextEmission <= time + 1e-9) {
          const i = layer.cursor;
          layer.born[i] = layer.nextEmission;
          const alpha =
            dt > 0
              ? T.MathUtils.clamp(1 - (time - layer.nextEmission) / dt, 0, 1)
              : 1;
          this.birthPosition.lerpVectors(
            this.oldPosition,
            this.newPosition,
            alpha,
          );
          this.birthRotation.slerpQuaternions(
            this.oldRotation,
            this.newRotation,
            alpha,
          );
          this.birthScale.lerpVectors(this.oldScale, this.newScale, alpha);
          this.birthWorld.compose(
            this.birthPosition,
            this.birthRotation,
            this.birthScale,
          );
          this.birthWorld.toArray(layer.origins, i * 16);
          this.inheritedVelocity.toArray(layer.velocities, i * 3);
          layer.cursor = (i + 1) % mesh.count;
          layer.nextEmission += interval;
        }
      }
      const rate =
        kind === "arc" || kind === "spark"
          ? 2.7
          : kind === "fire" || kind === "tongue"
            ? 2.1
            : kind === "bit"
              ? 1.8
              : kind === "vapor" || kind === "mote"
                ? 0.65
                : 1;
      for (let i = 0; i < mesh.count; i++) {
        const seed = ((i * 73 + 19) % 101) / 101,
          age = time - layer.born[i],
          p = s.stream
            ? (i / mesh.count + time * rate) % 1
            : Math.max(0, age / particleBoostTuning.lifetime),
          angle = i * 2.39996,
          side = i % 2 ? 0.21 : -0.21;
        if (
          !s.stream &&
          (!Number.isFinite(age) || age >= particleBoostTuning.lifetime)
        ) {
          this.instanceTransform.makeScale(0, 0, 0);
          mesh.setMatrixAt(i, this.instanceTransform);
          mesh.setColorAt(i, this.particleTint.setRGB(0, 0, 0));
          continue;
        }
        this.live = true;
        let x = side,
          y = 0,
          z = 0.02 + p * s.length,
          sx = 0.05,
          sy = 0.05,
          sz = 0.05;
        let brightness = s.stream
            ? Math.max(0.02, Math.sin(Math.PI * p))
            : Math.pow(1 - p, 0.65),
          rx = 0,
          ry = 0,
          rz = angle + time;
        switch (kind) {
          case "ring":
            sx = sy = sz = 1 - p * 0.6;
            break;
          case "fire": {
            const bend = Math.sin(time * 15 + i * 2) * 0.035;
            x += Math.cos(angle) * (0.035 + p * 0.09) + bend;
            y = Math.sin(angle) * (0.025 + p * 0.08) + p * 0.08;
            z = 0.04 + p * s.length * (0.65 + seed * 0.35);
            sx = (0.12 + seed * 0.1) * (1 - p * 0.6);
            sy = (0.22 + seed * 0.18) * (1 - p * 0.55);
            brightness *= 0.75 + 0.25 * Math.sin(time * 37 + i * 4);
            break;
          }
          case "tongue":
            x += Math.sin(time * 21 + i * 2) * (0.025 + p * 0.055);
            y = Math.cos(time * 17 + i) * 0.035 + p * 0.05;
            z = 0.06 + p * s.length * 0.72;
            sx = 0.018 + (1 - p) * 0.014;
            sy = 0.025 + seed * 0.025;
            sz = 0.035 + (1 - p) * 0.085;
            rx = Math.sin(time * 14 + i) * 0.3;
            ry = Math.cos(time * 18 + i) * 0.3;
            brightness *= 0.7 + 0.3 * Math.sin(time * 31 + i);
            break;
          case "smoke":
            x += Math.cos(angle) * (0.04 + p * 0.13);
            y = 0.03 + p * p * 0.25;
            z = 0.02 + p * s.length;
            sx = sy = 0.12 + p * 0.26;
            brightness *= 0.55;
            break;
          case "vapor":
            x += Math.cos(angle + time * 0.6) * (0.035 + p * 0.24);
            y = Math.sin(angle) * p * 0.1 + p * p * 0.25;
            sx = sy = 0.09 + p * 0.36;
            break;
          case "arc":
            x +=
              Math.cos(angle + Math.floor(time * 24) * 1.7) * (0.04 + p * 0.25);
            y = Math.sin(angle + Math.floor(time * 19)) * p * 0.23;
            sx = sy = 0.09 + seed * 0.05;
            sz = 0.18 + seed * 0.18;
            brightness *= Math.sin(time * 53 + i * 7) > -0.1 ? 1 : 0.04;
            rz = time * 9 + angle;
            break;
          case "spark":
            x += Math.cos(angle) * (0.02 + p * 0.22);
            y = Math.sin(angle) * p * 0.22;
            sx = sy = 0.012 + seed * 0.008;
            sz = 0.1 + seed * 0.18;
            rx = Math.cos(angle) * 0.6;
            ry = Math.sin(angle) * 0.6;
            break;
          case "blob":
            x += Math.cos(angle + time * 0.9) * (0.02 + p * 0.15);
            y = Math.sin(angle + time) * 0.09;
            z = 0.05 + p * s.length;
            sx = sy =
              (0.17 + seed * 0.18) * (0.6 + 0.4 * Math.sin(p * Math.PI));
            sx *= 1 + 0.15 * Math.sin(time * 7 + i);
            sy *= 1 + 0.16 * Math.cos(time * 6 + i);
            break;
          case "glitter":
            x += Math.cos(angle) * (0.035 + p * 0.34);
            y = Math.sin(angle) * (0.025 + p * 0.3);
            sx = sy = 0.075 + seed * 0.1;
            brightness *= Math.pow(Math.max(0, Math.sin(time * 14 + i * 3)), 4);
            break;
          case "mote":
            x += Math.cos(angle + p * 6 + time * 0.8) * (0.05 + p * 0.18);
            y =
              Math.sin(angle + p * 6 + time * 0.8) * (0.05 + p * 0.18) +
              p * 0.15;
            sx = sy = 0.14 + seed * 0.14;
            brightness *= 0.7 + 0.3 * Math.sin(time * 2 + i);
            break;
          case "halo":
            x += Math.cos(angle + p * 6) * p * 0.12;
            y = p * 0.16;
            sx = sy = sz = 0.045 + seed * 0.035;
            rx = time * 0.7 + angle;
            ry = p * 3;
            break;
          case "bit":
            x += ((i % 3) - 1) * 0.075;
            y = ((Math.floor(i / 3) % 3) - 1) * 0.065;
            z = 0.06 + (Math.floor(p * 12) / 12) * s.length;
            sx = sy = 0.025 + seed * 0.02;
            sz = i % 4 === 0 ? 0.16 : 0.045;
            rz = 0;
            brightness *= 0.65 + 0.35 * (Math.sin(time * 15 + i) > 0 ? 1 : 0);
            break;
          case "sand":
            x += Math.cos(angle) * (0.04 + p * 0.26);
            y = -0.04 - p * p * 0.2;
            sx = sy = 0.09 + p * 0.25;
            brightness *= 0.7;
            break;
          case "grain":
            x += Math.cos(angle) * (0.025 + p * 0.34);
            y = Math.sin(angle) * p * 0.1 - p * p * 0.25;
            sx = sy = sz = 0.012 + seed * 0.016;
            rx = time * 5 + angle;
            ry = angle;
            brightness = 0.2 + brightness * 0.8;
            break;
        }
        if (!s.stream) {
          // Keep all families at the nozzle at birth; their spread grows with age.
          x = side + (x - side) * Math.min(1, p * 8);
          y *= Math.min(1, p * 8);
          z = 0.02 + (z - 0.02) * particleBoostTuning.rangeMultiplier;
        }
        this.positionScratch.set(x, y, z);
        this.scaleScratch.set(sx, sy, sz);
        if (!s.stream)
          this.scaleScratch.multiplyScalar(
            1 - T.MathUtils.smoothstep(p, 0.75, 1),
          );
        this.eulerScratch.set(rx, ry, rz);
        this.rotationScratch.setFromEuler(this.eulerScratch);
        this.instanceTransform.compose(
          this.positionScratch,
          this.rotationScratch,
          this.scaleScratch,
        );
        if (!s.stream) {
          this.birthWorld.fromArray(layer.origins, i * 16);
          this.instanceTransform.premultiply(this.birthWorld);
          this.instanceTransform.elements[12] += layer.velocities[i * 3] * age;
          this.instanceTransform.elements[13] +=
            layer.velocities[i * 3 + 1] * age;
          this.instanceTransform.elements[14] +=
            layer.velocities[i * 3 + 2] * age;
          this.instanceTransform.premultiply(this.inverseWorld);
        }
        mesh.setMatrixAt(i, this.instanceTransform);
        const warm =
          kind === "fire" || kind === "tongue" ? 0.55 + seed * 0.45 : 1;
        mesh.setColorAt(
          i,
          this.particleTint.setRGB(
            brightness,
            brightness * warm,
            brightness * warm,
          ),
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }
    this.visible = s.stream ? emitting : this.live;
    this.emitting = emitting;
    this.lastTime = time;
    this.previousWorld.copy(this.matrixWorld);
  }
  dispose() {
    this.traverse((o) => {
      if (o instanceof T.Mesh) {
        if (o instanceof T.InstancedMesh) o.dispose();
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          m.dispose();
      }
    });
  }
}
