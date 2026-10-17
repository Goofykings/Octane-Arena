const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8265);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /Shader Error|THREE.WebGLProgram/.test(m.text())
      )
        errors.push(m.text());
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const boot = async () => {
      await page.goto(server.url);
      await page.waitForFunction(() => window.__arena);
    };
    await boot();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator('[data-arena="hoops"]').click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.deepEqual(
      await page.evaluate(() => [
        __arena.simulation.gameMode,
        __arena.match.gameMode,
        __arena.arena.mapId,
        __arena.replayView.ball.userData.hoops,
      ]),
      ["hoops", "hoops", "hoops", true],
    );
    assert.equal(await page.evaluate(() => __arena.match.timed), false);
    assert.deepEqual(
      await page.evaluate(() => {
        const g = __arena.arena.group.getObjectByName("hoops-court"),
          children = [];
        g.traverse((o) => children.push(o));
        return [
          children.filter((o) => o.name === "hoops-car-pass-through-net")
            .length,
          children.filter((o) => o.name === "hoops-solid-rim").length,
          !!g.getObjectByName("hoops-neighborhood"),
          children.filter((o) => /bank/i.test(o.name)).length,
        ];
      }),
      [2, 2, true, 0],
    );
    await page.keyboard.press("c");
    await page.waitForFunction(() => !__arena.cameraControl.ballMode);
    await page.keyboard.press("c");
    await page.waitForFunction(() => __arena.cameraControl.ballMode);
    await page.mouse.move(1000, 450);
    await page.mouse.down();
    await page.mouse.move(1140, 510, { steps: 8 });
    await page.mouse.up();
    assert.ok(
      await page.evaluate(
        () => __arena.mouseLook.active || Math.abs(__arena.mouseLook.yaw) > 0,
      ),
    );
    await page.evaluate(() => {
      window.hoopsPad = {
        id: "Hoops controller",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0.7, 0.3],
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          value: 0,
        })),
        timestamp: performance.now(),
      };
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [window.hoopsPad],
      });
    });
    await page.waitForFunction(
      () => __arena.input.controller.values.cameraRight > 0.1,
    );
    assert.ok(
      await page.evaluate(() =>
        [
          ...__arena.camera.position.toArray(),
          ...__arena.camera.quaternion.toArray(),
        ].every(Number.isFinite),
      ),
    );
    await page.evaluate(() => {
      window.hoopsPad.axes = [0, 0, 0, 0];
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => [],
      });
    });
    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    await page.waitForTimeout(500);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await page.screenshot({ path: ".tools/hoops-freeplay.png" });
    await page.evaluate(() => {
      const s = __arena.simulation;
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 7, z: -28 }, true);
      s.ball.setLinvel({ x: 0, y: -4, z: 0 }, true);
    });
    await page.waitForFunction(
      () => __arena.match.phase === "replay" && __arena.replayView.active,
    );
    assert.equal(
      await page.evaluate(() => __arena.match.replay.clip.goal.focus.y),
      3.64,
    );
    assert.equal(
      await page.evaluate(() => __arena.replayView.ball.userData.hoops),
      true,
    );
    await page.screenshot({ path: ".tools/hoops-replay.png" });
    await page.evaluate(() => {
      const a = __arena;
      a.match.skipReplay(
        a.simulation.cars[0].id,
        a.match.replay.clip.goal.id,
        a.simulation,
      );
    });
    await page.waitForFunction(() => __arena.match.phase === "playing");
    await boot();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    assert.equal(await page.locator("#bot-hoops").count(), 0);
    for (let i = 0; i < 3; i++) await page.locator("#bot-mode-next").click();
    assert.equal(await page.locator("#bot-game-mode").innerText(), "HOOPS");
    assert.equal(await page.locator("#bot-size").innerText(), "2v2");
    await page.locator("#bot-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.equal(await page.evaluate(() => __arena.simulation.cars.length), 4);
    await page.evaluate(() => {
      const s = __arena.simulation;
      s.cars.slice(1).forEach((c) => c.body.setEnabled(false));
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 7, z: -28 }, true);
      s.ball.setLinvel({ x: 0, y: -4, z: 0 }, true);
    });
    await page.waitForFunction(() => __arena.match.phase === "goal");
    assert.equal(
      await page.evaluate(
        () =>
          __arena.match.stats.players.get(__arena.simulation.cars[0].id).goals,
      ),
      1,
    );
    await page.keyboard.down("Tab");
    await page.screenshot({ path: ".tools/hoops-scoreboard.png" });
    await page.keyboard.up("Tab");
    await boot();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.deepEqual(
      await page.evaluate(() => [
        __arena.simulation.gameMode,
        __arena.arena.mapId !== "hoops",
        __arena.replayView.ball.userData.hoops,
      ]),
      ["soccar", true, false],
    );
    await boot();
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#training-mode").click();
    await page.locator("#training-striker").click();
    await page.waitForFunction(
      () => __arena.extraSession?.pack?.id === "striker",
    );
    assert.equal(
      await page.evaluate(() => __arena.extraSession.physics.gameMode),
      "soccar",
    );
    assert.equal(
      await page.evaluate(
        () => !!__arena.extraSession.scene.getObjectByName("hoops-court"),
      ),
      false,
      "Training never inherits Hoops geometry from the saved Free Play map",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS actual Hoops Free Play selection/driving/goal/replay/reset; default 2v2 bot UI, live goal stats/scoreboard; switching back to Soccar restores arena/ball; no shader/browser errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
