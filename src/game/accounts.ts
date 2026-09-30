import {
  avatars,
  titles,
  credentialsSchema,
  saveSchema,
  type AccountData,
  type AccountSave,
} from "../../shared/accounts";
import type { Garage } from "./inventory";
import type { Settings, Preferences } from "./settings";
import { icon } from "../ui/icons";

class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
  ) {
    super(message);
  }
}
export class Accounts {
  account: AccountData | null = null;
  private url = "";
  private ready = false;
  private status = "";
  private pending = false;
  private blocked = false;
  private generation = 0;
  private savedGeneration = 0;
  private timer = 0;
  private saving: Promise<void> | null = null;
  private guest: {
    presets: Garage["presets"];
    selected: string;
    profile: Garage["profile"];
    settings: Preferences;
  } | null = null;
  private dialog = document.querySelector<HTMLDialogElement>("#account")!;
  private formMode: "login" | "register" = "login";
  constructor(
    private garage: Garage,
    private settings: Settings,
    private changed: () => void,
  ) {
    document.getElementById("profile")!.onclick = () => {
      this.render();
      this.dialog.showModal();
    };
    window.addEventListener("beforeunload", (e) => {
      if (this.account && this.generation !== this.savedGeneration) {
        e.preventDefault();
      }
    });
    void this.initialize();
  }
  private async initialize() {
    try {
      const config: { apiUrl?: string } = await fetch(
        `${import.meta.env.BASE_URL}config.json`,
        { cache: "no-store", signal: AbortSignal.timeout(4000) },
      ).then((r) => (r.ok ? r.json() : {}));
      const address =
        import.meta.env.VITE_API_URL ||
        config.apiUrl ||
        (import.meta.env.DEV ? "http://127.0.0.1:8787" : "");
      if (address) {
        const parsed = new URL(address, location.origin);
        if (
          parsed.protocol !== "https:" &&
          !(
            parsed.protocol === "http:" &&
            (parsed.origin === location.origin ||
              ["localhost", "127.0.0.1"].includes(parsed.hostname))
          )
        )
          throw new Error("Invalid API URL");
        if (parsed.username || parsed.password || parsed.search || parsed.hash)
          throw new Error("Invalid API URL");
        this.url = parsed.href.replace(/\/$/, "");
      }
      if (this.url) {
        try {
          const { account } = await this.request<{ account: AccountData }>(
            "/api/me",
          );
          this.load(account);
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 401))
            this.status = this.message(e);
        }
      }
    } catch {
      this.status = "Account configuration could not be loaded.";
    }
    this.ready = true;
    if (this.dialog.open) this.render();
  }
  private async request<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    if (!this.url)
      throw new ApiError(
        "Accounts are not connected yet. You can keep playing as Guest.",
      );
    let response: Response;
    try {
      response = await fetch(this.url + path, {
        method,
        credentials: "include",
        headers:
          method === "GET"
            ? {}
            : { "Content-Type": "application/json", "X-Arena-Client": "1" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new ApiError(
        "Account service is unavailable. Check your connection and try again.",
      );
    }
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        data?.error?.message ?? "Account request failed. Please try again.",
        response.status,
      );
    if (!data)
      throw new ApiError("Account service returned an invalid response.");
    return data as T;
  }
  private message(e: unknown) {
    return e instanceof Error ? e.message : "Please try again.";
  }
  private preferences(value: Preferences) {
    // Keep the binding object used by Input alive across account changes.
    Object.assign(this.settings.value.camera, value.camera);
    Object.assign(this.settings.value.audio, value.audio);
    Object.assign(this.settings.value.bindings, value.bindings);
    for (const k of [
      "infiniteBoost",
      "showHitboxes",
      "quickChat",
      "quality",
    ] as const)
      Object.assign(this.settings.value, { [k]: value[k] });
  }
  private load(account: AccountData) {
    if (!this.guest)
      this.guest = structuredClone({
        presets: this.garage.presets,
        selected: this.garage.selected,
        profile: this.garage.profile,
        settings: this.settings.value,
      });
    this.account = account;
    this.garage.presets = structuredClone(account.presets);
    this.garage.selected = account.selected;
    this.preferences(account.settings);
    this.garage.onSave = this.settings.onSave = () => this.schedule();
    this.generation = this.savedGeneration = 0;
    this.blocked = false;
    this.status = "Saved";
    this.profile();
    this.changed();
  }
  private profile() {
    const a = this.account;
    if (a)
      this.garage.profile = {
        name: a.username,
        title: titles.find((t) => t.id === a.titleId)?.name ?? "Rookie",
        level: a.level,
        xp: a.xp,
        avatarId: a.avatarId,
      };
  }
  private schedule() {
    this.generation++;
    if (!this.blocked) this.status = "Saving…";
    clearTimeout(this.timer);
    this.timer = window.setTimeout(
      () => void this.flush().catch(() => {}),
      550,
    );
    this.updateStatus();
  }
  private snapshot(): AccountSave {
    const a = this.account!;
    return structuredClone({
      revision: a.revision,
      presets: this.garage.presets,
      selected: this.garage.selected,
      settings: this.settings.value,
      avatarId: a.avatarId,
      titleId: a.titleId,
    }) as AccountSave;
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.saving) {
      await this.saving;
      if (this.generation !== this.savedGeneration) return this.flush();
      return;
    }
    if (!this.account || this.generation === this.savedGeneration) return;
    if (this.blocked) throw new ApiError(this.status);
    const generation = this.generation,
      parsed = saveSchema.safeParse(this.snapshot());
    if (!parsed.success) {
      this.status =
        "Some settings could not be saved. " + parsed.error.issues[0].message;
      this.updateStatus();
      throw new ApiError(this.status);
    }
    const snapshot = parsed.data;
    this.saving = (async () => {
      try {
        const { account } = await this.request<{ account: AccountData }>(
          "/api/me/save",
          "PUT",
          snapshot,
        );
        this.account!.revision = account.revision;
        this.savedGeneration = generation;
        this.status = "Saved";
      } catch (e) {
        this.blocked = e instanceof ApiError && e.status === 409;
        this.status = this.message(e);
        throw e;
      } finally {
        this.saving = null;
        this.updateStatus();
      }
    })();
    await this.saving;
    if (this.generation !== this.savedGeneration) await this.flush();
  }
  private updateStatus() {
    const node = this.dialog.querySelector("#account-status");
    if (node) node.textContent = this.status;
  }
  private async action(work: () => Promise<void>) {
    if (this.pending) return;
    this.pending = true;
    this.dialog
      .querySelectorAll<HTMLButtonElement>("button")
      .forEach((b) => (b.disabled = true));
    try {
      await work();
    } catch (e) {
      this.status = this.message(e);
    } finally {
      this.pending = false;
      this.render();
    }
  }
  private render() {
    const a = this.account;
    this.dialog.innerHTML = `<div class="dialog-heading"><h2>${a ? "PROFILE" : "ACCOUNT"}</h2><button class="icon-button" id="account-close" aria-label="Close account">×</button></div><div class="account-body">${a ? `<div class="account-identity"><div class="avatar">${icon(a.avatarId)}</div><div><h3 id="account-name"></h3><p>LEVEL ${a.level} · ${a.xp} XP</p></div></div><h3>AVATAR</h3><div class="avatar-grid">${avatars.map((v) => `<button data-avatar="${v.id}" aria-label="${v.name}" aria-pressed="${a.avatarId === v.id}">${icon(v.id)}</button>`).join("")}</div><h3>TITLE</h3><div class="title-grid">${titles.map((t) => `<button data-title="${t.id}" ${a.owned.title?.includes(t.id) ? "" : "disabled"} aria-pressed="${a.titleId === t.id}">${t.name}${t.level > 1 ? ` <small>LV ${t.level}</small>` : ""}</button>`).join("")}</div><div class="account-actions"><button id="account-retry" class="small-button">RETRY SAVE</button><button id="account-reload" class="small-button">LOAD CLOUD SAVE</button><button id="account-logout" class="small-button">LOG OUT</button></div><div id="reload-confirm" hidden><p>Replace unsaved changes with the latest cloud save?</p><button id="reload-yes" class="small-button">LOAD SAVE</button><button id="reload-no" class="small-button">CANCEL</button></div>` : `<nav class="settings-tabs"><button data-auth="login" aria-pressed="${this.formMode === "login"}">LOG IN</button><button data-auth="register" aria-pressed="${this.formMode === "register"}">CREATE ACCOUNT</button></nav><form id="account-form"><label for="username">USERNAME</label><input id="username" name="username" autocomplete="username" minlength="5" maxlength="20" pattern="[A-Za-z0-9_]+" required spellcheck="false"><label for="password">PASSWORD</label><input id="password" name="password" type="password" autocomplete="${this.formMode === "login" ? "current-password" : "new-password"}" minlength="8" maxlength="128" required>${this.formMode === "register" ? '<p class="field-note">Username: 5–20 letters, numbers or underscores. Password: 8–128 characters.</p>' : ""}<button class="nav-button primary" type="submit" ${this.ready && this.url ? "" : "disabled"}>${this.formMode === "login" ? "LOG IN" : "CREATE ACCOUNT"}</button></form><p class="field-note">${this.ready ? (this.url ? "Your Guest garage stays on this device." : "Accounts are not connected yet. Continue playing as Guest.") : "Connecting…"}</p>`}<p id="account-status" role="status"></p></div>`;
    this.updateStatus();
    this.dialog
      .querySelector("#account-close")!
      .addEventListener("click", () => this.dialog.close());
    if (a) {
      this.dialog.querySelector("#account-name")!.textContent = a.username;
      this.dialog.querySelectorAll<HTMLButtonElement>("[data-avatar]").forEach(
        (b) =>
          (b.onclick = () => {
            a.avatarId = b.dataset.avatar!;
            this.profile();
            this.changed();
            this.schedule();
            this.render();
          }),
      );
      this.dialog.querySelectorAll<HTMLButtonElement>("[data-title]").forEach(
        (b) =>
          (b.onclick = () => {
            a.titleId = b.dataset.title!;
            this.profile();
            this.changed();
            this.schedule();
            this.render();
          }),
      );
      this.dialog
        .querySelector("#account-retry")!
        .addEventListener("click", () => void this.action(() => this.flush()));
      this.dialog
        .querySelector("#account-reload")!
        .addEventListener("click", () => {
          (this.dialog.querySelector("#reload-confirm") as HTMLElement).hidden =
            false;
        });
      this.dialog
        .querySelector("#reload-no")!
        .addEventListener("click", () => this.render());
      this.dialog.querySelector("#reload-yes")!.addEventListener(
        "click",
        () =>
          void this.action(async () => {
            clearTimeout(this.timer);
            await this.saving?.catch(() => {});
            this.load(
              (await this.request<{ account: AccountData }>("/api/me")).account,
            );
          }),
      );
      this.dialog.querySelector("#account-logout")!.addEventListener(
        "click",
        () =>
          void this.action(async () => {
            await this.flush();
            await this.request("/api/auth/logout", "POST", {});
            this.account = null;
            this.garage.onSave = this.settings.onSave = undefined;
            const guest = this.guest!;
            this.garage.presets = guest.presets;
            this.garage.selected = guest.selected;
            this.garage.profile = guest.profile;
            this.preferences(guest.settings);
            this.guest = null;
            this.status = "Logged out";
            this.changed();
          }),
      );
    } else {
      this.dialog.querySelectorAll<HTMLButtonElement>("[data-auth]").forEach(
        (b) =>
          (b.onclick = () => {
            this.formMode = b.dataset.auth as typeof this.formMode;
            this.status = "";
            this.render();
          }),
      );
      this.dialog.querySelector<HTMLFormElement>("#account-form")!.onsubmit = (
        e,
      ) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget as HTMLFormElement);
        const parsed = credentialsSchema.safeParse(Object.fromEntries(form));
        if (!parsed.success) {
          this.status = parsed.error.issues[0].message;
          this.updateStatus();
          return;
        }
        void this.action(async () => {
          await this.request(`/api/auth/${this.formMode}`, "POST", parsed.data);
          try {
            this.load(
              (await this.request<{ account: AccountData }>("/api/me")).account,
            );
          } catch (e) {
            if (e instanceof ApiError && e.status === 401)
              throw new ApiError(
                "Your browser blocked the account cookie. Allow this site’s cookies and log in again.",
              );
            throw e;
          }
        });
      };
    }
  }
}
