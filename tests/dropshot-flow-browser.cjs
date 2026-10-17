const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8281);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const p = await browser.newPage({ viewport: { width: 1100, height: 720 } }),
      errors = [];
    p.setDefaultTimeout(45000);
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("console", (e) => {
      if (e.type() === "error" && /shader|webgl/i.test(e.text()))
        errors.push(e.text());
    });
    await p.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const boot = async () => {
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
    };
    // Observe only the actual changed-value animation, never entrance/hover animations.
    await boot();
    await p.locator("#play").click();
    await p.locator("#bot-mode").click();
    await p.waitForTimeout(350);
    await p.evaluate(() => {
      window.changed = [];
      new MutationObserver((records) => {
        for (const r of records)
          if (r.target.hasAttribute("data-changed-control-id"))
            window.changed.push(r.target.dataset.changedControlId);
      }).observe(document.getElementById("app"), {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-changed-control-id"],
      });
    });
    await p.locator("#bot-size-next").click();
    await p.waitForTimeout(250);
    assert.deepEqual(await p.evaluate(() => [...new Set(window.changed)]), [
      "bot-size",
    ]);
    await p.locator("#bot-mutators").click();
    await p.waitForTimeout(350);
    await p.evaluate(() => (window.changed = []));
    const row = 'dialog[open] [data-mutator="gravity"]',
      before = await p.locator("dialog[open] .mutators-rows").boundingBox();
    await p.locator(row + ' [data-step="next"]').click();
    await p.waitForTimeout(250);
    assert.deepEqual(await p.evaluate(() => [...new Set(window.changed)]), [
      "gravity",
    ]);
    const after = await p.locator("dialog[open] .mutators-rows").boundingBox();
    assert.deepEqual(after, before);
    await p.locator("dialog[open] [data-nav-back]").click();
    await boot();
    await p.locator("#garage-open").click();
    await p.locator("#customize-car").click();
    await p.waitForTimeout(350);
    await p.evaluate(() => {
      window.changed = [];
      window.panelAnimations = 0;
      new MutationObserver((rs) => {
        for (const r of rs)
          if (r.target.hasAttribute("data-changed-control-id"))
            window.changed.push(r.target.dataset.changedControlId);
      }).observe(document.getElementById("garage-screen"), {
        subtree: true,
        attributes: true,
        attributeFilter: ["data-changed-control-id"],
      });
    });
    const item = await p
      .locator("[data-item]")
      .nth(1)
      .getAttribute("data-item");
    await p.locator(`[data-item="${item}"]`).click();
    assert.equal(
      await p
        .locator(".garage-left")
        .evaluate((el) => el.getAnimations().length),
      0,
      "Cosmetic selection does not reveal whole panel again",
    );
    await p.waitForTimeout(250);
    assert.deepEqual(await p.evaluate(() => [...new Set(window.changed)]), [
      item,
    ]);
    console.log(
      "PASS menu: one bot/mutator value, no row movement, only selected Garage item flashes",
    );
    for (const [i, mode] of [
      "soccar",
      "dropshot",
      "hoops",
      "heatseeker",
      "rumble",
      "freeplay",
    ].entries()) {
      await boot();
      await p.locator("#play").click();
      if (mode === "freeplay") {
        await p.locator("#freeplay-mode").click();
        await p.locator('[data-arena="city"]').click();
        await p.locator("#freeplay-launch").click();
      } else {
        await p.locator("#bot-mode").click();
        for (
          let k = 0;
          k < 5 && (await p.evaluate(() => __arena.botSetup.gameMode)) !== mode;
          k++
        )
          await p.locator("#bot-mode-next").click();
        await p.locator("#bot-launch").click();
      }
      await p.waitForFunction(
        () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
      );
      await p.evaluate((mode) => {
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
        s.cars[0].reset(0, -15, 0, 4);
        s.cars[0].body.setLinvel({ x: 0, y: -5, z: 0 }, true);
        s.cars.slice(1).forEach((c) => c.body.setEnabled(false));
        s.ball.setTranslation({ x: 0, y: 6, z: 0 }, true);
        s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        for (let k = 0; k < 240; k++) {
          s.step(s.cars.map(() => n));
          m.tick(s, pads);
        }
        s.lastTouchId = s.cars[0].id;
        s.lastTouchTime = s.clock;
        if (mode === "dropshot") {
          const d = s.dropshot,
            t = d.arena.tiles[90].translation();
          d.touch(s.cars[0].id, 0, 0);
          d.damage(90, 8, s.clock);
          d.damage(90, 8, s.clock + 0.21);
          s.ball.setTranslation({ x: t.x, y: 3, z: t.z }, true);
          s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
          for (let k = 0; k < 120 && m.phase === "playing"; k++) {
            s.step(s.cars.map(() => n));
            m.tick(s, pads);
          }
        } else if (mode === "hoops") {
          s.clock += 1 / 120;
          s.ball.setTranslation({ x: 0, y: 4.64, z: -28 }, true);
          m.tick(s, pads);
          s.clock += 1 / 120;
          s.ball.setTranslation({ x: 0, y: 3.14, z: -28 }, true);
          m.tick(s, pads);
        } else {
          s.clock += 1 / 120;
          s.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
          s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
          m.tick(s, pads);
        }
      }, mode);
      await p.waitForFunction(
        () => __arena.match.phase === "replay" && __arena.replayView.active,
      );
      const first = await p.evaluate(() => ({
        time: __arena.match.replay.clock.time,
        sim: __arena.simulation.clock,
        camera: __arena.camera.position.toArray(),
        tag: document
          .querySelector("#replay-nametags [data-player]")
          ?.getAttribute("style"),
      }));
      await p.waitForFunction(
        (t) => __arena.match.replay?.clock.time > t + 0.95,
        first.time,
      );
      const second = await p.evaluate(() => ({
        sim: __arena.simulation.clock,
        camera: __arena.camera.position.toArray(),
        tag: document
          .querySelector("#replay-nametags [data-player]")
          ?.getAttribute("style"),
        physics: __arena.replayView.proxies[0].car.physics.car.contactHeight,
      }));
      assert.equal(second.sim, first.sim);
      assert.notDeepEqual(second.camera, first.camera);
      assert.equal(second.physics, 0.31);
      assert.notEqual(first.tag, second.tag, "Replay labels continue moving");
      const score = await p.evaluate(() => __arena.match.score);
      if (mode === "rumble") {
        await p.waitForFunction(() => __arena.match.phase === "countdown", {
          timeout: 20000,
        });
      } else if (mode === "dropshot" || mode === "heatseeker") {
        await p.evaluate(async () => {
          const f = () => new Promise(requestAnimationFrame);
          window.pad = {
            id: "Replay controller",
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
            configurable: true,
            value: () => [window.pad],
          });
          await f();
          await f();
          window.pad.buttons[0] = { pressed: true, value: 1 };
          await f();
          await f();
          window.pad.buttons[0] = { pressed: false, value: 0 };
          await f();
          await f();
        });
      } else if (mode === "freeplay")
        await p.locator("#replay-skip-button").click();
      else await p.keyboard.press("Space");
      await p.waitForFunction(
        (mode) =>
          __arena.match.phase ===
          (mode === "freeplay" ? "playing" : "countdown"),
        mode,
      );
      assert.deepEqual(await p.evaluate(() => __arena.match.score), score);
      if (mode === "dropshot")
        assert.equal(
          await p.evaluate(() => __arena.simulation.dropshot.tiles),
          "0".repeat(140),
        );
      console.log(
        "PASS browser replay:",
        mode,
        "hard landing, moving clock/camera/labels, frozen physics, skip/natural end and reset",
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
