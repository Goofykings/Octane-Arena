import { LocalCarPrediction } from "../network/local-prediction";
import { RemoteCarSmoother } from "../network/remote-car-smoother";
import { RemoteCollisionProxies } from "../network/remote-collision-proxies";
import { AuthoritativeBallCorrection } from "../network/authoritative-ball-correction";
import { FixedLoop } from "../physics/loop";
import RAPIER from "@dimforge/rapier3d-compat";
import { refreshStaticQueries } from "../physics/queries";
import { DropshotView } from "../../shared/dropshot";
import { dropshotBall } from "./dropshot";
import { hoopsBall } from "./hoops";
import { P } from "../config/physics";
import { SpectatorCamera } from "../camera/spectator";
import type { Input } from "../input/input";
import { heatseekerBall, heatIntensity } from "../effects/heatseeker-ball";
import type { Quality } from "../../shared/settings";
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

/** Snapshot-driven presentation. Only kinematic/query bodies advance here;
 * gameplay outcomes remain in the host's independent simulation. */
import { RumbleEffects } from "../effects/rumble";
import type { RumbleItem } from "../../shared/rumble";
export class NetworkMatchView {
  private readonly remoteCars = new RemoteCarSmoother();
  private readonly collisionProxies: RemoteCollisionProxies;
  private readonly proxyLoop = new FixedLoop();
  private proxyAt = performance.now();
  private readonly ballCorrection = new AuthoritativeBallCorrection();
  proxySteps = 0;
  spectator: SpectatorCamera | null = null;
  readonly rumbleEffects: RumbleEffects;
  readonly matchId: string;
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
  readonly prediction: LocalCarPrediction | null;
  private networkDebug: HTMLPreElement | null = null;
  private debugAt = 0;
  private ballTrails: BallTrails;
  private flips: FlipTrails[];
  private jumps: JumpBurst[];
  private skids: SkidMarks[];
  private demos: DemolitionFlash[];
  private explosion: GoalExplosion;
  private labels: HTMLDivElement;
  private labelsById = new Map<string, HTMLElement>();
  private dropshotView = new DropshotView();
  private dropshotRevision = "";
  private reset = -1;
  private phase = "";
  constructor(
    private scene: T.Scene,
    camera: T.PerspectiveCamera,
    initial: MatchSnapshot,
    private localId: string,
    onPowerSound?: (item: RumbleItem) => void,
  ) {
    this.matchId = initial.matchId;
    const local = initial.players.find((p) => p.id === localId);
    this.prediction = local ? new LocalCarPrediction(local, initial) : null;
    if (new URLSearchParams(location.search).has("netdebug")) {
      this.networkDebug = document.createElement("pre");
      this.networkDebug.id = "network-debug";
      Object.assign(this.networkDebug.style, {
        position: "fixed",
        right: "12px",
        top: "12px",
        zIndex: "1000",
        background: "#081321dd",
        color: "#bcecff",
        font: "12px monospace",
        padding: "10px",
        pointerEvents: "none",
      });
      document.getElementById("app")!.append(this.networkDebug);
    }
    const players = [...initial.players].sort((a, b) =>
      a.id === localId ? -1 : b.id === localId ? 1 : 0,
    );
    this.simulation = new Simulation(false, players);
    this.simulation.configureMutators(initial.mutators);
    this.simulation.setGameMode(initial.gameMode ?? "soccar");
    if (initial.gameMode === "dropshot") refreshStaticQueries(this.simulation);
    this.match.mutators = this.simulation.mutators;
    hoopsBall(this.ball, initial.gameMode === "hoops");
    this.ball.scale.setScalar(
      this.simulation.physics.ball.radius / P.ball.radius,
    );
    this.cars = players.map((p, i) => {
      this.simulation.cars[i].setBody(p.preset.body);
      const model = carModel(
        new T.Color(p.team === 0 ? p.preset.blue : p.preset.orange).getHex(),
        p.preset.body,
        p.preset.wheels,
        p.preset.topper,
      );
      this.group.add(model);
      return model;
    });
    // This display/query world has no dynamic gameplay authority. Stepping its
    // kinematic proxies refreshes Rapier sweeps/queries, never scores or impulses.
    this.collisionProxies = new RemoteCollisionProxies(this.simulation.cars);
    this.simulation.cars.forEach((car) =>
      this.collisionProxies.move(
        car,
        initial.cars.find((c) => c.id === car.id)!,
        initial.reset,
      ),
    );
    this.simulation.ball.setBodyType(
      RAPIER.RigidBodyType.KinematicPositionBased,
      true,
    );
    this.simulation.ball.setTranslation(initial.ball.position, true);
    this.simulation.ball.setRotation(initial.ball.rotation, true);
    this.effects = this.cars.map(
      (car, i) =>
        new VehicleEffects(
          car,
          this.group,
          players[i].preset.boost === "ember" ? 0xffa548 : 0x69e9ff,
          players[i].preset.boost,
        ),
    );
    this.explosion = new GoalExplosion(this.group);
    this.explosion.setStyle(players[0].preset.explosion);
    this.ballTrails = new BallTrails(this.group);
    this.flips = players.map(() => new FlipTrails(this.group));
    this.jumps = players.map(() => new JumpBurst(this.group));
    this.skids = players.map(() => new SkidMarks(this.group));
    this.demos = players.map(() => new DemolitionFlash(this.group));
    this.rumbleEffects = new RumbleEffects(this.group, onPowerSound);
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
        rumble: this.rumbleEffects,
      },
    );
    this.match.mode = "network";
    this.labels = document.createElement("div");
    this.labels.id = "network-labels";
    for (const player of players) {
      const label = document.createElement("span");
      label.className = "network-name";
      label.dataset.player = player.id;
      label.textContent = displayIdentity(player);
      label.dataset.team = String(player.team);
      this.labels.append(label);
      this.labelsById.set(player.id, label);
    }
    document.getElementById("app")!.append(this.labels);
  }
  update(
    client: NetworkClient,
    dt: number,
    time: number,
    settings: CameraSettings,
    quality: Quality = "high",
    input?: Input,
  ) {
    this.ballTrails.quality = quality;
    const proxyNow = performance.now(),
      proxyDelta = (proxyNow - this.proxyAt) / 1000;
    this.proxyAt = proxyNow;
    client.metrics.frame();
    const sample = client.sample();
    if (!sample || !client.latest) return;
    const remoteSample = client.sampleRemote() ?? sample;
    const { older, newer } = sample,
      latest = client.latest;
    const remoteState = (id: string, behind = 0) =>
      this.remoteCars.sample(
        id,
        latest,
        client.remoteBuffer.sampleAt(remoteSample.time - behind) ??
          remoteSample,
      );
    this.prediction?.setRemoteTimeline(remoteState);
    const predicted = this.prediction?.update(
      latest,
      client.playerInput,
      client.inputSequence,
      dt,
      Math.max(0, (performance.now() - client.arrived) / 1000),
      (input) => client.recordInputTick(input),
    );
    if (this.prediction) {
      client.metrics.correctionDistance = this.prediction.correctionDistance;
      client.metrics.correctionRotation = this.prediction.correctionRotation;
      client.metrics.hardCorrections = this.prediction.hardCorrections;
    }
    if (this.networkDebug && performance.now() > this.debugAt) {
      this.debugAt = performance.now() + 250;
      const d = client.diagnostics(),
        number = (v: number | null) => (v == null ? "--" : v.toFixed(1));
      this.networkDebug.textContent = [
        "RTT / PING  " + number(d.roundTripMs) + " ms",
        "SEND  " +
          number(d.snapshotSendHz || d.inputSendHz) +
          " Hz    RECEIVE  " +
          number(d.snapshotReceiveHz) +
          " Hz",
        "PHYSICS  " +
          d.physicsTickHz +
          " Hz    RENDER  " +
          number(d.renderFPS) +
          " FPS",
        "INTERPOLATION  " +
          d.interpolationDelayMs +
          " ms    BUFFER  " +
          d.bufferLength,
        "MAX EXTRAPOLATION  " + d.extrapolationLimitMs + " ms",
        "DROPPED  " +
          (d.droppedPackets + d.artificialDrops) +
          "    OUT OF ORDER  " +
          d.outOfOrderPackets,
        "DUPLICATES  " + d.duplicatePackets,
        "CORRECTION  " +
          number(d.correctionDistance) +
          " m / " +
          number((d.correctionRotationRadians * 180) / Math.PI) +
          " deg",
        "GAMEPLAY  " +
          number(d.gameplaySendBytesPerSecond / 1024) +
          " / " +
          number(d.gameplayReceiveBytesPerSecond / 1024) +
          " KiB/s OUT / IN",
      ].join("\n");
    }
    if (latest.dropshot && this.simulation.dropshot) {
      this.dropshotView.apply(latest.dropshot);
      const key = this.dropshotView.epoch + ":" + this.dropshotView.revision;
      if (key !== this.dropshotRevision) {
        this.dropshotRevision = key;
        this.simulation.dropshot.states = this.dropshotView.tiles
          .split("")
          .map((v) => Number(v) as 0 | 1 | 2);
        this.simulation.dropshot.epoch = this.dropshotView.epoch;
        this.simulation.dropshot.revision = this.dropshotView.revision;
        this.simulation.dropshot.arena.tiles.forEach((c, i) =>
          c.setEnabled(this.dropshotView.tiles[i] !== "2"),
        );
        refreshStaticQueries(this.simulation);
      }
    }
    this.match.kickoffFormationId = latest.kickoffFormationId;
    if (this.reset !== latest.reset) {
      this.collisionProxies.clear();
      this.proxyLoop.accumulator = 0;
      this.camera.reset();
      this.spectator?.rig.reset();
      this.explosion.reset();
      this.effects.forEach((e) => e.reset());
      this.ballTrails.reset();
      this.rumbleEffects.reset();
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
      if (this.spectator) this.spectator.ui.hidden = true;
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
      this.collisionProxies.clear();
      this.proxyLoop.accumulator = 0;
      this.camera.reset();
      this.spectator?.resume();
    }
    this.replayPads = null;
    this.labels.hidden = false;
    if (latest.phase === "goal" && this.phase !== "goal" && latest.goalFocus)
      this.explosion.trigger(
        new T.Vector3().copy(latest.goalFocus),
        latest.goalFocus.z < 0 ? 0x69e9ff : 0xffb654,
        latest.lastGoal?.explosion ??
          latest.players.find((p) => p.id === latest.lastGoal?.scorerId)?.preset
            .explosion ??
          "pulse",
      );
    this.phase = latest.phase;
    const states = this.simulation.cars.map((car) =>
      predicted && car.id === this.localId ? predicted : remoteState(car.id),
    );
    const ballSample = client.buffer.sampleAt(remoteSample.time) ?? sample;
    const ballPose = this.ballCorrection.sample(latest, ballSample);
    if (this.prediction && latest.ball.enabled)
      this.ballCorrection.blendSmallPrediction(
        ballPose,
        this.prediction.ballFrame,
        this.prediction.interactionBlend,
      );
    this.simulation.ball.setEnabled(latest.ball.enabled);
    this.proxyLoop.advance(proxyDelta, () => {
      const behind = Math.max(0, this.proxyLoop.accumulator - P.dt);
      this.simulation.cars.forEach((car) => {
        const state =
          predicted && car.id === this.localId
            ? predicted
            : remoteState(car.id, behind);
        this.collisionProxies.move(car, state, latest.reset);
      });
      const fixedBall = this.ballCorrection.sample(
        latest,
        client.buffer.sampleAt(remoteSample.time - behind) ?? ballSample,
      );
      if (this.prediction && latest.ball.enabled)
        this.ballCorrection.blendSmallPrediction(
          fixedBall,
          this.prediction.ballFrame,
          this.prediction.interactionBlend,
        );
      this.simulation.ball.setNextKinematicTranslation(fixedBall.position);
      this.simulation.ball.setNextKinematicRotation(fixedBall.rotation);
      this.simulation.world.step();
      this.proxySteps++;
    });
    this.simulation.cars.forEach((car, i) => {
      const model = this.cars[i];
      const b = states[i];
      if (model.visible && !b.enabled)
        this.demos[i].trigger(new T.Vector3().copy(b.position));
      if (!model.visible && b.enabled && i === 0) this.camera.reset();
      model.position.copy(b.position);
      model.quaternion.copy(b.rotation).normalize();
      model.visible = b.enabled;
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
      car.flipResetSequence = b.flipReset?.sequence ?? 0;
      car.flipResetAge = b.flipReset?.age ?? Infinity;
      if (b.flipReset) {
        car.flipResetOrigin.copy(b.flipReset.origin);
        car.flipResetNormal.copy(b.flipReset.normal);
      }
      car.normalJumpSequence = b.normalJump?.sequence ?? 0;
      car.normalJumpAge = b.normalJump?.age ?? Infinity;
      if (b.normalJump) {
        car.normalJumpOrigin.copy(b.normalJump.origin);
        car.normalJumpNormal.copy(b.normalJump.normal);
      }
      car.forward.set(0, 0, -1).applyQuaternion(model.quaternion);
      car.right.set(1, 0, 0).applyQuaternion(model.quaternion);
      car.up.set(0, 1, 0).applyQuaternion(model.quaternion);
      car.wheelHits.forEach((point, j) => point.copy(b.wheelHits[j]));
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
    this.ball.position.copy(ballPose.position);
    this.ball.quaternion.copy(ballPose.rotation).normalize();
    this.ball.visible = latest.ball.enabled;
    this.simulation.ball.setEnabled(latest.ball.enabled);
    this.simulation.ball.setLinvel(ballPose.velocity, true);
    this.simulation.ball.setAngvel(ballPose.angularVelocity, true);
    animateBall(this.ball, time);
    heatseekerBall(this.ball, latest.heatseeker, dt);
    dropshotBall(this.ball, latest.dropshot, time);
    const ballSpeed =
      new T.Vector3()
        .copy(newer.ball.position)
        .distanceTo(older.ball.position) /
      Math.max(0.001, newer.time - older.time);
    this.ballTrails.updateBall(
      this.ball,
      ballSpeed,
      latest.heatseeker?.active
        ? latest.heatseeker.ownerTeam
        : latest.touchTeam,
      dt,
      newer.ball.enabled,
      this.camera.camera.position,
      heatIntensity(latest.heatseeker),
      latest.heatseeker,
      latest.dropshot,
    );
    this.explosion.update(dt);
    this.ballHeight.update(this.ball, this.simulation);
    Object.assign(this.match, {
      gameMode: latest.gameMode ?? "soccar",
      phase: latest.phase,
      score: latest.score,
      remaining: latest.remaining,
      countdown: latest.countdown,
      goTime: latest.goTime,
      overtime: latest.overtime,
      message: latest.message,
      goalFocus: latest.goalFocus,
    });
    this.rumbleEffects.update(
      latest.rumble,
      (id) => this.cars[this.simulation.cars.findIndex((c) => c.id === id)],
      this.ball,
      this.camera.camera,
      dt,
      latest.time,
    );
    this.camera.settings = settings;
    this.camera.camera.clearViewOffset();
    if (
      !latest.players.some((p) => p.id === this.localId) &&
      input &&
      this.camera.mouseLook
    ) {
      this.spectator ??= new SpectatorCamera(
        this.camera.camera,
        this.camera.mouseLook,
      );
      this.spectator.update(
        this.cars,
        this.ball,
        this.simulation,
        input,
        dt,
        time,
        settings,
        latest.phase !== "finished" && input.gameplayEnabled && !input.blocked,
      );
    } else
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
    this.updateLabels();
  }
  private updateLabels() {
    this.cars.forEach((model, i) => {
      const point = model.position
          .clone()
          .add(new T.Vector3(0, 1.2, 0))
          .project(this.camera.camera),
        label = this.labelsById.get(this.simulation.cars[i].id)!;
      label.hidden =
        this.simulation.cars[i].id === this.localId ||
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
    this.prediction?.dispose();
    this.networkDebug?.remove();
    this.spectator?.dispose();
    this.rumbleEffects.dispose();
    this.effects.forEach((e) => e.dispose());
    this.explosion.dispose();
    this.group.removeFromParent();
    disposeModel(this.group);
    this.labels.remove();
    this.labelsById.clear();
    this.simulation.dispose();
  }
}
