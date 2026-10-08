import * as T from "three";
import type {
  ExtraReadout,
  ExtraSession,
  ExtraSessionOptions,
} from "../session";
import type { PlayerInput } from "../../../shared/player";
import type { CameraSettings } from "../../game/settings";
import { LocalProfile } from "../../game/local-profile";
import { GameCamera } from "../../camera/camera";
import { FixedLoop } from "../../physics/loop";
import {
  carModel,
  ballModel,
  animateWheels,
  animateBall,
} from "../../render/models";
import { BallHeightIndicator } from "../../effects/ball-height";
import { VehicleEffects } from "../../effects/vehicle-effects";
import { JumpBurst } from "../../effects/jump-burst";
import { FlipTrails } from "../../effects/motion-trails";
import { DribblePhysics } from "./physics";
import { DribbleRun } from "./run";
import { buildDribbleCourse, dribbleLevels } from "./levels";
import { DribbleView, disposeDribbleResources } from "./view";

export class DribbleSession implements ExtraSession {
  readonly id = "dribble";
  readonly supportsBallCam = true;
  readonly scene = new T.Scene();
  readonly physics: DribblePhysics;
  readonly run: DribbleRun;
  readonly car = new T.Group();
  readonly ball = ballModel();
  readonly model: T.Group;
  readonly cameraControl: GameCamera;
  readonly loop = new FixedLoop();
  private level: DribbleView;
  private effects: VehicleEffects;
  private jump: JumpBurst;
  private flips: FlipTrails;
  private indicator: BallHeightIndicator;
  private oldCamera: {
    far: number;
    fov: number;
    position: T.Vector3;
    rotation: T.Quaternion;
  };
  constructor(private options: ExtraSessionOptions) {
    const profile = options.profile ?? new LocalProfile();
    const current = Math.min(
      dribbleLevels.length,
      profile.challengeProgress("dribble", dribbleLevels.length) + 1,
    );
    this.physics = new DribblePhysics(
      buildDribbleCourse(dribbleLevels[current - 1]),
      options.preset.body,
    );
    this.run = new DribbleRun(this.physics, profile);
    this.scene.background = new T.Color(0x183347);
    this.scene.fog = new T.Fog(0x183347, 140, 450);
    this.scene.add(new T.HemisphereLight(0xe1f3ff, 0x597483, 2.4));
    const light = new T.DirectionalLight(0xfff5dd, 3);
    light.position.set(20, 50, 20);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, {
      left: -100,
      right: 100,
      top: 30,
      bottom: -180,
      far: 250,
    });
    this.scene.add(light);
    this.level = new DribbleView(this.physics.course);
    this.scene.add(this.level.group);
    this.model = carModel(
      new T.Color(options.preset.blue).getHex(),
      options.preset.body,
      options.preset.wheels,
      options.preset.decal,
    );
    this.car.add(this.model);
    this.scene.add(this.car, this.ball);
    this.cameraControl = new GameCamera(options.camera);
    this.cameraControl.mouseLook = options.mouseLook;
    this.oldCamera = {
      far: options.camera.far,
      fov: options.camera.fov,
      position: options.camera.position.clone(),
      rotation: options.camera.quaternion.clone(),
    };
    options.camera.far = 600;
    options.camera.clearViewOffset();
    options.camera.updateProjectionMatrix();
    this.effects = new VehicleEffects(
      this.car,
      this.scene,
      options.preset.boost === "ember" ? 0xffa548 : 0x69e9ff,
    );
    this.jump = new JumpBurst(this.scene);
    this.flips = new FlipTrails(this.scene);
    this.indicator = new BallHeightIndicator(this.scene);
  }
  get vehicle() {
    return this.physics.car;
  }
  get paused() {
    return this.run.paused;
  }
  get complete() {
    return this.run.complete;
  }
  get resetSequence() {
    return this.run.resetSequence;
  }
  readout(_now: number): ExtraReadout {
    return {
      phase: this.paused ? "paused" : this.run.phase,
      progress: this.run.level,
      total: dribbleLevels.length,
      bestProgress: this.run.best,
      elapsed: 0,
      bestTime: null,
      unlocked: this.run.unlocked,
      message:
        this.run.phase === "complete"
          ? `LEVEL ${this.run.level} COMPLETE`
          : this.run.reason === "ball-dropped"
            ? "BALL DROPPED"
            : this.run.reason === "car-fell"
              ? "OFF COURSE"
              : "",
    };
  }
  private resetView() {
    this.loop.accumulator = 0;
    this.cameraControl.reset();
    this.effects.reset();
    this.jump.reset();
    this.flips.reset();
    this.options.mouseLook?.reset();
  }
  private refreshLevel() {
    this.level.dispose();
    this.level = new DribbleView(this.physics.course);
    this.scene.add(this.level.group);
    this.resetView();
  }
  navigate(delta: number) {
    const changed = this.run.select(this.run.level + delta);
    if (changed) this.refreshLevel();
    return changed;
  }
  reset() {
    this.run.reset();
    this.resetView();
  }
  pause(_now: number) {
    this.run.paused = !this.run.paused;
    this.loop.accumulator = 0;
  }
  toggleCamera() {
    this.cameraControl.ballMode = !this.cameraControl.ballMode;
  }
  frame(input: PlayerInput, dt: number, now: number, settings: CameraSettings) {
    if (this.run.advance(dt)) this.refreshLevel();
    const sequence = this.run.resetSequence;
    const result =
      !this.paused && this.run.phase !== "complete"
        ? this.loop.advance(dt, () => {
            if (sequence === this.run.resetSequence) this.run.step(input);
          })
        : { alpha: 1, steps: 0 };
    if (sequence !== this.run.resetSequence) this.resetView();
    const alpha = sequence === this.run.resetSequence ? result.alpha : 1;
    for (const { mesh, obstacleIndex } of this.level.spinners) {
      const spinner = this.physics.spinners.find(
        (s) => s.obstacleIndex === obstacleIndex,
      );
      if (spinner) mesh.quaternion.copy(spinner.body.rotation());
    }
    this.vehicle.pose.render(this.car, alpha);
    this.physics.ballPose.render(this.ball, alpha);
    const active = !this.paused && this.run.phase !== "complete",
      activeDt = active ? dt : 0;
    animateWheels(
      this.model,
      this.vehicle.forwardSpeed,
      this.vehicle.steerAngle,
      activeDt,
      this.vehicle,
      this.car,
    );
    animateBall(this.ball, now / 1000);
    this.cameraControl.settings = settings;
    this.cameraControl.update(
      this.car,
      this.ball,
      this.physics,
      dt,
      false,
      now / 1000,
    );
    this.effects.update(this.vehicle, activeDt, now / 1000, active);
    this.jump.update(
      this.vehicle,
      activeDt,
      active,
      this.options.camera.position,
    );
    this.flips.updateCar(
      this.vehicle,
      this.car,
      activeDt,
      active,
      this.options.camera.position,
    );
    this.indicator.update(this.ball, this.physics);
  }
  dispose() {
    this.effects.dispose();
    this.level.dispose();
    disposeDribbleResources(this.scene);
    this.physics.dispose();
    const camera = this.options.camera;
    camera.far = this.oldCamera.far;
    camera.fov = this.oldCamera.fov;
    camera.position.copy(this.oldCamera.position);
    camera.quaternion.copy(this.oldCamera.rotation);
    camera.updateProjectionMatrix();
    this.scene.clear();
  }
}
