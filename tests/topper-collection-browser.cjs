const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
const ids = [
  "birthday",
  "cat-ears",
  "cone",
  "halo",
  "beanie",
  "ufo",
  "top-hat",
  "banana",
  "shark-fin",
  "pixel-sunglasses",
  "octane-fries",
  "crown",
];
(async () => {
  const server = await staticGame(8262);
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
    page.on("console", (m) => {
      if (/Topper .*unavailable|Couldn't load texture/.test(m.text()))
        console.log(m.text());
    });
    page.on("console", (m) => {
      if (
        m.type() === "error" &&
        /THREE.WebGLProgram|Shader Error|GL_INVALID/.test(m.text())
      )
        errors.push(m.text());
    });
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    const open = async () => {
      await page.locator("#garage-open").click();
      await page.locator("#customize-car").click();
      await page.locator('[data-category="topper"]').click();
    };
    await open();
    assert.equal(await page.locator(".topper-card").count(), 13);
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".topper-card img")].length === 12 &&
        [...document.querySelectorAll(".topper-card img")].every(
          (i) => i.complete && i.naturalWidth === 320,
        ),
    );
    assert.equal(
      await page.locator('.topper-card[data-owned="false"]').count(),
      12,
    );
    await page.locator('[data-item="crown"]').click();
    await page.waitForFunction(
      () => __arena.preview.car.userData.topper.userData.topperId === "crown",
    );
    assert.deepEqual(
      await page.evaluate(() => [
        __arena.garage.current.topper,
        JSON.parse(localStorage.getItem("octane-arena-garage")).presets[0]
          .topper,
        __arena.visuals[0].userData.topper.userData.topperId,
      ]),
      ["none", "none", "none"],
    );
    await page.screenshot({ path: ".tools/topper-locked-crown.png" });
    await page.locator('[data-item="beanie"]').focus();
    await page.waitForFunction(
      () => __arena.preview.car.userData.topper.userData.topperId === "beanie",
    );
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(() => __arena.garage.current.topper),
      "none",
    );
    // Explicitly grant test ownership, then exercise the actual selection/save UI.
    await page.evaluate((ids) => {
      __arena.garage.owned.topper = [...ids];
      __arena.garage.owned.body = ["vector", "lowflat", "boxy", "wedge"];
      __arena.garage.save();
    }, ids);
    await open();
    for (const body of ["vector", "lowflat", "boxy", "wedge"]) {
      await page.locator('[data-category="body"]').click();
      await page.locator(`[data-item="${body}"]`).click();
      await page.locator('[data-category="topper"]').click();
      for (const id of ids) {
        await page.locator(`[data-item="${id}"]`).click();
        await page.waitForFunction(
          (id) => __arena.preview.car.userData.topper.userData.topperId === id,
          id,
        );
        const state = await page.evaluate(() => {
          const a = __arena,
            topper = a.preview.car.userData.topper;
          return {
            equipped: a.garage.current.topper,
            saved: JSON.parse(localStorage.getItem("octane-arena-garage"))
              .presets[0].topper,
            asset: topper.userData.assetLoaded,
            live: a.visuals[0].userData.topper.userData.assetLoaded,
          };
        });
        assert.deepEqual(state, {
          equipped: id,
          saved: id,
          asset: true,
          live: true,
        });
        if (
          body === "vector" &&
          ["crown", "octane-fries", "ufo", "cat-ears"].includes(id)
        )
          await page.screenshot({ path: `.tools/topper-garage-${id}.png` });
      }
    }
    await page.locator('[data-item="octane-fries"]').click();
    await page.evaluate(() => __arena.graphics.apply("ultra"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: ".tools/topper-fries-ultra.png" });
    await page.evaluate(() => __arena.graphics.apply("low"));
    await page.locator('[data-item="ufo"]').click();
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    await page.waitForFunction(() =>
      [...__arena.homeLobby.displays.values()].some((d) => {
        const beam = d.model.userData.topper.getObjectByName("Beam");
        return (
          beam &&
          beam.material.transparent &&
          beam.material.opacity > 0 &&
          beam.material.opacity <= 0.14
        );
      }),
    );
    await open();
    await page.locator('[data-item="beanie"]').click();
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.deepEqual(
      await page.evaluate(() => [
        __arena.garage.current.body,
        __arena.garage.current.topper,
      ]),
      ["wedge", "beanie"],
    );
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    await page.locator("#freeplay-launch").click();
    await page.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    // Use the real jump input and grounded state, without animation angle injection.
    await page.keyboard.press("Space");
    await page.waitForFunction(
      () =>
        !__arena.simulation.cars[0].grounded &&
        __arena.visuals[0].userData.topper.userData.rotor.speed > 0,
    );
    await page.screenshot({ path: ".tools/topper-propeller-jump.png" });
    await page.waitForFunction(() => __arena.simulation.cars[0].grounded);
    const speed = await page.evaluate(
      () => __arena.visuals[0].userData.topper.userData.rotor.speed,
    );
    assert.ok(speed > 0, "landing coasts");
    await page.waitForFunction(
      () => __arena.visuals[0].userData.topper.userData.rotor.speed < 0.05,
    );
    assert.deepEqual(errors, []);
    // A failed individual GLB cannot prevent boot or the remaining collection.
    const failure = await browser.newPage();
    await failure.route("**/models/toppers/ufo.glb", (route) => route.abort());
    await failure.goto(server.url);
    await failure.waitForFunction(() => window.__arena);
    await failure.evaluate(() => {
      __arena.garage.owned.topper = ["ufo"];
      __arena.garage.equip("topper", "ufo");
      __arena.garagePanel.customizing = true;
      __arena.garagePanel.category = "topper";
      __arena.garagePanel.render();
      __arena.ui.screen = "garage";
    });
    await failure.waitForFunction(
      () => __arena.preview.car.userData.topper.userData.topperId === "ufo",
    );
    assert.equal(
      await failure.evaluate(
        () => __arena.preview.car.userData.topper.userData.assetLoaded,
      ),
      false,
    );
    await failure.close();
    console.log(
      "PASS real Chromium: 12 decoded thumbnails, locked click/focus preview without persistence, all 48 body/topper equips, refresh, local jump/coasting, GLB failure boot fallback, no JS/WebGL errors",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
