const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8258);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const p = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
      errors = [];
    p.setDefaultTimeout(45000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
    });
    const boot = async () => {
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
    };
    for (const mode of ["freeplay", "soccar", "heatseeker", "rumble"]) {
      await boot();
      await p.locator("#play").click();
      if (mode === "freeplay") {
        await p.locator("#freeplay-mode").click();
        await p.locator("#freeplay-launch").click();
      } else {
        await p.locator("#bot-mode").click();
        for (
          let i = 0;
          i < 3 && (await p.evaluate(() => __arena.botSetup.gameMode)) !== mode;
          i++
        )
          await p.locator("#bot-mode-next").click();
        await p.locator("#bot-launch").click();
      }
      await p.waitForFunction(
        () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
      );
      await p.evaluate(() => {
        const { simulation: s, match: m, pads } = __arena,
          n = {
            throttle: 0,
            steer: 0,
            pitch: 0,
            yaw: 0,
            roll: 0,
            boost: false,
            jump: false,
            slide: false,
          };
        s.cars[0].reset(0, -15, 0);
        s.cars[1].reset(2, -14, 0);
        s.ball.setTranslation({ x: 0, y: 2, z: -18 }, true);
        s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < 240; i++) {
          s.step([n, n]);
          m.tick(s, pads);
        }
        s.lastTouchId = s.cars[0].id;
        s.lastTouchTime = s.clock;
        s.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
        s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
        m.tick(s, pads);
      });
      await p.waitForFunction(
        () => __arena.match.phase === "replay" && __arena.replayView.active,
      );
      await p.locator("#replay-nametags").waitFor({ state: "visible" });
      const local = await p.evaluate(() => __arena.simulation.cars[0].id);
      assert.ok(
        await p
          .locator('#replay-nametags [data-player="' + local + '"]')
          .isVisible(),
        mode + " local replay label visible outside hidden HUD",
      );
      if (mode === "freeplay")
        assert.equal(await p.locator("#replay-players li").count(), 1);
      const score = await p.evaluate(() => __arena.match.score);
      assert.deepEqual(score, mode === "freeplay" ? [0, 0] : [1, 0]);
      const clock = await p.evaluate(() => __arena.simulation.clock);
      await p.waitForTimeout(180);
      assert.equal(await p.evaluate(() => __arena.simulation.clock), clock);
      await p.screenshot({ path: ".tools/replay-" + mode + ".png" });
      await p.evaluate(() => {
        const view = __arena.replayView,
          original = view.effects.explosion.trigger.bind(
            view.effects.explosion,
          );
        view.effects.explosion.trigger = (point, color) => {
          window.replayExplosionColor = color;
          original(point, color);
        };
        __arena.match.replay.clock.time =
          __arena.match.replay.clip.goal.time + 0.1;
      });
      await p.waitForFunction(() => window.replayExplosionColor !== undefined);
      assert.equal(
        await p.evaluate(() => window.replayExplosionColor),
        mode === "freeplay" ? 0xbfc8d2 : 0x69e9ff,
      );
      await p.keyboard.press("Space");
      await p.waitForFunction(
        (mode) =>
          __arena.match.phase ===
          (mode === "freeplay" ? "playing" : "countdown"),
        mode,
      );
      assert.equal(await p.locator("#replay-nametags").count(), 0);
      console.log(
        "PASS",
        mode,
        "actual goal -> render-only replay with visible nametag -> skip/reset",
        score,
      );
    }
    await boot();
    await p.locator("#play").click();
    await p.locator("#extra-mode").click();
    await p.locator("#training-mode").click();
    await p.locator("#training-striker").click();
    await p.waitForFunction(
      () =>
        __arena.extraSession?.id === "training" && !__arena.matchLoader.active,
    );
    await p.evaluate(() => {
      const session = __arena.extraSession,
        r = session.run,
        s = session.physics,
        n = {
          throttle: 0,
          steer: 0,
          pitch: 0,
          yaw: 0,
          roll: 0,
          boost: false,
          jump: false,
          slide: false,
        };
      r.ready = false;
      s.cars[0].reset(0, -15, 0);
      s.ball.setTranslation({ x: 0, y: 2, z: -18 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      for (let i = 0; i < 120; i++) r.step(n);
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
      r.step(n);
    });
    await p.waitForFunction(() => __arena.extraSession.replayActive);
    assert.ok(
      await p.locator("#replay-nametags").isVisible(),
      "training uses shared replay labels",
    );
    assert.equal(await p.locator("#replay-nametags [data-player]").count(), 1);
    await p.keyboard.press("Space");
    await p.waitForFunction(() => !__arena.extraSession.replayActive);
    assert.equal(await p.locator("#replay-nametags").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS Striker replay uses same nametags and cleans them up after skip; no browser errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
