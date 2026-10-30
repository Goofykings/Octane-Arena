import { CustomTrainingSession } from "./extra/training/custom-session";
import { RocketPassPanel } from "./ui/rocket-pass-panel";
import { TrainingEditorPanel } from "./ui/training-editor-panel";
import { ARENA_CARS, loadArenaCars } from "./render/arena-car-model";
import { loadToppers } from "./render/toppers";
// Bots cycle through the polished GLB lineup.
const BOT_BODIES = Object.keys(ARENA_CARS) as (keyof typeof ARENA_CARS)[];
import { FirebaseTrainingPacks } from "./network/firebase-training";
import {
  CustomTrainingLibrary,
  LocalTrainingPackStorage,
} from "./game/custom-training";
import { CustomTrainingPanel } from "./ui/custom-training-panel";
import { Challenges } from "./game/challenges";
import { ChallengesPanel } from "./ui/challenges-panel";
import { ProgressionPanel } from "./ui/progression-panel";
import type { MatchCompletion } from "../shared/progression";
import { dropshotBall, replayDropshot } from "./render/dropshot";
import { LandingPulse } from "./effects/landing-pulse";
import { InterfaceFeedback } from "./ui/interface-feedback";
import { hoopsBall } from "./render/hoops";
import { DEFAULT_MUTATORS } from "../shared/mutators";
import { MatchLoading, type PreparationJob } from "./ui/match-loading";
import { MenuNavigation } from "./input/menu-navigation";
import { AirSpeedEffect } from "./effects/air-speed";
import { PartyClient } from "./game/party";
import { NetworkClient } from "./game/network";
import { NetworkMatchView } from "./render/network-match";
import { PartyPanel } from "./ui/party-panel";
import { HomeLobby } from "./render/home-lobby";
import RAPIER from "@dimforge/rapier3d-compat";
import * as T from "three";
import "./style.css";
import "./ui/polish.css";
import { Simulation } from "./physics/simulation";
import { FixedLoop } from "./physics/loop";
import { Input } from "./input/input";
import { BotNametags } from "./ui/bot-nametags";
import { BotTeam } from "./ai/team";
import { botRoster } from "../shared/bots";
import { BotSetup } from "./ui/bot-setup";
import { Match } from "./game/match";
import { Pads } from "./game/pads";
import { GameCamera } from "./camera/camera";
import {
  carModel,
  ballModel,
  animateBall,
  animateWheels,
  disposeModel,
} from "./render/models";
import { drawArena } from "./render/arena";
import {
  loadArenaChoice,
  saveArenaChoice,
  arenaThemes,
} from "./render/arena-themes";
import { ArenaSelect } from "./ui/arena-select";
import { chooseMatchArena, type ArenaId } from "../shared/arenas";
import { Effects } from "./effects/effects";
import { GameAudio } from "./audio/audio";
import { DebugView } from "./debug/debug";
import { UI } from "./ui/ui";
import { P } from "./config/physics";
import { neutral } from "./input/types";
import { Settings, qualities } from "./game/settings";
import { Garage } from "./game/inventory";
import { SettingsPanel } from "./ui/settings-panel";
import { GaragePanel } from "./ui/garage-panel";
import { GaragePreview } from "./render/garage-preview";
import { Graphics } from "./render/graphics";
import { Hitboxes } from "./debug/hitboxes";
import { VehicleEffects } from "./effects/vehicle-effects";
import { GoalExplosion } from "./effects/goal-explosion";
import { JumpBurst } from "./effects/jump-burst";
import { BallHeightIndicator } from "./effects/ball-height";
import { Accounts } from "./game/accounts";
import { displayIdentity, newLocalPlayerId } from "../shared/local-profile";
import { trainingActions } from "./input/bindings";
import { trainingAction } from "./game/training";
import { SkidMarks } from "./effects/skid-marks";
import { GoalPlanes } from "./effects/goal-plane";
import { BallTrails, FlipTrails } from "./effects/motion-trails";
import { heatseekerBall, heatIntensity } from "./effects/heatseeker-ball";
import { PadRecharge } from "./render/pad-recharge";
import { DemolitionFlash } from "./effects/demolition-flash";
import { extraModes, type ExtraSession } from "./extra/session";
import { TrainingSession } from "./extra/training/session";
import { trainingPacks } from "./extra/training/packs";
import { ExtraModePanel } from "./ui/extra-mode-panel";
import { ReplayScenePlayback } from "./replay/scene-playback";
import { ReplayPanel } from "./ui/replay-panel";
import { MouseLook } from "./camera/mouse-look";
import { CameraDrag } from "./input/camera-drag";
import { FeedbackPanel } from "./ui/feedback-panel";
import { GAME_VERSION } from "./config/version";
import { VersionPanel } from "./ui/version-panel";
import { MatchOverlay } from "./ui/match-overlay";
import { MusicManager } from "./audio/music";
import { NowPlaying } from "./ui/start-screen";
import { RumbleEffects } from "./effects/rumble";
import { RumbleHud } from "./ui/rumble-hud";
import { RUMBLE_CONFIG as R } from "./config/rumble";
import { keyName } from "./input/bindings";
import type { RumbleItem } from "../shared/rumble";
import { controllerName } from "../shared/controller";

