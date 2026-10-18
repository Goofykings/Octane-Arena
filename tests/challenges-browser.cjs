const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { staticGame } = require("./static-game.cjs");
(async () => {
  fs.mkdirSync(".tools", { recursive: true });
  const server = await staticGame(8297);
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
    await context.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Challenge controller",
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
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.waitForFunction(
      () => !document.getElementById("home-challenges").hidden,
    );
    assert.equal(
      await page.locator("#home-challenges [data-challenge]").count(),
      3,
    );
    const panel = page.locator("#home-challenges-panel");
    const toggle = page.locator("#home-challenges-toggle");
    const bounds = () => panel.boundingBox();
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page.locator("#home-challenges .challenge-season").isVisible(),
      false,
    );
    assert.equal(
      await page
        .locator("#home-challenges .challenge-card-footer")
        .first()
        .isVisible(),
      false,
    );
    for (const card of await page
      .locator("#home-challenges [data-challenge]")
      .all()) {
      assert.ok(await card.locator(".challenge-description").isVisible());
      assert.ok(await card.locator(".challenge-fraction").isVisible());
    }
    const compact = await bounds();
    const carArea = () => page.locator("#home-car-area").boundingBox();
    const carBefore = await carArea();
    await toggle.click();
    await page.waitForTimeout(400);
    const expanded = await bounds(),
      carAfter = await carArea();
    assert.ok(
      expanded.width > compact.width + 80,
      "Expansion restores full details",
    );
    assert.ok(expanded.x < compact.x, "Panel grows left from right edge");
    assert.ok(
      carAfter.x + carAfter.width / 2 < carBefore.x + carBefore.width / 2 - 20,
      "Car presentation shifts left",
    );
    assert.equal(
      await page.locator("#challenges-screen").evaluate((e) => e.open),
      false,
      "Arrow does not open full page",
    );
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    assert.ok(
      await page
        .locator("#home-challenges .challenge-reward")
        .first()
        .isVisible(),
    );
    assert.match(
      await page.locator("#home-challenges").innerText(),
      /SEASON 1/,
    );
    assert.match(
      await page.locator("#home-challenges").innerText(),
      /ENDS NOVEMBER 18/,
    );
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 700, height: 720 },
      { width: 390, height: 844 },
      { width: 1280, height: 500 },
    ]) {
      await page.setViewportSize(size);
      for (const expanded of [false, true]) {
        if ((await toggle.getAttribute("aria-expanded")) !== String(expanded))
          await toggle.click();
        await page.waitForTimeout(350);
        const r = await page.locator("#home-challenges").boundingBox();
        const a = await toggle.boundingBox();
        assert.ok(
          r.x >= 0 &&
            r.x + r.width <= size.width + 1 &&
            r.y + r.height <= size.height + 1,
          "Panel stays inside viewport",
        );
        assert.ok(a.x >= 0, "Arrow stays on screen");
        if (expanded && size.width < 760) {
          const car = await carArea();
          assert.ok(
            car.x + car.width / 2 < r.x,
            "Narrow-screen car stays beside expanded panel",
          );
        }
        const menu = await page.locator("#menu").boundingBox();
        assert.ok(
          r.x >= menu.x + menu.width ||
            r.y >= menu.y + menu.height ||
            r.y + r.height <= menu.y,
          "Home controls remain uncovered",
        );
        await page.screenshot({
          path:
            ".tools/challenges-home-" +
            size.width +
            "-" +
            size.height +
            "-" +
            expanded +
            ".png",
        });
      }
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(350);
    await page.locator("#home-challenges").click();
    assert.equal(
      await page.locator("#challenge-cards [data-challenge]").count(),
      3,
    );
    assert.equal(
      await page.locator("#challenges-daily").getAttribute("aria-selected"),
      "true",
    );
    await page.locator("#challenges-weekly").click();
    assert.equal(
      await page.locator("#challenge-cards [data-challenge]").count(),
      6,
    );
    await page.locator("#challenges-season").click();
    assert.equal(
      await page.locator("#challenge-cards [data-challenge]").count(),
      6,
    );
    assert.match(
      await page.locator("#challenge-period-end").innerText(),
      /NOVEMBER 18, 2026/,
    );
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 700, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      assert.equal(
        await page
          .locator("#challenge-cards")
          .evaluate((e) => getComputedStyle(e).scrollbarWidth),
        "none",
      );
      for (const card of await page
        .locator("#challenge-cards [data-challenge]")
        .all()) {
        await card.scrollIntoViewIfNeeded();
        const r = await card.boundingBox();
        assert.ok(r.x >= 0 && r.x + r.width <= size.width + 1);
        assert.ok(
          await card.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
          "No clipped card text",
        );
      }
      const footer = await page.locator("#challenges-back").boundingBox();
      assert.ok(footer.y + footer.height <= size.height + 1);
      await page.screenshot({
        path: ".tools/challenges-" + size.width + ".png",
      });
    }
    await page.locator("#challenges-back").click();
    await page.setViewportSize({ width: 1280, height: 720 });
    const tap = async (i) => {
      await page.evaluate((i) => {
        window.pad.buttons[i] = { pressed: true, value: 1 };
      }, i);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.evaluate((i) => {
        window.pad.buttons[i] = { pressed: false, value: 0 };
      }, i);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
    };
    await tap(11);
    await tap(15);
    await page.waitForFunction(() =>
      ["home-challenges", "home-challenges-toggle"].includes(
        document.activeElement?.id,
      ),
    );
    if (
      await page.evaluate(
        () => document.activeElement?.id === "home-challenges",
      )
    )
      await tap(14);
    await page.waitForFunction(
      () => document.activeElement?.id === "home-challenges-toggle",
    );
    await tap(0);
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    assert.equal(
      await page.locator("#challenges-screen").evaluate((e) => e.open),
      false,
    );
    await page.waitForTimeout(350);
    await tap(0);
    await page.waitForTimeout(350);
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    await tap(15);
    await page.waitForFunction(
      () => document.activeElement?.id === "home-challenges",
    );
    await tap(0);
    await page.waitForFunction(
      () => document.getElementById("challenges-screen").open,
    );
    await tap(5);
    await page.waitForFunction(
      () =>
        document
          .getElementById("challenges-weekly")
          .getAttribute("aria-selected") === "true",
    );
    assert.equal(
      await page.locator("#challenges-weekly").getAttribute("aria-selected"),
      "true",
    );
    await tap(5);
    assert.equal(
      await page.locator("#challenges-season").getAttribute("aria-selected"),
      "true",
    );
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "challenges-season",
      "Controller focus follows the active tab",
    );
    await tap(13);
    assert.ok(await page.locator("#challenge-cards .gamepad-focus").count());
    await tap(1);
    await page.waitForFunction(
      () => !document.getElementById("challenges-screen").open,
    );
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(() => __arena.match.phase === "playing");
    // Real rigid-body contacts produce the authoritative touch records; no synthetic stat events.
    for (let i = 0; i < 5; i++) {
      const touches = await page.evaluate(
        () =>
          __arena.match.stats.players.get(__arena.simulation.cars[0].id)
            .touches,
      );
      await page.evaluate(() => {
        const s = __arena.simulation;
        s.cars[1].reset(25, -25, 0);
        s.cars[0].reset(0, 10, 0);
        s.cars[0].body.setLinvel({ x: 0, y: 0, z: -12 }, true);
        s.ball.setTranslation(
          { x: 0, y: s.physics.ball.radius + 0.01, z: 7 },
          true,
        );
        s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        s.ballPose.snap();
      });
      await page.waitForFunction(
        (prev) =>
          __arena.match.stats.players.get(__arena.simulation.cars[0].id)
            .touches > prev,
        touches,
      );
      await page.evaluate(() => {
        __arena.simulation.cars[0].reset(20, 10, 0);
        __arena.simulation.ball.setTranslation({ x: 0, y: 2, z: 0 }, true);
        __arena.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      });
      await page.waitForTimeout(180);
    }
    await page.waitForFunction(
      () =>
        __arena.challenges.state.periods.DAILY.entries["get-involved"]
          ?.completed,
    );
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      0,
    );
    assert.equal(await page.locator("#challenge-complete").isVisible(), true);
    assert.equal(
      await page
        .locator("#challenge-complete")
        .evaluate((e) => getComputedStyle(e).pointerEvents),
      "none",
    );
    // Holding real drive input also proves the popup does not block gameplay.
    const beforeDrive = await page.evaluate(() => ({
      ...__arena.simulation.cars[0].body.translation(),
    }));
    await page.keyboard.down("w");
    await page.waitForTimeout(3300);
    await page.keyboard.up("w");
    const afterDrive = await page.evaluate(() => ({
      ...__arena.simulation.cars[0].body.translation(),
    }));
    assert.ok(
      Math.hypot(afterDrive.x - beforeDrive.x, afterDrive.z - beforeDrive.z) >
        1,
    );
    await page.evaluate(() => {
      const a = __arena;
      a.match.score = [1, 0];
      a.match.remaining = 0;
      a.simulation.ball.setTranslation(
        { x: 0, y: a.simulation.physics.ball.radius, z: 0 },
        true,
      );
      a.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(
      () =>
        __arena.match.phase === "finished" &&
        document.querySelector("#xp-earned"),
    );
    assert.equal(
      await page.evaluate(
        () =>
          Object.values(__arena.accounts.profile.value.xpAwards).filter(
            (a) => a.source.type === "CHALLENGE",
          ).length,
      ),
      0,
    );
    const result = await page.evaluate(() => ({
      total: __arena.accounts.profile.value.progression.totalXP,
      awards: Object.values(__arena.accounts.profile.value.xpAwards),
      state: __arena.challenges.state,
      level: __arena.accounts.profile.value.progression.level,
    }));
    assert.equal(
      result.awards
        .filter((a) => a.source.type === "CHALLENGE")
        .reduce((n, a) => n + a.amount, 0),
      0,
    );
    assert.ok(result.level >= 1);
    assert.equal(
      result.awards.find((a) => a.source.type === "MATCH").before.totalXP,
      0,
      "Unclaimed challenges do not inflate match XP",
    );
    assert.ok(
      Object.values(result.state.periods.DAILY.entries).every(
        (p) => p.completed && !p.rewardClaimed,
      ),
    );
    await page.evaluate(() => {
      let a = __arena,
        id = a.simulation.cars[0].id;
      for (let i = 0; i < 5; i++)
        a.challenges.observe({
          matchId: a.match.completion.id,
          playerId: id,
          mode: "bot",
          gameMode: a.match.gameMode,
          controller: "local",
          phase: "finished",
          stats: a.match.stats.players.get(id),
          completion: a.match.completion,
        });
    });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      result.total,
    );
    await page.locator("#home").click();
    await page.waitForFunction(
      () => !document.getElementById("home-challenges").hidden,
    );
    assert.equal(await page.locator("#home-challenges .complete").count(), 3);
    await page.locator("#home-challenges").click();
    assert.equal(await page.locator("#challenge-cards .ready").count(), 3);
    assert.equal(
      await page.locator("#challenges-daily .challenge-tab-check").isVisible(),
      false,
    );
    for (let i = 0; i < 3; i++) {
      await page
        .locator("#challenge-cards .ready .challenge-claim")
        .first()
        .click();
      await page.locator("#challenge-xp-dialog").waitFor({ state: "visible" });
      assert.match(
        await page.locator("#challenge-xp-progression").innerText(),
        /CHALLENGE XP/,
      );
      if (i === 0) {
        await page.waitForFunction(
          () =>
            document.getElementById("challenge-xp-progression").dataset
              .animating === "false",
        );
        assert.ok(
          Number(
            await page.locator("#claim-xp-bar").getAttribute("aria-valuenow"),
          ) >= 0,
        );
      } else if (await page.locator("#claim-xp-skip").isVisible())
        await page.locator("#claim-xp-skip").click();
      await page.locator("#challenge-xp-done").click();
      await page.locator("#challenge-xp-dialog").waitFor({ state: "hidden" });
    }
    assert.equal(await page.locator("#challenge-cards .claimed").count(), 3);
    assert.ok(
      await page.locator("#challenges-daily .challenge-tab-check").isVisible(),
    );
    result.total += 3250;
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      result.total,
    );
    await page.locator("#challenges-back").click();

    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(await page.locator("#home-challenges .complete").count(), 3);
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      result.total,
    );
    await page.screenshot({ path: ".tools/challenges-home.png" });
    const history = await page.evaluate(() =>
      JSON.stringify(__arena.challenges.state),
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () =>
        __arena.match.mode === "freeplay" && __arena.match.phase === "playing",
    );
    await page.keyboard.down("w");
    await page.waitForTimeout(350);
    await page.keyboard.up("w");
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    for (const mode of ["rings", "dribble", "training"]) {
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      await page.locator("#" + mode + "-mode").click();
      if (mode === "training") await page.locator("#training-striker").click();
      await page.waitForFunction(
        (mode) => __arena.extraSession?.id === mode,
        mode,
      );
      await page.waitForTimeout(250);
      await page.keyboard.press("Escape");
      await page.locator("#" + mode + "-exit").click();
      await page.waitForFunction(() => !__arena.extraSession);
    }
    assert.equal(
      await page.evaluate(() => JSON.stringify(__arena.challenges.state)),
      history,
      "All practice modes leave Challenges untouched",
    );
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      result.total,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS Challenges browser: Home 3 Daily cards/Season dates, six Weekly/Season cards, responsive/scrollbar-free layout, controller opening/tabs/cards/Back, real physical touches + live reward popup, completed match rewards/level-up, replay/resync dedup, match-XP ordering, refresh and Free Play/Rings/Dribble/Training exclusions",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
