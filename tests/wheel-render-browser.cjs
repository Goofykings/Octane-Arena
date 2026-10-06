const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app } = await startLan(8099, ":memory:");
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      ),
    );
    await page.goto("http://127.0.0.1:8099/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    await page.locator('[data-category="wheels"]').click();
    for (const style of ["apex", "disc"]) {
      await page.locator(`[data-item="${style}"]`).click();
      assert.equal(
        await page
          .locator(`[data-item="${style}"]`)
          .getAttribute("aria-pressed"),
        "true",
      );
      const selection = await page.evaluate(() => {
        const a = window.__arena;
        const hub = a.visuals[0].userData.wheels[0].children[1];
        const previewHub = a.preview.car.userData.wheels[0].children[1];
        return {
          equipped: a.garage.current.wheels,
          saved: JSON.parse(localStorage.getItem("octane-arena-garage"))
            .presets[0].wheels,
          liveSegments: hub.geometry.parameters.radialSegments,
          previewSegments: previewHub.geometry.parameters.radialSegments,
        };
      });
      assert.equal(selection.equipped, style);
      assert.equal(selection.saved, style);
      assert.equal(selection.liveSegments, style === "disc" ? 24 : 6);
      assert.equal(selection.previewSegments, selection.liveSegments);
      await page.screenshot({ path: `docs/wheel-rim-${style}.png` });
    }
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(() => window.__arena.garage.current.wheels),
      "disc",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS Apex/Orbit garage selection, distinct live and preview rims, saved wheel choice and reload",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