async function boot() {
  // The car GLB loads alongside physics init; on failure cars use the procedural body.
  await Promise.all([RAPIER.init(), loadArenaCars(), loadToppers()]);
  const settings = new Settings(),
    garage = new Garage(),
    ui = new UI(),
    airSpeed = new AirSpeedEffect(ui.root),
    simulation = new Simulation(),
    input = new Input(settings.value.bindings, settings.value.controller),
    botNametags = new BotNametags(document.getElementById("bot-tag")!),
    match = new Match(),
    pads = new Pads(),
    audio = new GameAudio(),
    music = new MusicManager(),
    nowPlaying = new NowPlaying();
  const interfaceFeedback = new InterfaceFeedback(ui.root, audio);
  music.onTrack = (track) => nowPlaying.show(track);
  music.setVolume(settings.value.audio.music);
  ui.setProfile(garage.profile);
  let audioUnlocked = false;
  const unlockAudio = () => {
    if (audioUnlocked) return;
    audioUnlocked = true;
    audio.unlock();
    music.unlock();
    input.clear();
  };
  window.addEventListener("keydown", unlockAudio, { capture: true });
  window.addEventListener("pointerdown", unlockAudio, { capture: true });
  const padPoll = window.setInterval(() => {
    for (const p of navigator.getGamepads?.() ?? []) {
      if (p?.connected && p.buttons.some((b) => b.pressed)) {
        unlockAudio();
        break;
      }
    }
    if (audioUnlocked) window.clearInterval(padPoll);
  }, 120);
  void music.playContext("menu");
  const renderer = new T.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  document.getElementById("viewport")!.appendChild(renderer.domElement);
  const scene = new T.Scene();
  scene.background = new T.Color(0x28354c);
  scene.fog = new T.Fog(0x28354c, 105, 290);
  scene.add(new T.HemisphereLight(0xc5e8ff, 0x426453, 2.5));
  const sun = new T.DirectionalLight(0xffeed9, 3.2);
  sun.position.set(20, 50, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -55,
    right: 55,
    top: 65,
    bottom: -65,
    near: 1,
    far: 120,
  });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const arena = drawArena(scene, loadArenaChoice());
  let freeplayArena = arena.mapId;
  let previousMatchArena: ArenaId | undefined;
  new ArenaSelect(arena.mapId, (id) => {
    freeplayArena = id;
    arena.setMap(id);
    saveArenaChoice(id);
    const caption = document.querySelector(".arena-caption");
    if (caption) caption.textContent = arenaThemes[id].name.toUpperCase();
  });
  const visuals = [
    carModel(
      new T.Color(garage.current.blue).getHex(),
      garage.current.body,
      garage.current.wheels,
      garage.current.topper,
    ),
    carModel(0xfa9c3e, "vector"),
  ];
  const cars = visuals.map((model) => {
      const root = new T.Group();
      root.add(model);
      return root;
    }),
    ball = ballModel();
  scene.add(...cars, ball);
  const goalPlanes = new GoalPlanes(scene, ball);
  const rumbleSound = (item: RumbleItem, attached = false) => {
    const cue = attached ? R.attachmentAudio : R.audio[item];
    audio.tone(cue[0], cue[1], cue[2], cue[3], "sfx");
  };
  const rumbleEffects = new RumbleEffects(scene, rumbleSound);
  const rumbleHud = new RumbleHud(ui.root);
  const ballTrails = new BallTrails(scene);
  const flipTrails = cars.map(() => new FlipTrails(scene));
  const jumpBursts = cars.map(() => new JumpBurst(scene));
  const skidMarks = cars.map(() => new SkidMarks(scene));
  const demoFlashes = cars.map(() => new DemolitionFlash(scene));
  const ballHeight = new BallHeightIndicator(scene);
  const padMeshes = pads.items.map((p) => {
    const group = new T.Group(),
      ring = new T.Mesh(
        new T.TorusGeometry(p.large ? 0.95 : 0.5, 0.045, 6, 24),
        new T.MeshBasicMaterial({ color: 0xfeb84f }),
      );
    group.name = "boost-pad";
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    const crystal = new T.Mesh(
      new T.OctahedronGeometry(p.large ? 0.3 : 0.14),
      new T.MeshBasicMaterial({ color: 0xffd181 }),
    );
    crystal.position.y = p.large ? 0.5 : 0.2;
    group.add(crystal);
    const base = new T.Mesh(
      new T.CircleGeometry(p.large ? 1.08 : 0.61, 24),
      new T.MeshBasicMaterial({
        color: 0x243b40,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = -0.025;
    group.add(base);
    group.position.set(p.x, 0.06, p.z);
    scene.add(group);
    return group;
  });
  const camera = new T.PerspectiveCamera(
      76,
      innerWidth / innerHeight,
      0.05,
      340,
    ),
    cameraControl = new GameCamera(camera),
    effects = new Effects(scene),
    debug = new DebugView(scene, document.getElementById("debug")!);
  const padRecharge = padMeshes.map(
    (mesh, i) => new PadRecharge(mesh, pads.items[i].large),
  );
  const vehicleEffects = cars.map(
    (car, i) => new VehicleEffects(car, scene, i === 0 ? 0x69e9ff : 0xffb654),
  );
  const explosion = new GoalExplosion(scene);
  let replayView = new ReplayScenePlayback(
    camera,
    cars,
    visuals,
    ball,
    simulation.cars,
    {
      vehicles: vehicleEffects,
      ball: ballTrails,
      flips: flipTrails,
      jumps: jumpBursts,
      skids: skidMarks,
      demos: demoFlashes,
      explosion,
      rumble: rumbleEffects,
    },
  );
  const replayPanel = new ReplayPanel(ui.root, () => {
    if (extraSession?.replayActive) {
      extraSession.skipReplay?.();
      input.clear();
    } else if (networkActive) network.skipReplay();
    else if (match.replay)
      match.skipReplay(
        simulation.cars[0].id,
        match.replay.clip.goal.id,
        simulation,
      );
  });
  const graphics = new Graphics(renderer, scene, camera, sun),
    hitboxes = new Hitboxes(scene);
  const preview = new GaragePreview(document.getElementById("garage-screen")!);
  match.explosionFor = (id) =>
    id === simulation.cars[0].id ? garage.current.explosion : "pulse";
  const updatePreset = () => {
    const p = garage.current;
    cars[0].remove(visuals[0]);
    disposeModel(visuals[0]);
    visuals[0] = carModel(
      new T.Color(p.blue).getHex(),
      p.body,
      p.wheels,
      p.topper,
    );
    cars[0].add(visuals[0]);
    simulation.cars[0].setBody(p.body);
    simulation.cars[1].setBody("vector");
    vehicleEffects[0].setStyle(p.boost);
    explosion.setStyle(p.explosion);
    preview.setPreset(p, garagePanel.team);
  };
  const garagePanel = new GaragePanel(garage, updatePreset, () => {
    ui.screen = "home";
    input.clear();
  });
  updatePreset();
  let goalSounds: (() => void)[] = [];
  const resetEffects = () => {
    goalSounds.forEach((stop) => stop());
    goalSounds = [];
    effects.reset();
    vehicleEffects.forEach((e) => e.reset());
    skidMarks.forEach((e) => e.reset());
    demoFlashes.forEach((e) => e.reset());
    explosion.reset();
    rumbleEffects.reset();
    rumbleHud.hide();
    ballTrails.reset();
    flipTrails.forEach((e) => e.reset());
    jumpBursts.forEach((e) => e.reset());
  };
  const applySettings = () => {
    input.bindings = settings.value.bindings;
    input.controller.settings = settings.value.controller;
    audio.settings = settings.value.audio;
    audio.apply();
    music.setVolume(settings.value.audio.music);
    cameraControl.settings = settings.value.camera;
    effects.density = qualities[settings.value.quality].particles;
    graphics.apply(settings.value.quality);
    LandingPulse.enabled = settings.value.quality !== "low";
    document.documentElement.dataset.quality = settings.value.quality;
    ballTrails.quality = settings.value.quality;
  };
  const settingsPanel = new SettingsPanel(settings, input, applySettings);
  const accounts = new Accounts(garage, settings, (progressionOnly = false) => {
    // Earning XP updates metadata without rebuilding models or touching colliders.
    if (!progressionOnly) {
      applySettings();
      updatePreset();
      garagePanel.render();
      simulation.cars[0].displayName = displayIdentity(garage.profile);
    }
    ui.setProfile(garage.profile);
  });
  // Physics, stat authority, replay and UI must share the same roster identity.
  // Updating only Car.id silently drops events against the old "player" key.
  Object.assign(simulation.players[0], {
    id: accounts.profile.value.localPlayerId,
    localPlayerId: accounts.profile.value.localPlayerId,
  });
  const rocketPass = new RocketPassPanel(
    ui.root,
    garage,
    accounts.profile,
    () => {
      ui.screen = "home";
      input.clear();
    },
    () => garagePanel.render(false),
  );
  ui.on("rocket-pass-open", () => {
    ui.screen = "rocket-pass";
    rocketPass.update();
    input.clear();
  });
  simulation.cars[0].id = simulation.players[0].id;
  const party = new PartyClient(garage),
    partyPanel = new PartyPanel(party),
    homeLobby = new HomeLobby(scene);
  document.querySelector(".arena-caption")!.textContent =
    arenaThemes[arena.mapId].name.toUpperCase();
  const network = new NetworkClient(party);
  let networkView: NetworkMatchView | null = null,
    networkActive = false,
    networkPaused = false,
    networkPhase = "",
    networkBoost = 0;
  const loadingMatch = new Match();
  loadingMatch.mode = "network";
  loadingMatch.phase = "countdown";
  loadingMatch.countdown = 0;
  const networkStatus = document.createElement("div");
  networkStatus.id = "network-status";
  networkStatus.hidden = true;
  const networkMenu = document.createElement("section");
  networkMenu.id = "network-menu";
  networkMenu.dataset.navScope = "network-menu";
  networkMenu.dataset.navPriority = "60";
  networkMenu.dataset.navDefault = "#network-resume";
  networkMenu.className = "modal";
  networkMenu.hidden = true;
  networkMenu.innerHTML =
    '<div class="modal-card"><h2 id="network-menu-title">MATCH MENU</h2><p id="network-menu-note">THE MATCH CONTINUES</p><button id="network-resume" data-nav-back class="nav-button primary">RESUME</button><button id="network-settings" class="nav-button">SETTINGS</button><button id="network-return" class="nav-button">RETURN TO LOBBY</button><button id="network-leave" class="nav-button">LEAVE MATCH</button></div>';
  ui.root.append(networkStatus, networkMenu);
  ui.on("network-resume", () => {
    networkPaused = false;
    input.clear();
  });
  ui.on("network-settings", () => settingsPanel.open());
  ui.on("network-leave", () => {
    network.clearInput();
    void party.action("leave");
  });
  ui.on("network-return", () => {
    void party.action("return");
  });
  const leaveDialog = document.createElement("dialog");
  leaveDialog.id = "leave-confirm";
  leaveDialog.setAttribute("aria-labelledby", "leave-title");
  leaveDialog.innerHTML =
    '<h2 id="leave-title">LEAVE MATCH?</h2><p>Are you sure you want to leave the game?</p><div><button id="leave-confirm-yes" class="nav-button">LEAVE MATCH</button><button id="leave-confirm-stay" class="nav-button primary" autofocus>STAY</button></div>';
  document.getElementById("app")!.append(leaveDialog);
  const stay = () => {
    leaveDialog.close();
    ui.leaveConfirmation = false;
    input.clear();
    if (match.phase === "paused") match.pause();
  };
  leaveDialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    stay();
  });
  leaveDialog.querySelector<HTMLButtonElement>("#leave-confirm-stay")!.onclick =
    stay;
  const loop = new FixedLoop();
  let extraSession: ExtraSession | null = null;
  let localMatchId = "";
  let dismissedResultsMatch = "";
  let extraPanel: ExtraModePanel | TrainingEditorPanel | null = null;
  const stopExtra = () => {
    replayPanel.hide();
    extraPanel?.dispose();
    extraPanel = null;
    extraSession?.dispose();
    extraSession = null;
    cameraControl.reset();
    input.clear();
    music.resumeLoop();
    if (match.phase === "home") void music.playContext("menu");
  };
  const matchLoader = new MatchLoading(ui.root);
  let partyArenaReady = "";
  const start = async (
    mode: "bot" | "freeplay" = match.mode === "freeplay" ? "freeplay" : "bot",
  ) => {
    if (matchLoader.active) return false;
    replayView.stop();
    input.clear();
    stopExtra();
    ui.modes(false);
    const local = {
      ...simulation.players[0],
      id: accounts.profile.value.localPlayerId,
      name: accounts.displayName,
    };
    const roster = botRoster(mode === "bot" ? botSetup.size : "1v1", local);
    const selectedArena =
      mode === "freeplay"
        ? freeplayArena
        : chooseMatchArena(previousMatchArena, Math.random, botSetup.gameMode);
    let preparedPhase: typeof match.phase = "countdown";
    const jobs: PreparationJob[] = [
      {
        name: "Physics",
        run: () => {
          simulation.configurePlayers(roster);
        },
      },
    ];
    for (let i = 0; i < roster.length; i++)
      jobs.push({
        name: "Cars and effects",
        run: () => {
          const body = BOT_BODIES[i % BOT_BODIES.length],
            color = roster[i].team === 0 ? 0x5ccce5 : 0xfa9c3e;
          if (i >= cars.length) {
            const model = carModel(color, body),
              root = new T.Group();
            root.add(model);
            root.visible = false;
            model.userData.matchKey = body + ":" + color;
            visuals.push(model);
            cars.push(root);
            scene.add(root);
            flipTrails.push(new FlipTrails(scene));
            jumpBursts.push(new JumpBurst(scene));
            skidMarks.push(new SkidMarks(scene));
            demoFlashes.push(new DemolitionFlash(scene));
            vehicleEffects.push(new VehicleEffects(root, scene, color));
          }
          if (i > 0) {
            const key = body + ":" + color;
            if (visuals[i].userData.matchKey !== key) {
              cars[i].remove(visuals[i]);
              disposeModel(visuals[i]);
              visuals[i] = carModel(color, body);
              visuals[i].userData.matchKey = key;
              cars[i].add(visuals[i]);
            }
            if (simulation.cars[i].bodyId !== body)
              simulation.cars[i].setBody(body);
            vehicleEffects[i].setColor(color);
          }
        },
      });
    jobs.push({
      name: "Arena",
      run: () => {
        if (mode !== "freeplay") previousMatchArena = selectedArena;
        arena.setMap(
          mode === "bot" && botSetup.gameMode === "hoops"
            ? "hoops"
            : selectedArena,
        );
        document.querySelector(".arena-caption")!.textContent =
          arenaThemes[selectedArena].name.toUpperCase();
      },
    });
    jobs.push({
      name: "Match resources",
      run: () => {
        for (let i = roster.length; i < cars.length; i++)
          cars[i].visible = false;
        resetEffects();
        updatePreset();
        match.gameMode =
          mode === "bot"
            ? botSetup.gameMode
            : arena.mapId === "dropshot"
              ? "dropshot"
              : arena.mapId === "hoops"
                ? "hoops"
                : "soccar";
        simulation.configureMutators(
          mode === "bot" ? botSetup.mutators : DEFAULT_MUTATORS,
        );
        ball.scale.setScalar(simulation.physics.ball.radius / P.ball.radius);
        localMatchId = newLocalPlayerId();
        match.start(simulation, mode, localMatchId);
        pads.configure(match.gameMode);
        hoopsBall(ball, match.gameMode === "hoops");
        goalPlanes.setMode(match.gameMode);
        preparedPhase = match.phase;
        match.phase = "home";
        simulation.rumble?.setPhase(false, true);
        arena.setNeutral(match.rules.training);
        goalPlanes.setNeutral(match.rules.training);
        pads.reset();
        simulation.cars.forEach((c, i) => {
          cars[i].position.copy(c.body.translation());
          cars[i].quaternion.copy(c.body.rotation());
          cars[i].visible = c.body.isEnabled();
        });
        ball.position.copy(simulation.ball.translation());
        ball.visible = true;
        replayView = new ReplayScenePlayback(
          camera,
          cars.slice(0, roster.length),
          visuals.slice(0, roster.length),
          ball,
          simulation.cars,
          {
            vehicles: vehicleEffects.slice(0, roster.length),
            ball: ballTrails,
            flips: flipTrails.slice(0, roster.length),
            jumps: jumpBursts.slice(0, roster.length),
            skids: skidMarks.slice(0, roster.length),
            demos: demoFlashes.slice(0, roster.length),
            explosion,
            rumble: rumbleEffects,
          },
        );
        match.recorder.prepare(simulation);
        if (match.stats) {
          matchOverlay.update(
            localMatchId,
            simulation.players,
            match.stats.snapshot(),
            [],
            match.score,
            simulation.cars[0].id,
            true,
            false,
          );
          matchOverlay.board.hidden = true;
        }
        simulation.cars[0].displayName = accounts.displayName;
      },
    });
    jobs.push({
      name: "Bot preparation",
      run: () => {
        botTeam = new BotTeam(botSetup.difficulty);
        if (mode === "bot") botTeam.prepare(simulation, pads);
      },
    });
    jobs.push({
      name: "Audio",
      run: () => {
        audio.unlock();
      },
    });
    jobs.push({
      name: "Materials and shaders",
      run: () => {
        camera.clearViewOffset();
        cameraControl.settings = settings.value.camera;
        cameraControl.reset();
        cameraControl.update(
          cars[0],
          ball,
          simulation,
          1 / 60,
          false,
          performance.now() / 1000,
        );
        return graphics.prepare(scene, camera);
      },
    });
    return matchLoader.run(
      jobs,
      () => {
        match.phase = preparedPhase;
        // In-game soundtrack: Slushii - LUV U NEED U (loops until the match ends).
        void music.playContext("game");
        simulation.rumble?.setPhase(match.phase === "playing", true);
        loop.accumulator = 0;
        previous = performance.now();
        input.clear();
        audio.tone(420, 0.12, 0.08, "sine");
      },
      home,
    );
  };
  const home = () => {
    matchLoader.cancel();
    replayView.stop();
    replayPanel.hide();
    stopExtra();
    leaveDialog.close();
    ui.leaveConfirmation = false;
    ui.modes(false);
    resetEffects();
    match.phase = "home";
    music.resumeLoop();
    // Back to the menu soundtrack: Slushii - All I Need.
    void music.playContext("menu");
    arena.setNeutral(false);
    goalPlanes.setNeutral(false);
    simulation.configureMutators();
    match.mutators = DEFAULT_MUTATORS;
    ball.scale.setScalar(1);
    simulation.reset();
    input.clear();
    audio.update(0, false, false);
  };
  ui.on("play", () => {
    audio.unlock();
    if (party.state) {
      if (party.state.hostId === party.playerId)
        void party.action("stage", { stage: "mode" });
      else partyPanel.flow.openSetup();
      input.clear();
    } else ui.modes(true);
  });
  let botTeam = new BotTeam("beginner");
  const botSetup = new BotSetup(
    ui.root,
    () => {
      ui.screen = "modes";
      input.clear();
    },
    () => start("bot"),
  );
  ui.on("bot-mode", () => {
    ui.screen = "bots";
    botSetup.show();
    input.clear();
  });
  ui.on("freeplay-mode", () => {
    ui.screen = "freeplay";
    input.clear();
  });
  ui.on("freeplay-back", () => {
    ui.screen = "modes";
    input.clear();
  });
  ui.on("freeplay-launch", () => start("freeplay"));
  ui.on("extra-mode", () => {
    ui.screen = "extras";
    input.clear();
  });
  ui.on("extras-back", () => {
    ui.screen = "modes";
    input.clear();
  });
  const launchExtra = (
    create: (
      options: Parameters<(typeof extraModes)[number]["create"]>[0],
    ) => ExtraSession,
  ) => {
    stopExtra();
    resetEffects();
    input.clear();
    audio.unlock();
    match.phase = "home";
    // Extra modes share the in-game soundtrack.
    void music.playContext("game");
    extraSession = create({
      camera,
      preset: garage.current,
      arenaId: arena.mapId,
      profile: accounts.profile,
      mouseLook,
      domElement: renderer.domElement,
      clearInput: () => input.clear(),
    });
    extraSession.vehicle.displayName = accounts.displayName;
    const restart = () => {
      extraSession?.reset();
      input.clear();
      audio.update(0, false, false);
    };
    const resume = () => {
      extraSession?.pause(performance.now());
      input.clear();
    };
    extraPanel =
      extraSession instanceof CustomTrainingSession
        ? new TrainingEditorPanel(
            ui.root,
            extraSession,
            customTraining,
            trainingCloud,
            () => accounts.displayName,
            () => {
              stopExtra();
              ui.screen = "training";
              customTrainingPanel.open();
            },
          )
        : new ExtraModePanel(ui.root, extraSession, {
            outcome: (success) =>
              audio.tone(
                success ? 740 : 220,
                success ? 0.12 : 0.08,
                0.04,
                "sine",
                "sfx",
              ),
            restart,
            exit: home,
            resume,
            settings: () => {
              if (extraSession && !extraSession.paused)
                extraSession.pause(performance.now());
              input.clear();
              settingsPanel.open();
            },
          });
    homeLobby.update([], camera, 0, performance.now() / 1000, false);
    partyPanel.host.hidden = true;
    partyPanel.flow.updateVisibility(false);
    hitboxes.update(simulation, false);
    ui.extraGame(100, false);
  };
  for (const mode of extraModes)
    ui.on(`${mode.id}-mode`, () => {
      if (mode.id === "training") {
        ui.screen = "training";
        input.clear();
      } else launchExtra(mode.create);
    });
  ui.on("training-back", () => {
    ui.screen = "extras";
    input.clear();
  });
  for (const pack of trainingPacks)
    ui.on(`training-${pack.id}`, () =>
      launchExtra((options) => new TrainingSession(options, pack)),
    );
  ui.on("friend-mode", () => {
    ui.modes(false);
    if (!party.state) void party.action("create");
  });
  ui.on("garage-open", () => {
    ui.screen = "garage";
    garagePanel.customizing = false;
    garagePanel.render();
    updatePreset();
    input.clear();
  });
  ui.on("modes-back", () => ui.modes(false));
  ui.on("again", async () => {
    if (party.state?.stage === "match") {
      if (party.state.hostId !== party.playerId) return;
      // One authority action replaces the match ID without an intermediate menu.
      await party.action("rematch");
    } else await start();
  });
  ui.on("resume", () => match.pause());
  ui.on("home", async () => {
    if (party.state?.stage === "match") {
      if (party.state.hostId === party.playerId) {
        if (!(await party.action("return"))) return;
        await party.action("stage", { stage: "home" });
      } else {
        // A guest may browse home while keeping the party/data connection alive.
        dismissedResultsMatch = party.state.matchId ?? "";
        networkView?.dispose();
        networkView = null;
        networkActive = false;
      }
    }
    matchOverlay.hide();
    home();
  });
  ui.on("results-leave", async () => {
    network.clearInput();
    await party.action("leave");
    matchOverlay.hide();
    home();
  });
  leaveDialog.querySelector<HTMLButtonElement>("#leave-confirm-yes")!.onclick =
    home;
  ui.on("pause-home", () => {
    if (match.mode !== "bot") {
      home();
      return;
    }
    if (match.active) match.pause();
    ui.leaveConfirmation = true;
    input.clear();
    leaveDialog.showModal();
  });
  const openSettings = () => {
    if (match.active) match.pause();
    settingsPanel.open();
  };
  ui.on("settings-open", openSettings);
  ui.on("pause-settings", openSettings);
  ui.on("pause-controls", () => settingsPanel.open("controls"));
  ui.on("pause-reset", () => {
    if (match.rules.training) {
      match.kickoff(simulation);
      resetEffects();
      pads.reset();
      cameraControl.reset();
    }
  });
  window.addEventListener("blur", () => {
    if (extraSession && !extraSession.paused)
      extraSession.pause(performance.now());
    if (match.active) match.pause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && extraSession && !extraSession.paused)
      extraSession.pause(performance.now());
    if (document.hidden && match.active) match.pause();
  });
  window.addEventListener("resize", () => {
    graphics.resize();
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  let previous = performance.now(),
    fps = 60,
    frameCount = 0,
    tickCount = 0,
    statsTime = 0,
    ticksPerSecond = 0;
  const mouseLook = new MouseLook();
  cameraControl.mouseLook = preview.mouseLook = mouseLook;
  const cameraDrag = new CameraDrag(ui.root, mouseLook, () => {
    if (matchLoader.active) return null;
    if (
      document.hidden ||
      input.typing ||
      document.querySelector("dialog[open]") ||
      ui.leaveConfirmation
    )
      return null;
    if (party.state?.stage === "match")
      return !networkPaused &&
        ["countdown", "playing", "goal"].includes(network.latest?.phase ?? "")
        ? "network"
        : null;
    if (extraSession?.editing) return null;
    if (extraSession)
      return !extraSession.paused && !extraSession.complete
        ? extraSession.supportsBallCam
          ? "dribble"
          : "rings"
        : null;
    if (match.phase === "home") {
      if (party.state && party.state.stage !== "home") return null;
      if (ui.screen === "home") return "home";
      if (
        ui.screen === "garage" &&
        (!garagePanel.customizing || garagePanel.category !== "explosion")
      )
        return "garage";
      return null;
    }
    return ["countdown", "playing", "goal"].includes(match.phase)
      ? "game"
      : null;
  });
  const matchOverlay = new MatchOverlay(
    ui.root,
    input,
    (text) => network.sendChat(text),
    () => {
      cameraDrag.stop();
      network.clearInput();
    },
    () => audio.tone(740, 0.09, 0.035, "sine", "sfx"),
  );
  const customTraining = new CustomTrainingLibrary(
    new LocalTrainingPackStorage(
      localStorage,
      accounts.profile.value.localPlayerId,
    ),
  );
  const trainingCloud = new FirebaseTrainingPacks();
  const customTrainingPanel = new CustomTrainingPanel(
    customTraining,
    ui.root,
    () => {
      cameraDrag.stop();
      input.clear();
    },
    {
      cloud: trainingCloud,
      username: () => accounts.displayName,
      edit: (id) => {
        const pack = customTraining.get(id);
        if (pack)
          launchExtra(
            (options) => new CustomTrainingSession(options, pack, true),
          );
      },
      play: (pack) =>
        launchExtra(
          (options) => new CustomTrainingSession(options, pack, false),
        ),
    },
  );
  let trainingPromoDismissed = false;
  ui.on("training-promo-open", () => {
    ui.screen = "training";
    customTrainingPanel.open();
  });
  ui.on("training-promo-close", () => {
    trainingPromoDismissed = true;
    document.getElementById("training-promo")!.hidden = true;
  });
  ui.on("training-create", () => customTrainingPanel.open());
  ui.on("training-community", () => customTrainingPanel.open(true));
  const challenges = new Challenges(accounts.profile);
  const challengesPanel = new ChallengesPanel(
    challenges,
    ui.root,
    () => audio.ui("confirm"),
    () => audio.tone(980, 0.18, 0.04, "sine", "sfx"),
    () => {
      cameraDrag.stop();
      input.clear();
    },
  );
  const progressionPanel = new ProgressionPanel(() =>
    audio.tone(880, 0.16, 0.04, "sine", "sfx"),
  );
  let progressionKey = "";
  const updateProgression = (
    completion: MatchCompletion | null | undefined,
    playerId: string,
    finished: boolean,
  ) => {
    const key =
      finished &&
      completion &&
      completion.players.some(
        (p) => p.id === playerId && p.controller !== "bot",
      )
        ? completion.id + ":" + playerId
        : "";
    if (key === progressionKey) return;
    progressionKey = key;
    progressionPanel.hide();
    if (!key || !completion) return;
    void challenges
      .settled()
      .then(() => accounts.profile.completeMatch(completion, playerId))
      .then((award) => {
        if (progressionKey === key)
          progressionPanel.show(award, accounts.profile.persistent);
      });
  };
  const versionPanel = new VersionPanel(ui.root, () => {
    cameraDrag.stop();
    input.clear();
  });
  const feedbackPanel = new FeedbackPanel(
    ui.root,
    () => ({
      username: accounts.profile.value.name,
      gameVersion: GAME_VERSION,
      screen: ui.screen,
      mode: party.state
        ? "party/" + (party.state.gameMode ?? "soccar") + "/" + party.state.mode
        : "home",
    }),
    () => {
      cameraDrag.stop();
      input.clear();
    },
  );
  const menuNavigation = new MenuNavigation(
    input.controller,
    () => {
      audio.ui("back");
      if (matchOverlay.typing) {
        matchOverlay.close();
        return;
      }
      const dialogs =
        document.querySelectorAll<HTMLDialogElement>("dialog[open]");
      if (dialogs.length) {
        const dialog = dialogs[dialogs.length - 1];
        const cancel = new Event("cancel", { cancelable: true });
        if (dialog.dispatchEvent(cancel)) dialog.close();
        return;
      }
      input.requestAction("pause");
    },
    () => {
      input.clear();
      audio.unlock();
    },
  );
  function updatePadVisuals(dt: number, replayPads?: Float32Array | null) {
    padMeshes.forEach((mesh, i) => {
      mesh.visible = i < pads.items.length;
    });
    pads.items.forEach((livePad, i) => {
      const cooldown = replayPads?.[i];
      const p =
        cooldown === undefined
          ? livePad
          : {
              ...livePad,
              cooldown,
              pulse: Math.max(0, 0.28 - (livePad.large ? 10 : 4) + cooldown),
            };
      padMeshes[i].position.set(p.x, 0.06, p.z);
      padRecharge[i].update(p);
      const pulse = (p.pulse ?? 0) / 0.28;
      padMeshes[i].children[1].visible = p.cooldown === 0 || pulse > 0;
      padMeshes[i].children[1].scale.setScalar(p.cooldown ? pulse : 1);
      padMeshes[i].children[0].scale.setScalar(1 + (1 - pulse) * pulse * 2);
      padMeshes[i].children[1].rotation.y += dt;
      const mat = (
        padMeshes[i].children[0] as T.Mesh<
          T.BufferGeometry,
          T.MeshBasicMaterial
        >
      ).material;
      mat.color.setHex(pulse > 0 ? 0xffefad : p.cooldown ? 0x354b42 : 0xfeb84f);
    });
  }
  function frame(now: number) {
    // A loader/initialization callback can advance the clock past this RAF
    // timestamp. Negative dt extrapolated the Home preview camera out of view.
    const dt = Math.min(Math.max(0, (now - previous) / 1000), 0.1);
    previous = now;
    if (matchLoader.active) {
      input.gameplayEnabled = false;
      input.clear();
      requestAnimationFrame(frame);
      return;
    }
    const previewArena =
      party.state?.stage === "teams" ? party.state.matchArenaId : undefined;
    if (
      previewArena &&
      (partyArenaReady !== previewArena || arena.mapId !== previewArena) &&
      match.phase === "home" &&
      !extraSession
    ) {
      partyPanel.flow.setArenaReady("");
      void matchLoader.run(
        [
          { name: "Party arena", run: () => arena.setMap(previewArena) },
          {
            name: "Materials and shaders",
            run: () => graphics.prepare(scene, camera),
          },
        ],
        () => {
          partyArenaReady = previewArena;
          partyPanel.flow.setArenaReady(previewArena);
          input.clear();
          previous = performance.now();
        },
        () => {
          party.message = "ARENA PREPARATION FAILED";
          home();
        },
      );
      requestAnimationFrame(frame);
      return;
    }
    const wasCapturing = input.capturing || input.controller.binding;
    const menuActive =
      !!document.querySelector("dialog[open]") ||
      ui.leaveConfirmation ||
      (party.state?.stage === "match"
        ? networkPaused || network.latest?.phase === "finished"
        : extraSession
          ? extraSession.paused ||
            extraSession.complete ||
            !!extraSession.editing
          : ["home", "paused", "finished"].includes(match.phase));
    input.gameplayEnabled = !menuActive;
    input.poll();
    settingsPanel.updateController();
    const replayUI =
      match.replayActive ||
      !!extraSession?.replayActive ||
      network.latest?.phase === "replay";
    menuNavigation.update(
      dt,
      menuActive || matchOverlay.typing || replayUI,
      wasCapturing || input.capturing,
    );
    cameraDrag.sync();
    const lookAllowed =
      !menuActive &&
      !input.typing &&
      !match.replayActive &&
      network.latest?.phase !== "replay";
    mouseLook.controllerLook(
      lookAllowed
        ? input.getAction("cameraRight") - input.getAction("cameraLeft")
        : 0,
      lookAllowed
        ? input.getAction("cameraDown") - input.getAction("cameraUp")
        : 0,
      dt,
    );
    mouseLook.update(dt, settings.value.camera);
    const homeControlsVisible =
      match.phase === "home" &&
      ui.screen === "home" &&
      !extraSession &&
      party.state?.stage !== "match" &&
      (!party.state || party.state.stage === "home");
    versionPanel.show(homeControlsVisible);
    feedbackPanel.show(homeControlsVisible);
    document.getElementById("training-promo")!.hidden =
      !homeControlsVisible || trainingPromoDismissed;
    challengesPanel.showHome(homeControlsVisible);
    const controls = input.sample(false);
    input.scoreboardActive =
      party.state?.stage === "match"
        ? !!network.latest &&
          (!networkPaused || network.latest.phase === "finished")
        : !extraSession &&
          match.mode === "bot" &&
          match.phase !== "home" &&
          match.phase !== "paused";
    const reverseHeld = input.isHeld("reverseCam");
    cameraControl.reverseHeld =
      reverseHeld && match.active && !match.replayActive;
    if (
      party.state?.stage === "match" &&
      party.state.matchId !== dismissedResultsMatch
    ) {
      if (!networkActive) {
        home();
        input.clear();
        audio.unlock();
        networkActive = true;
        networkPaused = false;
        networkPhase = "";
        networkBoost = 0;
        for (const dialog of document.querySelectorAll<HTMLDialogElement>(
          "dialog[open]",
        ))
          dialog.close();
      }
      if (input.takeAction("pause") && !document.querySelector("dialog[open]"))
        networkPaused = !networkPaused;
      if (networkView && networkView.matchId !== party.state.matchId) {
        networkView.dispose();
        networkView = null;
        matchOverlay.hide();
        replayPanel.hide();
        document.getElementById("result")!.hidden = true;
      }
      if (
        network.latest &&
        network.latest.matchId === party.state.matchId &&
        !networkView
      ) {
        const initial = network.latest,
          matchId = initial.matchId;
        void matchLoader.run(
          [
            {
              name: "Network arena",
              run: () => {
                arena.setMap(
                  initial.gameMode === "hoops" ? "hoops" : initial.arenaId,
                );
                pads.configure(initial.gameMode ?? "soccar");
                goalPlanes.setMode(initial.gameMode ?? "soccar");
                document.querySelector(".arena-caption")!.textContent =
                  arenaThemes[initial.arenaId].name.toUpperCase();
              },
            },
            {
              name: "Player resources",
              run: () => {
                networkView = new NetworkMatchView(
                  scene,
                  camera,
                  initial,
                  party.playerId,
                  rumbleSound,
                );
                networkView.camera.mouseLook = mouseLook;
                cars.forEach((c) => (c.visible = false));
                ball.visible = false;
                homeLobby.update([], camera, 0, now / 1000, false);
                networkView.update(
                  network,
                  0,
                  now / 1000,
                  settings.value.camera,
                  settings.value.quality,
                );
                matchOverlay.update(
                  initial.matchId,
                  initial.players,
                  initial.stats ?? [],
                  [],
                  initial.score,
                  party.playerId,
                  true,
                  false,
                );
                matchOverlay.board.hidden = true;
              },
            },
            {
              name: "Materials and shaders",
              run: () => graphics.prepare(scene, camera),
            },
          ],
          () => {
            if (
              network.latest?.matchId === matchId &&
              party.state?.stage === "match"
            )
              network.prepared();
            else {
              networkView?.dispose();
              networkView = null;
            }
            input.clear();
            previous = performance.now();
          },
          () => {
            networkView?.dispose();
            networkView = null;
            network.close();
            home();
          },
        );
        requestAnimationFrame(frame);
        return;
      }
      if (
        input.takeAction("camera") &&
        networkView &&
        network.latest?.phase !== "replay"
      )
        networkView.camera.ballMode = !networkView.camera.ballMode;
      network.input(
        network.latest?.phase === "replay" ||
          networkPaused ||
          document.hidden ||
          !document.hasFocus() ||
          !!document.querySelector("dialog[open]")
          ? neutral()
          : controls,
      );
      if (
        network.latest?.phase === "replay" &&
        (input.take("Space") || input.takeControllerAction("jump"))
      )
        network.skipReplay();
      input.takeAction("jump");
      input.takeAction("usePowerup");
      cars.forEach((c) => (c.visible = false));
      ball.visible = false;
      ballHeight.group.visible = false;
      homeLobby.update([], camera, dt, now / 1000, false);
      partyPanel.host.hidden = true;
      partyPanel.flow.updateVisibility(false);
      document.getElementById("bot-tag")!.hidden = true;
      hitboxes.update(simulation, false);
      if (networkView)
        networkView.camera.reverseHeld =
          reverseHeld && !networkPaused && network.latest?.phase !== "replay";
      networkView?.update(
        network,
        dt,
        now / 1000,
        settings.value.camera,
        settings.value.quality,
        input,
      );
      const localNetCar = networkView?.simulation.cars.find(
        (c) => c.id === party.playerId,
      );
      airSpeed.update(
        dt,
        localNetCar
          ? new T.Vector3().copy(localNetCar.body.linvel()).length()
          : 0,
        localNetCar?.supersonic ?? false,
        localNetCar?.grounded ?? true,
        settings.value.quality,
        !networkPaused &&
          (network.latest?.phase === "playing" ||
            network.latest?.phase === "goal"),
        networkView?.ball,
        camera,
        localNetCar?.body.linvel(),
      );
      if (input.takeAction("debug")) {
        debug.enabled = !debug.enabled;
        network.setStatsDebug(debug.enabled);
      }
      if (networkView)
        debug.update(
          networkView.simulation,
          fps,
          ticksPerSecond,
          networkView.camera.referenceUp,
          networkView.camera,
        );
      const netMatch = networkView?.match ?? loadingMatch,
        car = networkView?.simulation.cars.find((c) => c.id === party.playerId);
      const snapshot = network.latest;
      if (snapshot) {
        const local = snapshot.players.find((p) => p.id === party.playerId);
        if (local)
          challenges.observe({
            matchId: snapshot.matchId,
            playerId: local.id,
            mode: "network",
            gameMode: snapshot.gameMode ?? "soccar",
            controller: local.controller,
            phase: snapshot.phase,
            stats: snapshot.stats?.find((s) => s.playerId === local.id),
            completion: snapshot.completion,
          });
      }
      updateProgression(
        snapshot?.completion,
        party.playerId,
        snapshot?.phase === "finished",
      );
      const localPlayer = snapshot?.players.find(
        (p) => p.id === party.playerId,
      );
      if (snapshot && localPlayer && networkView) {
        accounts.profile.observeMatch(
          snapshot.matchId,
          localPlayer.id,
          localPlayer.team,
          snapshot.phase,
          snapshot.score,
          snapshot.lastGoal,
          snapshot.stats?.find((s) => s.playerId === localPlayer.id),
        );
        if (
          !networkPaused &&
          !document.hidden &&
          (snapshot.phase === "playing" || snapshot.phase === "goal")
        )
          accounts.profile.addPlayTime(dt);
      }
      ui.update(
        netMatch,
        car?.boost ?? 0,
        networkView?.camera.ballMode ?? true,
        car?.supersonic ?? false,
      );
      if (snapshot && !localPlayer) {
        document.querySelector(".boost-hud")!.classList.add("spectator-hidden");
        document
          .querySelector(".camera-status")!
          .classList.add("spectator-hidden");
      }
      if (snapshot?.phase === "replay")
        replayPanel.update(
          network.replayClip,
          snapshot.replay ?? null,
          snapshot.players,
          party.playerId,
          networkView?.replayView.director.debug,
        );
      else replayPanel.hide();
      document.getElementById("result")!.hidden = netMatch.phase !== "finished";
      document.getElementById("pause")!.hidden = true;
      networkStatus.hidden = !network.status;
      networkStatus.textContent = network.status;
      const finished = netMatch.phase === "finished";
      matchOverlay.gameMode = netMatch.gameMode;
      if (snapshot)
        matchOverlay.update(
          snapshot.matchId,
          snapshot.players,
          snapshot.stats ?? [],
          snapshot.statEvents ?? [],
          snapshot.score,
          party.playerId,
          input.isHeld("scoreboard"),
          true,
          network.chatLog,
          network.chatError,
          networkPaused && !finished,
          finished,
          snapshot.sessionMembers,
        );
      else matchOverlay.hide();
      networkMenu.hidden = !networkPaused || finished;
      document.getElementById("again")!.hidden =
        party.state.hostId !== party.playerId;
      document.getElementById("result")!.dataset.navDefault =
        party.state.hostId === party.playerId ? "#again" : "#home";
      (document.getElementById("again") as HTMLButtonElement).disabled =
        !party.state.matchFinished || party.busy;
      document.getElementById("results-leave")!.hidden = false;
      ui.resultMessage(
        /FAILED|STILL PLAYING|COULD NOT|ONLY THE/.test(party.message)
          ? party.message
          : "",
        party.busy,
      );
      document.getElementById("network-menu-title")!.textContent = finished
        ? netMatch.message
        : "MATCH MENU";
      document.getElementById("network-menu-note")!.textContent = finished
        ? `${netMatch.score[0]} — ${netMatch.score[1]}`
        : "THE MATCH CONTINUES";
      document.getElementById("network-resume")!.hidden = finished;
      document.getElementById("network-return")!.hidden =
        !finished || party.state.hostId !== party.playerId;
      if (network.latest && snapshot?.phase !== "replay")
        network.latest.pads.forEach((cooldown, i) => {
          const pad = pads.items[i];
          if (
            pad.cooldown === 0 &&
            cooldown > 0 &&
            (netMatch.phase === "playing" || netMatch.phase === "goal")
          ) {
            pad.pulse = 0.28;
            effects.emit(
              new T.Vector3(pad.x, 0.3, pad.z),
              new T.Vector3(0, 2, 0),
              0xffcf70,
              18,
            );
          }
          pad.cooldown = cooldown;
          pad.pulse = Math.max(0, (pad.pulse ?? 0) - dt);
        });
      updatePadVisuals(dt, networkView?.replayPads);
      effects.update(dt);
      if (car) {
        audio.update(
          Math.abs(car.forwardSpeed),
          car.boosting,
          car.body.isEnabled() && !finished,
          controls.throttle,
          false,
          car.skidIntensity,
        );
        if (
          car.boost > networkBoost + 5 &&
          (netMatch.phase === "playing" || netMatch.phase === "goal")
        ) {
          ui.pickup();
          audio.tone(820, 0.16, 0.035, "sine");
        }
        networkBoost = car.boost;
      }
      if (networkPhase !== netMatch.phase) {
        if (netMatch.phase === "goal")
          audio.tone(
            netMatch.gameMode === "hoops" ? 185 : 100,
            netMatch.gameMode === "hoops" ? 0.55 : 1.3,
            0.2,
            "sawtooth",
          );
        if (netMatch.phase === "playing") audio.tone(760, 0.12, 0.08, "sine");
        networkPhase = netMatch.phase;
      }
      if (networkView) {
        const ds =
          network.latest?.phase === "replay" &&
          network.replayClip &&
          network.latest.replay
            ? replayDropshot(network.replayClip, network.latest.replay.time)
            : network.latest?.dropshot;
        arena.updateDropshot(
          ds,
          dt *
            (network.latest?.phase === "replay"
              ? (network.latest.replay?.speed ?? 1)
              : 1),
          (open) => audio.tone(open ? 145 : 380, 0.12, 0.055, "triangle"),
        );
        goalPlanes.update(networkView.ball);
      }
      if (networkView)
        rumbleHud.update(
          network.latest?.rumble,
          party.playerId,
          networkView.cars[0],
          networkView.ball,
          camera,
          dt,
          !!car &&
            !networkPaused &&
            ["countdown", "playing"].includes(network.latest?.phase ?? ""),
          keyName(input.bindings.usePowerup) +
            " / " +
            controllerName(settings.value.controller.bindings.usePowerup),
          (id) =>
            networkView?.cars[
              networkView.simulation.cars.findIndex((c) => c.id === id)
            ],
        );
      graphics.render(scene, camera);
      requestAnimationFrame(frame);
      return;
    }
    if (networkActive) {
      networkView?.dispose();
      networkView = null;
      network.close();
      networkActive = false;
      networkMenu.hidden = networkStatus.hidden = true;
      home();
    }
    if (extraSession || match.phase === "home" || match.mode === "freeplay")
      matchOverlay.hide();
    if (extraSession) {
      let extraMenuInput = false;
      if (
        (extraSession.replayActive ||
          (extraSession instanceof CustomTrainingSession &&
            extraSession.goalCelebrating)) &&
        (input.take("Space") || input.takeControllerAction("jump"))
      ) {
        if (extraSession instanceof CustomTrainingSession)
          extraSession.skipGoal();
        else extraSession.skipReplay?.();
        input.clear();
        extraMenuInput = true;
      }
      if (input.takeAction("camera")) extraSession.toggleCamera?.();
      const previousLevel = input.takeAction("previousLevel"),
        nextLevel = input.takeAction("nextLevel");
      if (previousLevel || nextLevel) {
        if (extraSession.navigate?.(previousLevel ? -1 : 1)) {
          input.clear();
          extraMenuInput = true;
        }
      }
      if (
        input.takeAction("pause") &&
        !document.querySelector("dialog[open]")
      ) {
        if (extraSession instanceof CustomTrainingSession)
          extraSession.requestExit?.();
        else extraSession.pause(now);
        input.clear();
        extraMenuInput = true;
      }
      let restart = input.takeAction("reset");
      for (const action of trainingActions) {
        const pressed = input.takeAction(action);
        if (action === "trainingReset") restart ||= pressed;
      }
      if (restart) {
        extraSession.reset();
        input.clear();
      }
      if (extraSession.cameraControl)
        extraSession.cameraControl.reverseHeld =
          reverseHeld && !extraSession.paused && !extraSession.complete;
      const sequence = extraSession.resetSequence;
      extraSession.frame(
        restart || extraMenuInput || extraSession.paused ? neutral() : controls,
        dt,
        now,
        settings.value.camera,
      );
      if (
        !extraSession.paused &&
        !extraSession.complete &&
        !extraSession.blocksProgression &&
        extraSession.readout(now).phase === "running" &&
        !document.hidden
      )
        accounts.profile.addPlayTime(dt);
      if (sequence !== extraSession.resetSequence) input.clear();
      input.takeAction("jump");
      ui.extraGame(
        extraSession.vehicle.boost,
        extraSession.vehicle.supersonic,
        extraSession.supportsBallCam && !!extraSession.cameraControl?.ballMode,
      );
      if (extraSession.editing) document.getElementById("hud")!.hidden = true;
      extraPanel!.update(now);
      if (extraSession.replayActive)
        replayPanel.update(
          extraSession.replayClip ?? null,
          extraSession.replayState ?? null,
          extraSession.replayPlayers ?? [],
          extraSession.vehicle.id,
        );
      else replayPanel.hide();
      partyPanel.host.hidden = true;
      partyPanel.flow.updateVisibility(false);
      if (input.takeAction("debug")) debug.enabled = !debug.enabled;
      const debugText = document.getElementById("debug")!;
      debugText.hidden = !debug.enabled;
      if (debug.enabled) {
        const c = extraSession.vehicle,
          state = extraSession.readout(now);
        debugText.textContent = `${extraSession.id.toUpperCase()} • ${state.phase}\n${state.progress} / ${state.total}\n${c.supportKind} • ${c.contacts} wheels\n${new T.Vector3().copy(c.body.linvel()).length().toFixed(2)} m/s`;
      }
      const c = extraSession.vehicle;
      audio.update(
        Math.abs(c.forwardSpeed),
        c.boosting,
        !extraSession.paused && !extraSession.complete && !extraSession.editing,
        controls.throttle,
        false,
        c.skidIntensity,
      );
      airSpeed.update(
        dt,
        new T.Vector3().copy(c.body.linvel()).length(),
        c.supersonic,
        c.grounded,
        settings.value.quality,
        !extraSession.paused && !extraSession.complete,
        extraSession.ball,
        camera,
        c.body.linvel(),
      );
      rumbleHud.hide();
      graphics.render(extraSession.scene, camera);
      requestAnimationFrame(frame);
      return;
    }
    if (input.takeAction("camera") && !match.replayActive)
      cameraControl.ballMode = !cameraControl.ballMode;
    if (input.takeAction("debug")) {
      debug.enabled = !debug.enabled;
      if (match.stats) match.stats.debug = debug.enabled;
    }
    if (input.takeAction("pause") && !document.querySelector("dialog[open]")) {
      if (match.phase === "home") {
        if (partyPanel.escape()) {
          input.clear();
        } else if (ui.screen === "garage" && garagePanel.customizing) {
          garagePanel.customizing = false;
          garagePanel.render();
        } else if (ui.screen === "training") {
          ui.screen = "extras";
        } else if (ui.screen === "extras" || ui.screen === "freeplay") {
          ui.screen = "modes";
        } else ui.modes(false);
      } else match.pause();
    }
    input.takeAction("reset"); // Legacy binding never resets a competitive match.
    if (
      match.phase === "replay" &&
      (input.take("Space") || input.takeControllerAction("jump")) &&
      match.replay
    )
      match.skipReplay(
        simulation.cars[0].id,
        match.replay.clip.goal.id,
        simulation,
      );
    for (const action of trainingActions)
      if (input.takeAction(action)) {
        if (
          trainingAction(action, match, simulation) &&
          action === "trainingReset"
        ) {
          resetEffects();
          pads.reset();
          cameraControl.reset();
          loop.accumulator = 0;
        }
      }
    let alpha = 1;
    if (match.active) {
      const result = loop.advance(dt, () => {
        const phase = match.phase;
        const resetSequence = match.resetSequence;
        const countdownNumber = Math.ceil(match.countdown);
        if (phase === "countdown") simulation.cars[0].steerAtKickoff(controls);
        if (phase === "playing") {
          match.recordInput(simulation.cars[0].id, controls);
          const wasDemolished = simulation.cars[0].demolitionState !== "active";
          const botInputs = match.rules.bot
            ? botTeam.inputs(simulation, pads)
            : new Map();
          simulation.step(
            simulation.cars.map((c, i) =>
              i === 0
                ? controls
                : c.demolitionState === "active"
                  ? (botInputs.get(c.id) ?? neutral())
                  : neutral(),
            ),
          );
          if (wasDemolished && simulation.cars[0].demolitionState === "active")
            cameraControl.reset();
          for (const demo of simulation.demolitions)
            if (demo.age === 0) {
              demoFlashes[
                simulation.cars.findIndex((c) => c.id === demo.victimId)
              ].trigger(demo.position);
              effects.emit(
                demo.position,
                new T.Vector3(0, 2, 0),
                0xffc276,
                110,
              );
              effects.emit(demo.position, new T.Vector3(0, 5, 0), 0x74859a, 55);
              audio.tone(85, 0.45, 0.23, "sawtooth");
            }
          if (match.rules.infiniteBoost && settings.value.infiniteBoost)
            simulation.cars[0].boost = 100;
          for (const c of simulation.cars)
            if (c.lastJump) audio.tone(340, 0.13, 0.04, "triangle");
          for (const h of simulation.hits)
            if (h.age === 0) {
              audio.tone(
                h.kind === "rim" ? 520 : 100 + Math.min(h.strength, 30) * 5,
                0.12,
                Math.min(0.14, h.strength * 0.008),
                "triangle",
              );
              effects.emit(
                h.position,
                new T.Vector3(),
                0xa5f9eb,
                Math.min(24, Math.ceil(h.strength)),
              );
            }
        }
        if (phase === "goal") {
          simulation.step(
            simulation.cars.map((_, i) => (i === 0 ? controls : neutral())),
          );
          if (match.rules.infiniteBoost && settings.value.infiniteBoost)
            simulation.cars[0].boost = 100;
        }
        if (phase === "playing" || phase === "goal") {
          for (const pickup of pads.tick(simulation.cars)) {
            const pos = new T.Vector3().copy(pickup.car.body.translation());
            effects.emit(pos, new T.Vector3(0, 2, 0), 0xffcf70, 18);
            audio.tone(820, 0.16, 0.035, "sine");
            if (pickup.car === simulation.cars[0]) ui.pickup();
          }
        }
        match.tick(simulation, pads);
        if (match.resetSequence !== resetSequence && match.rules.training) {
          resetEffects();
          pads.reset();
          cameraControl.reset();
        }
        if (
          phase === "countdown" &&
          Math.ceil(match.countdown) !== countdownNumber
        )
          audio.tone(match.phase === "playing" ? 760 : 420, 0.12, 0.08, "sine");
        if (phase === "playing" && match.phase === "goal") {
          goalSounds = [
            audio.tone(
              match.gameMode === "hoops" ? 185 : 100,
              match.gameMode === "hoops" ? 0.55 : 1.3,
              0.2,
              "sawtooth",
            ),
            audio.tone(660, 0.9, 0.1, "triangle"),
          ].filter((stop): stop is () => void => !!stop);
          // Goal song: best bit of "We Speak Chinese" (drop at GOAL_STINGER_OFFSET).
          void music.goalStinger();
          const origin = new T.Vector3().copy(simulation.ball.translation()),
            color = match.rules.training
              ? 0xa8a8a8
              : origin.z < 0
                ? 0x69e9ff
                : 0xffb654;
          explosion.trigger(
            origin,
            color,
            match.recorder.pendingGoal?.explosion ?? "pulse",
            match.rules.training,
          );
          effects.burst(origin, color);
          vehicleEffects.forEach((e) => e.reset());
        }
        if (phase === "goal" && match.phase === "replay") {
          void music.goalStinger();
        }
        if (phase !== "countdown" && match.phase === "countdown") {
          resetEffects();
          audio.tone(420, 0.12, 0.08, "sine");
          pads.reset();
          cameraControl.reset();
        }
      });
      if (result.steps > 0) {
        input.takeAction("jump");
        input.takeAction("usePowerup");
      }
      alpha = match.phase === "countdown" ? 1 : result.alpha;
      tickCount += result.steps;
    } else loop.accumulator = 0;
    if (match.mode === "bot" && localMatchId)
      challenges.observe({
        matchId: localMatchId,
        playerId: simulation.cars[0].id,
        mode: match.mode,
        gameMode: match.gameMode,
        controller: "local",
        phase: match.phase,
        stats: match.stats?.players.get(simulation.cars[0].id),
        completion: match.completion,
      });
    updateProgression(
      match.completion,
      simulation.cars[0].id,
      match.mode === "bot" && match.phase === "finished",
    );
    if (match.mode === "bot" && localMatchId)
      accounts.profile.observeMatch(
        localMatchId,
        simulation.cars[0].id,
        simulation.cars[0].team,
        match.phase,
        match.score,
        match.lastGoal,
        match.stats?.players.get(simulation.cars[0].id),
      );
    matchOverlay.gameMode = match.gameMode;
    if (match.mode === "bot" && match.phase !== "home")
      matchOverlay.update(
        localMatchId,
        simulation.players.map((p, i) => ({
          ...p,
          name: simulation.cars[i].displayName,
        })),
        match.stats?.snapshot() ?? [],
        match.stats?.events ?? [],
        match.score,
        simulation.cars[0].id,
        input.isHeld("scoreboard"),
        false,
        [],
        "",
        match.phase === "paused",
        match.phase === "finished",
      );
    if (!networkActive) {
      document.getElementById("again")!.hidden = false;
      document.getElementById("result")!.dataset.navDefault = "#again";
      (document.getElementById("again") as HTMLButtonElement).disabled = false;
      document.getElementById("results-leave")!.hidden = !party.state;
    }
    if (
      !document.hidden &&
      (match.phase === "playing" || match.phase === "goal")
    )
      accounts.profile.addPlayTime(dt);
    if (match.replayActive && match.replay) {
      airSpeed.update(dt, 0, false, true, settings.value.quality, false);
      if (!replayView.active) {
        resetEffects();
        input.clear();
      }
      const state = match.replayState!;
      const cooldowns = replayView.render(
        match.replay.clip,
        state.time,
        state.speed,
        match.phase === "paused" ? 0 : dt,
      );
      arena.updateDropshot(
        replayDropshot(match.replay.clip, state.time),
        match.phase === "paused" ? 0 : dt * state.speed,
      );
      updatePadVisuals(dt, cooldowns);
      ballHeight.group.visible = false;
      document.getElementById("bot-tag")!.hidden = true;
      const players = simulation.cars.map((c, i) => ({
        ...simulation.players[i],
        id: c.id,
        name: c.displayName,
        avatarId: i === 0 ? garage.profile.avatarId : "robot",
        avatarColor: i === 0 ? garage.profile.avatarColor : undefined,
      }));
      replayPanel.update(
        match.replay.clip,
        state,
        match.mode === "freeplay" ? players.slice(0, 1) : players,
        simulation.cars[0].id,
        replayView.director.debug,
      );
      ui.update(match, 0, false, false);
      audio.update(0, false, false);
      goalPlanes.update(ball);

      graphics.render(scene, camera);
      requestAnimationFrame(frame);
      return;
    }
    if (replayView.active) {
      replayView.stop();
      replayPanel.hide();
      resetEffects();
      cameraControl.reset();
      input.clear();
      if (match.phase === "countdown") pads.reset();
    }
    const dropshotState = simulation.dropshot?.visualState();
    arena.updateDropshot(dropshotState, dt, (open) =>
      audio.tone(open ? 145 : 380, 0.12, 0.055, "triangle"),
    );
    simulation.cars.forEach((c, i) => {
      c.pose.render(cars[i], alpha);
      cars[i].visible = match.phase !== "home" && c.body.isEnabled();
      animateWheels(
        visuals[i],
        c.forwardSpeed,
        c.steerAngle,
        match.active ? dt : 0,
        match.phase !== "home" ? c : undefined,
        cars[i],
        match.phase === "playing" && !match.rules.training
          ? match.recorder.wheels(i)
          : undefined,
      );
    });
    simulation.ballPose.render(ball, alpha);
    animateBall(ball, now / 1000);
    heatseekerBall(
      ball,
      simulation.heatseeker?.state,
      match.phase === "paused" ? 0 : dt,
    );
    ball.visible = simulation.ball.isEnabled();
    dropshotBall(ball, dropshotState, now / 1000);
    goalPlanes.update(ball);
    ballHeight.update(ball, simulation);
    if (match.phase === "home") {
      cars[0].position.set(6, 0.32, 14);
      cars[0].rotation.set(0, -0.55, 0);
    }
    updatePadVisuals(dt);
    if (match.phase === "playing" || match.phase === "goal")
      simulation.cars.forEach((c, i) => {
        if (c.boosting) {
          const rear = new T.Vector3(0, 0, 0.7)
            .applyQuaternion(cars[i].quaternion)
            .add(cars[i].position);
          effects.emit(
            rear,
            c.forward.clone().multiplyScalar(-5),
            i === 0
              ? garage.current.boost === "ember"
                ? 0xffa548
                : 0x7cf9ff
              : 0xffbb55,
            3,
          );
        }
        if (
          controls.slide &&
          i === 0 &&
          c.grounded &&
          Math.abs(c.forwardSpeed) > 5
        )
          effects.emit(cars[i].position, new T.Vector3(0, 0.2, 0), 0x9bbaab, 1);
      });
    const effectDt = match.phase === "paused" ? 0 : dt;
    rumbleEffects.update(
      simulation.rumble?.state,
      (id) => cars[simulation.cars.findIndex((c) => c.id === id)],
      ball,
      camera,
      effectDt,
      simulation.clock,
    );
    rumbleHud.update(
      simulation.rumble?.state,
      simulation.cars[0].id,
      cars[0],
      ball,
      camera,
      dt,
      ["countdown", "playing"].includes(match.phase),
      keyName(input.bindings.usePowerup) +
        " / " +
        controllerName(settings.value.controller.bindings.usePowerup),
      (id) => cars[simulation.cars.findIndex((c) => c.id === id)],
    );
    const touched = simulation.cars.find(
      (c) => c.id === simulation.lastTouchId,
    );
    ballTrails.updateBall(
      ball,
      new T.Vector3().copy(simulation.ball.linvel()).length(),
      match.rules.training ? null : (touched?.team ?? null),
      effectDt,
      match.active && ball.visible,
      camera.position,
      heatIntensity(simulation.heatseeker?.state),
      simulation.heatseeker?.state,
      dropshotState,
    );
    simulation.cars.forEach((c, i) =>
      flipTrails[i].updateCar(
        c,
        cars[i],
        effectDt,
        match.active && c.body.isEnabled(),
        camera.position,
      ),
    );
    effects.update(effectDt);
    simulation.cars.forEach((c, i) =>
      jumpBursts[i].update(
        c,
        effectDt,
        match.active && c.body.isEnabled(),
        camera.position,
      ),
    );
    explosion.update(effectDt);
    demoFlashes.forEach((e) => e.update(effectDt));
    simulation.cars.forEach((c, i) =>
      vehicleEffects[i].update(
        c,
        effectDt,
        now / 1000,
        (match.phase === "playing" || match.phase === "goal") &&
          c.body.isEnabled(),
      ),
    );
    simulation.cars.forEach((c, i) =>
      skidMarks[i].update(c, effectDt, match.active && c.body.isEnabled()),
    );
    if (match.phase !== "home") camera.clearViewOffset();
    if (match.phase !== "home")
      cameraControl.update(
        cars[0],
        ball,
        simulation,
        dt,
        false,
        now / 1000,
        match.phase === "goal" ? match.goalFocus : null,
      );
    const localCar = simulation.cars[0];
    airSpeed.update(
      dt,
      new T.Vector3().copy(localCar.body.linvel()).length(),
      localCar.supersonic,
      localCar.grounded,
      settings.value.quality,
      match.phase === "playing" || match.phase === "goal",
      ball,
      camera,
      localCar.body.linvel(),
    );
    const lobbyVisible = match.phase === "home" && ui.screen === "home";
    const partySetup =
      match.phase === "home" &&
      !!party.state &&
      ["mode", "teams"].includes(party.state.stage);
    partyPanel.flow.updateVisibility(match.phase === "home");
    partyPanel.host.hidden = !lobbyVisible;
    homeLobby.update(
      party.state?.members ?? [
        {
          id: party.playerId,
          name: garage.profile.name,
          localPlayerId: garage.profile.localPlayerId,
          title: garage.profile.title,
          avatarId: garage.profile.avatarId ?? "helmet",
          avatarColor: garage.profile.avatarColor,
          preset: garage.current,
          team: null,
          ready: false,
        },
      ],
      camera,
      dt,
      now / 1000,
      lobbyVisible && !partySetup,
      mouseLook,
      simulation,
    );
    if (partySetup) {
      if (party.state?.stage === "teams" && party.state.matchArenaId)
        arena.setMap(party.state.matchArenaId);
      camera.clearViewOffset();
      camera.position.lerp(new T.Vector3(38, 27, 42), 1 - Math.exp(-dt * 5));
      camera.up.set(0, 1, 0);
      camera.lookAt(0, 0, 0);
      camera.fov = 58;
      camera.updateProjectionMatrix();
    }
    hitboxes.update(
      simulation,
      settings.value.showHitboxes && match.phase !== "home",
    );
    if (match.phase === "home" && ui.screen === "garage" && !partySetup) {
      preview.setPreset(garagePanel.previewPreset, garagePanel.team);
      preview.update(
        innerWidth,
        innerHeight,
        dt,
        garagePanel.customizing ? garagePanel.category : "body",
      );
      graphics.render(preview.renderScene, preview.camera);
    } else graphics.render(scene, camera);
    botNametags.update(
      simulation,
      cars,
      camera,
      match.rules.bot && match.phase !== "home" && match.phase !== "replay",
    );
    frameCount++;
    statsTime += dt;
    if (statsTime >= 1) {
      fps = frameCount / statsTime;
      ticksPerSecond = Math.round(tickCount / statsTime);
      frameCount = 0;
      tickCount = 0;
      statsTime = 0;
    }
    debug.update(
      simulation,
      fps,
      ticksPerSecond,
      cameraControl.referenceUp,
      cameraControl,
    );
    ui.update(
      match,
      simulation.cars[0].boost,
      cameraControl.ballMode,
      simulation.cars[0].supersonic,
    );
    audio.update(
      Math.abs(simulation.cars[0].forwardSpeed),
      simulation.cars[0].boosting,
      (match.phase === "playing" || match.phase === "goal") &&
        simulation.cars[0].body.isEnabled(),
      controls.throttle,
      match.phase === "home",
      simulation.cars[0].skidIntensity,
    );
    requestAnimationFrame(frame);
  }
  Object.defineProperty(window, "octaneArenaNetwork", {
    configurable: true,
    value: Object.freeze({
      diagnostics: () => network.diagnostics(),
      setDebug: (enabled: boolean) => {
        party.transport.debug = !!enabled;
      },
    }),
  });
  if (import.meta.env.DEV || new URLSearchParams(location.search).has("test"))
    Object.assign(window, {
      __arena: {
        simulation,
        match,
        matchLoader,
        interfaceFeedback,
        input,
        settings,
        garage,
        cameraControl,
        mouseLook,
        cameraDrag,
        versionPanel,
        feedbackPanel,
        challenges,
        trainingCloud,
        customTraining,
        customTrainingPanel,
        challengesPanel,
        get replayView() {
          return replayView;
        },
        get botTeam() {
          return botTeam;
        },
        botSetup,
        camera,
        graphics,
        audio,
        music,
        ui,
        visuals,
        hitboxes,
        vehicleEffects,
        pads,
        accounts,
        party,
        network,
        get networkView() {
          return networkView;
        },
        partyPanel,
        homeLobby,
        preview,
        garagePanel,
        skidMarks,
        goalPlanes,
        arena,
        get extraSession() {
          return extraSession;
        },
        explosion,
        effects,
        rumbleEffects,
        rumbleHud,
        ballTrails,
        flipTrails,
        jumpBursts,
        ballHeight,
        padRecharge,
      },
    });
  requestAnimationFrame(frame);
}
boot().catch((error) => {
  console.error(error);
  document.querySelector("#app")!.innerHTML =
    '<p class="loading">The arena could not start. Please use a browser with WebGL 2 enabled and reload.<br>See the browser console for details.</p>';
});
