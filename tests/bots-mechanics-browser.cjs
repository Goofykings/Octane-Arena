const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8220);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    context.setDefaultTimeout(45000);
    await context.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    const open = async () => {
      await page.locator("#play").click();
      await page.locator("#bot-mode").click();
      await page.locator("#bot-setup").waitFor({ state: "visible" });
      assert.equal(
        await page.evaluate(() => window.__arena.match.phase),
        "home",
      );
    };
    const pick = async (size, difficulty) => {
      for (
        let i = 0;
        i < 5 && (await page.locator("#bot-size").textContent()) !== size;
        i++
      )
        await page.locator("#bot-size-next").click();
      for (
        let i = 0;
        i < 3 &&
        (await page.locator("#bot-difficulty").textContent()) !==
          difficulty.toUpperCase();
        i++
      )
        await page.locator("#bot-difficulty-next").click();
    };
    const leave = async () => {
      await page.keyboard.press("Escape");
      await page.locator("#pause-home").click();
      await page.locator("#leave-confirm-yes").click();
      await page.waitForFunction(() => window.__arena.match.phase === "home");
    };
    await open();
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [800, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(120);
      for (const selector of ["#bot-size", "#bot-difficulty", "#bot-launch"]) {
        const b = await page.locator(selector).boundingBox();
        assert.ok(
          b &&
            b.x >= 0 &&
            b.y >= 0 &&
            b.x + b.width <= width + 1 &&
            b.y + b.height <= height + 1,
          `${selector} fits ${width}`,
        );
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await pick("3v3", "advanced");
    await page.screenshot({ path: "docs/bot-setup.png" });
    for (const size of ["1v1", "2v2", "3v3", "1v2", "1v3"])
      for (const difficulty of ["beginner", "intermediate", "advanced"]) {
        await pick(size, difficulty);
        await page.locator("#bot-launch").click();
        await page.waitForFunction(
          () => window.__arena.match.phase === "countdown",
        );
        const [blue, orange] = size.split("v").map(Number);
        const state = await page.evaluate(() => {
          const a = window.__arena;
          return {
            teams: a.simulation.cars.map((c) => c.team),
            active: a.simulation.cars.filter((c) => c.body.isEnabled()).length,
            difficulty: a.botTeam.difficulty,
            stats: a.match.stats.players.size,
          };
        });
        assert.equal(state.teams.filter((x) => x === 0).length, blue);
        assert.equal(state.teams.filter((x) => x === 1).length, orange);
        assert.equal(state.active, blue + orange);
        assert.equal(state.stats, blue + orange);
        assert.equal(state.difficulty, difficulty);
        await page.waitForFunction(() => {
          const a = window.__arena;
          return document.querySelectorAll("#bot-tag .bot-name").length === a.simulation.players.length - 1;
        });
        if (!(size === "3v3" && difficulty === "advanced"))
          await page.evaluate(() => (window.__arena.match.countdown = 0.001));
        await page.waitForFunction(
          () => window.__arena.match.phase === "playing",
        );
        await page.keyboard.down("KeyW");
        await page.waitForTimeout(160);
        await page.keyboard.up("KeyW");
        assert.equal(
          await page.evaluate(
            () => window.__arena.visuals.filter((v) => v.parent.visible).length,
          ),
          blue + orange,
          "All independent car models render, including six actors",
        );
        const tags = await page.evaluate(() => {
          const a = window.__arena;
          return [...document.querySelectorAll("#bot-tag .bot-name")].map((tag) => {
            const index = a.simulation.cars.findIndex((c) => c.id === tag.dataset.player);
            const car = a.simulation.cars[index], model = a.visuals[index].parent;
            const p = model.position.clone();
            p.y += 1.05;
            p.project(a.camera);
            return { id: tag.dataset.player, name: tag.textContent, expected: car.displayName,
              team: Number(tag.dataset.team), expectedTeam: car.team,
              hidden: tag.hidden || tag.parentElement.hidden,
              expectedHidden: Math.abs(p.x) > 1 || Math.abs(p.y) > 1 || p.z < 0 || p.z > 1,
              errorX: Math.abs(parseFloat(tag.style.left) - (p.x * .5 + .5) * innerWidth),
              errorY: Math.abs(parseFloat(tag.style.top) - (-p.y * .5 + .5) * innerHeight) };
          });
        });
        assert.equal(tags.length, blue + orange - 1);
        assert.equal(new Set(tags.map((t) => t.id)).size, tags.length);
        assert.equal(new Set(tags.map((t) => t.name)).size, tags.length);
        for (const tag of tags) {
          assert.equal(tag.name, tag.expected);
          assert.equal(tag.team, tag.expectedTeam);
          assert.equal(tag.hidden, tag.expectedHidden, `${tag.id} is visible when its car is in view`);
          assert.ok(tag.errorX < .1 && tag.errorY < .1, `${tag.id} follows its own car`);
        }
        await page.keyboard.down("Tab");
        await page.waitForTimeout(80);
        const rows = await page.evaluate(() => [...document.querySelectorAll(".stat-row[data-player]")]
          .map((el) => ({ id: el.dataset.player, text: el.textContent })));
        assert.equal(rows.length, blue + orange);
        for (const tag of tags) assert.ok(rows.some((r) => r.id === tag.id && r.text.includes(tag.name)));
        await page.keyboard.up("Tab");
        if (size === "3v3" && difficulty === "advanced") {
          await page.keyboard.down("Tab");
          await page.waitForTimeout(100);
          await page.screenshot({ path: "docs/bots-3v3-scoreboard.png" });
          await page.keyboard.up("Tab");
          await page.evaluate(() => {
            const s = window.__arena.simulation;
            s.ball.setTranslation({ x: 0, y: 2, z: -52.1 }, true);
            s.ball.setLinvel({ x: 0, y: 0, z: -20 }, true);
            s.ballPose.snap();
          });
          await page.waitForFunction(
            () => window.__arena.match.phase === "replay",
          );
          assert.equal(
            await page.evaluate(
              () => window.__arena.match.replay.clip.carIds.length,
            ),
            6,
          );
          assert.equal(
            await page.evaluate(() =>
              window.__arena.match.replay.clip.frames.every(Number.isFinite),
            ),
            true,
          );
          await page.locator("#replay-skip-button").click();
          await page.waitForFunction(
            () => window.__arena.match.phase === "countdown",
          );
        }
        await leave();
        await open();
      }
    await page.locator("#bot-setup-back").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation,
        c = s.cars[0];
      s.world.gravity = { x: 0, y: 0, z: 0 };
      c.reset(0, 0, 0, 6);
      c.jump.used = true;
      c.jump.second = true;
      c.jump.age = 10;
      s.ball.setTranslation({ x: 0, y: 4.94, z: 0 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      c.pose.snap();
      s.ballPose.snap();
    });
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].flipResetSequence > 0,
    );
    await page.waitForFunction(
      () => window.__arena.vehicleEffects[0].flipReset.ring.visible,
    );
    await page.screenshot({ path: "docs/flip-reset.png" });
    await page.evaluate(() => {
      const a = window.__arena,
        s = a.simulation;
      s.ball.setTranslation({ x: 20, y: 12, z: 0 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.cars[0].body.setLinvel({ x: 8, y: -2, z: 4 }, true);
    });
    await page.waitForTimeout(1600);
    assert.equal(
      await page.evaluate(
        () => window.__arena.simulation.cars[0].jump.available,
      ),
      true,
    );
    const binds = await page.evaluate(() => window.__arena.input.bindings);
    await page.keyboard.down(binds.left);
    await page.keyboard.down(binds.rollRight);
    await page.keyboard.down(binds.jump);
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].jump.stall,
    );
    await page.keyboard.up(binds.jump);
    await page.keyboard.up(binds.rollRight);
    await page.keyboard.up(binds.left);
    assert.equal(
      await page.evaluate(
        () => window.__arena.simulation.cars[0].jump.available,
      ),
      false,
    );
    assert.equal(
      await page.evaluate(() =>
        window.__arena.simulation.cars[0].jump.direction.length(),
      ),
      0,
    );
    assert.ok(
      await page.evaluate(
        () => Math.abs(window.__arena.simulation.cars[0].body.linvel().x) > 6,
      ),
      "Stall consumes reset without freezing motion",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS production responsive bot setup, all 15 selections with distinct ID-keyed names/nametags following cars/scoreboard rows, six-car replay/skip, Free Play return, real bottom contact white effect and late keyboard reset stall",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
