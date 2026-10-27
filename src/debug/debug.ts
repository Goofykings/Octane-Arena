import * as T from "three";
import type { Simulation } from "../physics/simulation";
import type { GameCamera } from "../camera/camera";
import { WHEEL_NAMES } from "../car/suspension";
import { curvature } from "../config/physics";
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
  update(
    s: Simulation,
    fps: number,
    ticks: number,
    cameraUp?: T.Vector3,
    rig?: GameCamera,
  ) {
    this.group.visible = this.enabled;
    this.element.hidden = !this.enabled;
    if (!this.enabled) return;
    const c = s.cars[0],
      v = c.body.linvel(),
      av = c.body.angvel(),
      b = s.ball,
      mag = (v: { x: number; y: number; z: number }) =>
        Math.hypot(v.x, v.y, v.z).toFixed(2),
      tuple = (v: { x: number; y: number; z: number }) =>
        [v.x, v.y, v.z].map((x) => x.toFixed(2)).join(",");
    const speed = Math.hypot(v.x, v.y, v.z);
    const wheels = c.wheels
      .map(
        (w, i) =>
          `${WHEEL_NAMES[i]} ${w.loaded ? "●" : w.contact ? "◐" : "○"} ${(w.compression * 100).toFixed(1)}cm ${w.force.toFixed(0)}N${w.pushback > 0 ? "+stop" : ""} slip ${w.slip.toFixed(2)} grip ${w.lateralFriction.toFixed(2)}`,
      )
      .join("\n  ");
    const comLocal = c.body.localCom(),
      comWorld = c.body.worldCom();
    const lines = [
      `PHYSICS DEBUG · 120 Hz · FPS ${fps.toFixed(0)} · ticks/s ${ticks}`,
      `Speed ${speed.toFixed(2)} m/s (${(speed * 100).toFixed(0)} uu/s) · forward ${c.forwardSpeed.toFixed(2)} · vertical ${v.y.toFixed(2)} · supersonic ${c.supersonic}`,
      `State ${c.supportState} · surface ${c.surfaceType} · loaded wheels ${c.contacts}/4 · coherent ${c.supportContacts} · chassis ${c.chassisContacts}`,
      `Wheels (● loaded ◐ ray only ○ none):\n  ${wheels}`,
      `Surface normal ${tuple(c.normal)} · sticky ${mag(c.adhesionAcceleration)} m/s² · suspension ${mag(c.normalCorrectionAcceleration)} m/s²`,
      `COM local ${tuple(comLocal)} · world ${tuple(comWorld)}`,
      `Angular ${tuple(av)} · |ω| ${mag(av)} / cap ${c.angularLimit.toFixed(1)} rad/s`,
      `Steering wheel angle ${c.steerAngle.toFixed(3)} rad · path curvature ${c.steeringCurvature.toFixed(4)} · measured ${c.turnCurvature.toFixed(4)} · RL table ${curvature(c.forwardSpeed).toFixed(4)} 1/m`,
      `Powerslide ${c.handbrake.toFixed(2)} · lateral slip ${c.lateralSlip.toFixed(2)} m/s · skid ${c.skidIntensity.toFixed(2)} · boost ${c.boost.toFixed(1)}${c.boosting ? " BOOSTING" : ""}`,
      `Jump ${c.jump.used ? "used" : "ready"}${c.jump.holding ? " (holding)" : ""} · aerial ${c.jump.second ? "used" : c.jump.available ? "available" : "expired"} · age ${c.jump.age.toFixed(2)} · flip ${c.jump.flipLeft.toFixed(2)} · pitch lock ${c.pitchLocked}`,
      `Flip pitch accel ${c.flipPitchAcceleration.toFixed(1)} · cancel ${c.flipCancelAcceleration.toFixed(2)} rad/s² · landing assist ${c.landing.rate > 0 ? "ON" : "off"} · recovery ${c.recovering}`,
      `Demo ${c.demolitionState} / respawn ${c.respawnTimer.toFixed(2)}`,
    ];
    const contact = s.ballContacts[0];
    lines.push(
      `BALL speed ${mag(b.linvel())} · spin ${mag(b.angvel())} · contact ${contact.kind} · closing ${contact.closing.toFixed(2)} m/s (rotational ${contact.rotationalClosing.toFixed(2)})`,
      `  Contact point v+ω×r ${tuple(contact.pointVelocity)} · relative ${tuple(contact.relative)}`,
      `  Extra RL impulse ${tuple(contact.impulse)} N·s · last ${mag(contact.lastImpulse)} N·s / ${contact.impactAge.toFixed(2)} s ago · count ${contact.impactCount}`,
    );
    if (rig) {
      const d = rig.debug;
      lines.push(
        `CAMERA DEBUG · ${d.mode} · blend ${d.blend.toFixed(2)}${rig.transitioning ? " (transition)" : ""}`,
        `  FOV ${d.fov}° (vertical ${d.verticalFov.toFixed(1)}°) · distance ${d.distance} · height ${d.height} · angle ${d.angle}°`,
        `  stiffness ${d.stiffness.toFixed(2)} · swivel ${d.swivel.toFixed(1)} · transition ${d.transition.toFixed(1)} · shake ${d.shake > 0 ? d.shake.toFixed(2) : "off"}`,
        `  lag ${d.lag.toFixed(2)} m · blocked ${rig.clearance.blocked} · pole ${d.singularity}`,
        `  reference up ${tuple(rig.referenceUp)} · surface ${tuple(rig.clearance.surfaceUp)}`,
        `  look ${tuple(rig.lookDirection)} · car screen ${tuple(rig.framing.carScreen)} · ball screen ${tuple(rig.framing.ballScreen)}`,
      );
    } else if (cameraUp) lines.push(`Camera up ${tuple(cameraUp)}`);
    lines.push(
      "Green: wheel rays/normals · white: colliders · yellow: velocity · pink: angular · magenta: extra hit impulse",
    );
    this.element.textContent = lines.join("\n");
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
    if (rig) {
      segment(rig.pivot, rig.desiredPosition, 0xffa333);
      segment(rig.pivot, rig.camera.position, 0xbb66ff);
      segment(
        rig.camera.position,
        rig.camera.position.clone().addScaledVector(rig.lookDirection, 2),
        0xffffff,
      );
      segment(
        rig.pivot,
        rig.pivot.clone().addScaledVector(rig.clearance.surfaceUp, 2),
        0x66ffbb,
      );
    }
    for (let i = 0; i < 4; i++)
      segment(
        c.wheelOrigins[i],
        c.wheelHits[i],
        c.wheelContact[i] ? 0x00ff66 : 0xff3355,
      );
    for (let i = 0; i < 4; i++)
      if (c.wheelNormals[i].lengthSq() > 0)
        segment(
          c.wheelHits[i],
          c.wheelHits[i].clone().add(c.wheelNormals[i]),
          c.wheelContact[i] ? 0x44ddff : 0xff9933,
        );
    const com = new T.Vector3().copy(c.body.worldCom());
    for (const axis of [
      new T.Vector3(0.12, 0, 0),
      new T.Vector3(0, 0.12, 0),
      new T.Vector3(0, 0, 0.12),
    ])
      segment(com.clone().sub(axis), com.clone().add(axis), 0xffdd22);
    const p = new T.Vector3().copy(c.body.translation());
    segment(p, p.clone().addScaledVector(c.normal, 2), 0x00ff66);
    segment(
      p,
      p.clone().addScaledVector(c.adhesionAcceleration, 0.15),
      0x9966ff,
    );
    segment(
      p,
      p.clone().addScaledVector(new T.Vector3().copy(av), 0.15),
      0xff66aa,
    );
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
