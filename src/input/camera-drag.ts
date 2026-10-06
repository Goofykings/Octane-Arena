import type { MouseLook } from "../camera/mouse-look";

/** Pointer capture without pointer lock; UI presses never start a drag. */
export class CameraDrag {
  private pointer: number | null = null;
  private x = 0;
  private y = 0;
  private movedAt = 0;
  private mode = "";
  constructor(
    private host: HTMLElement,
    readonly look: MouseLook,
    private context: () => string | null,
  ) {
    window.addEventListener("pointerdown", (e) => {
      const mode = context();
      const target = e.target as HTMLElement;
      if (
        !mode ||
        e.button !== 0 ||
        e.pointerType !== "mouse" ||
        !host.contains(target) ||
        target.closest(
          'button,input,select,textarea,a,label,dialog,[role="tab"],[contenteditable],.garage-left,.screen-footer,#party-panel,#party-flow,#brand,h1,h2,h3',
        )
      )
        return;
      this.stop();
      this.mode = mode;
      look.setBehavior(mode === "home" || mode === "garage" ? "orbit" : "look");
      this.pointer = e.pointerId;
      this.x = e.clientX;
      this.y = e.clientY;
      this.movedAt = performance.now();
      look.begin();
      host.classList.add("camera-dragging");
      host.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    window.addEventListener("pointermove", (e) => {
      if (this.pointer !== e.pointerId) return;
      if (!(e.buttons & 1) || context() !== this.mode) {
        this.stop();
        return;
      }
      const now = performance.now();
      look.move(
        e.clientX - this.x,
        e.clientY - this.y,
        (now - this.movedAt) / 1000,
      );
      this.movedAt = now;
      this.x = e.clientX;
      this.y = e.clientY;
      e.preventDefault();
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.pointer) this.stop();
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    host.addEventListener("lostpointercapture", end);
    host.addEventListener("preview-reset", () => this.stop(), true);
    window.addEventListener("pointerout", (e) => {
      if (!e.relatedTarget && this.pointer === e.pointerId) this.stop();
    });
    window.addEventListener("blur", () => this.stop());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
    });
  }
  stop() {
    const pointer = this.pointer;
    this.pointer = null;
    this.look.end();
    this.host.classList.remove("camera-dragging");
    if (pointer !== null && this.host.hasPointerCapture(pointer))
      this.host.releasePointerCapture(pointer);
  }
  sync() {
    const mode = this.context() ?? "";
    if (mode !== this.mode) {
      this.stop();
      // Opening a dialog should not discard the chosen display-car angle.
      if (!mode && this.look.behavior === "orbit") return;
      this.look.reset();
      this.mode = mode;
      this.look.setBehavior(
        mode === "home" || mode === "garage" ? "orbit" : "look",
      );
    }
  }
}
