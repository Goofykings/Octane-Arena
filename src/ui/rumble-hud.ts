import * as T from "three";
import { RUMBLE_CONFIG as R } from "../config/rumble";
import {
  rumbleNames,
  type RumbleSnapshot,
  type RumbleItem,
} from "../../shared/rumble";
const paths: Record<RumbleItem, string> = {
  HAYMAKER: "M4 12h13m-6-6 6 6-6 6M19 4v16",
  GRAPPLING_HOOK: "M5 4h9v10a4 4 0 0 0 8 0M5 4v16",
  POWER_HITTER: "m13 2-8 12h7l-1 8 8-13h-7z",
  PLUNGER: "M12 3v11M5 20l2-6h10l2 6z",
  SPIKES: "m3 18 4-11 5 11 5-11 4 11M3 21h18",
};
export const rumbleIcon = (item: RumbleItem) =>
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="' +
  paths[item] +
  '"/></svg>';
export class RumbleHud {
  readonly root = document.createElement("aside");
  readonly target = document.createElement("div");
  private point = new T.Vector3();
  private opacity = 0;
  private signature = "";
  constructor(parent: HTMLElement) {
    this.root.id = "rumble-hud";
    this.root.hidden = true;
    this.root.innerHTML =
      '<div class="rumble-symbol"></div><div><b class="rumble-name">POWERUP</b><span class="rumble-time"></span><kbd class="rumble-key"></kbd></div><i class="rumble-meter"></i>';
    this.target.id = "rumble-target";
    this.target.style.width = this.target.style.height =
      R.visual.targetPixels + "px";
    this.target.style.animationDuration =
      (Math.PI * 2) / R.visual.targetPulse + "s";
    this.target.innerHTML = "<i></i>";
    this.target.hidden = true;
    parent.append(this.root, this.target);
  }
  update(
    state: RumbleSnapshot | null | undefined,
    id: string,
    car: T.Object3D | undefined,
    ball: T.Object3D,
    camera: T.Camera,
    dt: number,
    show: boolean,
    shortcut: string,
  ) {
    const st = state?.players.find((p) => p.playerId === id);
    this.root.hidden = !show || !st;
    this.target.hidden = true;
    if (!show || !st) {
      this.opacity = 0;
      return;
    }
    this.root.dataset.state = st.phase;
    const label = st.item ? rumbleNames[st.item] : "POWERUP";
    if (this.signature !== label) {
      this.signature = label;
      this.root.querySelector(".rumble-name")!.textContent = label;
      this.root.querySelector(".rumble-symbol")!.innerHTML = st.item
        ? rumbleIcon(st.item)
        : "<span>?</span>";
    }
    this.root.querySelector(".rumble-time")!.textContent =
      st.phase === "ready"
        ? "READY"
        : (st.phase === "active" ? st.remaining : st.cooldown).toFixed(1) +
          " s";
    this.root.querySelector(".rumble-key")!.textContent =
      st.phase === "ready" ? shortcut : "";
    const total =
      st.item === "SPIKES"
        ? R.spikes.duration
        : st.item === "POWER_HITTER"
          ? R.powerHitter.duration
          : st.item === "PLUNGER"
            ? R.plunger.duration
            : R.grapple.duration;
    (this.root.querySelector(".rumble-meter") as HTMLElement).style.transform =
      "scaleX(" +
      (st.phase === "active"
        ? st.remaining / total
        : st.phase === "ready"
          ? 1
          : 1 - st.cooldown / R.cooldown) +
      ")";
    const range =
      st.item === "HAYMAKER"
        ? R.haymaker.range
        : st.item === "GRAPPLING_HOOK"
          ? R.grapple.range
          : st.item === "PLUNGER"
            ? R.plunger.range
            : 0;
    const locked =
      st.phase === "ready" &&
      range > 0 &&
      !!car &&
      this.point.copy(ball.position).distanceTo(car.position) <= range;
    this.opacity +=
      ((locked ? 1 : 0) - this.opacity) *
      (1 - Math.exp(-dt * R.visual.targetFade));
    if (this.opacity < 0.01 || !ball.visible) return;
    this.point.copy(ball.position).project(camera);
    if (
      this.point.z < -1 ||
      this.point.z > 1 ||
      Math.abs(this.point.x) > 1 ||
      Math.abs(this.point.y) > 1
    )
      return;
    this.target.hidden = false;
    this.target.style.left = (this.point.x * 0.5 + 0.5) * innerWidth + "px";
    this.target.style.top = (-this.point.y * 0.5 + 0.5) * innerHeight + "px";
    this.target.style.opacity = String(this.opacity);
  }
  hide() {
    this.root.hidden = this.target.hidden = true;
    this.opacity = 0;
  }
}
