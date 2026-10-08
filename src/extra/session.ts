import * as T from "three";
import type { PlayerInput } from "../../shared/player";
import type { CameraSettings } from "../game/settings";
import type { Preset } from "../../shared/catalog";
import type { ArenaId } from "../render/arena-themes";
import { FixedLoop } from "../physics/loop";
import { GameCamera } from "../camera/camera";
import { carModel, animateWheels } from "../render/models";
import { VehicleEffects } from "../effects/vehicle-effects";
import { JumpBurst } from "../effects/jump-burst";
import { FlipTrails } from "../effects/motion-trails";
import { RingsLevel } from "./rings-view";
import { RingsPhysics, RingsRun } from "./rings";
import { ExtraRecords } from "./storage";
import type { Car } from "../car/car";
import { DribbleSession } from "./dribble/session";
import type { LocalProfile } from "../game/local-profile";
import type { MouseLook } from "../camera/mouse-look";
import { TrainingSession } from "./training/session";
import { trainingPacks } from "./training/packs";

export interface ExtraReadout {
  phase: "ready" | "running" | "paused" | "complete" | "countdown" | "replay";
  progress: number;
  total: number;
  bestProgress: number;
  elapsed: number;
  bestTime: number | null;
  unlocked?: number;
  message?: string;
  successes?: number;
  packName?: string;
  outcomeSequence?: number;
  countdownText?: string;
}

export interface ExtraSession {
  readonly replayActive?: boolean;
  readonly replayClip?: import("../../shared/replay").ReplayClip | null;
  readonly replayState?: import("../../shared/replay").ReplayState | null;
  readonly replayPlayers?: import("../../shared/player").PlayerEntity[];
  skipReplay?(): boolean;
  readonly ball?: T.Object3D;
  readonly id: string;
  readonly scene: T.Scene;
  readonly paused: boolean;
  readonly complete: boolean;
  readonly vehicle: Car;
  readonly resetSequence: number;
  readonly supportsBallCam?: boolean;
  readonly cameraControl?: GameCamera;
  navigate?(delta: number): boolean;
  toggleCamera?(): void;
  readout(now: number): ExtraReadout;
  frame(
    input: PlayerInput,
    dt: number,
    now: number,
    settings: CameraSettings,
  ): void;
  pause(now: number): void;
  reset(): void;
  dispose(): void;
}
export interface ExtraSessionOptions {
  camera: T.PerspectiveCamera;
  preset: Preset;
  arenaId: ArenaId;
  profile?: LocalProfile;
  mouseLook?: MouseLook;
}

