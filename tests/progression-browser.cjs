const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { staticGame } = require("./static-game.cjs");
(async () => {
  fs.mkdirSync(".tools", { recursive: true });
  const server = await staticGame(8292),
    profileDir = fs.mkdtempSync(path.resolve(".tools/xp-browser-"));
  const options = {
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    viewport: { width: 1366, height: 768 },
    args: ["--enable-unsafe-swiftshader"],
  };
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(profileDir, options);
    await context.addInitScript(() => {
      if (!localStorage.getItem("octane-arena-profile"))
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            localPlayerId: crypto.randomUUID(),
            name: "XP Pilot",
            avatarId: "fox",
            stats: { wins: 8 },
            progression: { totalXP: 5800 },
          }),
        );
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "XP controller",
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
    });
    let page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    assert.equal(await page.locator("#profile-level").innerText(), "3");
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(() => __arena.match.phase === "playing");
    const originalModel = await page.evaluate(() => __arena.visuals[0].uuid);
    await page.keyboard.down("w");
    await page.waitForTimeout(3500);
    await page.keyboard.up("w");
    await page.evaluate(() => {
      const a = __arena;
      a.match.stats.players.get(a.simulation.cars[0].id).score = 540;
      a.match.stats.players.get(a.simulation.cars[0].id).touches = 5;
      a.match.score = [2, 1];
      // Use the real zero-clock/grounded-ball end path rather than forcing the UI phase.
      a.match.remaining = 0;
      a.simulation.ball.setTranslation({ x: 0, y: 1, z: 0 }, true);
      a.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(() => document.querySelector("#xp-earned"));
    const state = await page.evaluate(() => ({
      total: __arena.accounts.profile.value.progression.totalXP,
      award: Object.values(__arena.accounts.profile.value.xpAwards).find(
        (a) => a.source.type === "MATCH",
      ),
      completion: __arena.match.completion,
      animating: document.getElementById("results-progression").dataset
        .animating,
    }));
    assert.equal(
      await page.evaluate(() => __arena.visuals[0].uuid),
      originalModel,
      "XP must not rebuild car cosmetics/colliders",
    );
    const expected =
      Math.floor(state.completion.activeSeconds * 4 + 1e-7) + 54 + 100 + 50;
    assert.equal(state.award.amount, expected);
    assert.equal(
      state.total,
      5800 + expected,
      "Only match XP is awarded before challenge claims",
    );
    assert.equal(state.animating, "true");
    assert.equal(
      await page.locator("#profile-level").innerText(),
      "4",
      "Persistent level updates before animation finishes",
    );
    await page.waitForFunction(() =>
      document.getElementById("xp-level-up").textContent.includes("LEVEL UP"),
    );
    // Enter controller navigation, move from PLAY AGAIN to the XP skip control.
    await page.evaluate(() => {
      window.pad.buttons[11] = { pressed: true, value: 1 };
    });
    await page.waitForFunction(
      () => document.documentElement.dataset.uiInput === "controller",
    );
    await page.evaluate(() => {
      window.pad.buttons[11] = { pressed: false, value: 0 };
      window.pad.buttons[15] = { pressed: true, value: 1 };
    });
    await page.waitForFunction(() => document.activeElement?.id === "xp-skip");
    await page.evaluate(() => {
      window.pad.buttons[15] = { pressed: false, value: 0 };
    });
    await page.evaluate(() => {
      window.pad.buttons[0] = { pressed: true, value: 1 };
    });
    await page.waitForTimeout(120);
    await page.evaluate(() => {
      window.pad.buttons[0] = { pressed: false, value: 0 };
    });
    await page.waitForFunction(
      () =>
        document.getElementById("results-progression").dataset.animating ===
        "false",
    );
    assert.equal(await page.locator("#xp-level").innerText(), "LEVEL 4");
    assert.equal(
      await page.locator("#xp-bar").getAttribute("aria-valuenow"),
      String(state.total - 6000),
    );
    assert.equal(await page.locator(".xp-breakdown div").count(), 4);
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 700, height: 720 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const boxes = await page
        .locator(
          "#result-title,#match-board,#results-progression,#result .results-actions",
        )
        .evaluateAll((es) =>
          es.map((e) => {
            const r = e.getBoundingClientRect();
            return {
              id: e.id,
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          }),
        );
      for (const b of boxes)
        assert.ok(
          b.x >= -1 &&
            b.y >= -1 &&
            b.right <= size.width + 1 &&
            b.bottom <= size.height + 1,
          JSON.stringify({ size, b }),
        );
      const board = await page.locator("#results-board").boundingBox();
      assert.ok(
        boxes.find((b) => b.id === "results-progression").y >=
          board.y + board.height - 1,
        "XP is below the leaderboard viewport: " +
          JSON.stringify({ size, boxes, board }),
      );
      if (size.width === 1280)
        await page.screenshot({ path: ".tools/xp-results-desktop.png" });
    }
    await page.screenshot({ path: ".tools/xp-results.png" });
    // Reopening result UI never changes the persistent transaction.
    await page.evaluate(() => {
      document.getElementById("result").hidden = true;
    });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      state.total,
    );
    const oldId = state.completion.id;
    await page.locator("#again").click();
    await page.waitForFunction(() => __arena.match.phase === "playing");
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      state.total,
      "Starting a rematch doesn't re-award",
    );
    await page.evaluate(() => {
      const a = __arena;
      a.match.stats.players.get(a.simulation.cars[0].id).score = 20;
      a.match.score = [1, 2];
      a.match.finish();
    });
    await page.waitForFunction(
      () =>
        Object.values(__arena.accounts.profile.value.xpAwards).filter(
          (a) => a.source.type === "MATCH",
        ).length === 2,
    );
    const secondTotal = await page.evaluate(
      () => __arena.accounts.profile.value.progression.totalXP,
    );
    assert.notEqual(
      await page.evaluate(() => __arena.match.completion.id),
      oldId,
    );
    assert.ok(secondTotal > state.total);
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      secondTotal,
    );
    await page.locator("#profile").click();
    assert.match(
      await page.locator("#account .profile-stats").innerText(),
      /TOTAL XP/,
    );
    assert.match(
      await page.locator("#account .profile-stats").innerText(),
      /XP TO NEXT LEVEL/,
    );
    await page.locator("#account-close").click();
    await page.evaluate(() => {
      __arena.garage.duplicate();
      __arena.garage.rename(__arena.garage.current.id, "XP Preset");
      __arena.settings.value.audio.music = 0;
      __arena.settings.save();
    });
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      secondTotal,
    );
    await context.close();
    context = await chromium.launchPersistentContext(profileDir, options);
    page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      secondTotal,
      "Real browser close/reopen retains XP",
    );
    assert.equal(
      await page.evaluate(() => __arena.garage.current.name),
      "XP Preset",
    );
    assert.equal(
      await page.evaluate(() => __arena.settings.value.audio.music),
      0,
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () =>
        __arena.match.mode === "freeplay" && __arena.match.phase === "playing",
    );
    await page.keyboard.down("w");
    await page.waitForTimeout(800);
    await page.keyboard.up("w");
    await page.evaluate(() => __arena.match.finish());
    await page.waitForTimeout(150);
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      secondTotal,
    );
    assert.equal(await page.locator("#results-progression").isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(
      "PASS browser: real match-end XP, live level-up/overflow, controller skip, responsive results, no re-award, rematch, profile, refresh, browser restart, presets/settings and Free Play exclusion",
    );
  } finally {
    await context?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
