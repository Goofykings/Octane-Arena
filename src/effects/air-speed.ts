import { P } from "../config/physics";
import type { Quality } from "../../shared/settings";
import { Vector3, type Object3D, type PerspectiveCamera } from "three";
export class AirSpeedState {
  intensity = 0;
  update(
    dt: number,
    speed: number,
    supersonic: boolean,
    contact: boolean,
    quality: Quality,
    active: boolean,
  ) {
    const permitted =
      quality !== "low" &&
      active &&
      !contact &&
      supersonic &&
      speed >= P.supersonic.start;
    const scale = quality === "medium" ? 0.45 : 1;
    const target = permitted
      ? scale *
        (0.2 +
          0.8 *
            Math.min(
              1,
              Math.max(
                0,
                (speed - P.supersonic.start) /
                  (P.car.maxSpeed - P.supersonic.start),
              ),
            ))
      : 0;
    this.intensity +=
      (target - this.intensity) * (1 - Math.exp(-Math.max(0, dt) * 8));
    if (!active || quality === "low") this.intensity = 0;
    return this.intensity;
  }
}
/** One low-resolution canvas, fixed radial streaks, no blur/render targets. */
export class AirSpeedEffect {
  readonly state = new AirSpeedState();
  readonly canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private time = 0;
  constructor(root: HTMLElement) {
    this.canvas.id = "air-speed-effect";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:1";
    root.append(this.canvas);
    this.ctx = this.canvas.getContext("2d")!;
  }
  update(
    dt: number,
    speed: number,
    sonic: boolean,
    contact: boolean,
    quality: Quality,
    active: boolean,
    ball?: Object3D,
    camera?: PerspectiveCamera,
    velocity?: { x: number; y: number; z: number },
  ) {
    const intensity = this.state.update(
      dt,
      speed,
      sonic,
      contact,
      quality,
      active,
    );
    this.canvas.hidden = intensity < 0.005;
    if (this.canvas.hidden) return;
    const w = Math.min(960, innerWidth),
      h = Math.round((w * innerHeight) / innerWidth);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    const rearward =
      camera &&
      velocity &&
      new Vector3(0, 0, -1).applyQuaternion(camera.quaternion).dot(velocity) <
        0;
    this.time += dt * (0.5 + intensity) * (rearward ? -1 : 1);
    // Clip to the outermost 16% of the screen, leaving ball/center unobstructed.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.rect(w * 0.16, h * 0.16, w * 0.68, h * 0.68);
    ctx.clip("evenodd");
    if (ball?.visible && camera) {
      const point = new Vector3().copy(ball.position).project(camera);
      if (point.z >= -1 && point.z <= 1) {
        // Project a conservative bounding box, rather than assuming a centered
        // sphere's apparent size. This also protects balls at extreme FOV edges.
        let radius = 18;
        const depth = -new Vector3()
          .copy(ball.position)
          .applyMatrix4(camera.matrixWorldInverse).z;
        if (depth <= Math.sqrt(3) * P.ball.radius + camera.near) radius = w + h;
        else
          for (const x of [-1, 1])
            for (const y of [-1, 1])
              for (const z of [-1, 1]) {
                const corner = new Vector3(x, y, z)
                  .multiplyScalar(P.ball.radius)
                  .add(ball.position)
                  .project(camera);
                radius = Math.max(
                  radius,
                  Math.hypot(
                    ((corner.x - point.x) * w) / 2,
                    ((corner.y - point.y) * h) / 2,
                  ) + 12,
                );
              }
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        ctx.moveTo(((point.x + 1) * w) / 2 + radius, ((1 - point.y) * h) / 2);
        ctx.arc(
          ((point.x + 1) * w) / 2,
          ((1 - point.y) * h) / 2,
          radius,
          0,
          Math.PI * 2,
        );
        ctx.clip("evenodd");
      }
    }
    ctx.lineWidth = quality === "medium" ? 0.8 : 1.2;
    for (let i = 0; i < (quality === "medium" ? 16 : 32); i++) {
      const angle = i * 2.39996323,
        phase = (((this.time + i * 0.618) % 1) + 1) % 1;
      const start = 0.76 + phase * 0.4,
        end = start + 0.08 + intensity * 0.11;
      const dx = Math.cos(angle) * w * 0.6,
        dy = Math.sin(angle) * h * 0.6;
      ctx.strokeStyle =
        "rgba(255,255,255," +
        intensity * 0.25 * Math.sin(phase * Math.PI) +
        ")";
      ctx.beginPath();
      ctx.moveTo(w / 2 + dx * start, h / 2 + dy * start);
      ctx.lineTo(w / 2 + dx * end, h / 2 + dy * end);
      ctx.stroke();
    }
    ctx.restore();
  }
}
