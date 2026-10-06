import {
  displayIdentity,
  defaultAvatarColor,
} from "../../shared/local-profile";
import { PartyClient } from "../game/party";
import { icon } from "./icons";
import { PartyFlow } from "./party-flow";
import { normalizePartyCode, validPartyCode } from "../../shared/party";
export class PartyPanel {
  host = document.createElement("section");
  flow: PartyFlow;
  private joining = false;
  private selected: string | null = null;
  constructor(public party: PartyClient) {
    this.host.id = "party-panel";
    this.host.setAttribute("aria-label", "Party");
    this.host.innerHTML = `<div class="party-top"><button id="party-code" title="Copy party code" hidden></button><div id="party-members" role="group" aria-label="Party members"></div><div id="party-actions" hidden><b></b><button id="party-kick">KICK</button><button id="party-dismiss" aria-label="Close player actions">×</button></div></div><div class="party-controls"><button id="party-create" class="party-button">CREATE PARTY</button><button id="party-join-open" class="party-button">JOIN PARTY</button><form id="party-join" hidden><input id="party-input" aria-label="Party code" placeholder="ENTER CODE" maxlength="6" autocomplete="off" spellcheck="false"><button class="party-button" type="submit">JOIN</button><button class="party-button" type="button" id="party-cancel">CANCEL</button></form><button id="party-leave" class="party-button" hidden>LEAVE PARTY</button></div><div id="party-message" role="status" aria-live="polite"></div>`;
    document.getElementById("app")!.append(this.host);
    const retry = document.createElement("button");
    retry.id = "party-retry";
    retry.className = "party-button";
    retry.textContent = "RETRY CONNECTION";
    retry.onclick = () => void party.retry();
    this.host.querySelector(".party-controls")!.append(retry);
    this.flow = new PartyFlow(party);
    const start = document.createElement("button");
    start.id = "party-start";
    start.className = "party-button";
    start.textContent = "START GAME";
    start.onclick = () => void party.action("stage", { stage: "mode" });
    this.host.querySelector(".party-controls")!.prepend(start);
    const find = (id: string) =>
      this.host.querySelector<HTMLElement>("#" + id)!;
    find("party-create").onclick = () => void party.action("create");
    find("party-join-open").onclick = () => {
      this.joining = true;
      party.message = "";
      this.render();
      this.host.querySelector<HTMLInputElement>("input")!.focus();
    };
    find("party-cancel").onclick = () => {
      this.escape();
      find("party-join-open").focus();
    };
    find("party-dismiss").onclick = () => {
      this.selected = null;
      this.render();
    };
    find("party-leave").onclick = () => void party.action("leave");
    find("party-kick").onclick = () => {
      if (this.selected) void party.action("kick", { playerId: this.selected });
    };
    find("party-code").onclick = async () => {
      try {
        await navigator.clipboard.writeText(party.state!.code);
        party.message = "CODE COPIED";
      } catch {
        party.message = "COPY CODE: " + party.state!.code;
      }
      this.render();
    };
    this.host.querySelector<HTMLInputElement>("input")!.oninput = (e) => {
      const input = e.target as HTMLInputElement;
      input.value = normalizePartyCode(input.value);
    };
    this.host.querySelector("form")!.onsubmit = async (e) => {
      e.preventDefault();
      const code = normalizePartyCode(
        this.host.querySelector<HTMLInputElement>("input")!.value,
      );
      if (!validPartyCode(code)) {
        party.message = "INVALID CODE";
        this.render();
        return;
      }
      if (await party.action("join", { code })) {
        this.joining = false;
        this.render();
      }
    };
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && !this.host.hidden && this.escape()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    party.changed = () => this.render();
    this.render();
  }
  escape() {
    if (!this.joining && !this.selected) return false;
    this.joining = false;
    this.selected = null;
    this.render();
    return true;
  }
  render() {
    const p = this.party,
      s = p.state;
    const get = (id: string) => this.host.querySelector<HTMLElement>("#" + id)!;
    get("party-create").hidden = !!s || this.joining;
    get("party-join-open").hidden = !!s || this.joining;
    get("party-join").hidden = !!s || !this.joining;
    get("party-leave").hidden = !s;
    get("party-code").hidden = !s;
    get("party-code").textContent = s ? `PARTY  ${s.code}` : "";
    get("party-message").textContent = p.message;
    get("party-retry").hidden = p.connection !== "offline" || !p.message;
    const start = get("party-start") as HTMLButtonElement;
    start.hidden = !s;
    start.disabled = p.busy || s?.hostId !== p.playerId;
    start.title =
      s?.hostId === p.playerId
        ? "Choose a game mode"
        : "The party host starts the game setup";
    this.flow.render();
    const strip = get("party-members"),
      signature = JSON.stringify([
        s?.members.map((m) => [
          m.id,
          m.name,
          m.avatarId,
          m.avatarColor,
          m.team,
          m.ready,
        ]),
        s?.hostId,
        this.selected,
      ]);
    if (strip.dataset.signature !== signature) {
      const focusId = (document.activeElement as HTMLElement)?.dataset.player;
      strip.replaceChildren();
      strip.dataset.signature = signature;
      s?.members.forEach((m) => {
        const b = document.createElement("button");
        b.className = "party-avatar";
        b.dataset.player = m.id;
        b.dataset.team = String(m.team);
        b.style.color = m.avatarColor ?? defaultAvatarColor;
        b.title = `${displayIdentity(m)} · ${m.team === null ? "Unassigned" : m.team === 0 ? "Blue" : "Orange"}`;
        b.setAttribute(
          "aria-label",
          b.title + (m.id === s.hostId ? " — Party leader" : ""),
        );
        b.setAttribute("aria-pressed", String(this.selected === m.id));
        b.innerHTML =
          icon(m.avatarId) +
          (m.id === s.hostId
            ? '<span class="leader" aria-hidden="true">♛</span>'
            : "");
        b.onclick = () => {
          this.selected = this.selected === m.id ? null : m.id;
          this.render();
        };
        strip.append(b);
        if (focusId === m.id) b.focus();
      });
    }
    const member = s?.members.find((m) => m.id === this.selected);
    if (!member) this.selected = null;
    get("party-actions").hidden = !member;
    get("party-actions").querySelector("b")!.textContent = member
      ? displayIdentity(member)
      : "";
    get("party-kick").hidden =
      !member || s?.hostId !== p.playerId || member.id === p.playerId;
    for (const b of this.host.querySelectorAll<HTMLButtonElement>(
      ".party-controls button,#party-kick",
    ))
      b.disabled =
        p.busy || (b.id === "party-start" && s?.hostId !== p.playerId);
  }
}
