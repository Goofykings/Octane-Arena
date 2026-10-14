import {
  feedbackTypes,
  FEEDBACK_MAX_LENGTH,
  type FeedbackType,
  type FeedbackReport,
} from "../../shared/feedback";
import { FeedbackService, feedbackError } from "../game/feedback";
import { firestoreFeedbackWriter } from "../network/firebase-feedback";
export class FeedbackPanel {
  readonly button = document.createElement("button");
  readonly dialog = document.createElement("dialog");
  readonly service: FeedbackService;
  private type: FeedbackType = "Bug";
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    parent: HTMLElement,
    private context: () => Omit<FeedbackReport, "reportType" | "description">,
    opened: () => void,
    service?: FeedbackService,
  ) {
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {}
    this.service =
      service ?? new FeedbackService(firestoreFeedbackWriter(), storage);
    this.button.id = "feedback-open";
    this.button.className = "feedback-home-button";
    this.button.textContent = "FOUND A BUG?";
    this.button.hidden = true;
    this.dialog.id = "feedback";
    this.dialog.dataset.navScope = "feedback";
    this.dialog.dataset.navDefault = "#feedback-type-selector";
    this.dialog.setAttribute("aria-labelledby", "feedback-heading");
    this.dialog.innerHTML =
      '<form novalidate><header><h2 id="feedback-heading">FOUND A BUG?</h2><button class="icon-button" type="button" id="feedback-close" data-nav-back aria-label="Close feedback">&times;</button></header><p class="feedback-intro">Found a bug or glitch, or have an idea for a new feature? Describe it below and press Submit.</p><label id="feedback-type-label">TYPE</label><div id="feedback-type-selector" class="setup-selector" tabindex="0" role="group" aria-labelledby="feedback-type-label" data-nav-cycle data-nav-prev="#feedback-type-prev" data-nav-next="#feedback-type-next"><button id="feedback-type-prev" type="button" aria-label="Previous report type">&lsaquo;</button><strong id="feedback-type">Bug</strong><button id="feedback-type-next" type="button" aria-label="Next report type">&rsaquo;</button></div><label for="feedback-description">DESCRIPTION</label><textarea id="feedback-description" rows="5" tabindex="0" required maxlength="' +
      FEEDBACK_MAX_LENGTH +
      '" placeholder="Describe what happened or your idea..."></textarea><div class="feedback-details"><small id="feedback-count">0 / ' +
      FEEDBACK_MAX_LENGTH +
      '</small><small id="feedback-cooldown"></small></div><p id="feedback-status" role="status" aria-live="polite"></p><footer><button id="feedback-submit" type="submit" class="party-button">SUBMIT</button></footer></form>';
    parent.append(this.button, this.dialog);
    this.button.onclick = () => {
      opened();
      this.refresh();
      this.dialog.showModal();
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => this.refresh(), 1000);
    };
    this.dialog.querySelector<HTMLButtonElement>("#feedback-close")!.onclick =
      () => this.dialog.close();
    this.dialog.addEventListener("close", () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = undefined;
    });
    for (const [side, delta] of [
      ["prev", -1],
      ["next", 1],
    ] as const)
      this.dialog.querySelector<HTMLButtonElement>(
        "#feedback-type-" + side,
      )!.onclick = () => {
        if (this.service.pending) return;
        this.type =
          feedbackTypes[
            (feedbackTypes.indexOf(this.type) + delta + feedbackTypes.length) %
              feedbackTypes.length
          ];
        this.dialog.querySelector("#feedback-type")!.textContent = this.type;
      };
    this.description.oninput = () => this.refresh();
    this.dialog.querySelector("form")!.onsubmit = (e) => {
      e.preventDefault();
      void this.submit();
    };
  }
  private get description() {
    return this.dialog.querySelector<HTMLTextAreaElement>(
      "#feedback-description",
    )!;
  }
  private refresh() {
    const pending = this.service.pending,
      cooldown = this.service.cooldownSeconds;
    this.dialog.setAttribute("aria-busy", String(pending));
    this.description.disabled = pending;
    this.dialog
      .querySelector("#feedback-type-selector")!
      .setAttribute("aria-disabled", String(pending));
    for (const side of ["prev", "next"])
      this.dialog.querySelector<HTMLButtonElement>(
        "#feedback-type-" + side,
      )!.disabled = pending;
    const button =
      this.dialog.querySelector<HTMLButtonElement>("#feedback-submit")!;
    button.disabled = pending || cooldown > 0;
    button.textContent = pending ? "SUBMITTING..." : "SUBMIT";
    this.dialog.querySelector("#feedback-count")!.textContent =
      this.description.value.length + " / " + FEEDBACK_MAX_LENGTH;
    this.dialog.querySelector("#feedback-cooldown")!.textContent = cooldown
      ? "Please wait " +
        Math.floor(cooldown / 60) +
        ":" +
        String(cooldown % 60).padStart(2, "0") +
        " before another report."
      : "";
  }
  private async submit() {
    if (this.service.pending) return;
    const status = this.dialog.querySelector<HTMLElement>("#feedback-status")!;
    const description = this.description.value.trim();
    if (!description || description.length > FEEDBACK_MAX_LENGTH) {
      status.dataset.state = "error";
      status.textContent = !description
        ? "Please describe your report."
        : "Use at most " + FEEDBACK_MAX_LENGTH + " characters.";
      this.description.focus();
      return;
    }
    status.textContent = "";
    status.dataset.state = "";
    try {
      const promise = this.service.submit({
        ...this.context(),
        reportType: this.type,
        description,
      });
      this.refresh();
      await promise;
      this.description.value = "";
      this.type = "Bug";
      this.dialog.querySelector("#feedback-type")!.textContent = this.type;
      status.dataset.state = "success";
      status.textContent = "Thanks! Your report was submitted.";
    } catch (error) {
      status.dataset.state = "error";
      const message = error instanceof Error ? error.message : "";
      status.textContent =
        message.startsWith("Feedback is not configured") ||
        message.startsWith("Please wait ")
          ? message
          : feedbackError(error);
    } finally {
      this.refresh();
    }
  }
  show(visible: boolean) {
    this.button.hidden = !visible;
    if (!visible && this.dialog.open) this.dialog.close();
  }
}
