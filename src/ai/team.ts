import type { Simulation } from "../physics/simulation";
import type { Pads } from "../game/pads";
import { neutralInput, type PlayerInput } from "../../shared/player";
import type { BotDifficulty } from "../../shared/bots";
import { BotPerception } from "./perception";
import { BotDecision, type BotTarget } from "./decision";
import { BotController } from "./controller";
export class BotTeam {
  readonly perception: BotPerception;
  readonly decision: BotDecision;
  readonly targets = new Map<string, BotTarget>();
  private controllers = new Map<string, BotController>();
  constructor(readonly difficulty: BotDifficulty) {
    this.perception = new BotPerception(difficulty);
    this.decision = new BotDecision(difficulty);
  }
  inputs(s: Simulation, pads?: Pads) {
    if (this.perception.update(s)) {
      this.decision.assign(s, this.perception);
      for (const c of s.cars)
        if (
          s.players.find((p) => p.id === c.id)?.controller === "bot" &&
          c.body.isEnabled()
        )
          this.targets.set(
            c.id,
            this.decision.choose(c, s, this.perception, pads),
          );
    }
    const result = new Map<string, PlayerInput>();
    for (const c of s.cars) {
      if (s.players.find((p) => p.id === c.id)?.controller !== "bot") continue;
      let controller = this.controllers.get(c.id);
      if (!controller) {
        controller = new BotController(this.difficulty);
        this.controllers.set(c.id, controller);
      }
      const target = this.targets.get(c.id);
      result.set(
        c.id,
        c.body.isEnabled() && target
          ? controller.sample(c, target, s.clock)
          : neutralInput(),
      );
    }
    return result;
  }
}
