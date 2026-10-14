import {
  DEFAULT_MUTATORS,
  matchMutators,
  mutatorKeys,
  mutatorLabels,
  mutatorOptions,
  type MatchMutators,
  type MutatorKey,
} from "../../shared/mutators";
/** A view of the setup's authoritative configuration; never a second physics store. */
export class MutatorsPanel {
  private static sequence = 0;
  private readonly scope = "mutators-" + ++MutatorsPanel.sequence;
  readonly dialog = document.createElement("dialog");
  private pending = false;
  constructor(
    private get: () => MatchMutators,
    private change: (value: MatchMutators) => void | Promise<void>,
    private editable: () => boolean = () => true,
  ) {
    this.dialog.className = "mutators-panel";
    this.dialog.setAttribute("aria-label", "Mutators");
    this.dialog.id = this.scope;
    this.dialog.dataset.navScope = this.scope;
    this.dialog.dataset.navDefault = '[data-mutator="matchLength"]';
    this.dialog.innerHTML =
      '<header><h2>MUTATORS</h2><span class="mutators-authority"></span></header><div class="mutators-rows">' +
      mutatorKeys
        .map(
          (key) =>
            '<div class="mutator-row"><label id="' +
            this.scope +
            "-label-" +
            key +
            '">' +
            mutatorLabels[key] +
            '</label><div class="setup-selector" id="' +
            this.scope +
            "-" +
            key +
            '" data-mutator="' +
            key +
            '" tabindex="0" role="group" aria-labelledby="' +
            this.scope +
            "-label-" +
            key +
            '" data-nav-cycle data-nav-prev="[data-step=prev]" data-nav-next="[data-step=next]"><button data-step="prev" data-key="' +
            key +
            '" aria-label="Previous ' +
            mutatorLabels[key].toLowerCase() +
            '">&lsaquo;</button><strong data-value="' +
            key +
            '"></strong><button data-step="next" data-key="' +
            key +
            '" aria-label="Next ' +
            mutatorLabels[key].toLowerCase() +
            '">&rsaquo;</button></div></div>',
        )
        .join("") +
      '</div><p class="mutators-error" role="status"></p><footer><button class="back-button" data-nav-back>BACK</button><button class="party-button" data-reset>RESET TO DEFAULT</button></footer>';
    document.getElementById("app")!.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>("[data-nav-back]")!.onclick =
      () => this.close();
    this.dialog.querySelector<HTMLButtonElement>("[data-reset]")!.onclick =
      () => void this.commit(DEFAULT_MUTATORS);
    this.dialog.querySelectorAll<HTMLButtonElement>("[data-step]").forEach(
      (b) =>
        (b.onclick = () => {
          const key = b.dataset.key as MutatorKey,
            options: readonly string[] = mutatorOptions[key],
            current = this.get();
          const value =
            options[
              (options.indexOf(current[key]) +
                (b.dataset.step === "prev" ? -1 : 1) +
                options.length) %
                options.length
            ];
          void this.commit(matchMutators({ ...current, [key]: value }));
        }),
    );
  }
  private async commit(value: MatchMutators) {
    if (this.pending || !this.editable()) return;
    this.pending = true;
    this.refresh();
    const error = this.dialog.querySelector(".mutators-error")!;
    error.textContent = "";
    try {
      await this.change(value);
    } catch (e) {
      error.textContent =
        e instanceof Error ? e.message : "SETTING COULD NOT BE UPDATED";
    } finally {
      this.pending = false;
      this.refresh();
    }
  }
  refresh() {
    const config = this.get(),
      writable = this.editable() && !this.pending;
    this.dialog.querySelector(".mutators-authority")!.textContent =
      this.editable() ? "" : "HOST SETTINGS";
    for (const key of mutatorKeys) {
      this.dialog.querySelector('[data-value="' + key + '"]')!.textContent =
        config[key];
      const row = this.dialog.querySelector<HTMLElement>(
        '[data-mutator="' + key + '"]',
      )!;
      // Read-only rows remain focusable so guests can navigate all nine values with a controller.
      row.setAttribute("aria-disabled", String(this.pending));
      row
        .querySelectorAll<HTMLButtonElement>("button")
        .forEach((b) => (b.disabled = !writable));
    }
    this.dialog.querySelector<HTMLButtonElement>("[data-reset]")!.disabled =
      !writable;
    this.dialog.dataset.navDefault = '[data-mutator="matchLength"]';
  }
  show() {
    this.refresh();
    if (!this.dialog.open) this.dialog.showModal();
  }
  close() {
    this.dialog.close();
  }
}
