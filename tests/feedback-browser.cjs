const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8265);
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    ctx.setDefaultTimeout(30000);
    await ctx.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-profile",
        JSON.stringify({
          profileVersion: 1,
          localPlayerId: crypto.randomUUID(),
          name: "FeedbackPilot",
          avatarId: "helmet",
        }),
      );
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Feedback test pad",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          pressed: false,
          value: 0,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", { value: () => [pad] });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#feedback-open").waitFor({ state: "visible" });
    const currentVersion = (
      await page.locator("#game-version").textContent()
    ).slice(1);
    const button = await page.locator("#feedback-open").boundingBox();
    assert.ok(button.x > 1000 && button.y < 40, "small top-right home button");
    await page.evaluate(() => {
      // UI transport fixture only; tests/feedback.ts separately exercises the real Firebase SDK.
      window.feedbackReports = [];
      window.failFeedback = true;
      window.deferFeedback = false;
      __arena.feedbackPanel.service.writer = async (report) => {
        window.feedbackReports.push(report);
        if (window.failFeedback) throw { code: "unavailable" };
        if (window.deferFeedback)
          await new Promise((resolve) => (window.releaseFeedback = resolve));
      };
    });
    await page.locator("#feedback-open").click();
    assert.equal(
      await page.locator(".feedback-intro").textContent(),
      "Found a bug or glitch, or have an idea for a new feature? Describe it below and press Submit.",
    );
    await page.locator("#feedback-description").fill("   ");
    await page.locator("#feedback-submit").click();
    assert.equal(
      await page.locator("#feedback-status").textContent(),
      "Please describe your report.",
    );
    assert.equal(await page.evaluate(() => feedbackReports.length), 0);
    await page.evaluate(() => {
      const input = document.getElementById("feedback-description");
      input.value = "x".repeat(2001);
      input.dispatchEvent(new Event("input"));
    });
    await page.locator("#feedback-submit").click();
    assert.ok(
      (await page.locator("#feedback-status").textContent()).includes("2000"),
    );
    assert.equal(await page.evaluate(() => feedbackReports.length), 0);
    await page.locator("#feedback-description").fill("");
    async function press(index) {
      await page.evaluate(
        (i) => (pad.buttons[i] = { pressed: true, value: 1 }),
        index,
      );
      await page.waitForTimeout(240);
      await page.evaluate(
        (i) => (pad.buttons[i] = { pressed: false, value: 0 }),
        index,
      );
      await page.waitForTimeout(160);
    }
    await page.locator("#feedback-type-selector").click();
    await press(0);
    await press(15);
    await page.waitForFunction(
      () => document.getElementById("feedback-type").textContent === "Feature Request",
    );
    await press(13);
    await page.waitForFunction(
      () => document.activeElement?.id === "feedback-description",
    );
    await press(0);
    const text =
      "The goal frame flickers." +
      String.fromCharCode(10) +
      "It happens after kickoff.";
    await page.locator("#feedback-description").fill(text);
    await press(1);
    assert.ok(
      await page.locator("#feedback").evaluate((d) => d.open),
      "controller B exits text entry before closing the modal",
    );
    await press(13);
    await page.waitForFunction(
      () => document.activeElement?.id === "feedback-submit",
    );
    await press(0);
    await page.waitForFunction(() =>
      document
        .getElementById("feedback-status")
        .textContent.includes("could not be submitted"),
    );
    assert.equal(
      await page.locator("#feedback-description").inputValue(),
      text,
    );
    assert.ok(await page.locator("#feedback-submit").isEnabled());
    const report = await page.evaluate(() => feedbackReports[0]);
    assert.equal(report.username, "FeedbackPilot");
    assert.equal(report.reportType, "Feature Request");
    assert.equal(report.description, text);
    assert.equal(report.gameVersion, currentVersion);
    assert.equal(report.screen, "home");
    assert.equal(report.mode, "home");
    await page.keyboard.press("Escape");
    await page.locator("#feedback-open").click();
    assert.equal(
      await page.locator("#feedback-description").inputValue(),
      text,
      "closing/reopening keeps failed draft",
    );
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 390, height: 640 },
    ]) {
      await page.setViewportSize(size);
      const rect = await page.locator("#feedback").boundingBox();
      assert.ok(
        rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= size.width &&
          rect.y + rect.height <= size.height,
      );
      assert.ok(await page.locator("#feedback-submit").isVisible());
      const footer = await page.locator("#feedback footer").boundingBox();
      assert.ok(
        rect.y + rect.height - footer.y - footer.height < 50,
        "feedback modal hugs its content",
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: ".tools/feedback-modal.png" });
    await page.evaluate(() => {
      window.failFeedback = false;
      window.deferFeedback = true;
      const form = document.querySelector("#feedback form");
      form.requestSubmit();
      form.requestSubmit();
    });
    await page.waitForFunction(() => __arena.feedbackPanel.service.pending);
    assert.equal(
      await page.evaluate(() => feedbackReports.length),
      2,
      "duplicate submit produces one write",
    );
    assert.ok(await page.locator("#feedback-submit").isDisabled());
    assert.ok(await page.locator("#feedback-description").isDisabled());
    await page.locator("#feedback-close").click();
    await page.locator("#feedback-open").click();
    assert.equal(
      await page.locator("#feedback-description").inputValue(),
      text,
    );
    await page.evaluate(() => releaseFeedback());
    await page.waitForFunction(
      () =>
        document.getElementById("feedback-status").textContent ===
        "Thanks! Your report was submitted.",
    );
    assert.equal(await page.locator("#feedback-description").inputValue(), "");
    assert.equal(await page.locator("#feedback-type").textContent(), "Bug");
    assert.ok(await page.locator("#feedback-submit").isDisabled());
    assert.ok(
      (await page.locator("#feedback-cooldown").textContent()).includes(
        "before another report",
      ),
    );
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    await page.locator("#feedback-open").click();
    assert.ok(
      await page.locator("#feedback-submit").isDisabled(),
      "successful report cooldown survives reload",
    );
    await page.locator("#feedback-close").click();
    await page.locator("#garage-open").click();
    await page.waitForFunction(
      () => document.getElementById("feedback-open").hidden,
    );
    await page.locator("#garage-back").click();
    await page.locator("#play").click();
    await page.waitForFunction(
      () => document.getElementById("feedback-open").hidden,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS home-only top-right feedback, four viewport sizes, all form validation, multiline draft preservation, controller type/text/submit/back, live profile/version/context metadata, double-submit lock, success clear and reload-persistent cooldown",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
