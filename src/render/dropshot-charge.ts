import * as T from "three";
/** One bounded world-space pool per visible ball; also works with replay time. */
export class DropshotChargeFX {
  readonly group = new T.Group();
  readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>;
  readonly wave: T.Mesh<T.TorusGeometry, T.MeshBasicMaterial>;
  private positions = new Float32Array(128 * 3);
  private velocities = new Float32Array(128 * 3);
  private ages = new Float32Array(128).fill(10);
  private sizes = new Float32Array(128);
  private last = -Infinity;
  private level = 0;
  private epoch = -1;
  private pulse = 10;
  private budget = 0;
  private slot = 0;
  private previous = new T.Vector3();
  private point = new T.Vector3();
  private emission = new T.Vector3();
  constructor() {
    this.group.name = "dropshot-charge-fx";
    this.group.matrixAutoUpdate = false;
    const g = new T.BufferGeometry();
    g.setAttribute(
      "position",
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute(
      "size",
      new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage),
    );
    this.points = new T.Points(
      g,
      new T.ShaderMaterial({
        uniforms: { tint: { value: new T.Color() } },
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        vertexShader:
          "attribute float size;void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=size>0.?projectionMatrix*p:vec4(2.,2.,2.,1.);gl_PointSize=min(36.,size*850./max(1.,-p.z));}",
        fragmentShader:
          "uniform vec3 tint;void main(){float r=length(gl_PointCoord-.5)*2.;float a=pow(max(0.,1.-r),2.);gl_FragColor=vec4(tint*1.8,a*.85);}",
      }),
    );
    this.points.frustumCulled = false;
    this.points.name = "dropshot-charge-particles";
    this.wave = new T.Mesh(
      new T.TorusGeometry(1, 0.025, 4, 64),
      new T.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: T.AdditiveBlending,
        toneMapped: false,
      }),
    );
    this.wave.name = "dropshot-super-wave";
    this.group.add(this.points, this.wave);
  }
  reset() {
    this.ages.fill(10);
    this.sizes.fill(0);
    this.last = -Infinity;
    this.level = 0;
    this.pulse = 10;
    this.budget = 0;
    this.group.visible = false;
  }
  update(
    ball: T.Group,
    level: number,
    epoch: number,
    color: number,
    time: number,
  ) {
    if (this.group.parent !== ball) ball.add(this.group);
    // Cancel ball spin/scale while keeping visibility and disposal with its owner.
    ball.updateMatrix();
    this.group.matrix.copy(ball.matrix).invert();
    this.point.copy(ball.position);
    const discontinuity =
      epoch !== this.epoch ||
      time < this.last ||
      time - this.last > 1 ||
      this.point.distanceToSquared(this.previous) > 400;
    if (discontinuity) this.reset();
    this.epoch = epoch;
    const dt = Number.isFinite(this.last)
      ? Math.min(0.05, Math.max(0, time - this.last))
      : 0;
    if (level === 2 && this.level < 2) {
      this.pulse = 0;
      for (let i = 0; i < 72; i++) this.emit(this.point, 10, 0.55);
      this.wave.position.copy(this.point);
      this.wave.rotation.set(Math.PI / 2, 0, 0);
    }
    if (!Number.isFinite(this.last)) this.previous.copy(this.point);
    this.budget += dt * (level === 2 ? 150 : level === 1 ? 26 : 0);
    const count = Math.floor(this.budget);
    this.budget -= count;
    for (let i = 0; i < count; i++)
      this.emit(
        this.emission
          .copy(this.previous)
          .lerp(this.point, (i + 0.5) / Math.max(1, count)),
        level === 2 ? 5 : 1.8,
        level === 2 ? 0.55 : 0.24,
      );
    for (let i = 0; i < 128; i++) {
      const age = (this.ages[i] += dt),
        life = 0.48;
      if (age >= life) {
        this.sizes[i] = 0;
        continue;
      }
      for (let j = 0; j < 3; j++)
        this.positions[i * 3 + j] += this.velocities[i * 3 + j] * dt;
      this.sizes[i] = (level === 2 ? 0.5 : 0.28) * Math.max(0, 1 - age / life);
    }
    this.pulse += dt;
    this.wave.visible = this.pulse < 0.6;
    this.wave.scale.setScalar(1 + this.pulse * 11);
    this.wave.material.opacity = Math.max(0, 1 - this.pulse / 0.6) * 0.95;
    this.wave.material.color.setHex(color);
    this.points.material.uniforms.tint.value.setHex(color);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.group.visible = true;
    this.level = level;
    this.last = time;
    this.previous.copy(this.point);
  }
  private emit(p: T.Vector3, speed: number, size: number) {
    const i = this.slot++ % 128,
      a = i * 2.399963,
      b = ((i * 37) % 127) / 63.5 - 1,
      r = Math.sqrt(1 - b * b),
      x = Math.cos(a) * r,
      z = Math.sin(a) * r;
    this.positions.set([p.x + x * 0.85, p.y + b * 0.85, p.z + z * 0.85], i * 3);
    this.velocities.set([x * speed, b * speed, z * speed], i * 3);
    this.ages[i] = 0;
    this.sizes[i] = size;
  }
}
