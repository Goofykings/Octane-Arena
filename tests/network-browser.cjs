const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app, partyMatches, addresses } = await startLan(8096, ":memory:");
  const base = `http://${addresses[0] || "127.0.0.1"}:8096`;
  let browser, context;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const errors = [];
    // This suite checks transport/game state; keep several software-rendered
    // clients affordable without changing their physics or normal game defaults.
    await context.addInitScript(() => {
      if (location.protocol !== "http:" && location.protocol !== "https:")
        return;
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
    });
    context.setDefaultTimeout(60000);
    context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
    const open = async () => {
      const p = await context.newPage();
      await p.goto(base + "/?test");
      await p.waitForFunction(
        () =>
          window.__arena?.party.connection === "connected" &&
          !window.__arena.party.busy,
      );
      return p;
    };
    const host = await open(),
      guest = await open();
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    const join = async (p) => {
      await p.bringToFront();
      await p.locator("#party-join-open").click();
      await p.locator("#party-input").fill(code);
      await p.locator("#party-join button[type=submit]").click();
      await p.waitForFunction(() => !!window.__arena.party.state);
    };
    await join(guest);
    await host.locator("#party-start").click();
    await host.locator("#party-continue").click();
    await host.locator('.party-team-join[data-team="0"]').click();
    await guest.locator('.party-team-join[data-team="1"]').click();
    await host.locator("#party-launch").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () => window.__arena.networkView?.match.phase === "playing",
        null,
        { timeout: 60000 },
      );
    const game = partyMatches.matches.get(code);
    assert.ok(game);
    assert.equal(
      await host.evaluate(() => window.__arena.network.latest.matchId),
      await guest.evaluate(() => window.__arena.network.latest.matchId),
    );
    const local = await host.evaluate(() => window.__arena.party.playerId),
      remote = await guest.evaluate(() => window.__arena.party.playerId);
    for (const p of [host, guest]) {
      await p.waitForFunction(
        (id) => window.__arena.arena.mapId === id,
        game.arenaId,
        { polling: 100 },
      );
      assert.equal(
        await p.evaluate(() => window.__arena.network.latest.arenaId),
        game.arenaId,
      );
      assert.equal(
        await p.evaluate(
          () => window.__arena.network.latest.kickoffFormationId,
        ),
        game.match.kickoffFormationId,
      );
      assert.equal(
        await p.evaluate(
          () => window.__arena.networkView.match.kickoffFormationId,
        ),
        game.match.kickoffFormationId,
      );
    }
    assert.equal(
      await guest.evaluate(
        () => window.__arena.networkView.simulation.cars[0].id,
      ),
      remote,
      "each camera follows its own player",
    );
    const before = game.simulation.cars
      .find((c) => c.id === local)
      .body.translation().z;
    await host.bringToFront();
    await host.keyboard.down("KeyW");
    await host.keyboard.down("ShiftLeft");
    await host.waitForTimeout(850);
    await host.keyboard.up("ShiftLeft");
    await host.keyboard.up("KeyW");
    assert.ok(
      game.simulation.cars.find((c) => c.id === local).body.translation().z <
        before - 2,
    );
    await guest.waitForFunction(
      ({ id, before }) =>
        window.__arena.network.latest.cars.find((c) => c.id === id).position.z <
        before - 2,
      { id: local, before },
    );
    console.log(
      "PASS two clients share server physics, independent IDs, camera and boost input",
    );
    for (const p of [host, guest]) {
      await p.waitForFunction(() => {
        const rig = window.__arena.networkView.camera;
        return (
          rig.debug.safe &&
          Math.abs(rig.camera.rotation.z) < 1e-8 &&
          Math.abs(rig.framing.carScreen.x) < 0.9 &&
          Math.abs(rig.framing.ballScreen.x) < 0.9 &&
          rig.framing.carScreen.z > 0 &&
          rig.framing.ballScreen.z > 0
        );
      });
    }
    await host.keyboard.press("F3");
    await host.waitForFunction(() =>
      document.getElementById("debug").textContent.includes("CAMERA Ball Cam"),
    );
    await host.keyboard.press("F3");
    console.log(
      "PASS snapshot-rendered network rig frames both subjects with a level horizon and camera diagnostics",
    );
    await host.keyboard.press("Escape");
    const clock = game.match.remaining;
    await host.waitForTimeout(300);
    assert.ok(game.match.remaining < clock);
    await host.locator("#network-resume").click();
    console.log("PASS pause menu does not pause the shared match");
    // Test fixture changes only the in-process server. No client teleport API exists.
    game.simulation.lastTouchId = local;
    game.simulation.ball.setTranslation({ x: 0, y: 1, z: -53 }, true);
    game.match.tick(game.simulation);
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          window.__arena.network.latest.score[0] === 1 &&
          window.__arena.networkView.match.phase === "goal",
      );
    await host.screenshot({ path: "docs/network-goal.png" });
    for (const large of [false, true]) {
      // Keep the fixture in celebration while both software-rendered tabs
      // observe the pickup; the normal two-second window can expire mid-check.
      game.match.freeze = 10;
      const index = game.pads.items.findIndex((p) => p.large === large),
        pad = game.pads.items[index];
      // First let both clients receive the available pad state.
      pad.cooldown = 0;
      await host.waitForFunction(
        (index) => window.__arena.pads.items[index].cooldown === 0,
        index,
      );
      const car = game.simulation.cars.find((c) => c.id === local);
      car.reset(pad.x, pad.z, 0);
      car.boost = 20;
      await host.waitForFunction(
        ({ index, large }) => {
          const a = window.__arena,
            pad = a.pads.items[index];
          return (
            a.networkView.match.phase === "goal" &&
            a.networkView.simulation.cars[0].boost === (large ? 100 : 32) &&
            pad.cooldown > 0 &&
            pad.pulse > 0
          );
        },
        { index, large },
      );
      // Snapshot assertions must not depend on animation frames from a
      // background tab while the goal celebration/pad cooldown is advancing.
      await guest.bringToFront();
      await guest.waitForFunction(
        ({ index, local, large }) => {
          const a = window.__arena;
          return (
            a.network.latest.pads[index] > 0 &&
            a.network.latest.cars.find((c) => c.id === local).boost ===
              (large ? 100 : 32)
          );
        },
        { index, local, large },
        { polling: 50 },
      );
      await host.bringToFront();
      console.log(
        `PASS network post-goal ${large ? "large" : "small"} pickup and pulse synchronize in both browsers`,
      );
    }
    game.match.freeze = 0.1;
    await host.waitForFunction(
      () => window.__arena.networkView.match.phase === "countdown",
    );
    console.log("PASS authoritative goal, explosion and shared kickoff reset");
    game.match.phase = "playing";
    game.match.remaining = 0;
    game.simulation.ball.setTranslation({ x: 0, y: 0.93, z: 0 }, true);
    game.match.tick(game.simulation);
    for (const p of [host, guest])
      await p.waitForFunction(
        () => window.__arena.networkView.match.phase === "finished",
      );
    await host.locator("#network-return").click();
    await host.locator("#party-team-screen").waitFor({ state: "visible" });
    console.log("PASS shared result and host return to lobby");
    await host.locator('[data-stage="mode"]').click();
    await host.waitForFunction(
      () =>
        window.__arena.party.state.stage === "mode" &&
        !window.__arena.party.busy,
      null,
      { polling: 50 },
    );
    await host.locator('[data-mode="2v2bots"]').click();
    await host.waitForFunction(
      () =>
        window.__arena.party.state.mode === "2v2bots" &&
        !window.__arena.party.busy,
      null,
      { polling: 50 },
    );
    await host.locator("#party-continue").click();
    for (const p of [host, guest]) {
      await p.bringToFront();
      await p.waitForFunction(
        () =>
          window.__arena.party.state.stage === "teams" &&
          !window.__arena.party.busy,
        null,
        { polling: 50 },
      );
      await p.locator('.party-team-join[data-team="0"]').click();
      await p.waitForFunction(
        () => {
          const party = window.__arena.party;
          return (
            !party.busy &&
            party.state.members.find((m) => m.id === party.playerId)?.team === 0
          );
        },
        null,
        { polling: 50 },
      );
    }
    await host.bringToFront();
    await host.locator("#party-launch").click();
    await host.waitForFunction(
      () => window.__arena.networkView?.match.phase === "playing",
    );
    const bots = partyMatches.matches.get(code);
    assert.equal(bots.players.filter((p) => p.controller === "bot").length, 2);
    await host.waitForTimeout(900);
    assert.ok(
      bots.simulation.cars
        .filter((c) => c.team === 1)
        .some((c) => Math.abs(c.forwardSpeed) > 1),
    );
    await host.screenshot({ path: "docs/network-bots.png" });
    console.log("PASS two humans versus two server-controlled bots");
    // Simulate a transient transport drop; the same player/session reconnects.
    await guest.bringToFront();
    await guest.waitForFunction(
      (matchId) =>
        window.__arena.network.latest?.matchId === matchId &&
        window.__arena.network.socket?.readyState === WebSocket.OPEN,
      bots.id,
      { polling: 50 },
    );
    await guest.evaluate(() => window.__arena.network.socket.close());
    await guest.waitForTimeout(1200);
    await guest.waitForFunction(() => window.__arena.network.status === "");
    assert.equal(
      await guest.evaluate(() => window.__arena.network.latest.matchId),
      bots.id,
    );
    await guest.bringToFront();
    await guest.keyboard.press("Escape");
    await guest.locator("#network-leave").click();
    await host.bringToFront();
    await host.waitForFunction(
      () =>
        window.__arena.party.state.stage === "teams" &&
        !window.__arena.networkView,
    );
    assert.equal(partyMatches.matches.size, 0);
    console.log(
      "PASS transport reconnect and leaving disposes the shared match",
    );
    await host.locator('[data-stage="mode"]').click();
    await host.waitForFunction(
      () =>
        window.__arena.party.state.stage === "mode" &&
        !window.__arena.party.busy,
      null,
      { polling: 50 },
    );
    await host.locator('[data-mode="2v2"]').click();
    await host.waitForFunction(
      () =>
        window.__arena.party.state.mode === "2v2" && !window.__arena.party.busy,
      null,
      { polling: 50 },
    );
    await host.locator('[data-stage="home"]').click();
    await join(guest);
    const third = await open(),
      fourth = await open();
    await join(third);
    await join(fourth);
    await host.locator("#party-start").click();
    await host.locator("#party-continue").click();
    for (const [p, team] of [
      [host, 0],
      [guest, 0],
      [third, 1],
      [fourth, 1],
    ]) {
      await p.bringToFront();
      await p.waitForFunction(
        () =>
          window.__arena.party.state.stage === "teams" &&
          !window.__arena.party.busy,
        null,
        { polling: 50 },
      );
      await p.locator(`.party-team-join[data-team="${team}"]`).click();
    }
    await host.bringToFront();
    await host.locator("#party-launch").click();
    for (const p of [host, guest, third, fourth]) {
      await p.bringToFront();
      await p.waitForFunction(
        () =>
          window.__arena.networkView?.simulation.cars.length === 4 &&
          window.__arena.networkView.match.phase === "playing",
        null,
        { timeout: 60000 },
      );
    }
    await fourth.bringToFront();
    const fourthId = await fourth.evaluate(() => window.__arena.party.playerId);
    const fourGame = partyMatches.matches.get(code),
      start = fourGame.simulation.cars
        .find((c) => c.id === fourthId)
        .body.translation().z;
    await fourth.keyboard.down("KeyW");
    await fourth.waitForTimeout(700);
    await fourth.keyboard.up("KeyW");
    assert.ok(
      fourGame.simulation.cars.find((c) => c.id === fourthId).body.translation()
        .z >
        start + 1,
    );
    console.log("PASS four human cars and fourth-player controls in 2v2");
    await fourth.close();
    await host.waitForFunction(
      () => window.__arena.party.state.stage === "teams",
    );
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser?.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
