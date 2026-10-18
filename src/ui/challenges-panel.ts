import { Challenges } from "../game/challenges";
import {
  DAILY_CHALLENGES,
  WEEKLY_CHALLENGES,
  SEASON_1_CHALLENGES,
  SEASON_CONFIG,
  seasonCountdown,
  weeklyCountdown,
  dailyCountdown,
  type ChallengeCategory,
  seasonDateLabels,
  seasonStatus,
  blankChallengeProgress,
  type ChallengeDefinition,
  type ChallengeReward,
} from "../../shared/challenges";
import { reveal, reducedMotion, UI_MOTION } from "./motion";
import { ProgressionPanel } from "./progression-panel";
export class ChallengesPanel {
  readonly home = document.createElement("button");
  readonly homePanel = document.createElement("aside");
  readonly toggle = document.createElement("button");
  readonly dialog = document.createElement("dialog");
  readonly toast = document.createElement("aside");
  readonly claimDialog = document.createElement("dialog");
  private claimProgression: ProgressionPanel;
  private claiming = false;
  private tab: ChallengeCategory = "DAILY";
  private queue: ChallengeReward[] = [];
  private toastActive = false;
  constructor(
    readonly challenges: Challenges,
    parent: HTMLElement,
    private selectSound: () => void,
    private completionSound: () => void,
    private opened: () => void,
    private clock: () => number = Date.now,
  ) {
    const dates = seasonDateLabels();
    this.homePanel.id = "home-challenges-panel";
    this.homePanel.hidden = true;
    this.homePanel.dataset.expanded = "false";
    this.homePanel.setAttribute("aria-label", "Daily Challenges");
    this.toggle.id = "home-challenges-toggle";
    this.toggle.type = "button";
    this.toggle.setAttribute("aria-controls", "home-challenges");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", "Expand Daily Challenges");
    this.toggle.innerHTML = '<span aria-hidden="true">&laquo;</span>';
    this.toggle.onclick = () => {
      const expanded = this.homePanel.dataset.expanded !== "true";
      this.homePanel.dataset.expanded = String(expanded);
      this.toggle.setAttribute("aria-expanded", String(expanded));
      this.toggle.setAttribute(
        "aria-label",
        (expanded ? "Collapse" : "Expand") + " Daily Challenges",
      );
      this.toggle.innerHTML = expanded
        ? '<span aria-hidden="true">&raquo;</span>'
        : '<span aria-hidden="true">&laquo;</span>';
      this.selectSound();
    };
    this.home.id = "home-challenges";
    this.home.type = "button";
    this.home.hidden = true;
    this.home.setAttribute(
      "aria-label",
      "Open Challenges. Daily challenges and " + SEASON_CONFIG.name,
    );
    this.home.innerHTML =
      '<span class="challenge-season"><b></b><span></span><small></small><strong class="season-countdown"></strong></span><span class="challenge-home-heading">CHALLENGES <small>DAILY</small></span><span class="daily-challenges"></span><span class="challenge-home-footer">VIEW ALL CHALLENGES <span aria-hidden="true">&rsaquo;</span></span>';
    this.home.querySelector(".challenge-season>b")!.textContent =
      SEASON_CONFIG.name;
    this.home.querySelector(".challenge-season>span")!.textContent =
      dates.range;
    this.home.querySelector(".challenge-season>small")!.textContent =
      "ENDS " + dates.ends;
    for (const d of DAILY_CHALLENGES)
      this.home.querySelector(".daily-challenges")!.append(this.card(d, true));
    this.dialog.id = "challenges-screen";
    this.dialog.className = "challenges-screen";
    this.dialog.dataset.navScope = "challenges";
    this.dialog.dataset.navDefault = "#challenges-daily";
    this.dialog.setAttribute("aria-labelledby", "challenges-title");
    this.dialog.innerHTML =
      '<header class="challenges-heading"><div><small></small><h2 id="challenges-title">CHALLENGES</h2></div><button id="challenges-close" class="icon-button" data-nav-back aria-label="Back from Challenges">&times;</button></header><nav role="tablist" class="challenges-tabs" aria-label="Challenge category"><button id="challenges-daily" type="button" role="tab" aria-controls="challenge-cards">DAILY</button><button id="challenges-weekly" type="button" role="tab" aria-controls="challenge-cards">WEEKLY</button><button id="challenges-season" type="button" role="tab" aria-controls="challenge-cards">SEASON</button></nav><div class="challenge-period"><div><strong id="challenge-period-name"></strong><small id="challenge-period-end"></small></div><span class="season-countdown"></span></div><section id="challenge-cards" role="tabpanel" aria-label="Weekly challenges"></section><footer><small id="challenge-local-note">Progress and XP save in this browser.</small><button id="challenges-back" class="back-button" data-nav-back>BACK</button></footer>';
    this.dialog.querySelector(".challenges-heading small")!.textContent =
      "OCTANE ARENA / " + SEASON_CONFIG.name;
    this.toast.id = "challenge-complete";
    this.toast.setAttribute("role", "status");
    this.toast.setAttribute("aria-live", "polite");
    this.toast.hidden = true;
    this.toast.innerHTML =
      "<small>CHALLENGE COMPLETE</small><strong></strong><b></b>";
    this.homePanel.append(this.home, this.toggle);
    this.claimDialog.id = "challenge-xp-dialog";
    this.claimDialog.dataset.navScope = "challenge-reward";
    this.claimDialog.dataset.navDefault = "#challenge-xp-done";
    this.claimDialog.setAttribute("aria-labelledby", "challenge-xp-heading");
    this.claimDialog.innerHTML =
      '<h2 id="challenge-xp-heading">CHALLENGE REWARD</h2><p id="challenge-xp-name"></p><section id="challenge-xp-progression" class="challenge-xp-progression"></section><button id="challenge-xp-done" class="small-button" data-nav-back>DONE</button>';
    this.claimProgression = new ProgressionPanel(
      completionSound,
      this.claimDialog.querySelector<HTMLElement>("section")!,
      "claim-xp",
    );
    this.claimDialog.querySelector<HTMLButtonElement>("button")!.onclick = () =>
      this.claimDialog.close();
    this.claimDialog.addEventListener("close", () =>
      this.claimProgression.hide(),
    );
    parent.append(this.homePanel, this.dialog, this.claimDialog, this.toast);
    this.home.onclick = () => {
      opened();
      this.selectSound();
      this.challenges.tick();
      this.tab = "DAILY";
      this.buildCards();
      this.render();
      this.dialog.showModal();
    };
    for (const id of ["challenges-close", "challenges-back"])
      this.dialog.querySelector<HTMLButtonElement>("#" + id)!.onclick = () => {
        this.selectSound();
        this.dialog.close();
      };
    for (const tab of ["DAILY", "WEEKLY", "SEASON"] as const)
      this.dialog.querySelector<HTMLButtonElement>(
        "#challenges-" + tab.toLowerCase(),
      )!.onclick = () => {
        if (this.tab === tab) return;
        this.selectSound();
        this.tab = tab;
        this.buildCards();
        this.render();
        reveal(this.dialog.querySelector<HTMLElement>("#challenge-cards")!, 6);
      };
    challenges.onChange(() => this.render());
    challenges.onComplete((reward) => {
      this.queue.push(reward);
      this.showToast();
    });
    this.buildCards();
    this.render();
    setInterval(() => {
      challenges.tick();
      this.renderClock();
    }, 1000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        challenges.tick();
        this.renderClock();
      }
    });
  }
  showHome(visible: boolean) {
    this.homePanel.hidden = !visible;
    this.home.hidden = !visible;
  }
  private card(d: ChallengeDefinition, compact: boolean): HTMLElement {
    const card = document.createElement(compact ? "span" : "article");
    card.className = "challenge-card" + (compact ? " compact" : "");
    card.dataset.challenge = d.id;
    card.dataset.category = d.category;
    if (!compact) card.tabIndex = 0;
    card.innerHTML =
      '<span class="challenge-card-name"></span><span class="challenge-description"></span><span class="challenge-progress-row"><span class="challenge-progress" role="progressbar" aria-valuemin="0"><span></span></span><span class="challenge-fraction"></span></span><span class="challenge-card-footer"><span class="challenge-reward"></span><span class="challenge-completed"></span></span>';
    if (!compact) {
      const claim = document.createElement("button");
      claim.type = "button";
      claim.className = "challenge-claim small-button";
      claim.textContent = "CLAIM XP";
      claim.hidden = true;
      claim.setAttribute("aria-label", "Claim " + d.name + " reward");
      claim.onclick = async () => {
        if (this.claiming) return;
        this.claiming = true;
        this.selectSound();
        this.render();
        try {
          const award = await this.challenges.claim(d.category, d.id);
          if (award) {
            this.claimDialog.querySelector("#challenge-xp-name")!.textContent =
              d.name;
            this.claimDialog.showModal();
            this.claimProgression.show(
              award,
              this.challenges.profile.persistent,
            );
          }
        } finally {
          this.claiming = false;
          this.render();
        }
      };
      card.append(claim);
    }
    card.querySelector(".challenge-card-name")!.textContent = d.name;
    card.querySelector(".challenge-description")!.textContent = d.description;
    card.querySelector(".challenge-reward")!.textContent =
      "+" + d.xpReward.toLocaleString() + " XP";
    card
      .querySelector("[role=progressbar]")!
      .setAttribute("aria-label", d.name);
    return card;
  }
  private buildCards() {
    const grid = this.dialog.querySelector<HTMLElement>("#challenge-cards")!;
    grid.replaceChildren(
      ...(this.tab === "DAILY"
        ? DAILY_CHALLENGES
        : this.tab === "WEEKLY"
          ? WEEKLY_CHALLENGES
          : SEASON_1_CHALLENGES
      ).map((d) => this.card(d, false)),
    );
    grid.scrollTop = 0;
    grid.dataset.category = this.tab;
    grid.setAttribute(
      "aria-label",
      this.tab === "DAILY"
        ? "Three daily challenges"
        : this.tab === "WEEKLY"
          ? "Six weekly challenges"
          : "Six Season 1 challenges",
    );
    grid.setAttribute(
      "aria-labelledby",
      "challenges-" + this.tab.toLowerCase(),
    );
  }
  private render() {
    this.dialog.dataset.navDefault = "#challenges-" + this.tab.toLowerCase();
    const all = [
      ...DAILY_CHALLENGES,
      ...WEEKLY_CHALLENGES,
      ...SEASON_1_CHALLENGES,
    ];
    for (const card of [
      ...this.home.querySelectorAll<HTMLElement>("[data-challenge]"),
      ...this.dialog.querySelectorAll<HTMLElement>("[data-challenge]"),
    ]) {
      const definition = all.find(
        (d) =>
          d.id === card.dataset.challenge &&
          d.category === card.dataset.category,
      )!;
      const p =
        this.challenges.state.periods[definition.category].entries[
          definition.id
        ] ?? blankChallengeProgress();
      const progress = Math.min(definition.target, p.progress),
        bar = card.querySelector<HTMLElement>(".challenge-progress")!;
      const fraction =
        progress.toLocaleString() + " / " + definition.target.toLocaleString();
      bar.setAttribute("aria-valuemax", String(definition.target));
      bar.setAttribute("aria-valuenow", String(progress));
      bar.querySelector<HTMLElement>("span")!.style.width =
        (100 * progress) / definition.target + "%";
      card.querySelector(".challenge-fraction")!.textContent = fraction;
      const ready = p.completed && !p.rewardClaimed;
      card.querySelector(".challenge-completed")!.textContent = p.rewardClaimed
        ? "\u2713 CLAIMED"
        : ready
          ? "READY TO CLAIM"
          : "";
      card.classList.toggle("complete", p.completed);
      card.classList.toggle("ready", ready);
      card.classList.toggle("claimed", p.rewardClaimed);
      const claim = card.querySelector<HTMLButtonElement>(".challenge-claim");
      if (claim) {
        claim.hidden = !ready;
        claim.disabled = this.claiming;
        claim.textContent = this.claiming ? "CLAIMING..." : "CLAIM XP";
      }
      if (!card.classList.contains("compact"))
        card.setAttribute(
          "aria-label",
          definition.name +
            ". " +
            definition.description +
            ". " +
            fraction +
            ". " +
            definition.xpReward +
            " XP" +
            (p.rewardClaimed
              ? ". Claimed"
              : p.completed
                ? ". Ready to claim"
                : ""),
        );
    }
    for (const category of ["DAILY", "WEEKLY", "SEASON"] as const) {
      const tab = this.dialog.querySelector<HTMLButtonElement>(
        "#challenges-" + category.toLowerCase(),
      )!;
      const definitions =
        category === "DAILY"
          ? DAILY_CHALLENGES
          : category === "WEEKLY"
            ? WEEKLY_CHALLENGES
            : SEASON_1_CHALLENGES;
      const claimed = definitions.every(
        (d) =>
          this.challenges.state.periods[category].entries[d.id]?.completed &&
          this.challenges.state.periods[category].entries[d.id]?.rewardClaimed,
      );
      tab.setAttribute("aria-selected", String(category === this.tab));
      tab.setAttribute(
        "aria-label",
        category + (claimed ? ": all challenges claimed" : " challenges"),
      );
      if (!tab.querySelector(".challenge-tab-check"))
        tab.insertAdjacentHTML(
          "beforeend",
          '<span class="challenge-tab-check" aria-hidden="true"> &#10003;</span>',
        );
      tab.querySelector<HTMLElement>(".challenge-tab-check")!.hidden = !claimed;
    }
    this.dialog.querySelector("#challenge-period-name")!.textContent =
      this.tab === "DAILY"
        ? "3 DAILY CHALLENGES"
        : this.tab === "WEEKLY"
          ? "6 WEEKLY CHALLENGES"
          : SEASON_CONFIG.name + " CHALLENGES";
    this.dialog.querySelector("#challenge-period-end")!.textContent =
      this.tab === "DAILY"
        ? "RESETS MIDNIGHT / NEW YORK TIME"
        : this.tab === "WEEKLY"
          ? "RESETS MONDAY / NEW YORK TIME"
          : "ENDS " + seasonDateLabels().endsWithYear;
    this.dialog.querySelector("#challenge-local-note")!.textContent =
      this.challenges.error ||
      (this.challenges.profile.persistent
        ? "Progress and XP save in this browser."
        : "Storage unavailable: progress lasts for this session only.");
    this.renderClock();
  }
  private renderClock() {
    const now = this.clock(),
      countdown = seasonCountdown(now);
    for (const el of this.home.querySelectorAll(".season-countdown"))
      el.textContent = countdown;
    const tabCountdown = this.dialog.querySelector(".season-countdown")!;
    tabCountdown.textContent =
      this.tab === "DAILY"
        ? dailyCountdown(now)
        : this.tab === "WEEKLY"
          ? weeklyCountdown(now)
          : countdown;
    tabCountdown.setAttribute(
      "aria-label",
      this.tab === "DAILY"
        ? "Time until daily challenges reset"
        : this.tab === "WEEKLY"
          ? "Time until weekly challenges reset"
          : "Time remaining in the season",
    );
    this.home.dataset.season = seasonStatus(now);
    this.dialog.dataset.season = seasonStatus(now);
    if (this.tab === "SEASON" && seasonStatus(now) === "COMPLETE")
      this.dialog.querySelector("#challenge-period-name")!.textContent =
        SEASON_CONFIG.name + " COMPLETE";
  }
  private showToast() {
    if (this.toastActive) return;
    const reward = this.queue.shift();
    if (!reward) return;
    this.toastActive = true;
    this.toast.querySelector("strong")!.textContent = reward.name;
    this.toast.querySelector("b")!.textContent =
      reward.amount.toLocaleString() + " XP - READY TO CLAIM";
    this.toast.hidden = false;
    if (!reducedMotion())
      this.toast.animate(
        [
          { opacity: 0, translate: "calc(100% + 72px) 0" },
          { opacity: 1, translate: "0 0" },
        ],
        { duration: UI_MOTION.enter, easing: UI_MOTION.easing },
      );
    this.completionSound();
    setTimeout(() => {
      const finish = () => {
        this.toast.hidden = true;
        this.toastActive = false;
        this.showToast();
      };
      if (reducedMotion()) {
        finish();
        return;
      }
      const exit = this.toast.animate(
        [
          { opacity: 1, translate: "0 0" },
          { opacity: 0, translate: "calc(100% + 72px) 0" },
        ],
        {
          duration: UI_MOTION.enter,
          easing: UI_MOTION.easing,
          fill: "forwards",
        },
      );
      void exit.finished
        .catch(() => {})
        .then(() => {
          exit.cancel();
          finish();
        });
    }, 2600);
  }
}
