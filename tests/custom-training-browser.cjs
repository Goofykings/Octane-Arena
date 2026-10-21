const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8301);
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
        id: "Training test controller",
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
    page.on("pageerror", (error) => errors.push(error.message));
    const tap = async (i) => {
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: true, value: 1 }),
        i,
      );
      await page.waitForTimeout(220);
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { pressed: false, value: 0 }),
        i,
      );
      await page.waitForTimeout(220);
    };
    const open = async () => {
      await page.locator("#play").click();
      await page.locator("#extra-mode").click();
      await page.locator("#training-mode").click();
      await page.locator("#training-create").click();
      await page.locator("#custom-training").waitFor({ state: "visible" });
    };
    const rows = page.locator(".training-pack-row"),
      prompt = page.locator("#training-pack-prompt");
    const create = async (name) => {
      await page.locator("#new-training-pack").click();
      await prompt.locator("input").fill(name);
      await prompt.getByRole("button", { name: "CREATE", exact: true }).click();
      await prompt.waitFor({ state: "hidden" });
    };
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await open();
    assert.ok(
      await page
        .getByText("NO CUSTOM TRAINING PACKS YET", { exact: true })
        .isVisible(),
    );
    await create("  Aerial Warmup!  ");
    await create("Goalie's Practice #2");
    assert.equal(await rows.count(), 2);
    console.log("Verified two persisted pack rows.");
    const ids = await rows.evaluateAll((rows) =>
      rows.map((row) => row.dataset.packId),
    );
    assert.notEqual(ids[0], ids[1]);
    await rows
      .nth(0)
      .getByRole("button", { name: "DELETE", exact: true })
      .click();
    await prompt.getByRole("button", { name: "CANCEL", exact: true }).click();
    assert.equal(await rows.count(), 2);
    await rows
      .nth(1)
      .getByRole("button", { name: "PUBLISH", exact: true })
      .click();
    await prompt.getByRole("button", { name: "PUBLISH", exact: true }).click();
    await prompt
      .getByRole("alert")
      .getByText("Add at least one shot before playing or publishing.")
      .waitFor();
    await prompt.getByRole("button", { name: "CANCEL", exact: true }).click();
    await rows
      .nth(1)
      .getByRole("button", { name: "RENAME", exact: true })
      .click();
    await prompt.locator("input").fill("Advanced Saves");
    await prompt.getByRole("button", { name: "SAVE", exact: true }).click();
    await prompt.waitFor({ state: "hidden" });
    await rows
      .nth(1)
      .getByRole("button", { name: "EDIT", exact: true })
      .click();
    await page.locator("#custom-training-editor").waitFor({ state: "visible" });
    assert.equal(
      await page.evaluate(() => __arena.extraSession.draft.pack.id),
      ids[1],
    );
    await page.locator("#custom-editor-menu-open").click();
    await page.locator("#custom-save-exit").click();
    await page.locator("#custom-training").waitFor({ state: "visible" });
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await open();
    assert.equal(await rows.count(), 2);
    assert.ok((await rows.nth(1).textContent()).includes("Advanced Saves"));
    for (const [width, height] of [
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [900, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(300);
      const overflow = await page
        .locator("#custom-training")
        .evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      assert.equal(overflow, false, "No horizontal overflow at " + width);
      const box = await page.locator("#custom-training").boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= height + 1,
        "dialog fits " + width,
      );
    }
    await page.screenshot({ path: ".tools/custom-training-library.png" });
    console.log("Verified responsive creator layout.");
    await page.setViewportSize({ width: 1280, height: 720 });
    await rows
      .nth(0)
      .getByRole("button", { name: "DELETE", exact: true })
      .click();
    await prompt.getByRole("button", { name: "DELETE", exact: true }).click();
    await prompt.waitFor({ state: "hidden" });
    assert.equal(await rows.count(), 1);
    assert.equal(await rows.nth(0).getAttribute("data-pack-id"), ids[1]);
    // Controller opens form, focuses text entry, and cancels via B without deleting/creating.
    await page.locator("#new-training-pack").focus();
    await tap(0);
    await prompt.waitFor({ state: "visible" });
    assert.equal(
      await page
        .locator("#training-pack-name")
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await tap(1);
    if (await prompt.evaluate((e) => e.open)) await tap(1);
    await prompt.waitFor({ state: "hidden" });
    await rows
      .nth(0)
      .getByRole("button", { name: "DELETE", exact: true })
      .click();
    assert.equal(
      await prompt
        .getByRole("button", { name: "CANCEL", exact: true })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await tap(11); // First controller activity enters controller focus mode.
    await tap(15);
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "DELETE",
    );
    await tap(0);
    await prompt.waitFor({ state: "hidden" });
    assert.equal(await rows.count(), 0);
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await open();
    assert.equal(await rows.count(), 0);
    await page
      .locator("#custom-training")
      .getByRole("button", { name: "BACK", exact: true })
      .click();
    await page.locator("#training-striker").click();
    await page.waitForFunction(
      () => __arena.extraSession?.pack?.id === "striker",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS custom training browser: create, refresh, unique IDs, cancel/delete, publish validation, correct functional editor route, rename, responsive layout, controller form/delete, built-in Striker preserved.",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
