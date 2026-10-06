import { icon } from "./icons";
import {
  displayIdentity,
  defaultAvatarColor,
} from "../../shared/local-profile";
import type { PlayerEntity } from "../../shared/player";
import type { ReplayClip, ReplayState } from "../../shared/replay";

export class ReplayPanel {
  readonly root = document.createElement("section");
  private signature = "";
  private debugEnabled = new URLSearchParams(location.search).has(
    "replayDebug",
  );
  constructor(
    parent: HTMLElement,
    private skip: () => void,
  ) {
    this.root.id = "goal-replay";
    this.root.hidden = true;
    this.root.innerHTML =
      '<div class="replay-label">REPLAY</div><section class="replay-scorer"><div class="replay-avatar"></div><div><strong id="replay-scorer-name"></strong><small>GOAL SPEED</small><b id="replay-goal-speed"></b></div></section><section class="replay-skip"><h3>SKIP REPLAY</h3><ul id="replay-players"></ul><button id="replay-skip-button">PRESS SPACE TO SKIP</button></section><pre id="replay-debug" hidden></pre>';
    parent.append(this.root);
    this.root.querySelector<HTMLButtonElement>("#replay-skip-button")!.onclick =
      skip;
  }
  hide() {
    this.root.hidden = true;
    this.signature = "";
  }
  update(
    clip: ReplayClip | null,
    state: ReplayState | null,
    players: PlayerEntity[],
    localId: string,
    debug?: unknown,
  ) {
    this.root.hidden = false;
    const scorer = players.find((p) => p.id === clip?.goal.scorerId);
    const signature = JSON.stringify([
      clip?.goal.id,
      state?.eligible,
      state?.votes,
      players.map((p) => [p.id, p.name, p.avatarId, p.avatarColor]),
    ]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.root.querySelector(".replay-avatar")!.innerHTML = icon(
        scorer?.avatarId ?? "helmet",
      );
      (this.root.querySelector(".replay-avatar") as HTMLElement).style.color =
        scorer?.avatarColor ?? defaultAvatarColor;
      this.root.querySelector("#replay-scorer-name")!.textContent = scorer
        ? displayIdentity(scorer)
        : "LOADING REPLAY";
      this.root.querySelector("#replay-goal-speed")!.textContent = clip
        ? `${Math.round(clip.goal.ballSpeed * 3.6)} km/h`
        : "";
      const list = this.root.querySelector("#replay-players")!;
      list.replaceChildren();
      for (const player of players) {
        const item = document.createElement("li");
        item.textContent = displayIdentity(player);
        item.dataset.playerId = player.id;
        const skipped =
          player.controller === "bot" ||
          !state?.eligible.includes(player.id) ||
          !!state?.votes.includes(player.id);
        item.classList.toggle("replay-voted", skipped);
        if (skipped) {
          const mark = document.createElement("span");
          mark.textContent =
            player.controller === "bot"
              ? "BOT"
              : !state?.eligible.includes(player.id)
                ? "LEFT"
                : "✓";
          item.append(mark);
        }
        list.append(item);
      }
      this.root.querySelector<HTMLButtonElement>(
        "#replay-skip-button",
      )!.disabled =
        !state?.eligible.includes(localId) || state.votes.includes(localId);
    }
    const panel = this.root.querySelector<HTMLPreElement>("#replay-debug")!;
    panel.hidden = !this.debugEnabled;
    if (this.debugEnabled)
      panel.textContent = JSON.stringify(debug ?? state, null, 2);
  }
}
