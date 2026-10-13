const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8245);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1366, height: 768 },
    });
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Results controller",
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
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-mode-next").click();
    await page.locator("#bot-mode-next").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const a = __arena,
        s = a.simulation,
        r = s.rumble;
      const id = s.cars[0].id;
      s.cars[0].reset(0, 0, 0);
      s.cars[1].reset(10, -8, 0);
      r.end(id);
      r.grant(id, "SWAPPER");
    });
    await page.waitForFunction(
      () => !document.getElementById("rumble-target").hidden,
    );
    const target = await page
      .locator("#rumble-target")
      .getAttribute("data-player");
    assert.equal(
      target,
      await page.evaluate(() => __arena.simulation.cars[1].id),
    );
    await page.keyboard.press("f");
    await page.waitForFunction(() =>
      __arena.simulation.rumble.events.some((e) => e.kind === "SWAP"),
    );
    await page.evaluate(() => {
      const a = __arena;
      a.match.score = [3, 2];
      const stats = a.match.stats;
      for (const p of stats.players.values()) {
        p.score = 0;
        p.goals = p.assists = p.saves = p.shots = 0;
      }
      const id = a.simulation.cars[1].id;
      stats.players.get(id).score = 212;
      stats.players.get(id).goals = 1;
      stats.players.get(id).assists = 1;
      stats.players.get(id).saves = 1;
      stats.players.get(id).shots = 1;
      a.match.finish();
    });
    await page.waitForFunction(
      () =>
        !document.getElementById("result").hidden &&
        document.querySelector(".mvp-badge"),
    );
    assert.equal(
      await page.locator("#result-score").innerText(),
      "BLUE 3 - 2 ORANGE",
    );
    const bot = await page.evaluate(() => __arena.simulation.cars[1].id);
    assert.equal(
      await page
        .locator(".mvp-badge")
        .evaluate((e) => e.closest("[data-player]").dataset.player),
      bot,
    );
    assert.match(
      await page.locator('[data-player="' + bot + '"].stat-row').innerText(),
      /212/,
    );
    assert.equal(await page.locator("#match-board").isVisible(), true);
    const animation = await page.locator("#match-award").evaluate((e) => ({
      duration: e.getAnimations()[0].effect.getTiming().duration,
      frames: e.getAnimations()[0].effect.getKeyframes(),
    }));
    assert.equal(animation.duration, 1400);
    assert.ok(
      Math.abs(
        animation.frames[2].offset - animation.frames[1].offset - 1000 / 1400,
      ) < 1e-8,
    );
    assert.ok(
      await page.locator("#results-board").evaluate((e) => e.clientWidth > 600),
      "Final board fills available grid width",
    );
    const head = await page.locator("#result-title").boundingBox(),
      notice = await page.locator("#match-award").boundingBox();
    assert.ok(
      head.y >= notice.y + notice.height,
      "MVP does not overlap results title",
    );
    await page.screenshot({ path: ".tools/results-screen.png" });
    await page.waitForTimeout(1600);
    assert.equal(await page.locator("#match-award").isVisible(), false);
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator("#match-award").isVisible(),
      false,
      "MVP only once",
    );
    for (const size of [
      { width: 1280, height: 720 },
      { width: 700, height: 720 },
    ]) {
      await page.setViewportSize(size);
      const boxes = await page
        .locator("#result .results-actions,#match-board,#result-score")
        .evaluateAll((es) =>
          es.map((e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
          }),
        );
      for (const b of boxes)
        assert.ok(
          b.x >= 0 &&
            b.y >= 0 &&
            b.right <= size.width + 1 &&
            b.bottom <= size.height + 1,
          JSON.stringify({ size, b }),
        );
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    const press = async (i) => {
      await page.evaluate((i) => {
        pad.buttons[i] = { pressed: true, value: 1 };
      }, i);
      await page.waitForTimeout(130);
      await page.evaluate((i) => {
        pad.buttons[i] = { pressed: false, value: 0 };
      }, i);
      await page.waitForTimeout(130);
    };
    await press(13);
    await page.waitForFunction(
      () => document.documentElement.dataset.uiInput === "controller",
    );
    assert.equal(await page.evaluate(() => document.activeElement.id), "again");
    await press(13);
    assert.equal(await page.evaluate(() => document.activeElement.id), "home");
    await press(12);
    assert.equal(await page.evaluate(() => document.activeElement.id), "again");
    await press(0);
    await page.waitForFunction(() => __arena.match.phase === "playing");
    assert.equal(await page.evaluate(() => __arena.match.gameMode), "rumble");
    assert.deepEqual(await page.evaluate(() => __arena.match.score), [0, 0]);
    assert.ok(
      await page.evaluate(() =>
        [...__arena.match.stats.players.values()].every((s) => s.score === 0),
      ),
    );
    assert.equal(await page.locator("#result").isVisible(), false);
    await page.evaluate(() => __arena.match.finish());
    await page.locator("#home").click();
    await page.waitForFunction(() => __arena.match.phase === "home");
    assert.equal(await page.locator("#play").isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(
      "PASS production results final scores/rows/MVP one-shot 1s hold, responsive layout, Swapper target/use, controller navigation/rematch, fresh Rumble stats and Home",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
