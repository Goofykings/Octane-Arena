const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8341);
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    await context.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Pass controller",
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
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(45000);
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    assert.deepEqual(await page.evaluate(() => __arena.garage.owned), {
      body: ["vector", "lowflat"],
      topper: [],
      explosion: ["pulse"],
      boost: ["plasma"],
    });
    await page.locator("#rocket-pass-open").click();
    await page.locator("#rocket-pass-screen").waitFor({ state: "visible" });
    assert.equal(await page.locator("[data-pass-level]").count(), 25);
    assert.equal(
      await page.locator('[data-pass-level="1"]').getAttribute("data-state"),
      "claimable",
    );
    assert.equal(
      await page.locator('[data-pass-level="10"]').getAttribute("data-state"),
      "locked",
    );
    await page.locator('[data-pass-level="1"]').click();
    await page.waitForFunction(() =>
      __arena.garage.claimedRocketPass["season-1"].includes(1),
    );
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.ok(
      await page.evaluate(() => __arena.garage.owned.topper.includes("beanie")),
    );
    await page.locator("#rocket-pass-open").click();
    await page.evaluate(() =>
      __arena.accounts.profile.awardXP(45000, {
        type: "CHALLENGE",
        id: "challenge/DAILY/browser-test/level-ten",
      }),
    );
    await page.waitForFunction(
      () =>
        document.querySelector('[data-pass-level="10"]').dataset.state ===
        "claimable",
    );
    await page.locator('[data-pass-level="10"]').click();
    await page.waitForFunction(() =>
      __arena.garage.owned.body.includes("boxy"),
    );
    assert.equal(
      await page.evaluate(() => __arena.garage.owns("body", "wedge")),
      false,
    );
    const tap = async (i) => {
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: true, value: 1 }),
        i,
      );
      await page.waitForTimeout(130);
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: false, value: 0 }),
        i,
      );
      await page.waitForTimeout(130);
    };
    for (let i = 0; i < 5; i++) await tap(15);
    assert.ok(
      await page.evaluate(() =>
        document.activeElement.closest("#rocket-pass-screen"),
      ),
      "controller stays in the track scope",
    );
    assert.equal(
      await page
        .locator(".pass-track-window")
        .evaluate((e) => getComputedStyle(e).scrollbarWidth),
      "none",
    );
    await page.screenshot({ path: "docs/rocket-pass-season-1.png" });
    await page.locator("#rocket-pass-back").click();
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    assert.equal(await page.locator('[data-item="wedge"]').count(), 0);
    await page.locator('[data-item="boxy"]').click();
    assert.equal(
      await page.evaluate(() => __arena.garage.current.body),
      "boxy",
    );
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.locator("#training-mode").click();
    await page.locator("#training-create").click();
    await page.locator("#new-training-pack").click();
    await page.locator("#training-pack-name").fill("Performance Check");
    await page
      .locator("#training-pack-prompt")
      .getByRole("button", { name: "CREATE", exact: true })
      .click();
    await page
      .locator(".training-pack-row")
      .getByRole("button", { name: "EDIT", exact: true })
      .click();
    await page.locator("#custom-training-editor").waitFor({ state: "visible" });
    await page.waitForTimeout(300);
    const editorMeshCount = await page.evaluate(() => {
      let count = 0;
      __arena.extraSession.scene.traverse(() => count++);
      return count;
    });
    await page.locator("#custom-play-shot").click();
    await page.waitForFunction(() => !__arena.extraSession.editing);
    const result = await page.evaluate(async () => {
      const s = __arena.extraSession,
        group = s.editorOnly;
      const predictions = s.performance.editorPredictions,
        starting = s.performance.physicsSteps,
        elapsed = s.run.elapsed;
      let playNodes = 0;
      s.scene.traverse(() => playNodes++);
      const helper = s.transform.getHelper(),
        update = helper.updateMatrixWorld;
      let calls = 0;
      helper.updateMatrixWorld = function (...args) {
        calls++;
        return update.apply(this, args);
      };
      for (let i = 0; i < 20; i++) s.scene.updateMatrixWorld(true);
      const playHelperCalls = calls;
      const samples = (attached) => {
        if (attached) {
          s.scene.add(group);
          group.visible = false;
        } else group.removeFromParent();
        const measured = [];
        for (let batch = 0; batch < 9; batch++) {
          const start = performance.now();
          for (let i = 0; i < 30; i++) s.scene.updateMatrixWorld(true);
          measured.push((performance.now() - start) / 30);
        }
        return measured.sort((a, b) => a - b)[4];
      };
      const hiddenEditorMs = samples(true),
        detachedEditorMs = samples(false);
      group.visible = true;
      helper.updateMatrixWorld = update;
      await new Promise((r) => setTimeout(r, 1200));
      const after = s.performance.physicsSteps,
        dt = s.run.elapsed - elapsed;
      return {
        playNodes,
        playHelperCalls,
        hiddenEditorMs,
        detachedEditorMs,
        predictionsBefore: predictions,
        predictionsAfter: s.performance.editorPredictions,
        steps: after - starting,
        physicsHz: dt ? (after - starting) / dt : 0,
        lastFrameMs: s.performance.frameMs,
        editorAttached: !!group.parent,
      };
    });
    assert.equal(
      result.playHelperCalls,
      0,
      "editor handles do no matrix work during play",
    );
    assert.equal(result.editorAttached, false);
    assert.ok(result.playNodes < editorMeshCount - 50);
    assert.equal(
      result.predictionsBefore,
      result.predictionsAfter,
      "trajectory prediction stops during play",
    );
    assert.ok(result.steps > 0);
    assert.ok(Math.abs(result.physicsHz - 120) < 0.001);
    await page.screenshot({ path: "docs/training-play-performance.png" });
    await page.evaluate(() => __arena.extraSession.edit());
    await page.waitForFunction(
      () =>
        __arena.extraSession.editing &&
        __arena.extraSession.editorOnly.parent &&
        __arena.extraSession.orbit.enabled,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      ".tools/four-upgrades-browser.json",
      JSON.stringify({ editorMeshCount, ...result }, null, 2),
    );
    console.log(
      "PASS Rocket Pass UI/controller navigation, live XP, claims/persistence, locked equipment, play/edit lifecycle and shared 120 Hz physics",
    );
    console.log(JSON.stringify({ editorMeshCount, ...result }));
  } finally {
    await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
