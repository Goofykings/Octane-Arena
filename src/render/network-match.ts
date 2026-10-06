import { displayIdentity } from "../../shared/local-profile";
import * as T from "three";
import { Simulation } from "../physics/simulation";
import { Match } from "../game/match";
import type { NetworkClient } from "../game/network";
import type { MatchSnapshot } from "../../shared/network";
import {
  carModel,
  ballModel,
  animateWheels,
  animateBall,
  disposeModel,
} from "./models";
import { VehicleEffects } from "../effects/vehicle-effects";
import { GoalExplosion } from "../effects/goal-explosion";
import { GameCamera } from "../camera/camera";
import { BallTrails, FlipTrails } from "../effects/motion-trails";
import { SkidMarks } from "../effects/skid-marks";
import { DemolitionFlash } from "../effects/demolition-flash";
import { JumpBurst } from "../effects/jump-burst";
import { BallHeightIndicator } from "../effects/ball-height";
import type { CameraSettings } from "../game/settings";
import { ReplayScenePlayback } from "../replay/scene-playback";

/** Snapshot-only visual world. This never advances client-side match physics. */
export class NetworkMatchView {
  simulation: Simulation;
  match = new Match();
  group = new T.Scene();
  cars: T.Group[];
  ball = ballModel();
  ballHeight = new BallHeightIndicator(this.group);
  camera: GameCamera;
  readonly replayView: ReplayScenePlayback;
  replayPads: Float32Array | null = null;
  private effects: VehicleEffects[];
  private ballTrails: BallTrails;
  private flips: FlipTrails[];
  private jumps: JumpBurst[];
  private skids: SkidMarks[];
  private demos: DemolitionFlash[];
  private explosion: GoalExplosion;
  private labels: HTMLDivElement;
  private reset = -1;
  private phase = "";
  constructor(
    private scene: T.Scene,
    camera: T.PerspectiveCamera,
    initial: MatchSnapshot,
    localId: string,
  ) {
    const players = [...initial.players].sort((a, b) =>
      a.id === localId ? -1 : b.id === localId ? 1 : 0,
    );
    this.simulation = new Simulation(false, players);
    this.cars = players.map((p, i) => {
      this.simulation.cars[i].setBody(p.preset.body);
      const model = carModel(
        new T.Color(p.team === 0 ? p.preset.blue : p.preset.orange).getHex(),
        p.preset.body,
        p.preset.wheels,
        p.preset.decal,
      );
      this.group.add(model);
      return model;
    });
    this.effects = this.cars.map(
      (car, i) =>
        new VehicleEffects(
          car,
          this.group,
          players[i].preset.boost === "ember" ? 0xffa548 : 0x69e9ff,
        ),
    );
    this.explosion = new GoalExplosion(this.group);
    this.ballTrails = new BallTrails(this.group);
    this.flips = players.map(() => new FlipTrails(this.group));
    this.jumps = players.map(() => new JumpBurst(this.group));
    this.skids = players.map(() => new SkidMarks(this.group));
    this.demos = players.map(() => new DemolitionFlash(this.group));
    this.group.add(this.ball);
    scene.add(this.group);
    this.camera = new GameCamera(camera);
    this.replayView = new ReplayScenePlayback(
      camera,
      this.cars,
      this.cars,
      this.ball,
      this.simulation.cars,
      {
        vehicles: this.effects,
        ball: this.ballTrails,
        flips: this.flips,
        jumps: this.jumps,
        skids: this.skids,
        demos: this.demos,
        explosion: this.explosion,
      },
    );
    this.match.mode = "network";
    this.labels = document.createElement("div");
    this.labels.id = "network-labels";
    for (const player of players) {
      const label = document.createElement("span");
      label.className = "network-name";
      label.textContent = displayIdentity(player);
      label.dataset.team = String(player.team);
      this.labels.append(label);
    }
    document.getElementById("app")!.append(this.labels);
  }
  update(
    client: NetworkClient,
    dt: number,
    time: number,
    settings: CameraSettings,
  ) {
    const sample = client.sample();
    if (!sample || !client.latest) return;
    const { older, newer, alpha } = sample,
      latest = client.latest;
    this.match.kickoffFormationId = latest.kickoffFormationId;
    if (this.reset !== latest.reset) {
      this.camera.reset();
      this.explosion.reset();
      this.effects.forEach((e) => e.reset());
      this.ballTrails.reset();
      this.flips.forEach((e) => e.reset());
      this.jumps.forEach((e) => e.reset());
      this.skids.forEach((e) => e.reset());
      this.demos.forEach((e) => e.reset());
      this.reset = latest.reset;
    }
    if (latest.phase === "replay") {
      Object.assign(this.match, {
        phase: latest.phase,
        score: latest.score,
        remaining: latest.remaining,
        overtime: latest.overtime,
        message: "",
      });
      const clip = client.replayClip,
        state = latest.replay;
      this.labels.hidden = true;
      this.ballHeight.group.visible = false;
      if (clip && state && clip.goal.id === state.id) {
        const replayTime =
          state.time +
          Math.min(
            0.1,
            Math.max(0, (performance.now() - client.arrived) / 1000),
          ) *
            state.speed;
        this.replayPads = this.replayView.render(
          clip,
          replayTime,
          state.speed,
          dt,
        );
      }
      this.phase = latest.phase;
      return;
    }
    if (this.replayView.active) {
      this.replayView.stop();
      this.camera.reset();
    }
    this.replayPads = null;
    this.labels.hidden = false;
    if (latest.phase === "goal" && this.phase !== "goal" && latest.goalFocus)
      this.explosion.trigger(
        new T.Vector3().copy(latest.goalFocus),
        latest.goalFocus.z < 0 ? 0x69e9ff : 0xffb654,
      );
    this.phase = latest.phase;
    this.simulation.cars.forEach((car, i) => {
      const b = newer.cars.find((c) => c.id === car.id)!,
        a = older.cars.find((c) => c.id === car.id) ?? b,
        model = this.cars[i];
      const blend =
        a.enabled !== b.enabled ||
        new T.Vector3().copy(a.position).distanceToSquared(b.position) > 64
          ? 1
          : alpha;
      if (model.visible && !b.enabled)
        this.demos[i].trigger(new T.Vector3().copy(b.position));
      if (!model.visible && b.enabled && i === 0) this.camera.reset();
      model.position.lerpVectors(
        new T.Vector3().copy(a.position),
        new T.Vector3().copy(b.position),
        blend,
      );
      model.quaternion.slerpQuaternions(
        new T.Quaternion().copy(a.rotation),
        new T.Quaternion().copy(b.rotation),
        blend,
      );
      model.visible = b.enabled;
      car.body.setTranslation(model.position, true);
      car.body.setRotation(model.quaternion, true);
      car.body.setLinvel(b.velocity, true);
      car.body.setEnabled(b.enabled);
      car.boost = b.boost;
      car.boosting = b.boosting;
      car.supersonic = b.supersonic;
      car.grounded = b.grounded;
      car.forwardSpeed = b.speed;
      car.steerAngle = b.steer;
      car.skidIntensity = b.skid;
      car.normal.copy(b.normal);
      car.wheelContact = [...b.wheels];
      car.jump.flipLeft = b.flipLeft;
      car.normalJumpSequence = b.normalJump?.sequence ?? 0;
      car.normalJumpAge = b.normalJump?.age ?? Infinity;
      if (b.normalJump) {
        car.normalJumpOrigin.copy(b.normalJump.origin);
        car.normalJumpNormal.copy(b.normalJump.normal);
      }
      car.forward.set(0, 0, -1).applyQuaternion(model.quaternion);
      car.right.set(1, 0, 0).applyQuaternion(model.quaternion);
      car.up.set(0, 1, 0).applyQuaternion(model.quaternion);
      car.wheelHits.forEach((point, j) =>
        point.lerpVectors(
          new T.Vector3().copy(a.wheelHits[j]),
          new T.Vector3().copy(b.wheelHits[j]),
          blend,
        ),
      );
      animateWheels(
        model,
        b.speed,
        b.steer,
        dt,
        car,
        model,
        latest.phase === "playing" && b.wheelAngle !== undefined
          ? { angle: b.wheelAngle, steer: b.wheelSteer ?? b.steer }
          : undefined,
      );
      this.effects[i].update(
        car,
        dt,
        time,
        b.enabled && latest.phase !== "finished",
      );
      this.flips[i].updateCar(
        car,
        model,
        dt,
        b.enabled,
        this.camera.camera.position,
      );
      this.skids[i].update(car, dt, b.enabled && latest.phase === "playing");
      this.jumps[i].update(car, dt, b.enabled, this.camera.camera.position);
      this.demos[i].update(dt);
    });
    this.ball.position.lerpVectors(
      new T.Vector3().copy(older.ball.position),
      new T.Vector3().copy(newer.ball.position),
      alpha,
    );
    this.ball.quaternion.slerpQuaternions(
      new T.Quaternion().copy(older.ball.rotation),
      new T.Quaternion().copy(newer.ball.rotation),
      alpha,
    );
    this.ball.visible = newer.ball.enabled;
    this.simulation.ball.setEnabled(newer.ball.enabled);
    this.simulation.ball.setTranslation(this.ball.position, true);
    animateBall(this.ball, time);
    const ballSpeed =
      new T.Vector3()
        .copy(newer.ball.position)
        .distanceTo(older.ball.position) /
      Math.max(0.001, newer.time - older.time);
    this.ballTrails.updateBall(
      this.ball,
      ballSpeed,
      latest.touchTeam,
      dt,
      newer.ball.enabled,
      this.camera.camera.position,
    );
    this.explosion.update(dt);
    this.ballHeight.update(this.ball, this.simulation);
    Object.assign(this.match, {
      phase: latest.phase,
      score: latest.score,
      remaining: latest.remaining,
      countdown: latest.countdown,
      goTime: latest.goTime,
      overtime: latest.overtime,
      message: latest.message,
      goalFocus: latest.goalFocus,
    });
    this.camera.settings = settings;
    this.camera.camera.clearViewOffset();
    this.camera.update(
      this.cars[0],
      this.ball,
      this.simulation,
      dt,
      false,
      time,
      latest.phase === "goal" ? latest.goalFocus : null,
    );
    this.camera.camera.updateMatrixWorld(true);
    this.cars.forEach((model, i) => {
      const point = model.position
          .clone()
          .add(new T.Vector3(0, 1.2, 0))
          .project(this.camera.camera),
        label = this.labels.children[i] as HTMLElement;
      label.hidden =
        i === 0 ||
        !model.visible ||
        point.z < 0 ||
        point.z > 1 ||
        Math.abs(point.x) > 1 ||
        Math.abs(point.y) > 1;
      label.style.left = `${(point.x * 0.5 + 0.5) * innerWidth}px`;
      label.style.top = `${(-point.y * 0.5 + 0.5) * innerHeight}px`;
    });
  }
  dispose() {
    this.replayView.stop();
    this.effects.forEach((e) => e.dispose());
    this.group.removeFromParent();
    disposeModel(this.group);
    this.labels.remove();
    this.simulation.dispose();
  }
}
