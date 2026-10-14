import {
  matchMutators,
  DEFAULT_MUTATORS,
  type MatchMutators,
} from "../../shared/mutators";
export class MutatorStore {
  value: MatchMutators = DEFAULT_MUTATORS;
  constructor(private storage?: Pick<Storage, "getItem" | "setItem">) {
    try {
      this.value = matchMutators(
        JSON.parse(storage?.getItem("octane-arena-mutators") ?? "null") ??
          DEFAULT_MUTATORS,
      );
    } catch {}
  }
  save(config: MatchMutators) {
    this.value = matchMutators(config);
    try {
      this.storage?.setItem(
        "octane-arena-mutators",
        JSON.stringify(this.value),
      );
    } catch {}
  }
}
let storage: Storage | undefined;
try {
  storage = localStorage;
} catch {}
export const localMutators = new MutatorStore(storage);
