import { Vector3 } from "three";
import type { PlayerEntity } from "../../shared/player";
import {
  MATCH_POINTS,
  STAT_TUNING,
  type MatchStatEvent,
  type PlayerMatchStats,
  type StatKind,
} from "../../shared/match-stats";
import { predictGoal, type BallSample } from "./ball-prediction";
import type { Simulation } from "../physics/simulation";
export interface StatTouch {
  playerId: string;
  before: BallSample;
  after: BallSample;
  impulseSpeed?: number;
}
export class MatchStats {
  readonly players = new Map<string, PlayerMatchStats>();
  readonly events: MatchStatEvent[] = [];
  debug = false;
  private sequence = 0;
  private lastTick = -1;
  private goals = new Set<string>();
  private history: { playerId: string; team: number; time: number }[] = [];
  private saveTimes = new Map<number, number>();
  constructor(private roster: PlayerEntity[]) {
    roster.forEach((p) =>
      this.players.set(p.id, {
        playerId: p.id,
        score: 0,
        goals: 0,
        assists: 0,
        saves: 0,
        shots: 0,
        touches: 0,
        ping: null,
      }),
    );
  }
  private log(data: unknown) {
    if (this.debug) console.debug("[Octane match stats]", data);
  }
  private award(type: StatKind, playerId: string, time: number) {
    const player = this.roster.find((p) => p.id === playerId),
      stats = this.players.get(playerId);
    if (!player || !stats) return;
    const field = {
      BALL_TOUCH: "touches",
      GOAL: "goals",
      ASSIST: "assists",
      SAVE: "saves",
      SHOT: "shots",
    } as const;
    stats[field[type]]++;
    stats.score += MATCH_POINTS[type];
    const event: MatchStatEvent = {
      id: ++this.sequence,
      type,
      playerId,
      team: player.team,
      scoreAward: MATCH_POINTS[type],
      timestamp: time,
    };
    this.events.push(event);
    if (this.events.length > STAT_TUNING.eventHistory) this.events.shift();
    this.log(event);
  }
  touch(touch: StatTouch, s: Pick<Simulation, "world" | "clock">) {
    const player = this.roster.find((p) => p.id === touch.playerId);
    if (!player) return;
    const before = predictGoal(touch.before, s.world, STAT_TUNING.saveHorizon),
      after = predictGoal(
        touch.after,
        s.world,
        touch.after.heat?.active
          ? STAT_TUNING.heatPredictionHorizon
          : STAT_TUNING.predictionHorizon,
      );
    this.award("BALL_TOUCH", player.id, s.clock);
    this.history.push({
      playerId: player.id,
      team: player.team,
      time: s.clock,
    });
    if (this.history.length > STAT_TUNING.touchHistory) this.history.shift();
    this.log({ touch: player.id, before, after });
    if (after && after.team !== player.team)
      this.award("SHOT", player.id, s.clock);
    const changed =
      (new Vector3()
        .copy(touch.before.velocity)
        .distanceTo(touch.after.velocity) >=
        STAT_TUNING.materialVelocityChange &&
        (touch.impulseSpeed === undefined ||
          touch.impulseSpeed >= STAT_TUNING.materialVelocityChange)) ||
      (touch.after.heat?.active &&
        touch.before.heat?.targetTeam !== touch.after.heat.targetTeam);
    if (
      before?.team === player.team &&
      after?.team !== player.team &&
      changed &&
      this.saveTimes.get(player.team) !== s.clock
    ) {
      this.award("SAVE", player.id, s.clock);
      this.saveTimes.set(player.team, s.clock);
    }
  }
  observe(s: Simulation) {
    if (this.lastTick === s.clock) return;
    this.lastTick = s.clock;
    for (const touch of s.statTouches) this.touch(touch, s);
  }
  goal(
    goal: { id: string; scorerId: string; team: number; ownGoal: boolean },
    time: number,
  ) {
    if (this.goals.has(goal.id)) return;
    this.goals.add(goal.id);
    const scorer = this.roster.find((p) => p.id === goal.scorerId);
    if (!scorer || scorer.team !== goal.team) return;
    this.award("GOAL", scorer.id, time);
    let scoringIndex = -1;
    for (let i = this.history.length - 1; i >= 0; i--)
      if (this.history[i].playerId === scorer.id) {
        scoringIndex = i;
        break;
      }
    const scoringTouch = this.history[scoringIndex];
    if (scoringTouch) {
      const candidate = this.history
        .slice(0, scoringIndex)
        .reverse()
        .find(
          (t) =>
            t.team === goal.team &&
            t.playerId !== scorer.id &&
            t.time <= scoringTouch.time &&
            scoringTouch.time - t.time <= STAT_TUNING.assistWindow,
        );
      this.log({ scorer: scorer.id, assistCandidate: candidate ?? null });
      if (candidate) this.award("ASSIST", candidate.playerId, time);
    }
  }
  kickoff() {
    this.history = [];
    this.lastTick = -1;
    this.saveTimes.clear();
  }
  setPing(id: string, ping: number | null) {
    const stats = this.players.get(id);
    if (!stats) return;
    stats.ping =
      ping !== null && Number.isFinite(ping) && ping >= 0 && ping <= 60000
        ? Math.round(ping)
        : null;
  }
  snapshot() {
    return [...this.players.values()].map((p) => ({ ...p }));
  }
}
