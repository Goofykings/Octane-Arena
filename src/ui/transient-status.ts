import { reducedMotion, UI_MOTION } from "./motion";
/** UI-only lifetime: the underlying error remains available for diagnostics/retry. */
export class TransientStatus {
  private message = "";
  private pending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private animation: Animation | undefined;
  constructor(
    readonly element: HTMLElement,
    private duration = 2500,
  ) {
    element.hidden = true;
  }
  update(message: string, pending = false) {
    // Per-frame renders must not restart an already dismissed notice.
    if (message === this.message && pending === this.pending) return;
    this.message = message;
    this.pending = pending;
    this.cancel();
    this.element.textContent = message;
    this.element.hidden = !message;
    if (message && !pending)
      this.timer = setTimeout(() => this.dismiss(), this.duration);
  }
  repeat(message: string, pending = false) {
    this.message = "";
    this.pending = !pending;
    this.update(message, pending);
  }
  private cancel() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.animation?.cancel();
    this.animation = undefined;
  }
  private dismiss() {
    this.timer = undefined;
    const finish = () => {
      this.element.hidden = true;
      this.element.textContent = "";
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    const animation = this.element.animate(
      [
        { opacity: 1, translate: "0 0" },
        { opacity: 0, translate: "0 5px" },
      ],
      { duration: 180, easing: UI_MOTION.easing, fill: "forwards" },
    );
    this.animation = animation;
    animation.finished.then(
      () => {
        if (this.animation !== animation) return;
        finish();
        this.animation = undefined;
        animation.cancel();
      },
      () => {},
    );
  }
  dispose() {
    this.cancel();
  }
}
