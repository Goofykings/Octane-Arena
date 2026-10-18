import { xpRequired, type XPAward } from "../../shared/progression";
import { XPAnimation } from "./xp-animation";
export class ProgressionPanel {
  private animation: XPAnimation | null = null;
  private frame = 0;
  constructor(
    private levelSound: () => void,
    readonly root: HTMLElement = document.getElementById(
      "results-progression",
    )!,
    private idPrefix = "xp",
  ) {}
  hide() {
    cancelAnimationFrame(this.frame);
    this.animation = null;
    this.root.hidden = true;
  }
  show(award: XPAward | null, persistent = true) {
    this.hide();
    this.root.hidden = false;
    if (!award) {
      this.root.textContent = "Play actively to earn match XP.";
      return;
    }
    const a = (this.animation = new XPAnimation(
      award,
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    ));
    const rows = award.breakdown
      ? ([
          ["PLAYTIME", award.breakdown.playtime],
          ["SCORE", award.breakdown.performance],
          ["WIN", award.breakdown.win],
          ["MVP", award.breakdown.mvp],
        ] as const)
      : [];
    this.root.innerHTML =
      '<div class="xp-heading"><b id="xp-level"></b><span id="xp-level-up" role="status"></span><button id="xp-skip" class="small-button" aria-label="Skip XP animation">SKIP</button></div><div id="xp-bar" role="progressbar" aria-label="Level progress" aria-valuemin="0"><span></span></div><div class="xp-summary"><span id="xp-value"></span><b>MATCH XP <strong id="xp-earned"></strong></b></div><dl class="xp-breakdown"></dl><p class="xp-storage" hidden>XP is saved for this session only; browser storage is unavailable.</p>';
    this.root.innerHTML = this.root.innerHTML.replaceAll(
      'id="xp-',
      'id="' + this.idPrefix + "-",
    );
    if (award.source.type === "CHALLENGE")
      this.root.querySelector(".xp-summary>b")!.firstChild!.textContent =
        "CHALLENGE XP ";
    this.root.querySelector<HTMLElement>(
      "#" + this.idPrefix + "-earned",
    )!.textContent = "+" + award.amount.toLocaleString();
    const breakdown = this.root.querySelector("dl")!;
    for (const [label, value] of rows)
      if (value > 0) {
        const row = document.createElement("div"),
          key = document.createElement("dt"),
          amount = document.createElement("dd");
        key.textContent = label;
        amount.textContent = "+" + value.toLocaleString();
        row.append(key, amount);
        breakdown.append(row);
      }
    this.root.querySelector<HTMLElement>(".xp-storage")!.hidden = persistent;
    const skip = this.root.querySelector<HTMLButtonElement>(
      "#" + this.idPrefix + "-skip",
    )!;
    skip.onclick = () => {
      a.skip();
      this.paint();
    };
    this.paint();
    let previous = performance.now();
    const tick = (now: number) => {
      if (this.animation !== a || this.root.hidden) return;
      a.advance(Math.min(0.1, (now - previous) / 1000));
      previous = now;
      if (a.levelUp) {
        const label = this.root.querySelector<HTMLElement>(
          "#" + this.idPrefix + "-level-up",
        )!;
        label.textContent = "LEVEL UP! " + a.level;
        label.animate(
          [
            { opacity: 0, transform: "scale(.9)" },
            { opacity: 1, transform: "scale(1.08)", offset: 0.3 },
            { opacity: 1, transform: "scale(1)" },
          ],
          { duration: 300, fill: "forwards" },
        );
        this.levelSound();
      }
      this.paint();
      if (!a.done) this.frame = requestAnimationFrame(tick);
    };
    if (!a.done) this.frame = requestAnimationFrame(tick);
  }
  private paint() {
    const a = this.animation;
    if (!a) return;
    const needed = xpRequired(a.level),
      xp = Math.floor(a.xp);
    this.root.querySelector("#" + this.idPrefix + "-level")!.textContent =
      "LEVEL " + a.level.toLocaleString();
    this.root.querySelector("#" + this.idPrefix + "-value")!.textContent =
      xp.toLocaleString() + " / " + needed.toLocaleString() + " XP";
    const bar = this.root.querySelector<HTMLElement>(
      "#" + this.idPrefix + "-bar",
    )!;
    bar.setAttribute("aria-valuemax", String(needed));
    bar.setAttribute("aria-valuenow", String(xp));
    bar.querySelector<HTMLElement>("span")!.style.width =
      (100 * a.xp) / needed + "%";
    const skip = this.root.querySelector<HTMLButtonElement>(
      "#" + this.idPrefix + "-skip",
    )!;
    if (a.done && document.activeElement === skip) {
      const back = this.root
        .closest("dialog")
        ?.querySelector<HTMLButtonElement>("[data-nav-back]");
      const again = document.getElementById("again") as HTMLButtonElement;
      (
        back ??
        (again && !again.hidden && !again.disabled
          ? again
          : document.getElementById("home"))
      )?.focus();
    }
    skip.hidden = a.done;
    this.root.dataset.animating = String(!a.done);
  }
}
