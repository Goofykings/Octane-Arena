import { Vector3 } from "three";
import { Simulation } from "../../physics/simulation";
import { scoringTeam } from "../../game/goals";
import { predictGoal } from "../../game/ball-prediction";
import type { PlayerInput } from "../../../shared/player";
import type { RecordStorage } from "../storage";
import type { TrainingPack } from "./packs";
import { P } from "../../config/physics";
import { ReplayRecorder } from "../../replay/recorder";
import { ReplayClock, type ReplayClip } from "../../../shared/replay";
import { advanceKickoffCountdown, KICKOFF_GO_TIME } from "../../../shared/kickoff-countdown";
export const TRAINING_SAVE = {horizon: 5, debounce: 0.18, delay: 1} as const;
export class TrainingRun {
  readonly recorder = new ReplayRecorder();
  replay: {clip: ReplayClip; clock: ReplayClock} | null = null;
  countdown = 3;
  goTime = 0;
  saveCandidate = false;
  saveSafeTime = 0;
  saveDelay = 0;
  ballBurstSequence = 0;
  private predictionWait = 0;
  private threatened = true;
  index = 0;
  elapsed = 0;
  paused = false;
  complete = false;
  resetSequence = 0;
  outcomeSequence = 0;
  outcome: "SUCCESS" | "FAILED" | null = null;
  results: (boolean | null)[];
  frozen = false;
  private wait = 0;
  best = 0;
  constructor(
    readonly simulation: Simulation,
    readonly pack: TrainingPack,
    private storage?: RecordStorage,
  ) {
    this.results = pack.shots.map(() => null);
    try {
      const n = Number(storage?.getItem(`octane-arena-training-${pack.id}`));
      if (Number.isInteger(n) && n >= 0 && n <= pack.shots.length)
        this.best = n;
    } catch {
      /* Optional records. */
    }
    this.reset();
  }
  get shot() {
    return this.pack.shots[this.index];
  }
  get successes() {
    return this.results.filter((x) => x === true).length;
  }
  reset() {
    const s = this.simulation,
      shot = this.shot;
    s.reset();
    s.cars[0].reset(
      shot.playerSpawn.x,
      shot.playerSpawn.z,
      shot.playerSpawn.yaw,
    );
    s.cars[0].boost = 100;
    s.ball.setTranslation(shot.ballSpawn, true);
    s.ball.setLinvel({x:0,y:0,z:0}, true);
    s.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.frozen = shot.ballFrozen;
    // A dynamic ball with zero gravity/velocity stays still, yet its first
    // genuine rigid-body contact produces the normal physical impulse.
    s.ball.setGravityScale(this.frozen ? 0 : 1, true);
    s.cars[0].pose.snap();
    s.ballPose.snap();
    this.elapsed = 0;
    this.outcome = null;
    this.wait = 0;
    this.complete = false;
    this.paused = false;
    this.results[this.index] = null;
    this.countdown=3;this.goTime=0;this.replay=null;this.recorder.reset();
    this.saveCandidate=false;this.saveSafeTime=0;this.saveDelay=0;this.predictionWait=0;this.threatened=true;
    this.resetSequence++;
  }
  navigate(delta: number) {
    if(this.replay)return false;
    const next = this.index + delta;
    if (next < 0 || next >= this.pack.shots.length) return false;
    this.index = next;
    this.reset();
    return true;
  }
  private finish(success: boolean) {
    this.results[this.index] = success;
    this.outcome = success ? "SUCCESS" : "FAILED";
    this.outcomeSequence++;
    this.wait = 1.25;
  }
  advance(dt: number) {
    if(this.paused)return false;
    if(this.replay){
      this.replay.clock.advance(dt);
      if(!this.replay.clock.done)return false;
      this.replay=null;this.wait=0;
    }
    if (this.paused || !this.outcome || this.complete) return false;
    this.wait -= dt;
    if (this.wait > 0) return false;
    if (this.index < this.pack.shots.length - 1) {
      this.navigate(1);
      return true;
    }
    this.complete = true;
    this.best = Math.max(this.best, this.successes);
    try {
      this.storage?.setItem(
        `octane-arena-training-${this.pack.id}`,
        String(this.best),
      );
      this.storage?.setItem("octane-arena-training-last", this.pack.id);
    } catch {
      /* Practice works without storage. */
    }
    return false;
  }
  step(input: PlayerInput) {
    if (this.paused || this.outcome || this.complete || this.replay) return;
    const s = this.simulation;
    if(this.countdown>0){
      this.countdown=advanceKickoffCountdown(this.countdown,P.dt);
      if(this.countdown===0){
        s.ball.setLinvel(this.shot.ballVelocity,true);this.goTime=KICKOFF_GO_TIME;
        this.recorder.capture(s,this.resetSequence);
      }
      return;
    }
    this.goTime=Math.max(0,this.goTime-P.dt);
    if (this.frozen) {
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    s.cars[0].boost = 100;
    s.step([input]);
    this.recorder.capture(s,this.resetSequence);
    this.elapsed += P.dt;
    if (this.frozen && s.statTouches.some((t) => t.playerId === s.cars[0].id)) {
      this.frozen = false;
      s.ball.setGravityScale(1, true);
      // Keep the collision solver/contact model's velocity and spin intact.
    }
    const goal = scoringTeam(s.ball.translation());
    if (goal !== null) {
      this.finish(this.shot.successCondition === "opponent-goal" && goal === 0);
      if(this.outcome==="SUCCESS"){
        const car=s.cars[0],p=s.ball.translation();
        const clip=this.recorder.clip({id:`training:${this.pack.id}:${this.index}:${this.resetSequence}:${this.outcomeSequence}`,time:s.clock,scorerId:car.id,team:0,ownGoal:false,lastTouchId:s.lastTouchId,touchTime:Number.isFinite(s.lastTouchTime)?s.lastTouchTime:null,ballSpeed:new Vector3().copy(s.ball.linvel()).length(),focus:{x:p.x,y:p.y,z:-P.arena.halfLength}});
        this.replay={clip,clock:new ReplayClock(clip)};
      }
      return;
    }
    if (this.shot.successCondition === "save") {
      for (const touch of s.statTouches) {
        if (touch.playerId !== s.cars[0].id || (touch.impulseSpeed ?? 0) < 0.75)
          continue;
        const before = predictGoal(touch.before, s.world, TRAINING_SAVE.horizon);
        if (
          before?.team === 0 &&
          !this.saveCandidate
        ) {
          this.saveCandidate=true;this.predictionWait=0;
        }
      }
      if(this.saveCandidate){
        this.predictionWait-=P.dt;
        if(this.predictionWait<=0){
          this.threatened=predictGoal({position:s.ball.translation(),velocity:s.ball.linvel(),heat:null},s.world,TRAINING_SAVE.horizon)?.team===0;
          this.predictionWait=1/30;
        }
        if(this.threatened){this.saveSafeTime=0;this.saveDelay=0;}
        else {
          this.saveSafeTime+=P.dt;
          if(this.saveSafeTime>=TRAINING_SAVE.debounce)this.saveDelay+=P.dt;
          if(this.saveDelay>=TRAINING_SAVE.delay){this.ballBurstSequence++;s.ball.setEnabled(false);this.finish(true);return;}
        }
      }
    }
    if (
      this.elapsed >= this.shot.timeLimit ||
      !new Vector3().copy(s.ball.translation()).toArray().every(Number.isFinite)
    )
      this.finish(false);
  }
  skipReplay(){
    if(!this.replay||this.paused)return false;
    this.replay=null;this.wait=0;this.advance(0);return true;
  }
}
