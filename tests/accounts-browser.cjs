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
  let persistent;
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
      if (!/^https?:$/.test(location.protocol)) return;
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
    });
    const page = await context.newPage(),
      errors = [],
      authRequests = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/\/api\/(auth|me)(\/|$)/.test(new URL(r.url()).pathname))
        authRequests.push(r.url());
    });
    const url = "http://127.0.0.1:4192/?test";
    await page.goto(url);
    await page.waitForFunction(() => window.__arena);
    const initial = await page.evaluate(() => ({
      id: window.__arena.accounts.profile.value.localPlayerId,
      garage: localStorage.getItem("octane-arena-garage"),
      settings: localStorage.getItem("octane-arena-settings"),
    }));
    await page
      .getByRole("button", { name: "Customize Account", exact: true })
      .click();
    assert.equal(
      await page.locator("#account input[type=password]").count(),
      0,
    );
    assert.equal(
      await page.getByText("CREATE ACCOUNT", { exact: true }).count(),
      0,
    );
    assert.equal(await page.locator("#profile-edit-tag").count(), 0);
    await page
      .getByRole("button", { name: "Change profile picture", exact: true })
      .click();
    assert.equal(
      await page.locator("#profile-avatar-picker").isVisible(),
      true,
    );
    assert.equal(await page.locator("[data-avatar]").count(), 6);
    await page.locator('[data-avatar="fox"]').click();
    await page.locator('[data-avatar-color="#FF727C"]').click();
    assert.equal(
      await page.locator('[data-avatar="fox"]').getAttribute("aria-pressed"),
      "true",
    );
    assert.equal(
      await page
        .locator("#profile .avatar")
        .evaluate((e) => getComputedStyle(e).color),
      "rgb(255, 114, 124)",
    );
    await page.locator("#profile-avatar-color").fill("#1a85c9");
    await page.locator("#profile-avatar-color").dispatchEvent("change");
    assert.equal(
      await page.evaluate(
        () => window.__arena.accounts.profile.value.avatarColor,
      ),
      "#1A85C9",
    );
    for (const [width, height] of [
      [2560, 1440],
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [800, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
      const rect = await page.locator("#account").boundingBox();
      assert.ok(
        rect.x >= 0 &&
          rect.y >= 0 &&
          rect.x + rect.width <= width + 1 &&
          rect.y + rect.height <= height + 1,
      );
      assert.equal(await page.locator(".profile-stats input").count(), 0);
      const overflow = await page
        .locator(".account-body")
        .evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      assert.equal(
        overflow,
        false,
        `Profile picker overflow at ${width}x${height}`,
      );
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#profile-edit-name").fill("  GoofyKing  ");
    await page.locator("#profile-form button[type=submit]").click();
    assert.equal(
      await page.locator("#profile-name").textContent(),
      "GoofyKing",
    );
    await page.locator(".account-body").evaluate((e) => {
      e.scrollTop = 0;
    });
    await page.screenshot({ path: "docs/profile-icon-picker.png" });
    await page.locator("#profile-back").click();
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.locator("#profile-name").textContent(),
      "GoofyKing",
    );
    assert.equal(
      await page.evaluate(
        () => window.__arena.accounts.profile.value.localPlayerId,
      ),
      initial.id,
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        icon: window.__arena.accounts.profile.value.avatarId,
        color: window.__arena.accounts.profile.value.avatarColor,
        tag: Object.hasOwn(window.__arena.accounts.profile.value, "tag"),
      })),
      { icon: "fox", color: "#1A85C9", tag: false },
    );
    // Real gameplay events through the existing scorer and match loop.
    await page.locator("#play").click();
    await page.locator("#bot-mode").click();
    await page.waitForFunction(
      () => window.__arena.match.phase === "playing",
      null,
      { timeout: 20000 },
    );
    await page.evaluate(() => {
      const a = window.__arena;
      a.simulation.lastTouchId = a.simulation.cars[0].id;
      a.simulation.ball.setTranslation({ x: 0, y: 1, z: -54 }, true);
      a.simulation.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    });
    await page.waitForFunction(
      () => window.__arena.accounts.profile.value.stats.goals === 1,
    );
    await page.evaluate(() => {
      const a = window.__arena;
      a.match.score = [1, 0];
      a.match.finish();
    });
    await page.waitForFunction(
      () => window.__arena.accounts.profile.value.stats.wins === 1,
    );
    await page.reload();
    await page.waitForFunction(() => window.__arena);
    assert.equal(
      await page.evaluate(
        () => window.__arena.accounts.profile.value.stats.matchesPlayed,
      ),
      1,
    );
    const saved = await context.storageState();
    await browser.close();
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const userDataDir = fs.mkdtempSync(
      path.join(path.resolve(".tools"), "profile-reopen-"),
    );
    const options = {
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    };
    persistent = await chromium.launchPersistentContext(userDataDir, options);
    await persistent.addInitScript((entries) => {
      if (!/^https?:$/.test(location.protocol)) return;
      for (const entry of entries)
        localStorage.setItem(entry.name, entry.value);
    }, saved.origins[0].localStorage);
    const seeded = await persistent.newPage();
    await seeded.goto(url);
    await seeded.waitForFunction(() => window.__arena);
    await persistent.close();
    persistent = await chromium.launchPersistentContext(userDataDir, options);
    const p = await persistent.newPage();
    await p.goto(url);
    await p.waitForFunction(() => window.__arena);
    assert.equal(await p.locator("#profile-name").textContent(), "GoofyKing");
    assert.equal(
      await p.evaluate(
        () => window.__arena.accounts.profile.value.localPlayerId,
      ),
      initial.id,
    );
    await p
      .getByRole("button", { name: "Customize Account", exact: true })
      .click();
    await p.locator("#profile-reset").click();
    assert.equal(await p.locator("#profile-name").textContent(), "GoofyKing");
    await p.locator("#profile-reset-no").click();
    const preserved = await p.evaluate(() => ({
      garage: localStorage.getItem("octane-arena-garage"),
      settings: localStorage.getItem("octane-arena-settings"),
    }));
    await p.locator("#profile-reset").click();
    await p.locator("#profile-reset-yes").click();
    assert.equal(
      await p.evaluate(
        () => window.__arena.accounts.profile.value.localPlayerId,
      ),
      initial.id,
    );
    assert.equal(
      await p.evaluate(
        () => window.__arena.accounts.profile.value.stats.matchesPlayed,
      ),
      0,
    );
    assert.deepEqual(
      await p.evaluate(() => ({
        garage: localStorage.getItem("octane-arena-garage"),
        settings: localStorage.getItem("octane-arena-settings"),
      })),
      preserved,
    );
    assert.equal(
      await p.evaluate(() => window.__arena.accounts.profile.value.avatarId),
      "helmet",
    );
    await p.addInitScript(() =>
      localStorage.setItem("octane-arena-profile", "{corrupt"),
    );
    await p.reload();
    await p.waitForFunction(() => window.__arena);
    assert.equal(await p.locator("#profile-name").textContent(), "Guest");
    await persistent.close();
    persistent = null;
    const unavailable = await browser.newContext();
    await unavailable.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw Error("blocked");
        },
      });
    });
    const offline = await unavailable.newPage();
    await offline.goto(url);
    await offline.waitForFunction(() => window.__arena);
    await offline
      .getByRole("button", { name: "Customize Account", exact: true })
      .click();
    await offline.locator("#profile-edit-name").fill("Session");
    await offline.locator("#profile-form button[type=submit]").click();
    assert.equal(
      await offline.locator("#profile-name").textContent(),
      "Session",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(authRequests, []);
    console.log(
      "PASS icon/color picker at six resolutions, name/icon/color/ID persistence, no tags, real stats, reset and corrupt/unavailable storage",
    );
  } finally {
    if (persistent) await persistent.close();
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
