import * as T from "three";
import type { Simulation } from "../physics/simulation";
export class DebugView {
  enabled = false;
  private group = new T.Group();
  private geo = new T.BufferGeometry();
  private lines: T.LineSegments;
  private positions = new Float32Array(60000);
  private colors = new Float32Array(60000);
  constructor(
    scene: T.Scene,
    private element: HTMLElement,
  ) {
    this.geo.setAttribute("position", new T.BufferAttribute(this.positions, 3));
    this.geo.setAttribute("color", new T.BufferAttribute(this.colors, 3));
    this.lines = new T.LineSegments(
      this.geo,
      new T.LineBasicMaterial({ vertexColors: true, depthTest: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 10;
    this.group.add(this.lines);
    scene.add(this.group);
  }
  update(s: Simulation, fps: number, ticks: number) {
    this.group.visible = this.enabled;
    this.element.hidden = !this.enabled;
    if (!this.enabled) return;
    const c = s.cars[0],
      v = c.body.linvel(),
      av = c.body.angvel(),
      b = s.ball,
      mag = (v: { x: number; y: number; z: number }) =>
        Math.hypot(v.x, v.y, v.z).toFixed(2);
    this.element.textContent = `Slip ${c.lateralSlip.toFixed(2)} / rear ${c.wheelContact.slice(2).map(Number).join(" ")} / skid ${c.skidIntensity.toFixed(2)}\nSupersonic ${c.supersonic} / demo eligible ${c.supersonic && c.demolitionState === "active"}\nDemo ${c.demolitionState} / respawn ${c.respawnTimer.toFixed(2)}\nPHYSICS / 120 Hz\nFPS ${fps.toFixed(0)} · ticks/s ${ticks}\nSpeed ${mag(v)} m/s · forward ${c.forwardSpeed.toFixed(2)}\nVertical ${v.y.toFixed(2)} · boost ${c.boost.toFixed(1)}\nContact ${c.contactState} / support ${c.grounded} · wheels ${c.contacts}/4\nFirst jump ${c.jump.used ? "performed" : "unused"} / aerial ${c.jump.second ? "used" : c.jump.available ? "available" : "expired"}\nJump age ${c.jump.age.toFixed(2)} · dodge ${c.jump.flipLeft.toFixed(2)}\nBall speed ${mag(b.linvel())} · angular ${mag(b.angvel())}\nCar angular ${mag(av)}\nNormal ${c.normal
      .toArray()
      .map((n) => n.toFixed(2))
      .join(
        ", ",
      )}\nGreen: rays/normal · white: colliders\nYellow: relative velocity · magenta: extra hit impulse`;
    const data = s.world.debugRender();
    let offset = Math.min(data.vertices.length, this.positions.length - 300);
    this.positions.set(data.vertices.subarray(0, offset));
    for (let i = 0; i < offset / 3; i++)
      this.colors.set([0.55, 0.8, 0.8], i * 3);
    const segment = (a: T.Vector3, b: T.Vector3, color: number) => {
      if (offset + 6 > this.positions.length) return;
      this.positions.set([...a.toArray(), ...b.toArray()], offset);
      const col = new T.Color(color);
      this.colors.set([...col.toArray(), ...col.toArray()], offset);
      offset += 6;
    };
    for (let i = 0; i < 4; i++)
      segment(
        c.wheelOrigins[i],
        c.wheelHits[i],
        c.wheelContact[i] ? 0x00ff66 : 0xff3355,
      );
    const p = new T.Vector3().copy(c.body.translation());
    segment(p, p.clone().addScaledVector(c.normal, 2), 0x00ff66);
    segment(
      p,
      p.clone().addScaledVector(new T.Vector3().copy(v), 0.2),
      0xffff00,
    );
    for (const h of s.hits) {
      segment(h.position, h.position.clone().add(h.normal), 0x00ff66);
      segment(
        h.position,
        h.position.clone().addScaledVector(h.relative, 0.2),
        0xffff00,
      );
      segment(
        h.position,
        h.position.clone().addScaledVector(h.impulse, 0.02),
        0xff00ff,
      );
    }
    this.geo.setDrawRange(0, offset / 3);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
