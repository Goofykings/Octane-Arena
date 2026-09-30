import * as T from "three";
export class Effects {
  density = 1;
  enabled = true;
  private count = 1024;
  private cursor = 0;
  private life = new Float32Array(this.count);
  private velocity = new Float32Array(this.count * 3);
  private positions = new Float32Array(this.count * 3);
  private colors = new Float32Array(this.count * 3);
  private geo = new T.BufferGeometry();
  constructor(scene: T.Scene) {
    this.positions.fill(10000);
    this.geo.setAttribute("position", new T.BufferAttribute(this.positions, 3));
    this.geo.setAttribute("color", new T.BufferAttribute(this.colors, 3));
    scene.add(
      new T.Points(
        this.geo,
        new T.PointsMaterial({
          size: 0.16,
          vertexColors: true,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      ),
    );
  }
  emit(p: T.Vector3, v: T.Vector3, color: number, n = 1) {
    if (!this.enabled) return;
    n = Math.floor(n * this.density + Math.random());
    const c = new T.Color(color);
    for (let j = 0; j < n; j++) {
      const i = this.cursor++ % this.count,
        k = i * 3;
      this.life[i] = 0.2 + Math.random() * 0.35;
      this.positions.set([p.x, p.y, p.z], k);
      this.velocity.set(
        [
          v.x + (Math.random() - 0.5) * 2,
          v.y + (Math.random() - 0.5) * 2,
          v.z + (Math.random() - 0.5) * 2,
        ],
        k,
      );
      this.colors.set([c.r, c.g, c.b], k);
    }
  }
  burst(p: T.Vector3, color: number) {
    if (!this.enabled) return;
    for (let j = 0; j < 260 * this.density; j++) {
      const i = this.cursor++ % this.count,
        k = i * 3;
      const d = new T.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.25,
        Math.random() - 0.5,
      )
        .normalize()
        .multiplyScalar(8 + Math.random() * 22);
      this.life[i] = 1 + Math.random() * 1.4;
      this.positions.set(p.toArray(), k);
      this.velocity.set(d.toArray(), k);
      this.colors.set(new T.Color(color).toArray(), k);
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const k = i * 3;
      if (this.life[i] <= 0) this.positions[k + 1] = 10000;
      else {
        this.velocity[k + 1] -= 2 * dt;
        for (let j = 0; j < 3; j++)
          this.positions[k + j] += this.velocity[k + j] * dt;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
