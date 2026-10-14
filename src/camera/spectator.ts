import * as T from "three";
import { GameCamera } from "./camera";
import type { MouseLook } from "./mouse-look";
import type { Input } from "../input/input";
import type { Simulation } from "../physics/simulation";
import type { CameraSettings } from "../../shared/settings";

export const SPECTATOR = { speed: 16, sprint: 2.5, transition: 0.32 };
/** Local view only. No player/body, no input packets and no arena constraints. */
export class SpectatorCamera {
  target = "";
  speed = SPECTATOR.speed;
  readonly rig: GameCamera;
  private freePosition = new T.Vector3();
  private freeRotation = new T.Quaternion();
  private freeReady = false;
  private yaw = 0;
  private pitch = 0.3;
  private mouseYaw = 0;
  private mousePitch = 0;
  private oldPosition = new T.Vector3();
  private oldRotation = new T.Quaternion();
  private transition = SPECTATOR.transition;
  private modes: string[] = [];
  readonly ui = document.createElement("section");
  private caption = document.createElement("span");
  private hint = document.createElement("small");
  private speedField = document.createElement("input");
  constructor(
    readonly camera: T.PerspectiveCamera,
    readonly look: MouseLook,
  ) {
    this.rig = new GameCamera(camera);
    this.rig.mouseLook = look;
    this.rig.ballMode = false;
    this.ui.id = "spectator-controls";
    this.ui.hidden = true;
    for (const direction of [-1, 1]) {
      const button = document.createElement("button");
      button.textContent = direction < 0 ? "\u2039" : "\u203a";
      button.setAttribute(
        "aria-label",
        direction < 0 ? "Previous spectator camera" : "Next spectator camera",
      );
      button.onclick = () => this.cycle(direction);
      if (direction > 0) this.ui.append(this.caption);
      this.ui.append(button);
    }
    this.hint.textContent = ", / .  | D-PAD";
    this.speedField.type = "number";
    this.speedField.min = "1";
    this.speedField.max = "100";
    this.speedField.value = String(this.speed);
    this.speedField.setAttribute("aria-label", "Free camera speed (m/s)");
    this.speedField.onchange = () => {
      this.speed = T.MathUtils.clamp(
        Number(this.speedField.value) || SPECTATOR.speed,
        1,
        100,
      );
      this.speedField.value = String(this.speed);
    };
    this.ui.append(this.speedField, this.hint);
    document.getElementById("app")!.append(this.ui);
  }
  resume() {
    this.oldPosition.copy(this.camera.position);
    this.oldRotation.copy(this.camera.quaternion);
    this.transition = 0;
    this.rig.reset();
  }
  cycle(direction: number) {
    if (!this.modes.length) return;
    this.oldPosition.copy(this.camera.position);
    this.oldRotation.copy(this.camera.quaternion);
    this.transition = 0;
    this.target =
      this.modes[
        (this.modes.indexOf(this.target) + direction + this.modes.length) %
          this.modes.length
      ];
    this.look.reset();
    this.mouseYaw = this.mousePitch = 0;
    this.rig.reset();
    if (this.target === "free" && !this.freeReady) {
      this.freePosition.copy(this.camera.position);
      this.freeRotation.copy(this.camera.quaternion);
      this.freeReady = true;
    }
  }
  update(
    models: T.Group[],
    ball: T.Group,
    s: Simulation,
    input: Input,
    dt: number,
    time: number,
    settings: CameraSettings,
    enabled: boolean,
  ) {
    this.modes = [...s.players.map((p) => p.id), "ball", "free"];
    if (!this.modes.includes(this.target)) this.target = this.modes[0];
    this.ui.hidden = !enabled;
    if (!enabled) return;
    if (!input.blocked) {
      if (input.takeAction("spectatePrevious")) this.cycle(-1);
      if (input.takeAction("spectateNext")) this.cycle(1);
    }
    const index = s.players.findIndex((p) => p.id === this.target);
    this.caption.textContent =
      index >= 0
        ? "PLAYER: " + s.cars[index].displayName
        : this.target === "ball"
          ? "BALL CAM"
          : "FREE CAM";
    this.speedField.hidden = this.target !== "free";
    this.hint.textContent =
      this.target === "free"
        ? "WASD / LEFT STICK | SPACE / A: UP | CTRL / X: DOWN | BOOST: FASTER"
        : ", / .  | D-PAD";
    if (index >= 0) {
      this.rig.settings = settings;
      this.rig.update(models[index], ball, s, dt, false, time, null);
    } else {
      let dx = 0,
        dy = 0;
      if (this.look.dragging) {
        dx = this.look.yaw - this.mouseYaw;
        dy = this.look.pitch - this.mousePitch;
      }
      this.mouseYaw = this.look.yaw;
      this.mousePitch = this.look.pitch;
      const stickX =
        input.getAction("cameraRight") - input.getAction("cameraLeft");
      const stickY =
        input.getAction("cameraDown") - input.getAction("cameraUp");
      this.camera.clearViewOffset();
      this.camera.up.set(0, 1, 0);
      if (this.target === "ball") {
        this.yaw -= dx + stickX * dt * 2;
        this.pitch = T.MathUtils.clamp(
          this.pitch + dy + stickY * dt * 2,
          -1.3,
          1.3,
        );
        const destination = ball.position
          .clone()
          .add(
            new T.Vector3(
              Math.sin(this.yaw) * Math.cos(this.pitch) * 10,
              Math.sin(this.pitch) * 10,
              Math.cos(this.yaw) * Math.cos(this.pitch) * 10,
            ),
          );
        this.camera.position.lerp(destination, 1 - Math.exp(-dt * 12));
        this.camera.lookAt(ball.position);
        this.camera.fov = settings.fov;
      } else {
        const e = new T.Euler().setFromQuaternion(this.freeRotation, "YXZ");
        e.y -= dx + stickX * dt * 2;
        e.x = T.MathUtils.clamp(e.x - dy - stickY * dt * 2, -1.5, 1.5);
        this.freeRotation.setFromEuler(e);
        const strongest = (a: number, b: number) =>
          Math.abs(a) >= Math.abs(b) ? a : b;
        const forward = strongest(
          input.getAction("throttle") - input.getAction("reverse"),
          input.getAction("pitchForward") - input.getAction("pitchBack"),
        );
        const movement = new T.Vector3(
          input.getAction("right") - input.getAction("left"),
          0,
          -forward,
        ).applyQuaternion(this.freeRotation);
        movement.y += input.getAction("jump") - input.getAction("slide");
        movement
          .clampLength(0, 1)
          .multiplyScalar(
            dt * this.speed * (input.isHeld("boost") ? SPECTATOR.sprint : 1),
          );
        this.freePosition.add(movement);
        this.camera.position.copy(this.freePosition);
        this.camera.quaternion.copy(this.freeRotation);
        this.camera.fov = settings.fov;
      }
    }
    if (this.transition < SPECTATOR.transition) {
      this.transition += dt;
      const a = T.MathUtils.smoothstep(
        this.transition,
        0,
        SPECTATOR.transition,
      );
      this.camera.position.lerpVectors(
        this.oldPosition,
        this.camera.position.clone(),
        a,
      );
      this.camera.quaternion.slerpQuaternions(
        this.oldRotation,
        this.camera.quaternion.clone(),
        a,
      );
    }
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }
  dispose() {
    this.ui.remove();
  }
}
