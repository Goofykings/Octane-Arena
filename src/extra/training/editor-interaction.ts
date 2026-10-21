import * as T from "three";
import type { CustomTrainingSession } from "./custom-session";
/** Direct authoring input only. Every edit still passes through the existing clamp/commit path. */
export class EditorInteraction {
  private ray = new T.Raycaster();
  private ndc = new T.Vector2();
  private plane = new T.Plane();
  private hit = new T.Vector3();
  private offset = new T.Vector3();
  private drag:
    | {
        id: number;
        kind: "ball" | "car";
        arrow: boolean;
        startX: number;
        startY: number;
        moved: boolean;
      }
    | undefined;
  get dragging() {
    return !!this.drag;
  }
  constructor(
    private session: CustomTrainingSession,
    private canvas: HTMLElement,
    private camera: T.Camera,
  ) {
    canvas.addEventListener("pointerdown", this.down, true);
    canvas.addEventListener("pointermove", this.move, true);
    canvas.addEventListener("pointerup", this.up, true);
    canvas.addEventListener("pointercancel", this.up, true);
    canvas.addEventListener("lostpointercapture", this.up, true);
  }
  private active() {
    const s = this.session;
    return s.editing && !s.paused && !s.locked;
  }
  private setRay(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      (-(e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.ndc, this.camera);
  }
  private visible(object: T.Object3D) {
    for (let p: T.Object3D | null = object; p; p = p.parent)
      if (!p.visible) return false;
    return true;
  }
  private pick() {
    const s = this.session;
    const targets: [T.Object3D, "ball" | "car", boolean][] = [
      [s.ballHandle, "ball", true],
      [s.ballPowerArrow.cone, "ball", true],
      [s.carHandle, "car", true],
      [s.velocityArrow.cone, "car", true],
      [s.ball, "ball", false],
      [s.model, "car", false],
    ];
    let best:
      | { distance: number; kind: "ball" | "car"; arrow: boolean }
      | undefined;
    let arrowHit: typeof best;
    for (const [object, kind, arrow] of targets) {
      if (!this.visible(object)) continue;
      const hit = this.ray
        .intersectObject(object, true)
        .find((h) => this.visible(h.object));
      if (hit && arrow && (!arrowHit || hit.distance < arrowHit.distance))
        arrowHit = { distance: hit.distance, kind, arrow };
      if (hit && (!best || hit.distance < best.distance))
        best = { distance: hit.distance, kind, arrow };
    }
    return arrowHit ?? best;
  }
  private down = (e: PointerEvent) => {
    if (!this.active() || e.button !== 0) return;
    this.setRay(e);
    const picked = this.pick();
    if (!picked) return;
    if (this.session.advanced && picked.kind === this.session.selected) return;
    const s = this.session;
    s.selectObject(picked.kind);
    const origin = picked.arrow
      ? picked.kind === "ball"
        ? s.ballHandle.position
        : s.carHandle.position
      : picked.kind === "ball"
        ? s.draft.shot.ballPosition
        : s.draft.shot.carPosition;
    const normal =
      picked.arrow || e.shiftKey
        ? this.camera.getWorldDirection(new T.Vector3())
        : new T.Vector3(0, 1, 0);
    this.plane.setFromNormalAndCoplanarPoint(
      normal,
      new T.Vector3().copy(origin),
    );
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    this.offset.copy(origin).sub(this.hit);
    this.drag = {
      id: e.pointerId,
      kind: picked.kind,
      arrow: picked.arrow,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    s.beginGesture();
    s.orbit.enabled = false;
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.style.cursor = "grabbing";
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  private move = (e: PointerEvent) => {
    if (!this.drag) {
      if (this.active() && !this.session.advanced) {
        this.setRay(e);
        this.canvas.style.cursor = this.pick() ? "grab" : "";
      }
      return;
    }
    if (e.pointerId !== this.drag.id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!this.active()) {
      this.finish();
      return;
    }
    if (
      !this.drag.moved &&
      Math.hypot(e.clientX - this.drag.startX, e.clientY - this.drag.startY) < 3
    )
      return;
    this.drag.moved = true;
    this.setRay(e);
    if (!this.ray.ray.intersectPlane(this.plane, this.hit)) return;
    this.hit.add(this.offset);
    if (this.drag.arrow) this.session.directArrow(this.drag.kind, this.hit);
    else this.session.directMove(this.drag.kind, this.hit);
  };
  private up = (e: PointerEvent) => {
    if (!this.drag || e.pointerId !== this.drag.id) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.finish();
  };
  finish() {
    if (!this.drag) return;
    const id = this.drag.id;
    this.drag = undefined;
    if (this.canvas.hasPointerCapture(id))
      this.canvas.releasePointerCapture(id);
    this.canvas.style.cursor = "";
    this.session.endGesture();
  }
  dispose() {
    this.finish();
    this.canvas.removeEventListener("pointerdown", this.down, true);
    this.canvas.removeEventListener("pointermove", this.move, true);
    this.canvas.removeEventListener("pointerup", this.up, true);
    this.canvas.removeEventListener("pointercancel", this.up, true);
    this.canvas.removeEventListener("lostpointercapture", this.up, true);
    this.canvas.style.cursor = "";
  }
}
