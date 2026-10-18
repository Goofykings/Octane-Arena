const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8299);
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
      Date.now = () => Date.parse("2026-10-18T12:00:00-04:00");
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Claims test controller",
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
    await page.waitForFunction(
      () =>
        window.__arena && !document.getElementById("home-challenges").hidden,
    );
    // Authoritative completed-match fixtures exercise the public event adapter,
    // not direct mutations of card flags or XP totals.
    const expected = await page.evaluate(async () => {
      const a = __arena,
        id = a.accounts.profile.value.localPlayerId;
      const modes = ["soccar", "heatseeker", "rumble", "hoops", "dropshot"];
      for (let i = 0; i < 30; i++) {
        const matchId = crypto.randomUUID();
        const stats = {
          playerId: id,
          score: i === 0 ? 10000 : 0,
          goals: i === 0 ? 40 : 0,
          saves: i === 0 ? 25 : 0,
          shots: i === 0 ? 15 : 0,
          touches: i === 0 ? 5 : 0,
          assists: 0,
          ping: null,
        };
        const completion = {
          id: matchId,
          mode: "bot",
          score: [1, 0],
          mvpId: id,
          activeSeconds: 300,
          players: [
            {
              id,
              team: 0,
              controller: "local",
              completed: true,
              score: stats.score,
              activeSeconds: 300,
              activitySeconds: 30,
            },
          ],
        };
        a.challenges.observe({
          matchId,
          playerId: id,
          mode: "bot",
          gameMode: modes[i % 5],
          controller: "local",
          phase: "finished",
          stats,
          completion,
        });
      }
      await a.challenges.settled();
      return a.challenges.definitions.reduce((n, d) => n + d.xpReward, 0);
    });
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      0,
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        window.__arena && !document.getElementById("home-challenges").hidden,
    );
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      0,
      "Reload does not auto-claim",
    );
    await page.locator("#home-challenges").click();
    assert.equal(
      await page.locator("#challenges-screen [role=tab]").count(),
      3,
    );
    assert.equal(await page.locator("#challenge-cards .ready").count(), 3);
    assert.match(
      await page.locator("#challenge-cards").innerText(),
      /READY TO CLAIM/,
    );
    for (const category of ["daily", "weekly", "season"])
      assert.equal(
        await page
          .locator("#challenges-" + category + " .challenge-tab-check")
          .isVisible(),
        false,
      );
    const readyColor = await page
      .locator('#challenge-cards [data-challenge="get-involved"]')
      .evaluate((e) => getComputedStyle(e).background);
    const focusTrace = [];
    const tap = async (i) => {
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: true, value: 1 }),
        i,
      );
      await page.waitForTimeout(180);
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: false, value: 0 }),
        i,
      );
      await page.waitForTimeout(180);
      focusTrace.push(
        await page.evaluate(() => ({
          id: document.activeElement?.id,
          type: document.activeElement?.className,
          challenge: document.activeElement
            ?.closest("[data-challenge]")
            ?.getAttribute("data-challenge"),
        })),
      );
    };
    await tap(11);
    await tap(13);
    assert.equal(
      await page
        .locator("#challenge-cards .gamepad-focus")
        .evaluate((e) => getComputedStyle(e).outlineStyle),
      "solid",
    );
    await tap(15);
    await tap(15);
    await tap(13);
    assert.ok(
      await page.evaluate(
        () =>
          document.activeElement?.matches(".challenge-claim") &&
          document.activeElement.closest("[data-challenge]")?.dataset
            .challenge === "get-involved",
      ),
      JSON.stringify(focusTrace),
    );
    await tap(0);
    await page.locator("#challenge-xp-dialog").waitFor({ state: "visible" });
    assert.match(
      await page.locator("#challenge-xp-progression").innerText(),
      /CHALLENGE XP/,
    );
    await page.waitForFunction(
      () =>
        Number(
          document.getElementById("claim-xp-bar").getAttribute("aria-valuenow"),
        ) > 0,
    );
    await page.waitForFunction(
      () =>
        document.getElementById("challenge-xp-progression").dataset
          .animating === "false",
    );
    assert.equal(
      await page.locator("#claim-xp-bar").getAttribute("aria-valuenow"),
      "750",
    );
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      750,
    );
    await tap(0);
    await page.locator("#challenge-xp-dialog").waitFor({ state: "hidden" });
    const claimed = page.locator(
      '#challenge-cards [data-challenge="get-involved"]',
    );
    assert.ok(await claimed.evaluate((e) => e.classList.contains("claimed")));
    assert.notEqual(
      await claimed.evaluate((e) => getComputedStyle(e).background),
      readyColor,
    );
    assert.match(
      await claimed.locator(".challenge-completed").innerText(),
      /\u2713 CLAIMED/,
    );
    assert.equal(
      await page.locator("#challenges-daily .challenge-tab-check").isVisible(),
      false,
    );
    for (const category of ["daily", "weekly", "season"]) {
      await page.locator("#challenges-" + category).click();
      const count = category === "daily" ? 3 : 6;
      assert.equal(
        await page.locator("#challenge-cards [data-challenge]").count(),
        count,
      );
      while (await page.locator("#challenge-cards .ready").count()) {
        await page
          .locator("#challenge-cards .ready .challenge-claim")
          .first()
          .click();
        await page
          .locator("#challenge-xp-dialog")
          .waitFor({ state: "visible" });
        if (await page.locator("#claim-xp-skip").isVisible())
          await page.locator("#claim-xp-skip").click();
        await page.locator("#challenge-xp-done").click();
        await page.locator("#challenge-xp-dialog").waitFor({ state: "hidden" });
      }
      assert.equal(
        await page.locator("#challenge-cards .claimed").count(),
        count,
      );
      assert.ok(
        await page
          .locator("#challenges-" + category + " .challenge-tab-check")
          .isVisible(),
      );
    }
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      expected,
    );
    assert.equal(
      await page.evaluate(() =>
        __arena.challenges.claim("DAILY", "get-involved"),
      ),
      null,
    );
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      expected,
    );
    await page.reload();
    await page.waitForFunction(
      () =>
        window.__arena && !document.getElementById("home-challenges").hidden,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#home-challenges").click();
    for (const category of ["daily", "weekly", "season"]) {
      const tab = page.locator("#challenges-" + category);
      assert.ok(await tab.locator(".challenge-tab-check").isVisible());
      const r = await tab.boundingBox();
      assert.ok(r.x >= 0 && r.x + r.width <= 390);
    }
    assert.equal(
      await page.evaluate(
        () => __arena.accounts.profile.value.progression.totalXP,
      ),
      expected,
    );
    await page.screenshot({ path: ".tools/challenge-claims-mobile.png" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS Challenge claims: Daily 3 / Weekly 6 / Season 6, no auto-XP, reload safety, bright ready/darker claimed states, green card/tab checks, controller claim/Done, XP bar fill, all 15 claims and duplicate protection",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
