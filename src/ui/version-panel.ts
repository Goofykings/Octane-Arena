import { GAME_VERSION, upcomingUpdates } from "../config/version";

export class VersionPanel {
  readonly button = document.createElement("button");
  readonly dialog = document.createElement("dialog");
  constructor(parent: HTMLElement, opened: () => void) {
    this.button.id = "game-version";
    this.button.textContent = `V${GAME_VERSION}`;
    this.button.setAttribute(
      "aria-label",
      `Version ${GAME_VERSION}, upcoming updates`,
    );
    this.dialog.id = "version-updates";
    this.dialog.setAttribute("aria-labelledby", "updates-heading");
    this.dialog.innerHTML = `<div class="dialog-heading"><div><h2 id="updates-heading">OCTANE ARENA</h2><p class="updates-version">V${GAME_VERSION}</p></div><button class="icon-button" aria-label="Close updates">×</button></div><h3>UPCOMING</h3><ul>${upcomingUpdates.map((item) => `<li><b>${item.title}</b><span>${item.status}</span></li>`).join("")}</ul><button class="small-button updates-back">BACK</button>`;
    parent.append(this.button, this.dialog);
    this.button.onclick = () => {
      opened();
      this.dialog.showModal();
    };
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>(
      "button",
    ))
      button.onclick = () => this.dialog.close();
  }
  show(visible: boolean) {
    this.button.hidden = !visible;
    if (!visible && this.dialog.open) this.dialog.close();
  }
}
