import { soccerModes } from "../../shared/soccer";
import { displayIdentity } from "../../shared/local-profile";
import type { PartyClient } from "../game/party";
import { partyModes, teamCapacity, type PartyMode } from "../../shared/party";

export class PartyFlow {
  dialog = document.createElement("dialog");
  private visible = false;
  private localSetup = false;
  openSetup() {
    this.localSetup = true;
    this.visible = true;
    this.render();
  }
  constructor(private party: PartyClient) {
    this.dialog.id = "party-flow";
    this.dialog.setAttribute("aria-label", "Party game setup");
    this.dialog.innerHTML = `<section id="party-mode-screen"><header><h2>MATCH SETUP</h2><span class="party-flow-host"></span></header><div class="match-setup-grid"><section class="setup-gamemode"><h3>GAMEMODE</h3><div class="setup-selector" data-selector="gamemode"><button data-cycle="gamemode" data-direction="-1" aria-label="Previous gamemode">&lsaquo;</button><div class="setup-selection"><strong id="setup-gamemode" aria-live="polite"></strong></div><button data-cycle="gamemode" data-direction="1" aria-label="Next gamemode">&rsaquo;</button></div></section><section class="setup-players"><h3>PLAYERS</h3><div class="setup-selector" data-selector="mode"><button data-cycle="mode" data-direction="-1" aria-label="Previous player format">&lsaquo;</button><div class="setup-selection"><strong id="setup-players" aria-live="polite"></strong></div><button data-cycle="mode" data-direction="1" aria-label="Next player format">&rsaquo;</button></div><button id="party-setup-launch" class="party-button">START MATCH</button></section></div><footer><button class="back-button" data-stage="home">BACK</button><button id="party-continue" class="party-button" data-stage="teams">CHOOSE SIDES</button></footer></section><section id="party-team-screen" hidden><header><div><span class="arena-caption">LUMEN DISTRICT</span><h2>CHOOSE YOUR SIDE</h2></div><span id="party-match-mode"></span></header><div class="party-team-board">${[0, 1].map((t) => `<section class="party-team-column" data-team="${t}"><header><h3>${t === 0 ? "BLUE" : "ORANGE"}</h3><span class="team-count"></span></header><div class="team-rows"></div><button class="party-button party-team-join" data-team="${t}">JOIN ${t === 0 ? "BLUE" : "ORANGE"}</button></section>`).join("")}</div><div id="party-unassigned"></div><footer><button class="back-button" data-stage="mode">CHANGE MODE</button><button id="party-team-leave" class="back-button">LEAVE PARTY</button><span class="party-network-note">NETWORK MATCHES COMING NEXT</span></footer></section><p id="party-flow-message" role="status" aria-live="polite"></p>`;
    document.getElementById("app")!.append(this.dialog);
    const launch = document.createElement("button");
    launch.id = "party-launch";
    launch.className = "party-button";
    launch.textContent = "KICK OFF";
    launch.onclick = () => void party.action("launch");
    this.dialog.querySelector("#party-team-screen footer")!.append(launch);
    this.dialog.querySelector(".party-network-note")!.remove();
    const leaveMode = document.createElement("button");
    leaveMode.id = "party-mode-leave";
    leaveMode.className = "back-button";
    leaveMode.textContent = "LEAVE PARTY";
    leaveMode.onclick = () => void party.action("leave");
    this.dialog.querySelector("#party-mode-screen footer")!.append(leaveMode);
    this.dialog.querySelector<HTMLButtonElement>(
      "#party-setup-launch",
    )!.onclick = () => void party.action("launch");
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-cycle]")
      .forEach((b) => {
        b.onclick = () => {
          const state = party.state;
          if (!state) return;
          const direction = Number(b.dataset.direction);
          if (b.dataset.cycle === "gamemode") {
            const i = soccerModes.findIndex(
              (m) => m.id === (state.gameMode ?? "soccar"),
            );
            void party.action("gamemode", {
              gameMode:
                soccerModes[
                  (i + direction + soccerModes.length) % soccerModes.length
                ].id,
            });
          } else {
            const i = partyModes.findIndex((m) => m.id === state.mode);
            void party.action("mode", {
              mode: partyModes[
                (i + direction + partyModes.length) % partyModes.length
              ].id,
            });
          }
          this.dialog.dataset.direction = direction < 0 ? "left" : "right";
        };
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
      if (this.localSetup && party.state?.stage === "home") {
        this.localSetup = false;
        this.syncVisibility();
        return;
      }
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
      this.visible &&
      !!this.party.state &&
      (this.party.state.stage !== "home" || this.localSetup) &&
      this.party.state.stage !== "match";
    if (open && !this.dialog.open) this.dialog.showModal();
    if (!open && this.dialog.open) this.dialog.close();
    document.body.classList.toggle("party-flow-open", open);
  }
  render() {
    const p = this.party,
      s = p.state;
    this.syncVisibility();
    if (!s) {
      this.localSetup = false;
      return;
    }
    if (s.stage !== "home") this.localSetup = false;
    const host = s.hostId === p.playerId;
    const launch =
      this.dialog.querySelector<HTMLButtonElement>("#party-launch")!;
    launch.hidden = !host;
    launch.disabled =
      p.busy ||
      s.members.some((m) => m.team === null) ||
      ([0, 1] as const).some(
        (team) =>
          s.members.filter((m) => m.team === team).length !==
          teamCapacity(s.mode, team),
      );
    this.dialog.querySelector<HTMLButtonElement>("#party-mode-leave")!.hidden =
      host;
    this.dialog.querySelector<HTMLButtonElement>(
      "#party-mode-leave",
    )!.disabled = p.busy;
    this.dialog.dataset.stage = s.stage;
    this.dialog.querySelector<HTMLElement>("#party-mode-screen")!.hidden =
      s.stage !== "mode" && !(s.stage === "home" && this.localSetup);
    this.dialog.querySelector<HTMLElement>("#party-team-screen")!.hidden =
      s.stage !== "teams";
    this.dialog.querySelector<HTMLElement>(".party-flow-host")!.textContent =
      host ? "" : "HOST IS CHOOSING";
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-cycle],#party-setup-launch")
      .forEach((b) => (b.disabled = !host || p.busy));
    const updateSelector = (id: string, label: string) => {
      const el = this.dialog.querySelector<HTMLElement>(id)!;
      if (el.textContent === label) return;
      el.textContent = label;
      el.animate(
        [
          {
            opacity: 0,
            transform:
              "translateX(" +
              (this.dialog.dataset.direction === "left" ? -25 : 25) +
              "%)",
          },
          { opacity: 1, transform: "translateX(0)" },
        ],
        { duration: 180, easing: "ease-out" },
      );
    };
    updateSelector(
      "#setup-gamemode",
      soccerModes.find((m) => m.id === (s.gameMode ?? "soccar"))!.label,
    );
    updateSelector(
      "#setup-players",
      s.mode === "1v1" ? "1v1" : s.mode === "2v2" ? "2v2" : "2vBOTS",
    );
    this.dialog
      .querySelectorAll<HTMLButtonElement>("[data-stage]")
      .forEach((b) => {
        b.hidden = !host;
        b.disabled = p.busy;
      });
    this.dialog.querySelector<HTMLElement>("#party-match-mode")!.textContent =
      soccerModes.find((m) => m.id === (s.gameMode ?? "soccar"))!.label +
      " / " +
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
          : m
            ? displayIdentity(m)
            : "OPEN SLOT";
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
        ? "CHOOSING A SIDE · " +
          waiting.map((m) => displayIdentity(m)).join(" · ")
        : "";
    this.dialog.querySelector<HTMLElement>("#party-flow-message")!.textContent =
      p.message;
    this.dialog.querySelector<HTMLButtonElement>(
      "#party-team-leave",
    )!.disabled = p.busy;
  }
}
