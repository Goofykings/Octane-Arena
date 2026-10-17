const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8270);
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
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.evaluate(() => {
      window.cues = [];
      const play = __arena.audio.ui.bind(__arena.audio);
      __arena.audio.ui = (cue) => {
        window.cues.push(cue);
        play(cue);
      };
    });
    assert.equal(
      await page.locator("#match-loading").isVisible(),
      false,
      "No loading flash on boot",
    );
    await page.waitForFunction(
      () => __arena.homeLobby.group.children.length > 0,
    );
    await page.waitForTimeout(500);
    assert.ok(
      await page.evaluate(
        () =>
          __arena.camera.position.distanceTo(
            __arena.homeLobby.group.children[0].position,
          ) < 20,
      ),
      "Home camera must frame the car after startup; no negative-dt extrapolation",
    );
    await page.screenshot({ path: ".tools/game-feel-home.png" });
    await page.evaluate(() => {
      document.getElementById("play").click();
      document.getElementById("play").click();
    });
    await page.waitForFunction(() => __arena.ui.screen === "modes");
    assert.equal(
      await page.evaluate(
        () => window.cues.filter((c) => c === "confirm").length,
      ),
      1,
      "One semantic cue per activation",
    );
    await page.locator("#modes-back").click();
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-mutators").click();
    const mutators = page.locator(".mutators-panel[open]");
    assert.equal(await mutators.locator("[data-mutator]").count(), 9);
    await mutators.locator('[data-key="ballSize"][data-step="next"]').click();
    await mutators.locator("[data-reset]").click();
    await page.screenshot({ path: ".tools/game-feel-mutators.png" });
    await mutators.locator("[data-nav-back]").click();
    await page.locator("#bot-setup-back").click();
    await page.locator("#modes-back").click();
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    for (const category of [
      "body",
      "paint",
      "wheels",
      "topper",
      "boost",
      "explosion",
    ]) {
      await page.locator(`[data-category="${category}"]`).click();
      const items = page.locator(
        '.inventory-grid button:not([aria-pressed="true"])',
      );
      if (await items.count()) await items.first().click();
      if (category === "boost") {
        const before = await page.evaluate(() => __arena.preview.car.uuid);
        await page
          .locator('.inventory-grid button:not([aria-pressed="true"])')
          .first()
          .click();
        assert.equal(
          await page.evaluate(() => __arena.preview.car.uuid),
          before,
          "Boost selection reuses car model",
        );
        await page.screenshot({ path: ".tools/game-feel-garage.png" });
      }
    }
    await page.waitForTimeout(1600);
    await page.screenshot({ path: ".tools/game-feel-explosion.png" });
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    await page.locator("#settings-open").click();
    for (const tab of ["gameplay", "camera", "controls", "graphics", "audio"]) {
      await page.locator(`#tab-${tab}`).click();
      assert.equal(
        await page.locator(`#tab-${tab}`).getAttribute("aria-selected"),
        "true",
      );
    }
    assert.ok(await page.locator("#settings-content").innerText());
    await page.waitForFunction(() =>
      document.getElementById("settings").getAnimations({ subtree: true })
        .every((a) => a.playState !== "running"),
    );
    await page.screenshot({ path: ".tools/game-feel-settings.png" });
    await page.locator("#close-settings").click();
    await page.locator("#feedback-open").click();
    await page.locator("#feedback-description").fill("Preserved test draft");
    await page.locator("#feedback-close").click();
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.screenshot({ path: ".tools/game-feel-extras.png" });
    await page.locator("#extras-back").click();
    await page.locator("#bot-mode").click();
    await page.locator("#bot-launch").click();
    await page.waitForFunction(
      () => !__arena.matchLoader.active && __arena.match.phase === "playing",
    );
    await page.keyboard.down("Tab");
    await page.locator("#match-board").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.getElementById("match-board").getAnimations().length === 0,
    );
    assert.equal(await page.locator("#match-board > section").count(), 2);
    assert.ok(await page.locator("#match-board .stat-row[data-player]").count() >= 2);
    await page.screenshot({ path: ".tools/game-feel-scoreboard.png" });
    await page.keyboard.up("Tab");
    await page.locator("#match-board").waitFor({ state: "hidden" });
    await page.evaluate(() => {
      const s = __arena.simulation;
      s.cars.slice(1).forEach((c) => c.body.setEnabled(false));
      s.lastTouchId = s.cars[0].id;
      s.lastTouchTime = s.clock;
      s.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -12 }, true);
      s.ballPose.snap();
    });
    await page.waitForFunction(() => __arena.match.phase === "replay");
    await page.locator("#goal-replay").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.getElementById("goal-replay").getAnimations().length === 0,
    );
    assert.ok(await page.locator("#replay-scorer-name").innerText());
    await page.screenshot({ path: ".tools/game-feel-replay.png" });
    await page.locator("#replay-skip-button").click();
    await page.waitForFunction(() => __arena.match.phase === "countdown");
    await page.evaluate(() => __arena.match.finish());
    await page.waitForFunction(() => __arena.match.phase === "finished");
    await page.locator("#result").waitFor({ state: "visible" });
    await page.waitForFunction(() =>
      document.getElementById("result").getAnimations().length === 0 &&
      !!document.querySelector("#results-board .stat-row[data-player]"),
    );
    await page.screenshot({ path: ".tools/game-feel-results.png" });
    await page.locator("#home").click();
    await page.waitForFunction(() => __arena.match.phase === "home");
    await page.locator("#party-create").click();
    await page.waitForFunction(() => !!__arena.party.state);
    await page.locator("#party-start").click();
    await page.locator("#party-mutators").click();
    await page.locator(".mutators-panel[open] [data-nav-back]").click();
    await page.locator("#party-continue").click();
    await page.waitForFunction(
      () =>
        __arena.party.state.stage === "teams" && !__arena.matchLoader.active,
    );
    assert.equal(await page.locator("#party-launch").isDisabled(), true);
    assert.match(
      await page.locator("#party-launch").getAttribute("title"),
      /team/i,
    );
    await page.locator("#match-loading").waitFor({ state: "hidden" });
    await page.waitForFunction(() =>
      document.getElementById("party-flow").getAnimations({ subtree: true })
        .every((a) => a.playState !== "running"),
    );
    await page.screenshot({ path: ".tools/game-feel-party.png" });
    await page.locator("#party-team-leave").click();
    await page.waitForFunction(() => !__arena.party.state);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#play").click();
    await page.locator("#modes-back").click();
    await page.waitForTimeout(60);
    assert.equal(
      await page.locator("#menu").getAttribute("inert"),
      null,
      "No stuck input after reduced-motion reversal",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS production mouse traversal: home/Play/bots/mutators/Garage cosmetics/settings/feedback/extras/scoreboard/replay/results/party/team setup; duplicate cue suppression, model reuse, disabled-start explanation, reduced motion and no browser errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
