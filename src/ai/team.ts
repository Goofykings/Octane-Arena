import type { Simulation } from "../physics/simulation";
import type { Pads } from "../game/pads";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type { BotDifficulty } from "../../shared/bots";
import { BotPerception, BOT_TUNING } from "./perception";
import { BotDecision, type BotTarget } from "./decision";
import { BotController } from "./controller";
export class BotTeam {
  readonly perception: BotPerception;
  readonly decision: BotDecision;
  readonly targets = new Map<string, BotTarget>();
  private controllers = new Map<string, BotController>();
  private next = new Map<string, number>();
  private result = new Map<string, PlayerInput>();
  private previous = -Infinity;
  private roster = "";
  constructor(readonly difficulty: BotDifficulty) {
    this.perception = new BotPerception(difficulty);
    this.decision = new BotDecision(difficulty);
  }
  prepare(s: Simulation, pads?: Pads) {
    const bots = s.players.filter((p) => p.controller === "bot");
    this.roster = bots.map((p) => p.id).join("|");
    this.controllers.clear();
    this.targets.clear();
    this.next.clear();
    this.result.clear();
    this.perception.prepare(s);
    this.decision.assign(s, this.perception);
    const period = 1 / BOT_TUNING[this.difficulty].hz;
    bots.forEach((p, i) => {
      const car = s.cars.find((c) => c.id === p.id)!;
      this.controllers.set(p.id, new BotController(this.difficulty));
      this.targets.set(
        p.id,
        this.decision.choose(car, s, this.perception, pads),
      );
      this.next.set(
        p.id,
        s.clock + (period * (i + 1)) / Math.max(1, bots.length),
      );
    });
    this.previous = s.clock;
  }
  inputs(s: Simulation, pads?: Pads) {
    const roster = s.players
      .filter((p) => p.controller === "bot")
      .map((p) => p.id)
      .join("|");
    if (roster !== this.roster || s.clock < this.previous)
      this.prepare(s, pads);
    this.previous = s.clock;
    if (this.perception.update(s)) this.decision.assign(s, this.perception);
    this.result.clear();
    const period = 1 / BOT_TUNING[this.difficulty].hz;
    for (const car of s.cars) {
      const controller = this.controllers.get(car.id);
      if (!controller) continue;
      if (
        car.body.isEnabled() &&
        s.clock + 1e-8 >= (this.next.get(car.id) ?? -Infinity)
      ) {
        this.targets.set(
          car.id,
          this.decision.choose(car, s, this.perception, pads),
        );
        const due = this.next.get(car.id)!;
        this.next.set(
          car.id,
          due + Math.max(1, Math.floor((s.clock - due) / period) + 1) * period,
        );
      }
      const target = this.targets.get(car.id);
      this.result.set(
        car.id,
        car.body.isEnabled() && target
          ? controller.sample(car, target, s.clock)
          : neutralInput(),
      );
    }
    return this.result;
  }
}
