import { arenaIds, arenaThemes, type ArenaId } from "../render/arena-themes";

export class ArenaSelect {
  readonly host = document.createElement("fieldset");
  constructor(selected: ArenaId, changed: (id: ArenaId) => void) {
    this.host.id = "arena-select";
    this.host.innerHTML = `<legend>ARENA</legend><div class="arena-options">${arenaIds.map((id) => `<button type="button" class="arena-option ${id}" data-arena="${id}" aria-pressed="${id === selected}"><span class="arena-swatch" aria-hidden="true"></span><strong>${arenaThemes[id].name.toUpperCase()}</strong></button>`).join("")}</div>`;
    document.querySelector("#freeplay-setup .screen-footer")!.before(this.host);
    this.host
      .querySelectorAll<HTMLButtonElement>("[data-arena]")
      .forEach((b) => {
        b.onclick = () => {
          const id = b.dataset.arena as ArenaId;
          changed(id);
          this.host
            .querySelectorAll("button")
            .forEach((item) =>
              item.setAttribute("aria-pressed", String(item === b)),
            );
        };
      });
  }
}
