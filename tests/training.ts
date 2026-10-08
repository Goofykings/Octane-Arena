import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { initializeSimulation, Simulation } from "../src/physics/simulation";
import { TrainingRun } from "../src/extra/training/run";
import { trainingPacks } from "../src/extra/training/packs";
import { neutralInput } from "../shared/player";
import { predictGoal } from "../src/game/ball-prediction";
import { scoringTeam } from "../src/game/goals";
import { P } from "../src/config/physics";
import { trainingLaunchPreview } from "../src/extra/training/preview";
await initializeSimulation();
const n = neutralInput();
function begin(run:TrainingRun){
  const s=run.simulation,car=JSON.stringify({p:s.cars[0].body.translation(),q:s.cars[0].body.rotation()}),ball=JSON.stringify(s.ball.translation()),clock=s.clock;
  const arrow=trainingLaunchPreview(run.shot);
  assert.equal(arrow.visible,!run.shot.ballFrozen&&new Vector3().copy(run.shot.ballVelocity).length()>0);
  if(arrow.visible)assert.ok(arrow.direction.angleTo(new Vector3().copy(run.shot.ballVelocity))<1e-7);
  for(let i=0;i<359;i++)run.step({...n,throttle:1,steer:1,boost:true,jump:true});
  assert.ok(run.countdown>0);assert.equal(run.elapsed,0);assert.equal(s.clock,clock);
  assert.equal(JSON.stringify({p:s.cars[0].body.translation(),q:s.cars[0].body.rotation()}),car);
  assert.equal(JSON.stringify(s.ball.translation()),ball);
  assert.ok(new Vector3().copy(s.ball.linvel()).length()<1e-8);
  run.step(n);assert.equal(run.countdown,0);assert.equal(run.elapsed,0);assert.equal(run.goTime,0.7);
  assert.ok(new Vector3().copy(s.ball.linvel()).distanceTo(run.shot.ballVelocity)<1e-5);
}
const map = new Map<string, string>();
const storage = {
  getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => {
    map.set(k, v);
  },
};
assert.deepEqual(
  trainingPacks.map((p) => p.id),
  ["striker", "goalie", "aerial"],
);
for (const pack of trainingPacks) {
  const s = new Simulation(false, [
    { id: "practice", name: "Guest", team: 0, controller: "local" },
  ]);
  try {
    const run = new TrainingRun(s, pack, storage);
    assert.equal(pack.shots.length, 10);
    for (let index = 0; index < 10; index++) {
      run.index = index;
      run.reset();
      assert.equal(s.cars.length, 1);
      assert.ok(
        new Vector3()
          .copy(s.ball.translation())
          .distanceTo(pack.shots[index].ballSpawn) < 0.00001,
      );
      assert.equal(s.heatseeker, null);
      begin(run);
      const first = new Vector3().copy(s.ball.translation());
      if (run.frozen) {
        for (let i = 0; i < 240; i++) run.step(n);
        assert.ok(
          first.distanceTo(s.ball.translation()) < 0.00001,
          "Frozen ball stays exactly still before contact",
        );
        const b = s.ball.translation();
        s.cars[0].reset(b.x, b.z + 2.5, 0, b.y);
        s.cars[0].body.setLinvel({ x: 0, y: 0, z: -8 }, true);
        for (let i = 0; i < 90 && run.frozen; i++) run.step(n);
        assert.equal(
          run.frozen,
          false,
          `Aerial ${index + 1}: actual car contact releases ball`,
        );
        assert.equal(s.ball.gravityScale(), 1);
        assert.ok(
          new Vector3().copy(s.ball.linvel()).length() > 1,
          "Contact impulse retained instead of scripted velocity",
        );
      } else if (pack.type === "aerial") {
        for (let i = 0; i < 60; i++) run.step(n);
        assert.ok(
          s.ball.translation().y > first.y + 0.8,
          "Later aerial balls really rise under normal physics",
        );
        for (let i = 0; i < 180; i++) run.step(n);
        assert.ok(
          s.ball.linvel().y < 0 || s.ball.translation().y < first.y + 0.5,
          "Normal gravity brings moving aerial down",
        );
      }
      run.reset();
      assert.equal(run.elapsed, 0);
      assert.equal(run.outcome, null);
      begin(run);
      if (pack.type === "goalie") {
        assert.equal(
          predictGoal(
            {
              position: s.ball.translation(),
              velocity: s.ball.linvel(),
              heat: null,
            },
            s.world,
            4,
          )?.team,
          0,
          `Goalie ${index + 1}: real serve threatens defended goal`,
        );
        s.cars[0].body.setEnabled(false);
        for (let i = 0; i < 1800 && !run.outcome; i++) run.step(n);
        assert.equal(run.outcome, "FAILED");
        assert.equal(
          scoringTeam(s.ball.translation()),
          1,
          `Goalie ${index + 1}: untreated serve actually scores`,
        );
        s.cars[0].body.setEnabled(true);
        run.reset();begin(run);
        // Isolate real physical save classification with an intercept fixture,
        // including elevated shots. No fake touch events or ball impulses.
        const b = s.ball.translation();
        s.cars[0].reset(b.x, b.z + 2.5, 0, b.y);
        s.cars[0].body.setLinvel({ x: 0, y: 0, z: -10 }, true);
        let contact=false;
        for (let i = 0; i < 400 && !run.outcome; i++) {run.step(n);if(s.statTouches.length){contact=true;assert.equal(run.outcome,null,"Save does not complete at contact");assert.equal(s.ball.isEnabled(),true);}}
        assert.ok(contact);
        assert.equal(
          run.outcome,
          "SUCCESS",
          `Goalie ${index + 1}: meaningful real collision redirects threat`,
        );
      } else {
        s.ball.setGravityScale(1, true);
        run.frozen = false;
        s.ball.setTranslation(
          { x: 0, y: 2, z: -P.arena.halfLength - 0.9 },
          true,
        );
        s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
        run.step(n);
        assert.equal(run.outcome, "SUCCESS", "Actual opponent goal succeeds");
      }
      if(run.replay){const index=run.index;const before=JSON.stringify({car:s.cars[0].body.translation(),ball:s.ball.translation(),clock:s.clock});run.advance(0.1);assert.equal(run.index,index);assert.equal(run.countdown,0);assert.equal(JSON.stringify({car:s.cars[0].body.translation(),ball:s.ball.translation(),clock:s.clock}),before);assert.ok(run.replay.clip.count>=2);if(index<9)run.skipReplay();}
    }
    if (pack.type === "striker") {
      if(run.replay)run.skipReplay();
      // All ten retuned shots are scoreable with ground controls. Some require
      // lining up behind the ball or choosing approach speed; no ball edits,
      // boost, jump or scripted impulses.
      for (let index = 0; index < 10; index++) {
        run.index = index;
        run.reset();begin(run);
        for (let i = 0; i < 4350 && !run.outcome; i++) {
          const car = s.cars[0],
            pos = car.body.translation(),
            ball = s.ball.translation();
          const forward = new Vector3(0, 0, -1).applyQuaternion(
            new Quaternion().copy(car.body.rotation()),
          );
          const goalDir=new Vector3(-ball.x,0,-P.arena.halfLength-ball.z).normalize();
          const relative=new Vector3(pos.x-ball.x,0,pos.z-ball.z);
          const aligned=-relative.dot(goalDir)>1&&Math.abs(relative.x*goalDir.z-relative.z*goalDir.x)<1.2&&forward.dot(goalDir)>.9;
          const target=new Vector3(ball.x,0,ball.z);
          const approach=index===4||index===5;
          if(approach&&!aligned)target.addScaledVector(goalDir,-4);
          const desired=Math.atan2(target.x-pos.x,-(target.z-pos.z)),heading=Math.atan2(forward.x,-forward.z);
          const error=Math.atan2(Math.sin(desired-heading),Math.cos(desired-heading));
          const throttle=approach?.4:index===7?.8:.65;
          run.step({...n,throttle:Math.abs(error)<1?throttle:.15,steer:Math.max(-1,Math.min(1,error*3))});
        }
        assert.equal(
          run.outcome,
          "SUCCESS",
          `Striker ${index + 1}: harder but scoreable ground-input shot`,
        );
        if(index<9)run.skipReplay();
      }
    }
    if(run.replay)run.skipReplay();else run.advance(1.3);
    assert.equal(run.complete, true);
    assert.equal(run.successes, 10);
    assert.equal(run.best, 10);
    assert.equal(map.get("octane-arena-training-last"), pack.id);
    assert.equal(run.navigate(-9), true);
    assert.equal(run.index, 0);
    assert.equal(run.complete, false);
    assert.equal(run.navigate(-1), false);
    assert.equal(run.navigate(9), true);
    run.reset();begin(run);
    run.elapsed = run.shot.timeLimit;
    run.step(n);
    assert.equal(run.outcome, "FAILED");
    run.paused = true;
    const time = run.elapsed;
    run.step(n);
    run.advance(10);
    assert.equal(run.elapsed, time);
    assert.equal(run.complete, false);
    run.paused = false;
    run.advance(1.3);
    assert.equal(run.complete, true);
    assert.equal(
      run.successes,
      8,
      "Retrying first and last shots clears their previous results",
    );
    assert.equal(run.best, 10);
    assert.equal(new TrainingRun(s, pack, storage).best, 10);
  } finally {
    s.dispose();
  }
}
console.log(
  "PASS 30 data-driven scenarios, 10 real goalie serves/goals/saves, 4 frozen contact releases, 6 upward aerial trajectories, scoring, timeout, resets, unrestricted navigation, results/persistence; shared physics unchanged",
);
