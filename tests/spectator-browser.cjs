const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const { ReplayBuffer, replayMessage, BALL_STRIDE, CAR_STRIDE, RC } =
    await import("../shared/replay.ts");
  const server = await staticGame(8257);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    const errors = [];
    async function open(name) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.setDefaultTimeout(60000);
      await ctx.addInitScript((name) => {
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name,
            avatarId: "helmet",
          }),
        );
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        window.pad = {
          id: "Spectator test pad",
          index: 0,
          connected: true,
          mapping: "standard",
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, () => ({
            pressed: false,
            value: 0,
          })),
        };
        Object.defineProperty(navigator, "getGamepads", {
          value: () => [window.pad],
        });
        // Replay/final-screen rendering fixture ONLY. Normal connection, native
        // authority startup/input and state delivery are tested without this flag.
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          set onmessage(handler) {
            super.onmessage = (e) => {
              if (window.testReplay && e.data.type === "snapshot") {
                if (!window.clipSent) {
                  window.clipSent = true;
                  handler({ data: window.testReplayPacket });
                }
                e.data.phase = "replay";
                e.data.replay = {
                  id: window.testReplayPacket.clip.goal.id,
                  time: 0.5,
                  speed: 1,
                  eligible: e.data.players
                    .filter((p) => p.controller !== "bot")
                    .map((p) => p.id),
                  votes: [],
                };
              }
              if (window.testFinish && e.data.type === "snapshot") {
                e.data.phase = "finished";
                e.data.score = [1, 0];
                e.data.remaining = 0;
                e.data.message = "BLUE WINS";
              }
              handler(e);
            };
          }
        };
      }, name);
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
      console.log("READY", name);
      return p;
    }
    const host = await open("Host"),
      guest = await open("Opponent"),
      watch = await open("Spectator");
    async function action(p, name, data = {}) {
      await p.waitForFunction(() => !__arena.party.busy);
      const r = await p.evaluate(
        async ({ name, data }) => ({
          ok: await __arena.party.action(name, data),
          message: __arena.party.message,
        }),
        { name, data },
      );
      assert.ok(r.ok, r.message);
    }
    await host.locator("#party-create").click();
    await host.waitForFunction(() => __arena.party.state);
    const code = await host.evaluate(() => __arena.party.state.code);
    for (const p of [guest, watch]) {
      await p.locator("#party-join-open").click();
      await p.locator("#party-input").fill(code);
      await p.locator("#party-join button[type=submit]").click();
      await p.waitForFunction(() => __arena.party.state?.members.length >= 2);
    }
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.party.state?.members.length === 3 &&
          window.octaneArenaNetwork
            .diagnostics()
            .peers.every((p) => p.bidirectionalVerified),
      );
    console.log("PARTY CONNECTED");
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "1v1" });
    await host.locator("#party-continue").click();
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.party.state.stage === "teams" &&
          document.getElementById("party-flow").open &&
          !__arena.matchLoader.active,
      );
    assert.ok(await host.locator("#party-launch").isDisabled());
    await host.locator('.party-team-join[data-team="0"]').click();
    await guest.locator('.party-team-join[data-team="1"]').click();
    await watch.bringToFront();
    await watch.waitForFunction(
      () =>
        __arena.party.state.members.some((m) => m.team === 0) &&
        __arena.party.state.members.some((m) => m.team === 1),
    );
    await watch.evaluate(() => (pad.buttons[0] = { pressed: true, value: 1 }));
    await watch.waitForFunction(
      () =>
        __arena.party.state.members.find((m) => m.id === __arena.party.playerId)
          ?.team === "spectator",
    );
    await watch.evaluate(() => (pad.buttons[0] = { pressed: false, value: 0 }));
    await host.waitForFunction(
      () => !document.getElementById("party-launch").disabled,
    );
    await host.locator("#party-launch").click();
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "playing" && __arena.networkView,
      );
    console.log("MATCH PLAYING");
    const id = await watch.evaluate(() => __arena.party.playerId);
    assert.equal(
      await watch.evaluate(
        (id) => __arena.networkView.simulation.cars.some((c) => c.id === id),
        id,
      ),
      false,
    );
    assert.equal(
      await watch.evaluate(() => __arena.network.latest.players.length),
      2,
    );
    assert.equal(await watch.locator(".boost-hud").isVisible(), false);
    await watch.evaluate(() => {
      window.sentCarInputs = 0;
      const send = __arena.party.transport.send.bind(__arena.party.transport);
      __arena.party.transport.send = (id, msg, ...rest) => {
        if (msg.type === "input") window.sentCarInputs++;
        return send(id, msg, ...rest);
      };
    });
    await watch.bringToFront();
    await watch.keyboard.down("Tab");
    await watch.locator("#match-board").waitFor({ state: "visible" });
    assert.equal(
      await watch.locator('#match-board [data-player="' + id + '"]').count(),
      0,
    );
    await watch.keyboard.up("Tab");
    assert.match(
      await watch.locator("#spectator-controls span").innerText(),
      /PLAYER:/,
    );
    async function press(p, i) {
      await p.bringToFront();
      await p.evaluate(
        (i) => (pad.buttons[i] = { pressed: true, value: 1 }),
        i,
      );
      await p.waitForFunction(
        () => __arena.input.getAction("spectateNext") > 0.5,
      );
      await p.waitForTimeout(200);
      await p.evaluate(
        (i) => (pad.buttons[i] = { pressed: false, value: 0 }),
        i,
      );
      await p.waitForTimeout(170);
    }
    await press(watch, 15);
    assert.match(
      await watch.locator("#spectator-controls span").innerText(),
      /PLAYER: Opponent/,
    );
    await watch.keyboard.press("Period");
    await watch.waitForTimeout(400);
    assert.equal(
      await watch.locator("#spectator-controls span").innerText(),
      "BALL CAM",
    );
    assert.ok(
      await watch.evaluate(() => {
        const p = __arena.networkView.ball.position
          .clone()
          .project(__arena.cameraControl.camera);
        return Math.abs(p.x) < 0.3 && Math.abs(p.y) < 0.3;
      }),
    );
    await watch.keyboard.press("Period");
    await watch.waitForTimeout(450);
    assert.equal(
      await watch.locator("#spectator-controls span").innerText(),
      "FREE CAM",
    );
    const pose = () => ({
      p: __arena.networkView.camera.camera.position.toArray(),
      q: __arena.networkView.camera.camera.quaternion.toArray(),
    });
    const before = await watch.evaluate(pose);
    await watch.mouse.move(700, 350);
    await watch.mouse.down();
    await watch.waitForTimeout(120);
    const click = await watch.evaluate(pose);
    assert.ok(
      [...click.p, ...click.q].every(
        (v, i) => Math.abs(v - [...before.p, ...before.q][i]) < 1e-8,
      ),
      "drag capture without movement preserves free camera pose",
    );
    await watch.mouse.move(770, 370, { steps: 8 });
    await watch.mouse.up();
    await watch.waitForTimeout(150);
    const moved = await watch.evaluate(pose);
    assert.notDeepEqual(moved.q, before.q);
    await watch.evaluate(() => {
      pad.axes[2] = 0.6;
      pad.axes[1] = -0.7;
      pad.buttons[0] = { pressed: true, value: 1 };
      pad.buttons[1] = { pressed: true, value: 1 };
    });
    await watch.waitForTimeout(2500);
    await watch.evaluate(() => {
      pad.axes.fill(0);
      pad.buttons.forEach((b) => {
        b.pressed = false;
        b.value = 0;
      });
    });
    const freeMoved = await watch.evaluate(pose);
    assert.ok(
      freeMoved.p[1] > 30,
      "free camera flies above ceiling without collisions",
    );
    assert.notDeepEqual(freeMoved.q, moved.q, "right-stick free look");
    await watch.keyboard.press("Escape");
    await watch.locator("#network-menu").waitFor({ state: "visible" });
    const pausedPose = await watch.evaluate(pose);
    await watch.evaluate(() => {
      pad.axes[1] = -0.8;
      pad.axes[2] = 0.7;
    });
    await watch.waitForTimeout(450);
    assert.deepEqual(
      await watch.evaluate(pose),
      pausedPose,
      "menu navigation cannot move spectator camera",
    );
    await watch.evaluate(() => pad.axes.fill(0));
    await watch.locator("#network-resume").click();
    await watch.keyboard.press("KeyT");
    await watch.locator("#chat-input").fill("Spectator hello");
    await watch.locator("#chat-input").press("Enter");
    for (const p of [host, guest, watch])
      await p.waitForFunction(() =>
        __arena.network.chatLog.some((m) => m.text === "Spectator hello"),
      );
    // Packed replay built from deterministic recorded transforms. It exercises
    // Worker-message -> PeerJS -> spectator delivery/rendering, not goal physics.
    console.log("SPECTATOR CAMERAS AND CHAT CHECKED");
    const snapshot = await host.evaluate(() => __arena.network.latest),
      buffer = new ReplayBuffer(
        snapshot.players.map((p) => p.id),
        0,
      );
    for (let i = 0; i <= 90; i++) {
      const t = i / 60,
        o = buffer.write(t, 1),
        f = buffer.frames;
      f[o] = 0;
      f[o + 1] = 2;
      f[o + 2] = -20 - 22 * t;
      f[o + 6] = 1;
      f[o + 9] = -22;
      f[o + 13] = 1;
      snapshot.players.forEach((p, j) => {
        const k = o + BALL_STRIDE + j * CAR_STRIDE;
        f[k] = j * 3;
        f[k + 1] = 1;
        f[k + 2] = -17 - 22 * t + j * 2;
        f[k + RC.rotation + 3] = 1;
        f[k + RC.enabled] = 1;
        f[k + RC.normal + 1] = 1;
      });
    }
    const clip = buffer.clip({
      id: "spectator-goal",
      time: 1.5,
      scorerId: snapshot.players[0].id,
      team: 0,
      ownGoal: false,
      lastTouchId: snapshot.players[0].id,
      touchTime: 0.5,
      ballSpeed: 22,
      focus: { x: 0, y: 2, z: -51 },
    });
    await host.evaluate(
      (packet) => {
        window.testReplayPacket = packet;
        window.testReplay = true;
      },
      replayMessage(snapshot.matchId, clip),
    );
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "replay" &&
          __arena.networkView.replayView.active,
      );
    assert.ok(await watch.locator("#replay-skip-button").isDisabled());
    assert.equal(await watch.locator("#spectator-controls").isVisible(), false);
    for (const p of [host, guest, watch]) {
      assert.equal(await p.locator("#replay-nametags").isVisible(), true);
      assert.equal(
        await p.locator("#replay-nametags .network-name:not([hidden])").count(),
        2,
      );
    }
    await watch.screenshot({ path: ".tools/spectator-replay.png" });
    await host.evaluate(() => (window.testReplay = false));
    await watch.waitForFunction(
      () =>
        __arena.network.latest?.phase === "playing" &&
        !__arena.networkView.replayView.active,
    );
    assert.equal(
      await watch.locator("#spectator-controls span").innerText(),
      "FREE CAM",
    );
    await watch.waitForTimeout(400);
    const restored = await watch.evaluate(pose);
    assert.deepEqual(
      restored.p,
      freeMoved.p,
      "replay returns to saved free camera position",
    );
    await host.evaluate(() => (window.testFinish = true));
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "finished" &&
          document.querySelector(".mvp-badge"),
      );
    assert.equal(
      await watch.locator('#match-board [data-player="' + id + '"]').count(),
      0,
    );
    assert.ok(await watch.locator("#result").isVisible());
    assert.equal(
      await watch.evaluate(() => window.sentCarInputs),
      0,
      "watcher never sends car input, including clearInput",
    );
    await host.waitForFunction(() => __arena.party.state.matchFinished);
    await host.evaluate(() => (window.testFinish = false));
    await action(host, "return");
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "2v2bots" });
    await action(host, "stage", { stage: "teams" });
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          document.getElementById("party-flow").open &&
          !__arena.matchLoader.active,
      );
    await action(host, "team", { team: "spectator" });
    await action(guest, "team", { team: 0 });
    await action(watch, "team", { team: "spectator" });
    await action(host, "launch");
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "playing" &&
          __arena.network.latest.players.length === 3 &&
          __arena.networkView.spectator?.target !== "free",
      );
    assert.equal(
      await host.evaluate(() =>
        __arena.networkView.simulation.cars.some(
          (c) => c.id === __arena.party.playerId,
        ),
      ),
      false,
      "host can run authority while spectating",
    );
    for (const name of ["Circuit", "Relay"]) {
      await watch.locator("#spectator-controls button").last().click();
      await watch.waitForTimeout(400);
      assert.equal(
        await watch.locator("#spectator-controls span").innerText(),
        "PLAYER: " + name,
      );
    }
    await watch.evaluate(() =>
      __arena.network.sendChat("Final spectator goodbye"),
    );
    for (const p of [host, guest, watch])
      await p.waitForFunction(() =>
        __arena.network.chatLog.some(
          (m) => m.text === "Final spectator goodbye",
        ),
      );
    const lastGuestTick = await guest.evaluate(
      () => __arena.network.latest.tick,
    );
    await action(watch, "leave");
    await guest.waitForFunction(
      (tick) => __arena.network.latest.tick > tick + 80,
      lastGuestTick,
    );
    assert.equal(
      await guest.evaluate(() => __arena.network.status),
      "",
      "departed spectator chat cannot invalidate later snapshots",
    );
    assert.ok(
      await guest
        .locator(".chat-lines")
        .innerText()
        .then((t) => t.includes("Final spectator goodbye")),
    );
    await host.waitForFunction(() => __arena.party.state.members.length === 2);
    assert.equal(await host.evaluate(() => __arena.party.state.stage), "match");
    assert.deepEqual(errors, []);
    console.log(
      "PASS three real PeerJS sessions / smaller party format / spectator selection, no car or stats, zero car packets, live chat, keyboard/controller cycling, relative mouse look and free flight above ceiling; replay/final rendering fixtures with all replay labels, skip exclusion and saved spectator return",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