export class RingsSession implements ExtraSession {
  readonly id = "rings";
  readonly physics = new RingsPhysics();
  readonly run: RingsRun;
  readonly level: RingsLevel;
  readonly car = new T.Group();
  readonly model: T.Group;
  readonly cameraControl: GameCamera;
  readonly loop = new FixedLoop();
  private effects: VehicleEffects;
  private jump: JumpBurst;
  private flips: FlipTrails;
  private oldFar: number;
  private oldPosition: T.Vector3;
  private oldRotation: T.Quaternion;
  private oldFov: number;
  constructor(private options: ExtraSessionOptions) {
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {
      /* Session-only records. */
    }
    this.run = new RingsRun(
      this.physics,
      new ExtraRecords(this.physics.course.id, storage),
    );
    this.physics.car.setBody(options.preset.body);
    this.physics.car.displayName = "Guest";
    this.run.reset();
    this.level = new RingsLevel(this.physics.course, options.arenaId);
    this.model = carModel(
      new T.Color(options.preset.blue).getHex(),
      options.preset.body,
      options.preset.wheels,
      options.preset.decal,
    );
    this.car.add(this.model);
    this.level.scene.add(this.car);
    this.cameraControl = new GameCamera(options.camera);
    this.cameraControl.ballMode = false;
    this.oldFar = options.camera.far;
    this.oldPosition = options.camera.position.clone();
    this.oldRotation = options.camera.quaternion.clone();
    this.oldFov = options.camera.fov;
    options.camera.far = 1200;
    options.camera.clearViewOffset();
    options.camera.updateProjectionMatrix();
    this.effects = new VehicleEffects(
      this.car,
      this.scene,
      options.preset.boost === "ember" ? 0xffa548 : 0x69e9ff,
    );
    this.jump = new JumpBurst(this.scene);
    this.flips = new FlipTrails(this.scene);
  }
  get scene() {
    return this.level.scene;
  }
  get paused() {
    return this.run.phase === "paused";
  }
  get complete() {
    return this.run.phase === "complete";
  }
  get vehicle() {
    return this.physics.car;
  }
  get resetSequence() {
    return this.run.resetSequence;
  }
  readout(now: number): ExtraReadout {
    return {
      phase: this.run.phase,
      progress: this.run.passed,
      total: this.physics.course.rings.length,
      bestProgress: this.run.records.value.bestRings,
      elapsed: this.run.elapsed(now),
      bestTime: this.run.records.value.bestTime,
    };
  }
  pause(now: number) {
    this.run.pause(now);
    this.loop.accumulator = 0;
  }
  reset() {
    this.run.reset();
    this.loop.accumulator = 0;
    this.cameraControl.reset();
    this.effects.reset();
    this.jump.reset();
    this.flips.reset();
  }
  frame(input: PlayerInput, dt: number, now: number, settings: CameraSettings) {
    const before = this.run.resetSequence;
    const result =
      !this.paused && !this.complete
        ? this.loop.advance(dt, () => {
            if (this.run.resetSequence === before) this.run.step(input, now);
          })
        : { alpha: 1, steps: 0 };
    if (before !== this.run.resetSequence) {
      this.loop.accumulator = 0;
      this.cameraControl.reset();
      this.effects.reset();
      this.jump.reset();
      this.flips.reset();
    }
    const c = this.physics.car;
    c.pose.render(
      this.car,
      before === this.run.resetSequence ? result.alpha : 1,
    );
    const activeDt = this.paused || this.complete ? 0 : dt;
    animateWheels(
      this.model,
      c.forwardSpeed,
      c.steerAngle,
      activeDt,
      c,
      this.car,
    );
    this.cameraControl.settings = settings;
    this.cameraControl.ballMode = false;
    this.cameraControl.update(
      this.car,
      null,
      this.physics,
      dt,
      false,
      now / 1000,
    );
    this.effects.update(
      c,
      activeDt,
      now / 1000,
      !this.paused && !this.complete,
    );
    this.jump.update(
      c,
      activeDt,
      !this.paused && !this.complete,
      this.options.camera.position,
    );
    this.flips.updateCar(
      c,
      this.car,
      activeDt,
      !this.paused && !this.complete,
      this.options.camera.position,
    );
    this.level.update(this.run.passed, now / 1000);
  }
  dispose() {
    this.effects.dispose();
    this.level.dispose();
    this.physics.dispose();
    this.options.camera.far = this.oldFar;
    this.options.camera.position.copy(this.oldPosition);
    this.options.camera.quaternion.copy(this.oldRotation);
    this.options.camera.fov = this.oldFov;
    this.options.camera.updateProjectionMatrix();
  }
}
export const extraModes = [
  {
    id: "training",
    name: "TRAINING PACKS",
    icon: "freeplay",
    create: (options: ExtraSessionOptions) =>
      new TrainingSession(options, trainingPacks[0]),
  },
  {
    id: "rings",
    name: "RINGS",
    icon: "rings",
    create: (options: ExtraSessionOptions) => new RingsSession(options),
  },
  {
    id: "dribble",
    name: "DRIBBLE CHALLENGE",
    icon: "dribble",
    create: (options: ExtraSessionOptions) => new DribbleSession(options),
  },
] as const;
