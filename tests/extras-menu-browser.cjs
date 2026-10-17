const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8273);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-features=OverlayScrollbar",
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    page.setDefaultTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Extra Modes fixture",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      window.pads = [];
      Object.defineProperty(navigator, "getGamepads", {
        value: () => window.pads,
      });
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    await page.locator("#extra-mode").click();
    await page.waitForFunction(
      () => !document.getElementById("extras").getAnimations().length,
    );
    for (const [width, height] of [
      [2560, 1440],
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [1024, 600],
      [850, 500],
      [641, 480],
      [640, 480],
      [390, 844],
      [320, 480],
      [640, 360],
    ]) {
      await page.setViewportSize({ width, height });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(200);
      const before = await page.evaluate(() => {
        const grid = document.querySelector("#extras .extra-grid");
        return {
          overflow: getComputedStyle(grid).overflow,
          width: grid.clientWidth,
          height: grid.clientHeight,
          scrollWidth: grid.scrollWidth,
          scrollHeight: grid.scrollHeight,
        };
      });
      console.log(width + "x" + height, before);
      assert.equal(
        before.overflow,
        "visible",
        "Extra Modes must not be an auto scroll container",
      );
      for (let i = 0; i < 3; i++) {
        await page.locator("#extras .mode-card").nth(i).hover();
        const frames = await page.evaluate(async () => {
          const grid = document.querySelector("#extras .extra-grid"),
            footer = document.querySelector("#extras footer"),
            cards = [...grid.children];
          const rows = [];
          for (let frame = 0; frame < 16; frame++) {
            await new Promise(requestAnimationFrame);
            const r = grid.getBoundingClientRect();
            rows.push({
              width: grid.clientWidth,
              height: grid.clientHeight,
              x: r.x,
              y: r.y,
              scrollLeft: grid.scrollLeft,
              scrollTop: grid.scrollTop,
              footerTop: footer.getBoundingClientRect().top,
              cards: cards.map((c) => {
                const b = c.getBoundingClientRect();
                return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
              }),
            });
          }
          return rows;
        });
        const style = await page
          .locator("#extras .mode-card")
          .nth(i)
          .evaluate((e) => ({
            scale: Number(getComputedStyle(e).scale),
            transform: new DOMMatrixReadOnly(getComputedStyle(e).transform).m42,
          }));
        assert.ok(
          style.scale > 1 && style.transform < -5,
          "Existing hover scale and lift remain",
        );
        for (const f of frames) {
          assert.equal(
            f.width,
            before.width,
            "Hover must not shrink the grid width",
          );
          assert.equal(
            f.height,
            before.height,
            "Hover must not shrink the grid height",
          );
          assert.equal(f.scrollLeft, 0);
          assert.equal(f.scrollTop, 0);
          for (const r of f.cards) {
            assert.ok(
              r.x >= 0 && r.right <= width,
              "Card stays inside the viewport",
            );
            assert.ok(
              r.y >= 0 && r.bottom <= f.footerTop + 1,
              "Card stays above Back",
            );
          }
        }
      }
      // Real Gamepad API navigation, not manually applying the focus CSS class.
      await page.mouse.move(0, 0);
      await page.evaluate(() => (window.pads = [window.pad]));
      const tap = (index) =>
        page.evaluate(async (index) => {
          const frame = () => new Promise(requestAnimationFrame);
          window.pad.buttons[index] = { value: 1, pressed: true };
          await frame();
          await frame();
          window.pad.buttons[index] = { value: 0, pressed: false };
          await frame();
          await frame();
        }, index);
      await tap(3);
      // Navigate to each target through real directional input. Geometry, not
      // a fixed step sequence, accounts for focus memory and 1-row/2-row layouts.
      for (const id of await page
        .locator("#extras .mode-card")
        .evaluateAll((cards) => cards.map((c) => c.id))) {
        let reached = false;
        for (let step = 0; step < 12; step++) {
          const move = await page.evaluate((id) => {
            const active = document.querySelector(".gamepad-focus"),
              target = document.getElementById(id);
            if (active === target) return 0;
            if (!active) throw Error("Controller did not establish focus");
            const a = active.getBoundingClientRect(),
              b = target.getBoundingClientRect();
            const dx = (b.left + b.right - a.left - a.right) / 2,
              dy = (b.top + b.bottom - a.top - a.bottom) / 2;
            return Math.abs(dy) > 15 ? (dy < 0 ? 12 : 13) : dx < 0 ? 14 : 15;
          }, id);
          if (!move) {
            reached = true;
            break;
          }
          await tap(move);
        }
        assert.ok(
          reached,
          "Controller can focus " + id + " at " + width + "x" + height,
        );
        await page.waitForTimeout(220);
        const focus = await page
          .locator("#" + id)
          .evaluate((e) => ({
            scale: Number(getComputedStyle(e).scale),
            transform: new DOMMatrixReadOnly(getComputedStyle(e).transform).m42,
          }));
        assert.ok(
          focus.scale > 1 && focus.transform < -5,
          "Controller retains the same clean highlight/lift",
        );
      }
      const layout = await page.evaluate(() => {
        const g = document.querySelector("#extras .extra-grid");
        return {
          overflow: getComputedStyle(g).overflow,
          x: g.scrollLeft,
          y: g.scrollTop,
        };
      });
      assert.deepEqual(layout, { overflow: "visible", x: 0, y: 0 });
      if (width === 1280 || width === 390 || (width === 640 && height === 360))
        await page.screenshot({ path: ".tools/extras-" + width + ".png" });
      await page.evaluate(() => (window.pads = []));
    }
    // The fix must not disable scroll containers elsewhere.
    assert.equal(
      await page
        .locator("#settings-content")
        .evaluate((e) => getComputedStyle(e).overflowY),
      "auto",
    );
    assert.equal(
      await page
        .locator(".garage-left")
        .evaluate((e) => getComputedStyle(e).overflowY),
      "auto",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS Extra Modes: mouse hover animation frames and controller focus across eleven desktop/narrow/short viewport sizes; no scroll container, shifting or overlap; other menu scrolling retained",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
