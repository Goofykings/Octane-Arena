import {
  ROCKET_PASS_SEASON_1 as SEASON,
  rocketPassProgress,
  rewardSlot,
} from "../../shared/rocket-pass";
import { xpRequired } from "../../shared/progression";
import type { LocalProfile } from "../game/local-profile";
import type { Garage } from "../game/inventory";
import { icon } from "./icons";
import { TrackScroll } from "./track-scroll";
export class RocketPassPanel {
  readonly root = document.createElement("section");
  private track: HTMLElement;
  private status: HTMLElement;
  private unsubscribe: () => void;
  private scrolling: TrackScroll;
  constructor(
    host: HTMLElement,
    private garage: Garage,
    private profile: LocalProfile,
    back: () => void,
    private claimed: () => void,
  ) {
    this.root.id = "rocket-pass-screen";
    this.root.className = "screen full-screen";
    this.root.hidden = true;
    this.root.dataset.navScope = "rocket-pass";
    this.root.dataset.navPriority = "0";
    this.root.dataset.navDefault = "#rocket-pass-back";
    this.root.innerHTML =
      '<header class="rocket-pass-heading"><div><small>SEASON 1 &middot; FREE TRACK</small><h2>ROCKET PASS</h2><p>Play. Level up. Make it yours.</p></div><div class="pass-account-level"></div></header><div class="pass-track-window"><div class="pass-track"><div class="pass-line"><i></i></div></div></div><p class="pass-claim-status" role="status" aria-live="polite"></p><footer class="screen-footer"><button id="rocket-pass-back" data-nav-back class="back-button">&larr; BACK</button><span>25 LEVELS &middot; NO PREMIUM TRACK</span></footer>';
    host.append(this.root);
    this.track = this.root.querySelector(".pass-track")!;
    this.status = this.root.querySelector(".pass-claim-status")!;
    this.scrolling = new TrackScroll(
      this.root.querySelector(".pass-track-window")!,
    );
    this.root
      .querySelector("#rocket-pass-back")!
      .addEventListener("click", back);
    this.unsubscribe = profile.onXPAward(() => this.update());
    this.root.addEventListener("focusin", (e) => {
      this.scrolling.stop();
      (e.target as HTMLElement).closest("[data-pass-level]")?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    });
    this.render();
  }
  render() {
    this.track
      .querySelectorAll(".pass-reward")
      .forEach((card) => card.remove());
    for (const reward of SEASON.rewards) {
      const card = document.createElement("button");
      card.className = "pass-reward";
      card.dataset.passLevel = String(reward.level);
      card.innerHTML =
        '<span class="pass-node">' +
        reward.level +
        '</span><div class="pass-card"><small>LEVEL ' +
        reward.level +
        '</small><div class="pass-symbol">' +
        icon(rewardSlot(reward.type)) +
        "</div><strong>" +
        reward.displayName +
        '</strong><span class="pass-type">' +
        reward.type.replaceAll("_", " ") +
        '</span><span class="pass-bonus">' +
        (reward.bonus ?? [])
          .map((item) => "+ " + item.displayName + " Boost")
          .join(" / ") +
        '</span><b class="pass-state"></b></div>';
      card.onclick = async () => {
        if (card.dataset.state !== "claimable") {
          this.status.textContent =
            card.dataset.state === "claimed"
              ? "ALREADY CLAIMED"
              : "REACH LEVEL " + reward.level + " TO CLAIM";
          return;
        }
        card.disabled = true;
        try {
          const ok = await this.garage.claimRocketPass(
            reward.level,
            this.profile.value.progression,
          );
          if (ok) {
            this.status.textContent =
              "REWARD CLAIMED - " +
              [
                reward.displayName,
                ...(reward.bonus ?? []).map(
                  (item) => item.displayName + " Boost",
                ),
              ].join(" + ") +
              (this.garage.persistent ? "" : " - THIS SESSION ONLY");
            if (!matchMedia("(prefers-reduced-motion: reduce)").matches)
              this.status.animate(
                [
                  { opacity: 0, transform: "translateY(8px)" },
                  { opacity: 1, transform: "translateY(0)" },
                ],
                { duration: 280 },
              );
            this.claimed();
          }
        } finally {
          card.disabled = false;
          this.update();
        }
      };
      this.track.append(card);
    }
    this.update();
  }
  update() {
    const p = this.profile.value.progression;
    this.root.querySelector(".pass-account-level")!.textContent =
      "LEVEL " +
      p.level +
      " \u00b7 " +
      p.currentLevelXP.toLocaleString() +
      " / " +
      xpRequired(p.level).toLocaleString() +
      " XP";
    this.track.style.setProperty(
      "--pass-progress",
      String(rocketPassProgress(p)),
    );
    for (const card of this.track.querySelectorAll<HTMLElement>(
      "[data-pass-level]",
    )) {
      const level = Number(card.dataset.passLevel);
      const state = this.garage.claimedRocketPass[SEASON.id].includes(level)
        ? "claimed"
        : p.level >= level
          ? "claimable"
          : "locked";
      card.dataset.state = state;
      card.toggleAttribute("data-current", p.level === level);
      card.querySelector(".pass-state")!.textContent =
        state === "claimable" ? "CLAIM" : state.toUpperCase();
      card.setAttribute(
        "aria-label",
        "Level " +
          level +
          ", " +
          SEASON.rewards[level - 1].displayName +
          (SEASON.rewards[level - 1].bonus ?? [])
            .map((item) => ", " + item.displayName + " boost")
            .join("") +
          ", " +
          state,
      );
    }
  }
  dispose() {
    this.scrolling.dispose();
    this.unsubscribe();
    this.root.remove();
  }
}
