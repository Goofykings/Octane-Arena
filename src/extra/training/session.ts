import * as T from "three";
import type {
  ExtraReadout,
  ExtraSession,
  ExtraSessionOptions,
} from "../session";
import type { PlayerInput } from "../../../shared/player";
import type { CameraSettings } from "../../game/settings";

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
import { Simulation } from "../../physics/simulation";
import { TrainingRun } from "./run";
import type { TrainingPack } from "./packs";
import { drawArena } from "../../render/arena";
import { disposeDribbleResources } from "../dribble/view";
import { TrainingPreview } from "./preview";
import { ReplayScenePlayback } from "../../replay/scene-playback";
import { BallTrails } from "../../effects/motion-trails";
import { SkidMarks } from "../../effects/skid-marks";
import { DemolitionFlash } from "../../effects/demolition-flash";
import { GoalExplosion } from "../../effects/goal-explosion";

export class TrainingSession implements ExtraSession {
  readonly id = "training";
  readonly supportsBallCam = true;
  readonly scene = new T.Scene();
  readonly physics: Simulation;
  readonly run: TrainingRun;
  readonly car = new T.Group();
  readonly ball = ballModel();
  readonly model: T.Group;
  readonly cameraControl: GameCamera;
  readonly loop = new FixedLoop();
  readonly preview: TrainingPreview;
  readonly replayView: ReplayScenePlayback;
  private saveExplosion: GoalExplosion;
  private burstSequence = 0;
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
  constructor(
    private options: ExtraSessionOptions,
    readonly pack: TrainingPack,
  ) {
    this.physics = new Simulation(false, [
      { id: "training-local", name: "Guest", team: 0, controller: "local" },
    ]);
    this.physics.cars[0].setBody(options.preset.body);
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {
      /* Optional local records. */
    }
    this.run = new TrainingRun(this.physics, pack, storage);
    this.scene.background = new T.Color(0x183347);
    this.scene.fog = new T.Fog(0x183347, 140, 450);
    this.scene.add(new T.HemisphereLight(0xe1f3ff, 0x597483, 2.4));
    const light = new T.DirectionalLight(0xfff5dd, 3);
    light.position.set(20, 50, 20);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    Object.assign(light.shadow.camera, {
      left: -80,
      right: 80,
      top: 80,
      bottom: -80,
      far: 250,
    });
    this.scene.add(light);
    drawArena(this.scene, options.arenaId);
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
    this.preview = new TrainingPreview(this.scene);this.preview.load(this.run.shot);
    this.saveExplosion=new GoalExplosion(this.scene,0.18);
    this.replayView=new ReplayScenePlayback(options.camera,[this.car],[this.model],this.ball,this.physics.cars,{
      vehicles:[this.effects],ball:new BallTrails(this.scene),flips:[this.flips],jumps:[this.jump],skids:[new SkidMarks(this.scene)],demos:[new DemolitionFlash(this.scene)],explosion:new GoalExplosion(this.scene),
    });
  }
  get replayActive(){return !!this.run.replay;}
  get replayClip(){return this.run.replay?.clip??null;}
  get replayState(){const r=this.run.replay;return r?{id:r.clip.goal.id,time:r.clock.time,speed:r.clock.speed,eligible:[this.vehicle.id],votes:[]}:null;}
  get replayPlayers(){return this.physics.players.map(p=>({...p,name:this.vehicle.displayName,avatarId:this.options.profile?.value.avatarId,avatarColor:this.options.profile?.value.avatarColor}));}
  skipReplay(){const sequence=this.run.resetSequence;const changed=this.run.skipReplay();if(changed&&sequence!==this.run.resetSequence)this.resetView();return changed;}
  get vehicle() {
    return this.physics.cars[0];
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
      phase: this.paused ? "paused" : this.complete ? "complete" : this.replayActive ? "replay" : this.run.countdown>0 ? "countdown" : "running",
      progress: this.run.index + 1,
      total: this.pack.shots.length,
      bestProgress: this.run.best,
      elapsed: this.run.elapsed,
      bestTime: null,
      unlocked: this.pack.shots.length,
      message: this.run.outcome ?? "",
      successes: this.run.successes,
      packName: this.pack.name,
      outcomeSequence: this.run.outcomeSequence,
      countdownText: this.run.countdown>0?String(Math.ceil(this.run.countdown)):this.run.goTime>0?"GO!":"",
    };
  }
  private resetView() {
    this.replayView.stop();this.preview.load(this.run.shot);this.saveExplosion.reset();
    this.loop.accumulator = 0;
    this.cameraControl.reset();
    this.effects.reset();
    this.jump.reset();
    this.flips.reset();
    this.options.mouseLook?.reset();
  }
  navigate(delta: number) {
    const changed = this.run.navigate(delta);
    if (changed) this.resetView();
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
    if (this.run.advance(dt)) this.resetView();
    const sequence = this.run.resetSequence;
    const result =
      !this.paused && !this.complete && !this.run.outcome && !this.replayActive
        ? this.loop.advance(dt, () => {
            if (sequence === this.run.resetSequence) this.run.step(input);
          })
        : { alpha: 1, steps: 0 };
    if (sequence !== this.run.resetSequence) this.resetView();
    this.preview.update(this.run.countdown);
    if(this.run.replay){
      const r=this.run.replay;
      this.replayView.render(r.clip,r.clock.time,r.clock.speed,this.paused?0:dt);
      this.preview.arrow.visible=false;this.indicator.group.visible=false;
      return;
    }
    if(this.replayView.active)this.replayView.stop();
    const alpha = sequence === this.run.resetSequence ? result.alpha : 1;
    this.vehicle.pose.render(this.car, alpha);
    this.physics.ballPose.render(this.ball, alpha);
    this.ball.visible=this.physics.ball.isEnabled();
    if(this.burstSequence!==this.run.ballBurstSequence){this.burstSequence=this.run.ballBurstSequence;this.saveExplosion.trigger(this.physics.ball.translation(),0xb3e8ff);}
    this.saveExplosion.update(this.paused?0:dt);
    const active = !this.paused && !this.complete && !this.run.outcome && this.run.countdown===0,
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
    this.replayView.stop();
    this.effects.dispose();
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
