const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8274);
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
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low", infiniteBoost: false }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    for (let i = 0; i < 4; i++) await page.locator("#bot-mode-next").click();
    assert.equal(await page.locator("#bot-game-mode").innerText(), "DROPSHOT");
    assert.equal(await page.locator("#bot-size").innerText(), "3v3");
    // The same option is reachable through the existing controller carousel.
    await page.evaluate(() => {
      window.pad = {
        id: "Dropshot menu fixture",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", {
        configurable: true,
        value: () => (window.pad ? [window.pad] : []),
      });
    });
    const tap = (i) =>
      page.evaluate(async (i) => {
        const f = () => new Promise(requestAnimationFrame);
        window.pad.buttons[i] = { value: 1, pressed: true };
        await f();
        await f();
        window.pad.buttons[i] = { value: 0, pressed: false };
        await f();
        await f();
      }, i);
    await tap(3);
    await tap(12);
    await tap(14);
    assert.equal(await page.locator("#bot-game-mode").innerText(), "HOOPS");
    await tap(15);
    assert.equal(await page.locator("#bot-game-mode").innerText(), "DROPSHOT");
    assert.equal(await page.locator("#bot-size").innerText(), "3v3");
    await page.evaluate(() => (window.pad = null));
    await page.locator("#bot-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.deepEqual(
      await page.evaluate(() => [
        __arena.simulation.gameMode,
        __arena.arena.mapId,
        __arena.simulation.cars.length,
        __arena.pads.items.length,
      ]),
      ["dropshot", "dropshot", 6, 0],
    );
    await page.waitForFunction(
      () => __arena.arena.group.getObjectByName("dropshot-tiles").count === 140,
    );
    await page.waitForTimeout(500);
    assert.equal(
      await page.evaluate(
        () =>
          __arena.arena.group.parent.children.filter(
            (o) => o.name === "boost-pad" && o.visible,
          ).length,
      ),
      0,
    );
    await page.screenshot({ path: ".tools/dropshot-match.png" });
    const damage = await page.evaluate(() => {
      const s = __arena.simulation,
        ds = s.dropshot;
      s.cars.slice(1).forEach((c) => c.body.setEnabled(false));
      const index = 90,
        tile = ds.arena.tiles[index].translation();
      ds.touch(s.cars[0].id, 0, 30);
      ds.damage(index, 8, s.clock);
      return { index, tile };
    });
    await page.waitForFunction(() =>
      __arena.arena.dropshotTiles?.includes("1"),
    );
    await page.keyboard.down("Tab");
    await page.locator("#match-board").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.getElementById("match-board").textContent.includes("DAMAGE"),
    );
    assert.ok(
      await page
        .locator("#match-board")
        .innerText()
        .then((x) => x.includes("70")),
      "Seven damaged tiles credit 70 points",
    );
    await page.screenshot({ path: ".tools/dropshot-scoreboard.png" });
    await page.keyboard.up("Tab");
    await page.evaluate(({ index, tile }) => {
      const s = __arena.simulation,
        ds = s.dropshot;
      ds.damage(index, 10, s.clock + 0.3);
      s.ball.setTranslation({ x: tile.x, y: 5, z: tile.z }, true);
      s.ball.setLinvel({ x: 0, y: -9, z: 0 }, true);
      s.ballPose.snap();
    }, damage);
    await page.waitForFunction(() => __arena.match.phase === "goal");
    assert.equal(await page.evaluate(() => __arena.match.score[0]), 1);
    await page.waitForFunction(() => __arena.match.phase === "replay");
    await page.waitForFunction(() =>
      __arena.arena.dropshotTiles?.includes("2"),
    );
    await page.screenshot({ path: ".tools/dropshot-replay.png" });
    await page.locator("#replay-skip-button").click();
    await page.waitForFunction(() => __arena.match.phase === "countdown");
    await page.waitForFunction(
      () => __arena.arena.dropshotTiles === "0".repeat(140),
    );
    await page.evaluate(() => __arena.match.finish());
    await page.locator("#home").click();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator('[data-arena="dropshot"]').click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.equal(await page.evaluate(() => __arena.match.timed), false);
    assert.equal(
      await page.evaluate(() => __arena.simulation.gameMode),
      "dropshot",
    );
    await page.evaluate(() => {
      const s = __arena.simulation;
      window.dsFloor = s.dropshot;
      window.dsClock = s.clock;
      s.cars[0].boost = 0;
    });
    await page.waitForTimeout(1800);
    assert.ok(
      await page.evaluate(() => __arena.simulation.cars[0].boost > 5),
      "Free Play regenerates boost",
    );
    await page.screenshot({ path: ".tools/dropshot-freeplay.png" });
    await page.evaluate(() => {
      const s = __arena.simulation,
        d = s.dropshot,
        p = d.arena.tiles[90].translation();
      d.touch(s.cars[0].id, 0, 0);
      d.damage(90, 8, s.clock);
      d.damage(90, 8, s.clock + 0.21);
      s.ball.setTranslation({ x: p.x, y: 4, z: p.z }, true);
      s.ball.setLinvel({ x: 0, y: -8, z: 0 }, true);
      s.ballPose.snap();
    });
    await page.waitForFunction(() => __arena.match.phase === "replay");
    await page.locator("#replay-skip-button").click();
    await page.waitForFunction(
      () =>
        __arena.match.phase === "playing" &&
        __arena.arena.dropshotTiles === "0".repeat(140),
    );
    await page.evaluate(() => __arena.match.finish());
    await page.locator("#home").click();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator('[data-arena="city"]').click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.equal(await page.evaluate(() => __arena.simulation.dropshot), null);
    assert.equal(
      await page.evaluate(
        () => __arena.arena.group.getObjectByName("dropshot-reactor").visible,
      ),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS Dropshot browser: normal carousel/3v3 default, 140 instanced tiles/charge skin, live Damage points, holes/goal/replay/reset, Free Play/regeneration, Soccar restoration and no page errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
