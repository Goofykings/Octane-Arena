import {
  botSizes,
  botDifficulties,
  type BotSize,
  type BotDifficulty,
} from "../../shared/bots";
import { soccerModes, type SoccerMode } from "../../shared/soccer";
export class BotSetup {
  gameMode: SoccerMode = "soccar";
  size: BotSize = "1v1";
  difficulty: BotDifficulty = "beginner";
  readonly root = document.createElement("section");
  constructor(parent: HTMLElement, onBack: () => void, onStart: () => void) {
    this.root.id = "bot-setup";
    this.root.dataset.navScope = "bots";
    this.root.dataset.navDefault = "#bot-size-cycle";
    this.root.className = "screen full-screen";
    this.root.hidden = true;
    this.root.innerHTML = `<h2>AGAINST BOTS</h2><div class="bot-selectors"><section><h3>GAMEMODE</h3><div id="bot-mode-cycle" class="bot-cycle" tabindex="0" role="group" aria-label="Gamemode" data-nav-cycle data-nav-prev="#bot-mode-prev" data-nav-next="#bot-mode-next"><button id="bot-mode-prev" aria-label="Previous gamemode">&lsaquo;</button><strong id="bot-game-mode">SOCCAR</strong><button id="bot-mode-next" aria-label="Next gamemode">&rsaquo;</button></div></section><section><h3>MATCH SIZE</h3><div id="bot-size-cycle" class="bot-cycle" tabindex="0" role="group" aria-label="Match size" data-nav-cycle data-nav-prev="#bot-size-prev" data-nav-next="#bot-size-next"><button id="bot-size-prev" aria-label="Previous match size">‹</button><strong id="bot-size">1v1</strong><button id="bot-size-next" aria-label="Next match size">›</button></div></section><section><h3>BOT DIFFICULTY</h3><div id="bot-difficulty-cycle" class="bot-cycle" tabindex="0" role="group" aria-label="Bot difficulty" data-nav-cycle data-nav-prev="#bot-difficulty-prev" data-nav-next="#bot-difficulty-next"><button id="bot-difficulty-prev" aria-label="Previous difficulty">‹</button><strong id="bot-difficulty">BEGINNER</strong><button id="bot-difficulty-next" aria-label="Next difficulty">›</button></div></section></div><button id="bot-launch" class="nav-button primary">START MATCH</button><footer class="screen-footer"><button id="bot-setup-back" data-nav-back class="back-button">← BACK</button></footer>`;
    parent.append(this.root);
    const on = (id: string, fn: () => void) =>
      (this.root.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = fn);
    for (const [side, delta] of [
      ["prev", -1],
      ["next", 1],
    ] as const) {
      on(`bot-mode-${side}`, () => {
        this.gameMode =
          soccerModes[
            (soccerModes.findIndex((m) => m.id === this.gameMode) +
              delta +
              soccerModes.length) %
              soccerModes.length
          ].id;
        this.render();
      });
      on(`bot-size-${side}`, () => {
        this.size =
          botSizes[
            (botSizes.indexOf(this.size) + delta + botSizes.length) %
              botSizes.length
          ];
        this.render();
      });
      on(`bot-difficulty-${side}`, () => {
        this.difficulty =
          botDifficulties[
            (botDifficulties.indexOf(this.difficulty) +
              delta +
              botDifficulties.length) %
              botDifficulties.length
          ];
        this.render();
      });
    }
    on("bot-launch", () => {
      this.root.hidden = true;
      onStart();
    });
    on("bot-setup-back", () => {
      this.root.hidden = true;
      onBack();
    });
  }
  render() {
    this.root.querySelector("#bot-game-mode")!.textContent = soccerModes.find(
      (m) => m.id === this.gameMode,
    )!.label;
    this.root.querySelector("#bot-size")!.textContent = this.size;
    this.root.querySelector("#bot-difficulty")!.textContent =
      this.difficulty.toUpperCase();
  }
  show() {
    this.render();
    this.root.hidden = false;
  }
}
