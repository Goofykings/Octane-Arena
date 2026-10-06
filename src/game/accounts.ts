import type { Garage } from "./inventory";
import type { Settings } from "./settings";
import { LocalProfile, browserProfile } from "./local-profile";
import {
  displayIdentity,
  avatarIds,
  avatarColors,
} from "../../shared/local-profile";
import { icon } from "../ui/icons";
import { ExtraRecords } from "../extra/storage";
import { createRingsCourse } from "../extra/course";

/** Browser-local identity. Garage/settings retain their existing independent saves. */
export class Accounts {
  readonly profile: LocalProfile = browserProfile();
  private dialog = document.querySelector<HTMLDialogElement>("#account")!;
  constructor(
    private garage: Garage,
    _settings: Settings,
    private changed: () => void,
  ) {
    this.apply();
    document.getElementById("profile")!.onclick = () => this.open();
    window.addEventListener("pagehide", () => this.profile.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.profile.flush();
    });
  }
  private apply() {
    Object.assign(this.garage.profile, {
      name: this.profile.value.name,
      avatarId: this.profile.value.avatarId,
      avatarColor: this.profile.value.avatarColor,
      localPlayerId: this.profile.value.localPlayerId,
    });
    this.changed();
  }
  open() {
    this.render();
    this.dialog.showModal();
  }
  private render() {
    let storage: Storage | undefined;
    try {
      storage = localStorage;
    } catch {}
    const rings = new ExtraRecords(createRingsCourse().id, storage).value;
    const stats = this.profile.value.stats;
    const entries = [
      ["MATCHES COMPLETED", stats.matchesPlayed],
      ["WINS", stats.wins],
      ["LOSSES", stats.losses],
      ["GOALS", stats.goals],
      ["PLAY TIME", `${Math.floor(stats.playTime / 60)} MIN`],
      ["RINGS BEST", `${rings.bestRings} / 40`],
      [
        "BEST RINGS TIME",
        rings.bestTime === null
          ? "—"
          : `${Math.floor(rings.bestTime / 60)}:${(rings.bestTime % 60).toFixed(3).padStart(6, "0")}`,
      ],
    ];
    this.dialog.innerHTML = `<div class="dialog-heading"><h2>PROFILE</h2><button class="icon-button" id="account-close" aria-label="Close profile">×</button></div><div class="account-body local-profile-body"><form id="profile-form"><div class="profile-fields"><button type="button" id="profile-avatar-edit" aria-label="Change profile picture" aria-expanded="false" aria-controls="profile-avatar-picker" title="Change profile picture"></button><label>NAME<input id="profile-edit-name" maxlength="20" required autocomplete="nickname"></label></div><section id="profile-avatar-picker" hidden aria-label="Profile picture options"><h3>ICON</h3><div class="avatar-grid" role="group" aria-label="Profile icons">${avatarIds.map((id) => `<button type="button" data-avatar="${id}" aria-label="${id}" title="${id}" aria-pressed="false">${icon(id)}</button>`).join("")}</div><h3>COLOR</h3><div class="avatar-color-grid" role="group" aria-label="Icon colors">${avatarColors.map((color) => `<button type="button" data-avatar-color="${color}" style="--swatch:${color}" aria-label="Icon color ${color}" aria-pressed="false"></button>`).join("")}<label class="avatar-custom-color" title="Choose any icon color"><input id="profile-avatar-color" type="color" aria-label="Custom icon color"><span>CUSTOM</span></label></div></section><h3>ACCOUNT STATS</h3><dl class="profile-stats">${entries.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl><p class="field-note">Saved in this browser only. Clearing site data can erase your profile. It does not sync between devices.</p><p id="profile-status" role="status"></p><div class="account-actions"><button class="small-button" type="submit">SAVE</button><button class="small-button" type="button" id="profile-back">BACK</button><button class="small-button" type="button" id="profile-reset">RESET LOCAL PROFILE</button></div><div id="profile-reset-confirm" hidden><p>Reset your name, profile picture and local match stats? Garage, settings and Rings records are kept.</p><button class="small-button" type="button" id="profile-reset-yes">RESET</button><button class="small-button" type="button" id="profile-reset-no">CANCEL</button></div></form></div>`;
    const name =
      this.dialog.querySelector<HTMLInputElement>("#profile-edit-name")!;
    name.value = this.profile.value.name;
    const status = this.dialog.querySelector<HTMLElement>("#profile-status")!;
    const preview = this.dialog.querySelector<HTMLButtonElement>(
      "#profile-avatar-edit",
    )!;
    const picker = this.dialog.querySelector<HTMLElement>(
      "#profile-avatar-picker",
    )!;
    const colorInput = this.dialog.querySelector<HTMLInputElement>(
      "#profile-avatar-color",
    )!;
    const updateAvatar = () => {
      const { avatarId, avatarColor } = this.profile.value;
      preview.innerHTML = icon(avatarId);
      preview.style.color = avatarColor;
      colorInput.value = avatarColor;
      for (const button of picker.querySelectorAll<HTMLButtonElement>(
        "[data-avatar]",
      )) {
        button.style.color = avatarColor;
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.avatar === avatarId),
        );
      }
      for (const button of picker.querySelectorAll<HTMLButtonElement>(
        "[data-avatar-color]",
      ))
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.avatarColor === avatarColor),
        );
    };
    const saveAvatar = (avatarId: string, avatarColor: string) => {
      this.profile.customize(this.profile.value.name, avatarId, avatarColor);
      this.apply();
      updateAvatar();
      status.textContent = this.profile.persistent
        ? "Saved"
        : "Saved for this session only; browser storage is unavailable.";
    };
    preview.onclick = () => {
      picker.hidden = !picker.hidden;
      preview.setAttribute("aria-expanded", String(!picker.hidden));
    };
    for (const button of picker.querySelectorAll<HTMLButtonElement>(
      "[data-avatar]",
    ))
      button.onclick = () =>
        saveAvatar(button.dataset.avatar!, this.profile.value.avatarColor);
    for (const button of picker.querySelectorAll<HTMLButtonElement>(
      "[data-avatar-color]",
    ))
      button.onclick = () =>
        saveAvatar(this.profile.value.avatarId, button.dataset.avatarColor!);
    colorInput.onchange = () =>
      saveAvatar(this.profile.value.avatarId, colorInput.value);
    updateAvatar();
    if (!this.profile.persistent)
      status.textContent =
        "Storage is unavailable. Changes will last for this session only.";
    this.dialog.querySelector<HTMLFormElement>("#profile-form")!.onsubmit = (
      e,
    ) => {
      e.preventDefault();
      try {
        this.profile.customize(name.value);
        this.apply();
        name.value = this.profile.value.name;
        status.textContent = this.profile.persistent
          ? "Saved"
          : "Saved for this session only; browser storage is unavailable.";
      } catch {
        status.textContent = "Name: 1–20 characters, no control characters.";
      }
    };
    for (const id of ["account-close", "profile-back"])
      this.dialog.querySelector<HTMLButtonElement>("#" + id)!.onclick = () =>
        this.dialog.close();
    const confirm = this.dialog.querySelector<HTMLElement>(
      "#profile-reset-confirm",
    )!;
    this.dialog.querySelector<HTMLButtonElement>("#profile-reset")!.onclick =
      () => {
        confirm.hidden = false;
      };
    this.dialog.querySelector<HTMLButtonElement>("#profile-reset-no")!.onclick =
      () => {
        confirm.hidden = true;
      };
    this.dialog.querySelector<HTMLButtonElement>(
      "#profile-reset-yes",
    )!.onclick = () => {
      this.profile.reset();
      this.apply();
      this.render();
    };
  }
  get displayName() {
    return displayIdentity(this.profile.value);
  }
}
