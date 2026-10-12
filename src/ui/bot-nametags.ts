import * as T from "three";
import type { Simulation } from "../physics/simulation";

/** Labels own stable player IDs, never team/name/index identity. */
export class BotNametags {
  private labels = new Map<string, HTMLDivElement>();
  private point = new T.Vector3();
  constructor(private root: HTMLElement) {}

  update(s: Simulation, models: T.Object3D[], camera: T.Camera, visible: boolean) {
    const bots = s.players.filter((p) => p.controller === "bot");
    const ids = new Set(bots.map((p) => p.id));
    for (const [id, label] of this.labels)
      if (!ids.has(id)) {
        label.remove();
        this.labels.delete(id);
      }
    this.root.hidden = !visible;
    for (const player of bots) {
      let label = this.labels.get(player.id);
      if (!label) {
        label = document.createElement("div");
        label.className = "bot-name";
        label.dataset.player = player.id;
        this.root.append(label);
        this.labels.set(player.id, label);
      }
      const index = s.cars.findIndex((c) => c.id === player.id);
      const car = s.cars[index], model = models[index];
      label.textContent = car?.displayName ?? player.name;
      label.dataset.team = String(player.team);
      label.hidden = !visible || !car || !model || !model.visible ||
        !car.body.isEnabled() || car.demolitionState !== "active";
      if (label.hidden) continue;
      model.getWorldPosition(this.point).add(new T.Vector3(0, 1.05, 0));
      const distance = camera.position.distanceTo(this.point);
      this.point.project(camera);
      label.hidden = Math.abs(this.point.x) > 1 || Math.abs(this.point.y) > 1 ||
        this.point.z > 1 || this.point.z < 0;
      label.style.left = `${(this.point.x * 0.5 + 0.5) * innerWidth}px`;
      label.style.top = `${(-this.point.y * 0.5 + 0.5) * innerHeight}px`;
      label.style.fontSize = `${T.MathUtils.clamp(22 - distance * 0.08, 14, 20)}px`;
    }
  }
}
