const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app, partyMatches } = await startLan(8098, ":memory:");
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const errors = [];
    const context = async (name) => {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.setDefaultTimeout(20000);
      await ctx.addInitScript((name) => {
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name,
            avatarId: "comet",
            avatarColor: "#FF727C",
          }),
        );
        localStorage.setItem(
          "octane-arena-garage",
          JSON.stringify({
            presets: [
              {
                body: "vector",
                blue: "#2274ff",
                orange: "#ff8a2a",
                wheels: "disc",
                boost: "ember",
                decal: "circuit",
              },
            ],
          }),
        );
      }, name);
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:8098/?test");
      await page.waitForFunction(
        () =>
          window.__arena?.party.connection === "connected" &&
          !window.__arena.party.busy,
      );
      console.log(`Browser ready: ${name}`);
      return page;
    };
    const page = await context("Replay Driver");
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    console.log("VS Bot live");
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        m = a.match;
      // Populate the normal fixed-step recorder with genuine physics states.
      const n = {
        throttle: 0,
        steer: 0,
        pitch: 0,
        yaw: 0,
        roll: 0,
        boost: false,
        jump: false,
        slide: false,
      };
      for (let i = 0; i < 650; i++) {
        s.step([n, n]);
        m.tick(s, a.pads);
      }
      a.replayQaModel = a.visuals[0];
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -22 }, true);
    });
    await page.waitForFunction(() => window.__arena.match.phase === "goal");
    assert.equal(await page.evaluate(() => window.__arena.match.score[0]), 1);
    await page.evaluate(() => (window.__arena.match.freeze = 0.1));
    await page.locator("#goal-replay").waitFor({ state: "visible" });
    console.log("VS Bot replay visible");
    assert.equal(
      await page
        .locator(".replay-avatar")
        .evaluate((e) => getComputedStyle(e).color),
      "rgb(255, 114, 124)",
    );
    assert.equal(
      await page.locator(".replay-avatar path").getAttribute("d"),
      await page.locator("#profile .avatar path").getAttribute("d"),
    );
    assert.equal(
      await page.locator("#replay-scorer-name").textContent(),
      "Replay Driver",
    );
    assert.match(
      await page.locator("#replay-goal-speed").textContent(),
      /^\d+ km\/h$/,
    );
    assert.equal(await page.locator("#replay-players li").count(), 2);
    assert.equal(
      await page.locator("#replay-players li:not(.replay-voted)").count(),
      1,
    );
    assert.equal(
      await page.evaluate(
        () => window.__arena.visuals[0] === window.__arena.replayQaModel,
      ),
      true,
    );
    const worldHash = () => {
      const data = window.__arena.simulation.world.takeSnapshot();
      let a = 2166136261,
        b = 0;
      for (let i = 0; i < data.length; i++) {
        a = Math.imul(a ^ data[i], 16777619);
        b = (b + data[i] * (i + 1)) >>> 0;
      }
      return [data.length, a >>> 0, b];
    };
    const frozen = {
      world: await page.evaluate(worldHash),
      ...(await page.evaluate(() => ({
        clock: window.__arena.simulation.clock,
        goals: window.__arena.accounts.profile.value.stats.goals,
      }))),
    };
    console.log("VS Bot live world hash captured");
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(worldHash), frozen.world);
    assert.equal(
      await page.evaluate(() => window.__arena.simulation.clock),
      frozen.clock,
    );
    assert.equal(frozen.goals, 1);
    await page.screenshot({ path: "docs/goal-replay.png" });
    await page.evaluate(() => window.__arena.match.pause());
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [640, 600],
    ]) {
      await page.setViewportSize({ width, height });
      const bounds = await page.locator("#goal-replay").evaluate((root) => {
        const a = root.querySelector(".replay-scorer").getBoundingClientRect(),
          b = root.querySelector(".replay-skip").getBoundingClientRect();
        return {
          cardInside:
            a.left >= 0 && a.right <= innerWidth && a.bottom <= innerHeight,
          listInside:
            b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
          overlap: !(
            a.right <= b.left ||
            a.left >= b.right ||
            a.bottom <= b.top ||
            a.top >= b.bottom
          ),
        };
      });
      assert.ok(
        bounds.cardInside && bounds.listInside && !bounds.overlap,
        `Replay panels overlap at ${width}x${height}`,
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.evaluate(() => window.__arena.match.pause());
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () => window.__arena.match.phase === "countdown",
    );
    assert.equal(await page.locator("#goal-replay").isVisible(), false);
    assert.equal(await page.evaluate(() => window.__arena.match.score[0]), 1);
    assert.equal(
      await page.evaluate(
        () => window.__arena.accounts.profile.value.stats.goals,
      ),
      1,
    );
    await page.evaluate(() => {
      window.__arena.match.countdown = 0.01;
    });
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.bringToFront();
    await page.keyboard.down("KeyW");
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].forwardSpeed > 0.5,
      null,
      { timeout: 10000 },
    );
    await page.keyboard.up("KeyW");
    assert.ok(
      await page.evaluate(
        () => window.__arena.simulation.cars[0].forwardSpeed > 0,
      ),
    );
    console.log(
      "PASS VS Bot: recorded replay, matching cosmetics, scorer/speed/list, frozen live world, responsive overlays, one Space vote and normal kickoff/drive",
    );
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.locator("#leave-confirm-yes").click();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator('[data-arena="circuit"]').click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const a = window.__arena;
      a.simulation.ball.setTranslation({ x: 0, y: 1, z: -54 }, true);
      a.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(() => window.__arena.match.phase === "goal");
    await page.evaluate(() => (window.__arena.match.freeze = 0.05));
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    assert.equal(await page.locator("#goal-replay").isVisible(), false);
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#rings-mode").click();
    await page.waitForFunction(() => window.__arena.extraSession);
    assert.equal(await page.locator("#goal-replay").isVisible(), false);
    await page.keyboard.press("Escape");
    await page.locator("#rings-exit").click();
    console.log(
      "PASS Free Play goal/reset and Rings remain outside soccer replay flow",
    );

    const guest = await context("Replay Friend");
    const pages = [page, guest];
    const action = async (p, name, payload = {}) => {
      await p.bringToFront();
      await p.waitForFunction(() => !window.__arena.party.busy, null, {
        polling: 100,
      });
      const result = await p.evaluate(
        async ({ name, payload }) => ({
          ok: await window.__arena.party.action(name, payload),
          message: window.__arena.party.message,
        }),
        { name, payload },
      );
      assert.equal(result.ok, true, `${name}: ${result.message}`);
    };
    await action(page, "create");
    const code = await page.evaluate(() => window.__arena.party.state.code);
    await action(guest, "join", { code });
    await action(page, "stage", { stage: "mode" });
    await action(page, "stage", { stage: "teams" });
    await action(page, "team", { team: 0 });
    await action(guest, "team", { team: 1 });
    // Keep software WebGL from starving server physics during world creation.
    for (const p of pages)
      await p.evaluate(() => {
        window.replayQaRender = window.__arena.graphics.render;
        window.__arena.graphics.render = () => {};
      });
    await action(page, "launch");
    for (const p of pages)
      await p.waitForFunction(() => window.__arena.networkView, null, {
        polling: 100,
        timeout: 60000,
      });
    const game = partyMatches.matches.get(code);
    game.match.phase = "playing";
    for (let i = 0; i < 650; i++) game.step();
    game.simulation.lastTouchId = game.players[0].id;
    game.simulation.lastTouchTime = game.simulation.clock;
    game.simulation.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
    game.simulation.ball.setLinvel({ x: 0, y: 0, z: -25 }, true);
    game.match.tick(game.simulation, game.pads);
    game.match.freeze = 100;
    for (const p of pages) {
      await p.waitForFunction(() => !!window.__arena.network.replayClip, null, {
        polling: 100,
      });
      await p.evaluate(() => {
        window.__arena.graphics.render = window.replayQaRender;
      });
    }
    game.match.freeze = 0.05;
    for (const p of pages)
      await p.waitForFunction(
        () => window.__arena.network.latest.phase === "replay",
        null,
        { polling: 100 },
      );
    const frozenServer = game.simulation.world.takeSnapshot();
    for (const p of pages) {
      await p.bringToFront();
      await p.locator("#goal-replay").waitFor({ state: "visible" });
      assert.equal(
        await p
          .locator(".replay-avatar")
          .evaluate((e) => getComputedStyle(e).color),
        "rgb(255, 114, 124)",
      );
      assert.equal(
        await p.locator("#replay-players li:not(.replay-voted)").count(),
        2,
      );
      assert.equal(
        await p.locator("#replay-scorer-name").textContent(),
        "Replay Driver",
      );
      assert.equal(
        await p.locator("#replay-goal-speed").textContent(),
        "90 km/h",
      );
      assert.equal(
        await p.evaluate(() => window.__arena.arena.mapId),
        game.arenaId,
      );
    }
    assert.deepEqual(game.simulation.world.takeSnapshot(), frozenServer);
    await page.bringToFront();
    await page.keyboard.press("Space");
    const local = await page.evaluate(() => window.__arena.party.playerId);
    for (const p of pages)
      await p.waitForFunction(
        (id) => window.__arena.network.latest.replay?.votes.includes(id),
        local,
        { polling: 100 },
      );
    assert.equal(game.match.phase, "replay");
    await guest.bringToFront();
    await guest.waitForFunction(
      () =>
        document.querySelectorAll("#replay-players li:not(.replay-voted)")
          .length === 1,
    );
    await guest.screenshot({ path: "docs/goal-replay-lan.png" });
    await guest.keyboard.press("Space");
    for (const p of pages)
      await p.waitForFunction(
        () => window.__arena.network.latest.phase === "countdown",
        null,
        { polling: 100 },
      );
    assert.equal(game.match.score[0], 1);
    for (const p of pages) {
      await p.bringToFront();
      await p.waitForFunction(
        () => document.getElementById("goal-replay").hidden,
      );
    }
    console.log(
      "PASS two browsers: same authoritative clip/map/scorer/speed, two human skip entries, one vote synchronized, unanimous immediate kickoff and frozen server physics",
    );
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
