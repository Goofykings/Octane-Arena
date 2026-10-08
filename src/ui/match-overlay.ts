import type { Input } from "../input/input";
import type { NetPlayer } from "../../shared/network";
import type {
  PlayerMatchStats,
  MatchStatEvent,
} from "../../shared/match-stats";
import { CHAT, type ChatMessage } from "../../shared/chat";
import { displayIdentity } from "../../shared/local-profile";
import { scoreboardOrder } from "../../shared/match-stats";
const symbols = {
  SHOT: '<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>',
  SAVE: '<path d="M12 2 21 6v6c0 5-9 10-9 10S3 17 3 12V6Z"/>',
  ASSIST: '<path d="M3 8h16m-5-5 5 5-5 5M21 16H5m5-5-5 5 5 5"/>',
  GOAL: '<circle cx="12" cy="12" r="9"/><path d="m12 6 5 4-2 6H9l-2-6Z"/>',
};
export class MatchOverlay {
  readonly chat = document.createElement("section");
  readonly board = document.createElement("section");
  readonly notice = document.createElement("div");
  readonly field = document.createElement("input");
  typing = false;
  private chatAllowed = false;
  private matchId = "";
  private activity = -Infinity;
  private chatSequence = 0;
  private log = document.createElement("div");
  private error = document.createElement("small");
  private boardSignature = "";
  private eventSequence = 0;
  private queue: MatchStatEvent[] = [];
  private showing = false;
  private errorText = "";
  private animation: Animation | null = null;
  constructor(
    root: HTMLElement,
    private input: Input,
    private send: (text: string) => boolean,
    private onOpen: () => void,
    private sound: () => void,
  ) {
    this.chat.id = "match-chat";
    this.chat.setAttribute("aria-label", "Match chat");
    this.log.className = "chat-lines";
    this.log.setAttribute("role", "log");
    this.log.setAttribute("aria-live", "polite");
    this.field.id = "chat-input";
    this.field.maxLength = CHAT.maxLength * 2;
    this.field.placeholder = "MESSAGE";
    this.field.setAttribute("aria-label", "Chat message");
    this.field.hidden = true;
    this.chat.append(this.log, this.field, this.error);
    this.board.id = "match-board";
    this.board.hidden = true;
    this.board.setAttribute("aria-label", "Match scoreboard");
    this.notice.id = "match-award";
    this.notice.hidden = true;
    root.append(this.chat, this.board, this.notice);
    this.chat.addEventListener("pointerdown", (e) => e.stopPropagation());
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.typing && e.key === "Escape") {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.close();
          return;
        }
        if (
          e.code !== input.bindings.chat ||
          this.typing ||
          !this.chatAllowed ||
          input.capturing ||
          document.querySelector("dialog[open]") ||
          (e.target as HTMLElement)?.matches("input,textarea,[contenteditable]")
        )
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        this.open();
      },
      true,
    );
    this.field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (this.send(this.field.value)) {
          this.field.value = "";
          this.close();
        }
      }
    });
    window.addEventListener("blur", () => this.close());
  }
  open() {
    if (!this.chatAllowed) return;
    this.typing = this.input.typing = true;
    this.input.clear();
    this.onOpen();
    this.field.hidden = false;
    this.chat.classList.add("typing", "shown");
    this.activity = performance.now();
    this.field.focus();
  }
  close() {
    if (!this.typing) return;
    this.typing = this.input.typing = false;
    this.input.clear();
    this.field.hidden = true;
    this.field.value = "";
    this.chat.classList.remove("typing");
    this.field.blur();
    this.activity = performance.now();
  }
  private reset(id: string, events: MatchStatEvent[]) {
    this.close();
    this.matchId = id;
    this.chatSequence = 0;
    this.activity = -Infinity;
    this.log.replaceChildren();
    this.queue = [];
    this.animation = null;
    this.notice.getAnimations().forEach((a) => a.cancel());
    this.notice.hidden = true;
    this.showing = false;
    this.eventSequence = events.at(-1)?.id ?? 0;
    this.boardSignature = "";
  }
  update(
    id: string,
    players: NetPlayer[] | import("../../shared/player").PlayerEntity[],
    stats: PlayerMatchStats[],
    events: MatchStatEvent[],
    score: number[],
    localId: string,
    held: boolean,
    multiplayer: boolean,
    chat: ChatMessage[] = [],
    error = "",
    menu = false,
  ) {
    if (id !== this.matchId) this.reset(id, events);
    this.chatAllowed = multiplayer && !!id && !menu;
    if (!this.chatAllowed) this.close();
    if (chat.at(-1)?.id !== this.chatSequence && chat.length) {
      this.chatSequence = chat.at(-1)!.id;
      this.log.replaceChildren();
      for (const message of chat) {
        const player = players.find((p) => p.id === message.playerId);
        if (!player) continue;
        const line = document.createElement("div"),
          name = document.createElement("b"),
          text = document.createElement("span");
        name.dataset.team = String(player.team);
        name.textContent = displayIdentity(player) + ": ";
        text.textContent = message.text;
        line.append(name, text);
        this.log.append(line);
      }
      this.log.scrollTop = this.log.scrollHeight;
      this.activity = performance.now();
    }
    this.error.textContent = error;
    if (error && error !== this.errorText) this.activity = performance.now();
    this.errorText = error;
    this.chat.classList.toggle(
      "shown",
      this.chatAllowed &&
        (this.typing || performance.now() - this.activity < CHAT.fadeDelayMs),
    );
    this.board.hidden = !held || !id || menu;
    const signature = JSON.stringify([
      players.map((p) => [p.id, p.name, p.team]),
      stats,
      score,
      localId,
    ]);
    if (!this.board.hidden && signature !== this.boardSignature) {
      this.boardSignature = signature;
      this.board.replaceChildren();
      for (const team of [0, 1] as const) {
        const section = document.createElement("section");
        section.dataset.team = String(team);
        const heading = document.createElement("header"),
          label = document.createElement("b"),
          points = document.createElement("strong");
        label.textContent = team === 0 ? "BLUE" : "ORANGE";
        points.textContent = String(score[team] ?? 0);
        heading.append(label, points);
        section.append(heading);
        const cols = document.createElement("div");
        cols.className = "stat-row stat-columns";
        for (const [wide, compact] of [
          ["PLAYER", "PLAYER"],
          ["SCORE", "SCORE"],
          ["GOALS", "G"],
          ["ASSISTS", "A"],
          ["SAVES", "SV"],
          ["SHOTS", "SH"],
          ["PING", "PING"],
        ]) {
          const cell = document.createElement("span");
          cell.textContent = wide;
          cell.dataset.compact = compact;
          cols.append(cell);
        }
        section.append(cols);
        for (const p of scoreboardOrder(players, stats, team)) {
          const s = stats.find((s) => s.playerId === p.id);
          const row = document.createElement("div");
          row.className =
            "stat-row" + (p.id === localId ? " local-player" : "");
          row.dataset.player = p.id;
          const values = [
            displayIdentity(p),
            s?.score ?? 0,
            s?.goals ?? 0,
            s?.assists ?? 0,
            s?.saves ?? 0,
            s?.shots ?? 0,
            s?.ping ?? "--",
          ];
          values.forEach((value, i) => {
            const cell = document.createElement("span");
            cell.textContent = String(value);
            if (i === 0) cell.title = String(value);
            row.append(cell);
          });
          section.append(row);
        }
        this.board.append(section);
      }
    }
    for (const event of events)
      if (event.id > this.eventSequence) {
        this.eventSequence = event.id;
        if (event.playerId === localId && event.type !== "BALL_TOUCH")
          this.queue.push(event);
      }
    if (this.queue.length > 8) this.queue = this.queue.slice(-8);
    if (!this.showing && this.queue.length && !menu) this.showAward();
  }
  hide() {
    this.chatAllowed = false;
    this.close();
    this.chat.classList.remove("shown");
    this.board.hidden = true;
    this.notice.hidden = true;
  }
  private showAward() {
    const event = this.queue.shift()!;
    this.showing = true;
    this.notice.hidden = false;
    this.notice.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">' +
      symbols[event.type as keyof typeof symbols] +
      "</svg>";
    const text = document.createElement("strong"),
      points = document.createElement("span");
    text.textContent = event.type === "SHOT" ? "SHOT ON GOAL" : event.type;
    points.textContent = "+" + event.scoreAward;
    this.notice.append(text, points);
    this.sound();
    const animation = this.notice.animate(
      [
        { transform: "translate(-50%,-180px)", opacity: 0, offset: 0 },
        { transform: "translate(-50%,0)", opacity: 1, offset: 0.14 },
        { transform: "translate(-50%,0)", opacity: 1, offset: 0.84 },
        { transform: "translate(-50%,-180px)", opacity: 0, offset: 1 },
      ],
      { duration: 1300, easing: "ease-in-out" },
    );
    this.animation = animation;
    animation.finished
      .catch(() => {})
      .then(() => {
        if (this.animation !== animation) return;
        this.animation = null;
        this.showing = false;
        this.notice.hidden = true;
      });
  }
}
