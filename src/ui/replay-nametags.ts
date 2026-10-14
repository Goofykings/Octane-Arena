import { Vector3, type Group, type Camera } from "three";
import type { Car } from "../car/car";
/** Replay labels live outside gameplay HUD visibility and follow render poses. */
export class ReplayNametags {
  private root: HTMLElement | null = null;
  private labels = new Map<string, HTMLElement>();
  private point = new Vector3();
  update(sources: Car[], models: Group[], camera: Camera) {
    if (typeof document === "undefined" || !document.getElementById?.("app"))
      return;
    if (!this.root) {
      this.root = document.createElement("section");
      this.root.id = "replay-nametags";
      document.getElementById("app")!.append(this.root);
    }
    sources.forEach((car, i) => {
      let label = this.labels.get(car.id);
      if (!label) {
        label = document.createElement("span");
        label.className = "network-name";
        label.dataset.player = car.id;
        this.labels.set(car.id, label);
        this.root!.append(label);
      }
      label.textContent = car.displayName;
      label.dataset.team = String(car.team);
      models[i].getWorldPosition(this.point);
      this.point.y += 1.1;
      this.point.project(camera);
      label.hidden =
        !models[i].visible ||
        this.point.z < 0 ||
        this.point.z > 1 ||
        Math.abs(this.point.x) > 1 ||
        Math.abs(this.point.y) > 1;
      label.style.left = (this.point.x * 0.5 + 0.5) * innerWidth + "px";
      label.style.top = (-0.5 * this.point.y + 0.5) * innerHeight + "px";
    });
  }
  clear() {
    this.root?.remove();
    this.root = null;
    this.labels.clear();
  }
}
