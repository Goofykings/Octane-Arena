import * as T from "three";
import { RUMBLE_CONFIG as R } from "../config/rumble";
import type { RumbleSnapshot, RumbleItem } from "../../shared/rumble";
interface Fx {
  id: string;
  root: T.Group;
  spikes: T.Group;
  aura: T.LineSegments;
  tether: T.Line;
  line: Float32Array;
  arcs: Float32Array;
  flash: T.Mesh<T.RingGeometry, T.MeshBasicMaterial>;
  pulse: number;
}
/** All meshes/buffers allocated once, six slots reused across rosters. Only
 * authoritative state is rendered; this class contains no physics or RNG. */
export class RumbleEffects {
  readonly slots: Fx[] = [];
  private lastEvent = 0;
  private cone = new T.ConeGeometry(
    R.visual.spikeRadius,
    R.visual.spikeLength,
    5,
  );
  private ring = new T.RingGeometry(0.8, 1, 24);
  private a = new T.Vector3();
  private b = new T.Vector3();
  private q = new T.Quaternion();
  constructor(
    private scene: T.Scene,
    private sound?: (item: RumbleItem, attached?: boolean) => void,
  ) {
    for (let slot = 0; slot < R.visual.maxPlayers; slot++) {
      const root = new T.Group(),
        spikes = new T.Group();
      root.name = "rumble-car-fx";
      const mat = new T.MeshBasicMaterial({ color: R.visual.neutral });
      for (let i = 0; i < R.visual.spikeCount; i++) {
        const spike = new T.Mesh(this.cone, mat);
        let nx = 0,
          ny = 0,
          nz = 0;
        if (i < 4) {
          ny = 1;
          spike.position.set(
            i % 2 ? 0.5 : -0.5,
            R.visual.spikeRoof,
            i < 2 ? -0.7 : 0.7,
          );
        } else if (i < 8) {
          nx = i % 2 ? 1 : -1;
          spike.position.set(
            nx * R.visual.spikeSide,
            0.3,
            i < 6 ? -0.65 : 0.65,
          );
        } else {
          nz = i % 2 ? 1 : -1;
          spike.position.set(i < 10 ? -0.5 : 0.5, 0.3, nz * R.visual.spikeEnd);
        }
        spike.quaternion.setFromUnitVectors(
          this.a.set(0, 1, 0),
          this.b.set(nx, ny, nz),
        );
        spikes.add(spike);
      }
      const arcs = new Float32Array(R.visual.auraPoints * 6),
        geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.BufferAttribute(arcs, 3).setUsage(T.DynamicDrawUsage),
      );
      const aura = new T.LineSegments(
        geometry,
        new T.LineBasicMaterial({
          color: 0x99edff,
          transparent: true,
          opacity: 0.9,
          blending: T.AdditiveBlending,
        }),
      );
      aura.frustumCulled = false;
      root.add(spikes, aura);
      scene.add(root);
      const line = new Float32Array(6),
        lineGeom = new T.BufferGeometry();
      lineGeom.setAttribute(
        "position",
        new T.BufferAttribute(line, 3).setUsage(T.DynamicDrawUsage),
      );
      const tether = new T.Line(
        lineGeom,
        new T.LineBasicMaterial({
          color: R.visual.neutral,
          transparent: true,
          opacity: R.visual.lineOpacity,
        }),
      );
      tether.name = "rumble-tether";
      tether.frustumCulled = false;
      scene.add(tether);
      const flash = new T.Mesh(
        this.ring,
        new T.MeshBasicMaterial({
          color: R.visual.neutral,
          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          blending: T.AdditiveBlending,
        }),
      );
      flash.name = "rumble-punch-flash";
      scene.add(flash);
      this.slots.push({
        id: "",
        root,
        spikes,
        aura,
        tether,
        line,
        arcs,
        flash,
        pulse: 0,
      });
    }
    this.reset();
  }
  reset() {
    this.lastEvent = 0;
    for (const fx of this.slots) {
      fx.root.visible = fx.tether.visible = fx.flash.visible = false;
      fx.pulse = 0;
      fx.id = "";
    }
  }
  update(
    state: RumbleSnapshot | null | undefined,
    getPose: (id: string) => T.Object3D | undefined,
    ball: T.Object3D,
    camera: T.Camera,
    dt: number,
    time: number,
    replay = false,
  ) {
    if (!state) {
      for (const fx of this.slots)
        fx.root.visible = fx.tether.visible = fx.flash.visible = false;
      return;
    }
    for (const st of state.players)
      if (st.attachment) {
        const pose = getPose(st.playerId);
        if (pose?.visible) {
          ball.position
            .copy(st.attachment.local)
            .applyQuaternion(pose.quaternion)
            .add(pose.position);
          this.q.copy(st.attachment.rotation);
          ball.quaternion.copy(pose.quaternion).multiply(this.q);
        }
        break;
      }
    for (let i = 0; i < this.slots.length; i++) {
      const fx = this.slots[i],
        st = state.players[i],
        pose = st ? getPose(st.playerId) : undefined;
      if (!st || !pose?.visible) {
        fx.root.visible = fx.tether.visible = fx.flash.visible = false;
        continue;
      }
      if (fx.id !== st.playerId) {
        fx.id = st.playerId;
        fx.pulse = 0;
      }
      const active = st.phase === "active";
      fx.root.visible = active;
      fx.root.position.copy(pose.position);
      fx.root.quaternion.copy(pose.quaternion);
      fx.spikes.visible = active && st.item === "SPIKES";
      fx.spikes.scale.setScalar(
        Math.min(
          1,
          (R.spikes.duration - st.remaining) / R.visual.extensionTime,
        ),
      );
      fx.aura.visible = active && st.item === "POWER_HITTER";
      if (fx.aura.visible) {
        for (let j = 0; j < R.visual.auraPoints * 2; j++) {
          const angle = (j / R.visual.auraPoints) * Math.PI * 2;
          const radius = R.visual.auraRadius * (j % 2 ? 0.75 : 1);
          const k = j * 3;
          fx.arcs[k] = Math.cos(angle) * radius;
          fx.arcs[k + 1] =
            0.3 + 0.4 * Math.sin(angle * 3 + time * R.visual.glowSpeed);
          fx.arcs[k + 2] = Math.sin(angle) * radius;
        }
        fx.aura.geometry.attributes.position.needsUpdate = true;
      }
      fx.tether.visible =
        active && (st.item === "GRAPPLING_HOOK" || st.item === "PLUNGER");
      if (fx.tether.visible) {
        fx.line[0] = pose.position.x;
        fx.line[1] = pose.position.y;
        fx.line[2] = pose.position.z;
        fx.line[3] = ball.position.x;
        fx.line[4] = ball.position.y;
        fx.line[5] = ball.position.z;
        fx.tether.geometry.attributes.position.needsUpdate = true;
        (fx.tether.material as T.LineBasicMaterial).color.setHex(
          st.item === "PLUNGER" ? R.visual.colors[1] : R.visual.colors[0],
        );
      }
      fx.pulse = Math.max(0, fx.pulse - dt);
      fx.flash.visible = fx.pulse > 0;
      fx.flash.quaternion.copy(camera.quaternion);
      fx.flash.scale.setScalar(
        (1 - fx.pulse / R.visual.flashDuration) * R.visual.flashRadius + 0.2,
      );
      fx.flash.material.opacity = fx.pulse / R.visual.flashDuration;
    }
    for (const event of state.events) {
      if (event.id <= this.lastEvent) continue;
      this.lastEvent = event.id;
      if (time - event.time > R.visual.flashDuration || event.time > time)
        continue;
      const fx = this.slots.find((f) => f.id === event.playerId);
      if (!fx) continue;
      if (event.kind === "POWERUP_USED" && !replay) this.sound?.(event.item);
      if (event.kind === "SPIKE_ATTACHED" && !replay)
        this.sound?.(event.item, true);
      if (
        (event.item === "HAYMAKER" && event.kind === "POWERUP_USED") ||
        event.kind === "SPIKE_ATTACHED"
      ) {
        fx.flash.position.copy(event.point);
        fx.pulse = R.visual.flashDuration;
        fx.flash.visible = true;
      }
    }
  }
  dispose() {
    for (const fx of this.slots) {
      fx.root.removeFromParent();
      fx.tether.removeFromParent();
      fx.flash.removeFromParent();
      fx.aura.geometry.dispose();
      (fx.aura.material as T.Material).dispose();
      fx.tether.geometry.dispose();
      (fx.tether.material as T.Material).dispose();
      fx.flash.material.dispose();
      (fx.spikes.children[0] as T.Mesh).material instanceof T.Material &&
        ((fx.spikes.children[0] as T.Mesh).material as T.Material).dispose();
    }
    this.cone.dispose();
    this.ring.dispose();
  }
}
