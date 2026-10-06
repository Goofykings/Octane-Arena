const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve("dist");
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    const file = path.resolve(
      root,
      req.url
        .split("?")[0]
        .replace(/^\/Octane-Arena\//, "/")
        .replace(/^\//, "") || "index.html",
    );
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, bytes) => {
      if (err) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
              ? "application/json"
              : "text/html",
      );
      res.end(bytes);
    });
  });
  await new Promise((r) => server.listen(4192, "127.0.0.1", r));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:4192/?test");
    await page.waitForFunction(() => window.__arena);
    await page.locator("#play").click();
    assert.equal(await page.locator("#arena-select").isVisible(), false);
    for (const [width, height] of [
      [2560, 1440],
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [1024, 600],
      [900, 600],
      [800, 600],
      [640, 480],
      [390, 844],
      [850, 500],
    ]) {
      await page.setViewportSize({ width, height });
      await page.mouse.move(0, 0);
      await page.waitForTimeout(250);
      const state = await page.evaluate(() => {
        const grid = document.querySelector("#modes .mode-grid"),
          screen = document.querySelector("#modes");
        return {
          scroll: [
            grid.scrollWidth - grid.clientWidth,
            grid.scrollHeight - grid.clientHeight,
            screen.scrollWidth - screen.clientWidth,
            screen.scrollHeight - screen.clientHeight,
          ],
          cards: [...grid.children].map((c) => {
            const r = c.getBoundingClientRect(),
              t = c.querySelector("strong").getBoundingClientRect(),
              s = c.querySelector("svg").getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              tx: t.x,
              ty: t.y,
              tw: t.width,
              th: t.height,
              sy: s.y,
              sh: s.height,
              font: parseFloat(
                getComputedStyle(c.querySelector("strong")).fontSize,
              ),
            };
          }),
        };
      });
      assert.ok(
        state.scroll.every((n) => n <= 1),
        `scroll at ${width}x${height}: ${JSON.stringify(state)}`,
      );
      for (const c of state.cards) {
        assert.ok(
          c.x >= 0 &&
            c.y >= 0 &&
            c.x + c.w <= width + 1 &&
            c.y + c.h <= height + 1,
        );
        assert.ok(
          c.tx >= c.x &&
            c.tx + c.tw <= c.x + c.w + 1 &&
            c.ty + c.th <= c.y + c.h + 1,
          `text clipped at ${width}x${height}`,
        );
        assert.ok(c.font >= 17);
        if (height > 480)
          assert.ok(
            c.sy + c.sh <= c.ty + 1,
            `icon/text overlap at ${width}x${height}`,
          );
      }
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const a = state.cards[i],
            b = state.cards[j];
          assert.ok(
            a.x + a.w <= b.x + 1 ||
              b.x + b.w <= a.x + 1 ||
              a.y + a.h <= b.y + 1 ||
              b.y + b.h <= a.y + 1,
          );
        }
      assert.equal(state.cards[0].y === state.cards[3].y, width > 850);
      console.log(
        `PASS four readable, non-overlapping cards without scroll ${width}x${height}`,
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#bot-mode").hover();
    await page.waitForTimeout(250);
    assert.notEqual(
      await page
        .locator("#bot-mode")
        .evaluate((e) => getComputedStyle(e).transform),
      "none",
    );
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    await page.screenshot({ path: "docs/play-responsive.png" });
    for (const id of ["city", "beach", "stadium", "circuit"]) {
      await page.locator("#freeplay-mode").click();
      assert.equal(await page.locator("#arena-select").isVisible(), true);
      await page.locator(`[data-arena="${id}"]`).click();
      await page.locator("#freeplay-launch").click();
      await page.waitForFunction(
        () => window.__arena.match.phase === "playing",
      );
      assert.equal(await page.evaluate(() => window.__arena.arena.mapId), id);
      await page.keyboard.press("Escape");
      await page.locator("#pause-home").click();
      await page.locator("#play").click();
    }
    let previous;
    for (let i = 0; i < 5; i++) {
      assert.equal(await page.locator("#arena-select").isVisible(), false);
      await page.locator("#bot-mode").click();
      await page.waitForFunction(
        () => window.__arena.match.phase === "countdown",
      );
      const id = await page.evaluate(() => window.__arena.arena.mapId);
      assert.ok(["city", "beach", "stadium", "circuit"].includes(id));
      assert.notEqual(id, previous);
      previous = id;
      await page.keyboard.press("Escape");
      await page.locator("#pause-home").click();
      await page.locator("#leave-confirm-yes").click();
      await page.locator("#play").click();
    }
    await page.locator("#extra-mode").click();
    assert.equal(await page.locator("#arena-select").isVisible(), false);
    await page.locator("#rings-mode").click();
    await page.waitForFunction(() => window.__arena.extraSession);
    assert.equal(
      await page.evaluate(() => window.__arena.extraSession.physics.course.id),
      "skyline-40-v2",
    );
    assert.equal(
      await page.evaluate(
        () => window.__arena.extraSession.physics.ringColliders.length,
      ),
      40,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS all Free Play maps, bot random selection without repeats, hover/click and fixed Rings world",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
