import { TrainingPowerArrow } from "./power-arrow";
import { GoalExplosion } from "../../effects/goal-explosion";
import { EditorInteraction } from "./editor-interaction";
import { validatePlayablePack } from "../../../shared/custom-training";
import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type {
  ExtraSession,
  ExtraSessionOptions,
  ExtraReadout,
} from "../session";
import type { PlayerInput } from "../../../shared/player";
import type { CameraSettings } from "../../game/settings";
import type { CustomTrainingPack } from "../../../shared/custom-training";
import { TrainingDraft, plainVector } from "../../game/custom-training-editor";
import { Simulation } from "../../physics/simulation";
import { FixedLoop } from "../../physics/loop";
import { GameCamera } from "../../camera/camera";
import { carModel, ballModel, animateWheels } from "../../render/models";
import { drawArena } from "../../render/arena";
import { disposeDribbleResources } from "../dribble/view";
import { VehicleEffects } from "../../effects/vehicle-effects";
import { predictBallTrajectory } from "../../game/ball-prediction";
import { P } from "../../config/physics";
import { CustomTrainingRun, constrainTrainingPosition } from "./custom-run";
export class CustomTrainingSession implements ExtraSession {
  readonly id = "custom-training";
  readonly replayActive = false;
  readonly replayClip = null;
  readonly replayState = null;
  readonly replayPlayers = [];
  readonly blocksProgression = true;
  readonly scene = new T.Scene();
  readonly physics: Simulation;
  readonly run: CustomTrainingRun;
  readonly draft: TrainingDraft;
  readonly car = new T.Group();
  private selectedOutline = new T.LineSegments(
    new T.EdgesGeometry(new T.BoxGeometry(1.4, 1.05, 1.95)),
    new T.LineBasicMaterial({ color: 0x82ffc2, depthTest: false }),
  );
  readonly ball = ballModel();
  readonly model: T.Group;
  readonly cameraControl: GameCamera;
  readonly loop = new FixedLoop();
  readonly launcher = new T.Group();
  readonly ballPowerArrow = new TrainingPowerArrow(
    P.ball.maxSpeed,
    2.8,
    15.2,
    0x51eaff,
  );
  readonly ballHandle = new T.Mesh(
    new T.SphereGeometry(0.4, 12, 10),
    new T.MeshBasicMaterial({ color: 0xa3f6ff, depthTest: false }),
  );
  readonly carHandle = new T.Mesh(
    new T.SphereGeometry(0.35, 12, 10),
    new T.MeshBasicMaterial({ color: 0xc0d0ff, depthTest: false }),
  );
  readonly interaction: EditorInteraction;
  advanced = false;
  locked = false;
  readonly aim = new T.Group();
  readonly carArrow = new T.ArrowHelper(
    new T.Vector3(0, 0, -1),
    new T.Vector3(),
    3,
    0x7dffbe,
  );
  readonly velocityArrow = new TrainingPowerArrow(
    P.car.maxSpeed,
    1.1,
    11.9,
    0x87aaff,
  );
  readonly dots: T.InstancedMesh;
  readonly orbit: OrbitControls;
  readonly transform: TransformControls;
  editing: boolean;
  paused = false;
  complete = false;
  selected: "ball" | "car" = "ball";
  tool: "move" | "rotate" | "aim" = "move";
  changed?: (fieldsOnly?: boolean) => void;
  requestExit?: () => void;
  private pending = true;
  private predictionWait = 0;
  private phase = 0;
  private points: T.Vector3[] = [];
  private lengths: number[] = [];
  private matrix = new T.Matrix4();
  private point = new T.Vector3();
  private color = new T.Color();
  private scale = new T.Vector3();
  private identity = new T.Quaternion();
  private effects: VehicleEffects;
  readonly goalExplosion: GoalExplosion;
  private goalShown = false;
  private oldCamera: {
    far: number;
    fov: number;
    position: T.Vector3;
    rotation: T.Quaternion;
  };
  constructor(
    private options: ExtraSessionOptions,
    pack: CustomTrainingPack,
    readonly editable: boolean,
  ) {
    this.editing = editable;
    this.draft = new TrainingDraft(
      editable ? pack : validatePlayablePack(pack),
    );
    this.physics = new Simulation(false, [
      {
        id: "custom-training-local",
        name: options.profile?.value.name ?? "Guest",
        team: 0,
        controller: "local",
      },
    ]);
    this.physics.cars[0].setBody(options.preset.body);
    this.run = new CustomTrainingRun(this.physics);
    drawArena(this.scene, "city");
    this.scene.add(new T.HemisphereLight(0xe1f3ff, 0x597483, 2.4));
    const light = new T.DirectionalLight(0xfff5dd, 3);
    light.position.set(20, 50, 20);
    this.scene.add(light);
    this.model = carModel(
      new T.Color(options.preset.blue).getHex(),
      options.preset.body,
      options.preset.wheels,
      options.preset.topper,
    );
    this.car.add(this.model, this.selectedOutline);
    this.selectedOutline.position.y = 0.12;
    this.scene.add(
      this.car,
      this.ball,
      this.launcher,
      this.aim,
      this.carArrow,
      this.velocityArrow,
      this.ballHandle,
      this.carHandle,
    );
    const base = new T.Mesh(
      new T.CylinderGeometry(0.7, 0.95, 0.16, 20),
      new T.MeshBasicMaterial({
        color: 0x44dfff,
        transparent: true,
        opacity: 0.7,
      }),
    );
    base.position.y = -P.ball.radius - 0.1;
    this.launcher.add(base);
    const ring = new T.Mesh(
      new T.TorusGeometry(P.ball.radius + 0.08, 0.04, 6, 48),
      new T.MeshBasicMaterial({ color: 0x44dfff, depthTest: false }),
    );
    ring.rotation.x = Math.PI / 2;
    this.launcher.add(ring);
    this.aim.add(this.ballPowerArrow);
    this.dots = new T.InstancedMesh(
      new T.SphereGeometry(0.19, 8, 6),
      new T.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
      }),
      80,
    );
    this.dots.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.dots.frustumCulled = false;
    this.dots.renderOrder = 8;
    this.scene.add(this.dots);
    this.oldCamera = {
      far: options.camera.far,
      fov: options.camera.fov,
      position: options.camera.position.clone(),
      rotation: options.camera.quaternion.clone(),
    };
    options.camera.far = 600;
    options.camera.clearViewOffset();
    options.camera.updateProjectionMatrix();
    this.cameraControl = new GameCamera(options.camera);
    this.cameraControl.mouseLook = options.mouseLook;
    this.orbit = new OrbitControls(options.camera, options.domElement!);
    this.orbit.enableDamping = true;
    this.orbit.minDistance = 3;
    this.orbit.maxDistance = 180;
    this.orbit.maxPolarAngle = Math.PI - 0.05;
    this.orbit.target.set(0, 3, 0);
    this.transform = new TransformControls(options.camera, options.domElement!);
    this.transform.setSize(0.85);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (event) => {
      if (event.value) this.draft.beginChange();
      else {
        this.draft.endChange();
        this.changed?.(true);
      }
      this.orbit.enabled =
        this.editing && !event.value && !this.locked && !this.paused;
    });
    this.transform.addEventListener("objectChange", () => {
      const shot = this.draft.shot;
      if (this.tool === "aim") {
        shot.ballLaunchDirection = plainVector(
          new T.Vector3(0, 1, 0)
            .applyQuaternion(this.aim.quaternion)
            .normalize(),
        );
      } else if (this.selected === "ball")
        shot.ballPosition = plainVector(
          constrainTrainingPosition(
            this.physics,
            this.ball.position.clone(),
            true,
          ),
        );
      else {
        shot.carPosition = plainVector(
          constrainTrainingPosition(
            this.physics,
            this.car.position.clone(),
            false,
            this.car.quaternion,
          ),
        );
        shot.carRotation = {
          x: this.car.quaternion.x,
          y: this.car.quaternion.y,
          z: this.car.quaternion.z,
          w: this.car.quaternion.w,
        };
      }
      this.commit();
    });
    this.goalExplosion = new GoalExplosion(this.scene);
    this.goalExplosion.setStyle(options.preset.explosion);
    this.effects = new VehicleEffects(
      this.car,
      this.scene,
      0x69e9ff,
      options.preset.boost,
    );
    this.interaction = new EditorInteraction(
      this,
      options.domElement!,
      options.camera,
    );
    this.load();
    if (this.editing) this.editorCamera();
    else this.play();
  }
  get vehicle() {
    return this.physics.cars[0];
  }
  get resetSequence() {
    return this.run.resetSequence;
  }
  get supportsBallCam() {
    return !this.editing;
  }
  private editorCamera() {
    const ball = new T.Vector3().copy(this.draft.shot.ballPosition);
    const car = new T.Vector3().copy(this.draft.shot.carPosition);
    const target = ball.clone().lerp(car, 0.5);
    const scale = Math.max(1, ball.distanceTo(car) / 20);
    this.options.camera.position
      .copy(target)
      .add(new T.Vector3(18, 16, 24).multiplyScalar(scale));
    this.orbit.target.copy(target);
    this.orbit.update();
  }
  commit() {
    this.constrain();
    this.draft.changed();
    this.load();
    this.changed?.(true);
  }
  constrain() {
    const s = this.draft.shot;
    s.ballPosition = plainVector(
      constrainTrainingPosition(
        this.physics,
        new T.Vector3().copy(s.ballPosition),
        true,
      ),
    );
    s.carPosition = plainVector(
      constrainTrainingPosition(
        this.physics,
        new T.Vector3().copy(s.carPosition),
        false,
        new T.Quaternion().copy(s.carRotation),
      ),
    );
  }
  load() {
    this.goalExplosion?.reset();
    this.goalShown = false;
    this.ball.visible = true;
    this.options.clearInput?.();
    this.run.reset(this.draft.shot);
    this.loop.accumulator = 0;
    this.cameraControl.reset();
    this.effects?.reset();
    this.options.mouseLook?.reset();
    this.pending = true;
    this.refreshObjects();
    if (!this.transform.dragging) this.attach();
  }
  private refreshObjects() {
    const shot = this.draft.shot;
    this.car.position.copy(shot.carPosition);
    this.car.quaternion.copy(shot.carRotation);
    this.ball.position.copy(shot.ballPosition);
    this.launcher.position.copy(shot.ballPosition);
    this.aim.position.copy(shot.ballPosition);
    this.aim.quaternion.setFromUnitVectors(
      new T.Vector3(0, 1, 0),
      new T.Vector3().copy(shot.ballLaunchDirection),
    );
    this.carArrow.position.copy(shot.carPosition);
    this.ballPowerArrow.setPower(shot.ballLaunchSpeed);
    this.ballHandle.material.color.copy(
      this.ballPowerArrow.shaft.material.color,
    );
    this.ballHandle.position
      .copy(shot.ballPosition)
      .addScaledVector(
        new T.Vector3().copy(shot.ballLaunchDirection),
        this.ballPowerArrow.length,
      );
    this.carArrow.setLength(2.6, 0.6, 0.45);
    this.carArrow.setDirection(
      new T.Vector3(0, 0, -1).applyQuaternion(this.car.quaternion),
    );
    const v = new T.Vector3().copy(shot.carVelocity);
    this.velocityArrow.position.copy(shot.carPosition);
    this.velocityArrow.setDirection(
      v.lengthSq() ? v.clone().normalize() : new T.Vector3(0, 0, -1),
    );
    const direction = v.lengthSq()
      ? v.clone().normalize()
      : new T.Vector3(0, 0, -1).applyQuaternion(this.car.quaternion);
    this.velocityArrow.setPower(v.length());
    this.carHandle.material.color.copy(this.velocityArrow.shaft.material.color);
    const length = this.velocityArrow.length;
    this.velocityArrow.setDirection(direction);

    this.carHandle.position
      .copy(shot.carPosition)
      .addScaledVector(direction, length);
  }
  selectObject(
    selected: "ball" | "car",
    tool: "move" | "rotate" | "aim" = "move",
  ) {
    if (this.selected !== selected) this.advanced = false;
    this.selected = selected;
    this.tool = tool;
    this.attach();
    this.changed?.();
  }
  focusSelected() {
    const target =
      this.selected === "ball"
        ? this.draft.shot.ballPosition
        : this.draft.shot.carPosition;
    const offset = this.options.camera.position.clone().sub(this.orbit.target);
    this.orbit.target.copy(target);
    this.options.camera.position.copy(target).add(offset);
    this.orbit.update();
  }
  private attach() {
    this.selectedOutline.visible = this.editing && this.selected === "car";
    this.transform.detach();
    const advanced =
      this.editing && this.advanced && !this.locked && !this.paused;
    this.transform.enabled = advanced;
    this.transform.getHelper().visible = advanced;
    this.orbit.enabled =
      this.editing &&
      !this.locked &&
      !this.paused &&
      !this.interaction?.dragging;
    if (advanced) {
      this.transform.setMode(this.tool === "move" ? "translate" : "rotate");
      this.transform.attach(
        this.tool === "aim"
          ? this.aim
          : this.selected === "ball"
            ? this.ball
            : this.car,
      );
    }
    this.launcher.visible = false;
    this.aim.visible =
      this.carArrow.visible =
      this.velocityArrow.visible =
      this.dots.visible =
      this.ballHandle.visible =
      this.carHandle.visible =
        this.editing;
  }
  play() {
    if (!this.draft.shot.enabled)
      throw new Error("Enable this shot to test it.");
    this.interaction.finish();
    this.draft.endChange();
    this.constrain();
    this.editing = false;
    this.paused = false;
    this.complete = false;
    this.load();
    this.changed?.();
  }
  edit() {
    if (!this.editable) return;
    this.editing = true;
    this.paused = false;
    this.load();
    this.editorCamera();
    this.changed?.();
  }
  reset() {
    this.complete = false;
    this.paused = false;
    this.load();
    this.changed?.();
  }
  pause() {
    if (!this.editing) {
      this.paused = !this.paused;
      this.loop.accumulator = 0;
      this.changed?.();
    }
  }
  toggleCamera() {
    if (!this.editing)
      this.cameraControl.ballMode = !this.cameraControl.ballMode;
  }
  selectShot(index: number) {
    if (!this.editing && !this.draft.pack.shots[index]?.enabled) return false;
    this.interaction.finish();
    if (!this.draft.select(index)) return false;
    this.complete = false;
    this.load();
    this.changed?.();
    return true;
  }
  navigate(delta: number) {
    const indices = this.draft.pack.shots.flatMap((shot, index) =>
      this.editing || shot.enabled ? [index] : [],
    );
    const at = indices.indexOf(this.draft.index),
      next = indices[at + delta];
    return next === undefined ? false : this.selectShot(next);
  }
  setAdvanced(enabled: boolean) {
    this.advanced = enabled;
    this.attach();
    this.changed?.();
  }
  setLocked(locked: boolean) {
    if (locked) {
      this.interaction.finish();
      if (this.transform.dragging) this.transform.dragging = false;
      this.draft.endChange();
    }
    this.locked = locked;
    this.attach();
  }
  clearInput() {
    this.options.clearInput?.();
  }
  beginGesture() {
    this.draft.beginChange();
  }
  endGesture() {
    this.draft.endChange();
    this.attach();
    this.changed?.(true);
  }
  directMove(kind: "ball" | "car", position: T.Vector3) {
    if (kind === "ball") this.draft.shot.ballPosition = plainVector(position);
    else this.draft.shot.carPosition = plainVector(position);
    this.commit();
  }
  directArrow(kind: "ball" | "car", tip: T.Vector3) {
    const shot = this.draft.shot,
      origin = kind === "ball" ? shot.ballPosition : shot.carPosition;
    const vector = tip.clone().sub(origin),
      length = vector.length();
    if (kind === "ball") {
      if (length > 0.00001)
        shot.ballLaunchDirection = plainVector(vector.normalize());
      shot.ballLaunchSpeed = T.MathUtils.clamp(
        this.ballPowerArrow.speedAtLength(length),
        0,
        P.ball.maxSpeed,
      );
    } else {
      const speed = T.MathUtils.clamp(
        this.velocityArrow.speedAtLength(length),
        0,
        P.car.maxSpeed,
      );
      shot.carVelocity = plainVector(
        length > 0.00001
          ? vector.normalize().multiplyScalar(speed)
          : new T.Vector3(),
      );
    }
    this.commit();
  }
  history(redo = false) {
    if (!(redo ? this.draft.redo() : this.draft.undo())) return;
    this.load();
    this.changed?.();
  }
  private predict() {
    const shot = this.draft.shot;
    const result = predictBallTrajectory(
      {
        position: shot.ballPosition,
        velocity: {
          x: shot.ballLaunchDirection.x * shot.ballLaunchSpeed,
          y: shot.ballLaunchDirection.y * shot.ballLaunchSpeed,
          z: shot.ballLaunchDirection.z * shot.ballLaunchSpeed,
        },
        heat: null,
      },
      this.physics.world,
      5,
    );
    this.points = result.samples.map((p) => p.position);
    this.lengths = [0];
    for (let i = 1; i < this.points.length; i++)
      this.lengths.push(
        this.lengths[i - 1] + this.points[i].distanceTo(this.points[i - 1]),
      );
    this.pending = false;
  }
  private animateDots(dt: number) {
    const length = this.lengths[this.lengths.length - 1] ?? 0,
      spacing = 1.8;
    this.phase = (this.phase + this.draft.shot.ballLaunchSpeed * dt) % spacing;
    let segment = 1,
      count = 0;
    for (let i = 0; i < 80; i++) {
      const d = i * spacing + this.phase;
      if (d >= length) break;
      while (segment < this.lengths.length - 1 && this.lengths[segment] < d)
        segment++;
      const f =
        (d - this.lengths[segment - 1]) /
        Math.max(0.00001, this.lengths[segment] - this.lengths[segment - 1]);
      this.point.lerpVectors(this.points[segment - 1], this.points[segment], f);
      this.scale.setScalar(1 - (0.55 * d) / Math.max(1, length));
      this.matrix.compose(this.point, this.identity, this.scale);
      this.dots.setMatrixAt(i, this.matrix);
      this.color
        .setRGB(0.25, 0.9, 1)
        .multiplyScalar(1 - (0.6 * d) / Math.max(1, length));
      this.dots.setColorAt(i, this.color);
      count++;
    }
    this.dots.count = count;
    this.dots.instanceMatrix.needsUpdate = true;
    if (this.dots.instanceColor) this.dots.instanceColor.needsUpdate = true;
  }
  get goalCelebrating() {
    return !this.editing && this.run.result === "GOAL" && !this.complete;
  }
  skipGoal() {
    if (!this.goalCelebrating) return false;
    this.finishShot();
    return true;
  }
  private finishShot() {
    this.goalExplosion.reset();
    if (!this.navigate(1)) {
      this.complete = true;
      this.changed?.();
    }
  }
  readout(): ExtraReadout {
    return {
      phase: this.paused
        ? "paused"
        : this.complete
          ? "complete"
          : this.editing
            ? "ready"
            : "running",
      progress: this.editing
        ? this.draft.index + 1
        : this.draft.pack.shots
            .slice(0, this.draft.index + 1)
            .filter((s) => s.enabled).length,
      total: this.editing
        ? this.draft.pack.shots.length
        : this.draft.pack.shots.filter((s) => s.enabled).length,
      bestProgress: 0,
      bestTime: null,
      elapsed: this.run.elapsed,
      message: this.run.result === "GOAL" ? "" : this.run.result,
      packName: this.draft.pack.name,
    };
  }
  frame(
    input: PlayerInput,
    dt: number,
    _now: number,
    settings: CameraSettings,
  ) {
    if (this.editing) {
      this.predictionWait -= dt;
      if (this.pending && this.predictionWait <= 0) {
        this.predict();
        this.predictionWait = 0.05;
      }
      this.animateDots(dt);
      if (
        !this.paused &&
        !this.locked &&
        !this.interaction.dragging &&
        !this.transform.dragging
      )
        this.orbit.update();
      return;
    }
    if (!this.paused && !this.complete)
      this.loop.advance(dt, () => this.run.step(input, this.draft.shot));
    if (this.goalCelebrating && !this.goalShown && this.run.goalPosition) {
      this.goalShown = true;
      this.goalExplosion.trigger(
        this.run.goalPosition,
        0x69e9ff,
        this.options.preset.explosion,
      );
      this.changed?.();
    }
    this.goalExplosion.update(this.paused || this.complete ? 0 : dt);
    this.ball.visible = this.physics.ball.isEnabled();
    this.vehicle.pose.render(this.car, 1);
    this.physics.ballPose.render(this.ball, 1);
    animateWheels(
      this.model,
      this.vehicle.forwardSpeed,
      this.vehicle.steerAngle,
      this.paused ? 0 : dt,
      this.vehicle,
      this.car,
    );
    this.cameraControl.settings = settings;
    this.cameraControl.update(
      this.car,
      this.ball,
      this.physics,
      dt,
      false,
      _now / 1000,
    );
    this.effects.update(
      this.vehicle,
      this.paused ? 0 : dt,
      _now / 1000,
      !this.paused && !this.complete,
    );
    if (
      !this.complete &&
      !this.paused &&
      this.run.result &&
      (this.run.result === "GOAL"
        ? !this.goalExplosion.active
        : this.run.delay >= 1.2)
    )
      this.finishShot();
  }
  dispose() {
    this.interaction.dispose();
    this.transform.dispose();
    this.orbit.dispose();
    this.effects.dispose();
    this.goalExplosion.dispose();
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
