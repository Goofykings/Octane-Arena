import { displayIdentity } from "../../shared/local-profile";
import * as T from "three";
import { carModel, disposeModel } from "./models";
import type { PartyMember } from "../../shared/party";
import { MouseOrbit, type MouseLook } from "../camera/mouse-look";
import type { CameraWorld } from "../camera/camera";
type Display = {
  model: T.Group;
  label: HTMLElement;
  key: string;
  target: T.Vector3;
  opacity: number;
  leaving: boolean;
};
export class HomeLobby {
  group = new T.Group();
  private displays = new Map<string, Display>();
  private count = 1;
  private basePosition = new T.Vector3();
  private baseReady = false;
  private mouseOrbit = new MouseOrbit();
  area = document.createElement("div");
  labels = document.createElement("div");
  constructor(scene: T.Scene) {
    scene.add(this.group);
    this.area.id = "home-car-area";
    this.labels.id = "lobby-labels";
    document.getElementById("app")!.append(this.area, this.labels);
  }
  update(
    members: PartyMember[],
    camera: T.PerspectiveCamera,
    dt: number,
    time: number,
    visible: boolean,
    mouseLook?: MouseLook,
    world?: CameraWorld,
  ) {
    this.group.visible = visible;
    this.area.hidden = !visible;
    this.labels.hidden = !visible;
    if (!visible) {
      this.baseReady = false;
      return;
    }
    if (!this.baseReady) {
      this.basePosition.copy(camera.position);
      this.baseReady = true;
    }
    const narrow = innerWidth < 760,
      columns = narrow ? Math.min(2, members.length) : members.length,
      rows = Math.ceil(members.length / columns);
    const active = new Set(members.map((m) => m.id));
    for (const [id, d] of this.displays) d.leaving = !active.has(id);
    members.forEach((m, i) => {
      const key = JSON.stringify(m.preset);
      let d = this.displays.get(m.id);
      if (d && d.key !== key) {
        const position = d.model.position.clone();
        this.group.remove(d.model);
        disposeModel(d.model);
        d.model = carModel(
          new T.Color(m.preset.blue).getHex(),
          m.preset.body,
          m.preset.wheels,
          m.preset.decal,
        );
        d.model.position.copy(position);
        this.group.add(d.model);
        d.key = key;
      }
      if (!d) {
        const model = carModel(
            new T.Color(m.preset.blue).getHex(),
            m.preset.body,
            m.preset.wheels,
            m.preset.decal,
          ),
          label = document.createElement("span");
        label.className = "lobby-name";
        this.labels.append(label);
        model.position.set(6, 0.31, 15);
        this.group.add(model);
        d = {
          model,
          label,
          key,
          target: new T.Vector3(),
          opacity: 0,
          leaving: false,
        };
        this.displays.set(m.id, d);
      }
      const row = Math.floor(i / columns),
        rowCount = Math.min(columns, members.length - row * columns);
      d.target.set(
        6 + ((i % columns) - (rowCount - 1) / 2) * 1.95,
        0.31,
        14 + row * 2.3 + (rows === 1 && i % 2 ? 0.18 : 0),
      );
      d.label.textContent = displayIdentity(m);
      d.model.rotation.y = Math.PI + 0.38;
      d.leaving = false;
    });
    const ease = 1 - Math.exp(-dt * 15);
    this.count = T.MathUtils.lerp(this.count, members.length, ease);
    const rect = this.area.getBoundingClientRect(),
      spanX = (columns - 1) * 1.95 + 2.05,
      spanY = rows > 1 ? 3.5 : 1.9;
    const fov = 42,
      halfTan = Math.tan(T.MathUtils.degToRad(fov / 2));
    const distance = Math.max(
      2.7,
      spanX / (2 * halfTan * (rect.width / innerHeight)),
      spanY / (2 * halfTan * (rect.height / innerHeight)),
    );
    const target = new T.Vector3(6, 0.5, 14 + (rows - 1) * 1.15),
      position = target
        .clone()
        .add(
          new T.Vector3(Math.sin(time * 0.1) * 0.07, distance * 0.42, distance),
        );
    this.basePosition.lerp(position, ease);
    camera.position.copy(this.basePosition);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.fov = fov;
    camera.setViewOffset(
      innerWidth,
      innerHeight,
      innerWidth / 2 - (rect.x + rect.width / 2),
      innerHeight / 2 - (rect.y + rect.height / 2),
      innerWidth,
      innerHeight,
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    this.mouseOrbit.apply(camera, target, mouseLook, dt, world, 0.3);
    for (const [id, d] of this.displays) {
      d.model.position.lerp(d.target, ease);
      d.opacity = T.MathUtils.lerp(d.opacity, d.leaving ? 0 : 1, ease);
      d.model.traverse((o) => {
        if (o instanceof T.Mesh)
          for (const material of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            material.transparent = d.opacity < 0.995;
            material.opacity = d.opacity;
          }
      });
      const p = d.model.position
        .clone()
        .add(new T.Vector3(0, -0.06, 0.85))
        .project(camera);
      d.label.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
      d.label.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
      d.label.style.opacity = String(d.opacity);
      if (d.leaving && d.opacity < 0.01) {
        this.group.remove(d.model);
        disposeModel(d.model);
        d.label.remove();
        this.displays.delete(id);
      }
    }
  }
}
