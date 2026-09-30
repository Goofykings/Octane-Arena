import type { PartyClient } from "../game/party";
import { partyModes, teamCapacity, type PartyMode } from "../../shared/party";

export class PartyFlow {
  dialog = document.createElement("dialog");
  private visible = false;
  constructor(private party: PartyClient) {
    this.dialog.id = "party-flow";
    this.dialog.setAttribute("aria-label", "Party game setup");
    this.dialog.innerHTML = `<section id="party-mode-screen"><header><h2>CHOOSE MODE</h2><span class="party-flow-host"></span></header><div class="party-mode-cards">${partyModes.map((m) => `<button class="party-mode-card" data-mode="${m.id}" aria-pressed="false"><span class="mode-emblem" aria-hidden="true">${m.id === "1v1" ? "Ⅰ : Ⅰ" : m.id === "2v2" ? "Ⅱ : Ⅱ" : "Ⅱ : ▣"}</span><strong>${m.label}</strong></button>`).join("")}</div><footer><button class="back-button" data-stage="home">BACK</button><button id="party-continue" class="party-button" data-stage="teams">CONTINUE →</button></footer></section><section id="party-team-screen" hidden><header><div><span class="arena-caption">LUMEN DISTRICT</span><h2>CHOOSE YOUR SIDE</h2></div><span id="party-match-mode"></span></header><div class="party-team-board">${[0, 1].map((t) => `<section class="party-team-column" data-team="${t}"><header><h3>${t === 0 ? "BLUE" : "ORANGE"}</h3><span class="team-count"></span></header><div class="team-rows"></div><button class="party-button party-team-join" data-team="${t}">JOIN ${t === 0 ? "BLUE" : "ORANGE"}</button></section>`).join("")}</div><div id="party-unassigned"></div><footer><button class="back-button" data-stage="mode">CHANGE MODE</button><button id="party-team-leave" class="back-button">LEAVE PARTY</button><span class="party-network-note">NETWORK MATCHES COMING NEXT</span></footer></section><p id="party-flow-message" role="status" aria-live="polite"></p>`;
    document.getElementById("app")!.append(this.dialog);
    const leaveMode = document.createElement("button");
    leaveMode.id = "party-mode-leave";
    leaveMode.className = "back-button";
    leaveMode.textContent = "LEAVE PARTY";
    leaveMode.onclick = () => void party.action("leave");
    this.dialog.querySelector("#party-mode-screen footer")!.append(leaveMode);
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((b) => {
        b.onclick = () =>
          void party.action("mode", { mode: b.dataset.mode as PartyMode });
      });
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-stage]")
      .forEach((b) => {
        b.onclick = () =>
          void party.action("stage", {
            stage: b.dataset.stage as "home" | "mode" | "teams",
          });
      });
    this.dialog
      .querySelectorAll<HTMLButtonElement>(".party-team-join")
      .forEach((b) => {
        b.onclick = () =>
          void party.action("team", { team: Number(b.dataset.team) as 0 | 1 });
      });
    this.dialog.querySelector<HTMLButtonElement>("#party-team-leave")!.onclick =
      () => void party.action("leave");
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      if (party.state?.hostId === party.playerId)
        void party.action("stage", {
          stage: party.state.stage === "teams" ? "mode" : "home",
        });
    });
  }
  updateVisibility(visible: boolean) {
    this.visible = visible;
    this.syncVisibility();
  }
  private syncVisibility() {
    const open =
      this.visible && !!this.party.state && this.party.state.stage !== "home";
    if (open && !this.dialog.open) this.dialog.showModal();
    if (!open && this.dialog.open) this.dialog.close();
    document.body.classList.toggle("party-flow-open", open);
  }
  render() {
    const p = this.party,
      s = p.state;
    this.syncVisibility();
    if (!s) return;
    const host = s.hostId === p.playerId;
    this.dialog.querySelector<HTMLButtonElement>("#party-mode-leave")!.hidden =
      host;
    this.dialog.querySelector<HTMLButtonElement>(
      "#party-mode-leave",
    )!.disabled = p.busy;
    this.dialog.dataset.stage = s.stage;
    this.dialog.querySelector<HTMLElement>("#party-mode-screen")!.hidden =
      s.stage !== "mode";
    this.dialog.querySelector<HTMLElement>("#party-team-screen")!.hidden =
      s.stage !== "teams";
    this.dialog.querySelector<HTMLElement>(".party-flow-host")!.textContent =
      host ? "" : "HOST IS CHOOSING";
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-mode]")
      .forEach((b) => {
        b.disabled = !host || p.busy;
        b.setAttribute("aria-pressed", String(b.dataset.mode === s.mode));
      });
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-stage]")
      .forEach((b) => {
        b.hidden = !host;
        b.disabled = p.busy;
      });
    this.dialog.querySelector<HTMLElement>("#party-match-mode")!.textContent =
      partyModes.find((m) => m.id === s.mode)!.label;
    const local = s.members.find((m) => m.id === p.playerId);
    for (const team of [0, 1] as const) {
      const column = this.dialog.querySelector<HTMLElement>(
          `.party-team-column[data-team="${team}"]`,
        )!,
        members = s.members.filter((m) => m.team === team),
        bots = s.mode === "2v2bots" && team === 1,
        capacity = bots ? 2 : teamCapacity(s.mode, team),
        rows = column.querySelector<HTMLElement>(".team-rows")!;
      column.querySelector<HTMLElement>(".team-count")!.textContent =
        `${bots ? 2 : members.length} / ${capacity}`;
      rows.replaceChildren();
      for (let i = 0; i < capacity; i++) {
        const row = document.createElement("div"),
          name = document.createElement("strong"),
          tag = document.createElement("span"),
          m = members[i];
        row.className = "team-row" + (!m && !bots ? " empty" : "");
        name.textContent = bots
          ? i === 0
            ? "CIRCUIT"
            : "RELAY"
          : (m?.name ?? "OPEN SLOT");
        tag.textContent = bots
          ? "BOT"
          : m?.id === p.playerId
            ? "YOU"
            : m?.id === s.hostId
              ? "HOST"
              : "";
        if (m) row.dataset.player = m.id;
        row.append(name, tag);
        rows.append(row);
      }
      const button = column.querySelector<HTMLButtonElement>("button")!;
      button.disabled =
        p.busy || bots || local?.team === team || members.length >= capacity;
      button.textContent = bots
        ? "BOT TEAM"
        : local?.team === team
          ? "JOINED"
          : members.length >= capacity
            ? "TEAM FULL"
            : `JOIN ${team === 0 ? "BLUE" : "ORANGE"}`;
    }
    const waiting = s.members.filter((m) => m.team === null);
    this.dialog.querySelector<HTMLElement>("#party-unassigned")!.textContent =
      waiting.length
        ? "CHOOSING A SIDE · " + waiting.map((m) => m.name).join(" · ")
        : "";
    this.dialog.querySelector<HTMLElement>("#party-flow-message")!.textContent =
      p.message;
    this.dialog.querySelector<HTMLButtonElement>(
      "#party-team-leave",
    )!.disabled = p.busy;
  }
}
