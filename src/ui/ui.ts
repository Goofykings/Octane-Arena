import type { Match } from "../game/match";
import type { Profile } from "../game/inventory";
import { icon } from "./icons";
import { extraModes } from "../extra/session";
import { trainingPacks } from "../extra/training/packs";
import {
  displayIdentity,
  defaultAvatarColor,
} from "../../shared/local-profile";
export class UI {
  leaveConfirmation = false;
  root = document.querySelector<HTMLDivElement>("#app")!;
  screen: "home" | "modes" | "freeplay" | "extras" | "training" | "garage" =
    "home";
  constructor() {
    this.root.innerHTML = `<div id="viewport"></div><div id="home-shade"></div><header id="brand"><h1>OCTANE <span>ARENA</span></h1></header>
    <section id="menu" class="screen"><nav class="home-nav"><button id="play" class="nav-button primary">PLAY <span aria-hidden="true">↗</span></button><button id="garage-open" class="nav-button">GARAGE</button><button id="settings-open" class="nav-button">SETTINGS</button></nav></section>
    <button id="profile" aria-label="Open profile"><div class="avatar">${icon("profile")}</div><div><b id="profile-name">Guest</b><span id="profile-title">Rookie</span></div><div class="level"><small>LEVEL</small><b id="profile-level">1</b></div></button>
    <section id="modes" class="screen full-screen" hidden><h2>PLAY</h2><div class="mode-grid"><button id="bot-mode" class="mode-card">${icon("bot")}<strong>AGAINST A BOT</strong></button><button id="freeplay-mode" class="mode-card">${icon("freeplay")}<strong>FREE PLAY</strong></button><button id="friend-mode" class="mode-card">${icon("friend")}<strong>AGAINST A FRIEND</strong></button><button id="extra-mode" class="mode-card">${icon("extras")}<strong>EXTRA MODES</strong></button></div><footer class="screen-footer"><button id="modes-back" class="back-button">← BACK</button></footer></section>
    <section id="extras" class="screen full-screen" hidden><h2>EXTRA MODES</h2><div class="mode-grid extra-grid">${extraModes.map((mode) => `<button id="${mode.id}-mode" class="mode-card">${icon(mode.icon)}<strong>${mode.name}</strong></button>`).join("")}</div><footer class="screen-footer"><button id="extras-back" class="back-button">← BACK</button></footer></section>
    <section id="training-menu" class="screen full-screen" hidden><h2>TRAINING PACKS</h2><div class="mode-grid extra-grid">${trainingPacks.map((pack) => `<button id="training-${pack.id}" class="mode-card">${icon(pack.type === "aerial" ? "boost" : pack.type === "goalie" ? "ranked" : "freeplay")}<strong>${pack.name}</strong><small>${pack.description}</small></button>`).join("")}</div><footer class="screen-footer"><button id="training-back" class="back-button">← BACK</button></footer></section>
    <section id="freeplay-setup" class="screen full-screen" hidden><h2>FREE PLAY</h2><footer class="screen-footer"><button id="freeplay-back" class="back-button">← BACK</button><button id="freeplay-launch" class="nav-button primary">ENTER FREE PLAY</button></footer></section>
    <section id="garage-screen" class="screen full-screen" hidden></section>
    <div id="hud" hidden><div class="scoreboard"><span id="score-cyan">0</span><time id="clock">5:00</time><span id="score-amber">0</span></div><div id="notice" aria-live="polite"></div><div id="countdown" aria-live="polite"></div><div class="camera-status"><i></i><b id="camera-mode">BALL CAMERA</b></div><div class="boost-hud"><svg viewBox="0 0 160 160" aria-hidden="true"><path class="boost-track" d="M128 128 A68 68 0 1 0 32 128" pathLength="100"/><path id="boost-fill" d="M32 128 A68 68 0 1 1 128 128" pathLength="100"/></svg><div id="boost">100</div><div id="boost-label">BOOST</div></div><div id="bot-tag" hidden></div></div>
    <section id="pause" class="modal" hidden><div class="modal-card"><h2>PAUSED</h2><button id="resume" class="nav-button primary">RESUME</button><button id="pause-settings" class="nav-button">SETTINGS</button><button id="pause-controls" class="nav-button">CONTROLS</button><button id="pause-reset" class="nav-button">RESET</button><button id="pause-home" class="nav-button">LEAVE MATCH</button></div></section>
    <section id="result" class="modal" hidden><div class="modal-card"><h2 id="result-title"></h2><p id="result-score"></p><button id="again" class="nav-button primary">PLAY AGAIN</button><button id="home" class="nav-button">HOME</button></div></section><dialog id="settings"></dialog><dialog id="account" aria-label="Account"></dialog><pre id="debug" hidden></pre>`;
  }
  on(id: string, fn: () => void) {
    document.getElementById(id)!.addEventListener("click", fn);
  }
  modes(show: boolean) {
    this.screen = show ? "modes" : "home";
  }
  setProfile(profile: Profile) {
    document.querySelector("#profile .avatar")!.innerHTML = icon(
      profile.avatarId ?? "helmet",
    );
    (document.querySelector("#profile .avatar") as HTMLElement).style.color =
      profile.avatarColor ?? defaultAvatarColor;
    document.getElementById("profile-name")!.textContent =
      displayIdentity(profile);
    document
      .getElementById("profile")!
      .setAttribute("aria-label", "Customize Account");
    document.getElementById("profile-title")!.textContent = profile.title;
    document.getElementById("profile-level")!.textContent = String(
      profile.level,
    );
  }
  pickup() {
    const hud = document.querySelector(".boost-hud")!;
    hud.getAnimations().forEach((a) => a.cancel());
    hud.animate(
      [
        { filter: "brightness(2)", transform: "scale(1.08)" },
        { filter: "brightness(1)", transform: "scale(1)" },
      ],
      { duration: 280, easing: "ease-out" },
    );
  }
  extraGame(boost: number, sonic: boolean, ballMode = false) {
    for (const id of [
      "menu",
      "brand",
      "profile",
      "home-shade",
      "modes",
      "freeplay-setup",
      "extras",
      "training-menu",
      "garage-screen",
      "pause",
      "result",
      "bot-tag",
    ])
      document.getElementById(id)!.hidden = true;
    document.getElementById("hud")!.hidden = false;
    (document.querySelector(".scoreboard") as HTMLElement).hidden = true;
    document.getElementById("countdown")!.textContent = "";
    document.getElementById("notice")!.textContent = "";
    document.getElementById("camera-mode")!.textContent = ballMode
      ? "BALL CAMERA"
      : "CAR CAMERA";
    document.getElementById("boost")!.textContent = String(Math.ceil(boost));
    document.getElementById("boost-fill")!.style.strokeDasharray =
      `${boost} 100`;
    document.getElementById("boost-label")!.textContent = sonic
      ? "SUPERSONIC"
      : "BOOST";
    this.root.dataset.screen = "extra-game";
  }
  update(m: Match, boost: number, ballCamera: boolean, sonic: boolean) {
    const set = (id: string, text: string) => {
      const e = document.getElementById(id)!;
      if (e.textContent !== text) {
        e.textContent = text;
        if (
          (id.startsWith("score-") || id === "notice" || id === "countdown") &&
          text &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          e.animate(
            [
              { filter: "brightness(2.5)", opacity: 0.4 },
              { filter: "brightness(1)", opacity: 1 },
            ],
            { duration: 240 },
          );
      }
    };
    const home = m.phase === "home";
    document.getElementById("pause-reset")!.hidden = !m.rules.training;
    (document.querySelector(".scoreboard") as HTMLElement).hidden =
      !m.rules.scoreboard || m.replayActive;
    for (const [id, show] of [
      ["menu", home && this.screen === "home"],
      ["brand", home && this.screen === "home"],
      ["profile", home && this.screen === "home"],
      ["home-shade", home],
      ["modes", home && this.screen === "modes"],
      ["freeplay-setup", home && this.screen === "freeplay"],
      ["extras", home && this.screen === "extras"],
      ["training-menu", home && this.screen === "training"],
      ["garage-screen", home && this.screen === "garage"],
      ["hud", !home && m.phase !== "finished" && !m.replayActive],
      ["pause", m.phase === "paused" && !this.leaveConfirmation],
      ["result", m.phase === "finished"],
    ] as const)
      document.getElementById(id)!.hidden = !show;
    this.root.dataset.screen = home ? this.screen : "game";
    set("score-cyan", String(m.score[0]));
    set("score-amber", String(m.score[1]));
    const t = Math.ceil(m.remaining);
    set(
      "clock",
      m.mode === "freeplay"
        ? "FREE PLAY"
        : m.overtime
          ? "OT"
          : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`,
    );
    set("boost", String(Math.ceil(boost)));
    document.getElementById("boost-fill")!.style.strokeDasharray =
      `${boost} 100`;
    set("boost-label", sonic ? "SUPERSONIC" : "BOOST");
    set(
      "notice",
      m.phase === "goal"
        ? m.message
        : m.overtime && m.phase === "countdown"
          ? "OVERTIME"
          : "",
    );
    set(
      "countdown",
      m.phase === "countdown"
        ? String(Math.ceil(m.countdown))
        : m.phase === "playing" && m.goTime > 0
          ? "GO!"
          : "",
    );
    set("camera-mode", ballCamera ? "BALL CAMERA" : "CAR CAMERA");
    set("result-title", m.message);
    set("result-score", `${m.score[0]} — ${m.score[1]}`);
  }
}
