import * as T from "three";
import type { Simulation } from "../physics/simulation";
import type { GameCamera } from "../camera/camera";
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
        Math.hypot(v.x, v.y, v.z).toFixed(2);
    this.element.textContent = `Slip ${c.lateralSlip.toFixed(2)} / rear ${c.wheelContact.slice(2).map(Number).join(" ")} / skid ${c.skidIntensity.toFixed(2)}\nSupersonic ${c.supersonic} / demo eligible ${c.supersonic && c.demolitionState === "active"}\nDemo ${c.demolitionState} / respawn ${c.respawnTimer.toFixed(2)}\nPHYSICS / 120 Hz\nFPS ${fps.toFixed(0)} · ticks/s ${ticks}\nSpeed ${mag(v)} m/s · forward ${c.forwardSpeed.toFixed(2)}\nVertical ${v.y.toFixed(2)} · boost ${c.boost.toFixed(1)}\nContact ${c.contactState} / support ${c.grounded} · wheels ${c.contacts}/4\nFirst jump ${c.jump.used ? "performed" : "unused"} / aerial ${c.jump.second ? "used" : c.jump.available ? "available" : "expired"}\nJump age ${c.jump.age.toFixed(2)} · dodge ${c.jump.flipLeft.toFixed(2)}\nBall speed ${mag(b.linvel())} · angular ${mag(b.angvel())}\nCar angular ${mag(av)}\nNormal ${c.normal
      .toArray()
      .map((n) => n.toFixed(2))
      .join(
        ", ",
      )}\nGreen: rays/normal · white: colliders\nYellow: relative velocity · magenta: extra hit impulse`;
    const data = s.world.debugRender();
    const contact = s.ballContacts[0],
      tuple = (v: T.Vector3) =>
        v
          .toArray()
          .map((x) => x.toFixed(2))
          .join(",");
    this.element.textContent += `\nBall contact ${contact.kind} / closing ${contact.closing.toFixed(2)} m/s\nLocal contact ${tuple(contact.local)}\nContact car linear ${tuple(contact.linear)} / angular ${tuple(contact.angular)}\nPoint velocity ${tuple(contact.pointVelocity)} / relative ${tuple(contact.relative)}\nExtra hit impulse ${tuple(contact.impulse)} N·s / roof support ${tuple(contact.roofImpulse)} N·s\nLast impact ${tuple(contact.lastImpulse)} N·s / age ${contact.impactAge.toFixed(2)} s / count ${contact.impactCount}`;
    this.element.textContent += `\nFlip time ${c.jump.flipAge.toFixed(3)} / remaining ${c.jump.flipLeft.toFixed(3)} / pitch lock ${c.pitchLocked}\nPitch input ${c.pitchInput.toFixed(2)} / angular ${new T.Vector3().copy(av).dot(c.right).toFixed(2)} rad/s\nFlip pitch acceleration ${c.flipPitchAcceleration.toFixed(2)} / cancel braking ${c.flipCancelAcceleration.toFixed(2)} rad/s²`;
    this.element.textContent += `\nSupport frame ${c.stableContact ? "stable driving" : c.contacts ? "landing / partial" : "air"} / roll angular ${new T.Vector3().copy(av).dot(c.forward).toFixed(2)} rad/s`;
    this.element.textContent += `\nSupport kind ${c.supportKind} / chassis contacts ${c.chassisContacts} / wheel edges ${c.edgeContacts}\nDriven edge force ${tuple(c.edgeDriveForce)} N`;
    this.element.textContent += `\nAdhesion ${mag(c.adhesionAcceleration)} m/s² / normal correction ${mag(c.normalCorrectionAcceleration)} m/s²\nPosition correction ${mag(c.contactCorrection)} m\nWheel normals ${c.wheelNormals
      .map((n) =>
        n
          .toArray()
          .map((v) => v.toFixed(2))
          .join(","),
      )
      .join(" / ")}\nCamera up ${
      cameraUp
        ?.toArray()
        .map((v) => v.toFixed(2))
        .join(",") ?? "world"
    }`;
    if (rig) {
      this.element.textContent += `\nCAMERA ${rig.debug.mode} / blocked ${rig.clearance.blocked} / framing safe ${rig.debug.safe}\nPivot ${tuple(rig.pivot)}\nDesired ${tuple(rig.desiredPosition)} / actual ${tuple(rig.camera.position)}\nSurface reference ${tuple(rig.clearance.surfaceUp)} / horizon up ${tuple(rig.referenceUp)}\nLook ${tuple(rig.lookDirection)} / pole fallback ${rig.debug.singularity}\nCar screen ${tuple(rig.framing.carScreen)} / ball screen ${tuple(rig.framing.ballScreen)}\nFOV ${rig.camera.fov.toFixed(1)} / adjustment ${rig.debug.fovAdjustment.toFixed(1)}`;
    }
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
