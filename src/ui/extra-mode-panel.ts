import { ringsTime } from "../extra/rings";
import type { ExtraSession } from "../extra/session";

export class ExtraModePanel {
  readonly root = document.createElement("section");
  constructor(
    root: HTMLElement,
    private session: ExtraSession,
    actions: {
      restart(): void;
      exit(): void;
      resume(): void;
      settings(): void;
    },
  ) {
    this.root.id = "rings-ui";
    this.root.innerHTML = `<aside id="rings-hud"><div><small>TIME</small><time id="rings-time">0:00.000</time></div><div class="rings-stats"><div><small>${session.id.toUpperCase()}</small><b id="rings-progress">0 / ${session.readout(0).total}</b></div><div><small>BEST</small><b id="rings-best">0</b></div></div></aside>
      <div class="rings-actions"><button id="rings-restart" class="back-button">RESTART</button><button id="rings-menu" class="back-button">MENU</button></div>
      <section id="rings-modal" class="modal" hidden><div class="modal-card"><h2 id="rings-title">PAUSED</h2><div id="rings-result" hidden><small>TIME</small><time id="rings-final"></time><small>BEST TIME</small><time id="rings-best-time"></time></div><button id="rings-resume" class="nav-button primary">RESUME</button><button id="rings-modal-restart" class="nav-button">RESTART</button><button id="rings-settings" class="nav-button">SETTINGS</button><button id="rings-exit" class="nav-button">EXIT</button></div></section>`;
    root.append(this.root);
    const on = (id: string, fn: () => void) =>
      (this.root.querySelector<HTMLButtonElement>(`#${id}`)!.onclick = fn);
    on("rings-restart", actions.restart);
    on("rings-modal-restart", actions.restart);
    on("rings-menu", actions.resume);
    on("rings-resume", actions.resume);
    on("rings-exit", actions.exit);
    on("rings-settings", actions.settings);
  }
  update(now: number) {
    const run = this.session.readout(now);
    const set = (id: string, text: string) => {
      const e = this.root.querySelector(`#${id}`)!;
      if (e.textContent !== text) e.textContent = text;
    };
    set("rings-time", ringsTime(run.elapsed));
    set("rings-progress", `${run.progress} / ${run.total}`);
    set("rings-best", String(run.bestProgress));
    this.root.querySelector<HTMLElement>("#rings-modal")!.hidden =
      !this.session.paused && !this.session.complete;
    this.root.querySelector<HTMLElement>("#rings-result")!.hidden =
      !this.session.complete;
    this.root.querySelector<HTMLElement>("#rings-resume")!.hidden =
      this.session.complete;
    this.root.querySelector<HTMLElement>("#rings-settings")!.hidden =
      this.session.complete;
    set("rings-title", this.session.complete ? "COMPLETE!" : "PAUSED");
    if (this.session.complete) {
      set("rings-final", ringsTime(run.elapsed));
      set("rings-best-time", ringsTime(run.bestTime ?? run.elapsed));
    }
  }
  dispose() {
    this.root.remove();
  }
}
