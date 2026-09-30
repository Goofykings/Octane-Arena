// Isolated test profiles only; configure PLAYWRIGHT_MODULE and CHROME_PATH if needed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs"),
  http = require("node:http"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
(async () => {
  const { createApp } = await import("../server/dist/server/src/app.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-browser-"));
  const { app, store } = await createApp({
    host: "127.0.0.1",
    port: 0,
    database: path.join(dir, "qa.sqlite"),
    origins: ["http://127.0.0.1:4179"],
    production: false,
    trustProxy: false,
    authLimit: 50,
    sessionSeconds: 86400,
  });
  const api = await app.listen({ host: "127.0.0.1", port: 0 });
  const root = path.resolve("dist");
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    if (req.url === "/repository/config.json") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify({ apiUrl: api }));
    }
    const relative = decodeURIComponent(req.url.split("?")[0]).replace(
      /^\/repository\//,
      "",
    );
    const file = path.resolve(root, relative || "index.html");
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (e, data) => {
      if (e) {
        res.writeHead(404);
        return res.end();
      }
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".ttf")
              ? "font/ttf"
              : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(4179, "127.0.0.1", resolve));
  const launch = () =>
    chromium.launch({
      executablePath:
        process.env.CHROME_PATH ||
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
  let browser = await launch();
  let apiClosed = false;
  const errors = [];
  const url = "http://127.0.0.1:4179/repository/?test";
  const open = async (context) => {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => window.__arena?.accounts.ready);
    return page;
  };
  const signIn = async (page) => {
    await page.locator("#profile").click();
    await page.locator("#username").fill("BrowserDriver");
    await page.locator("#password").fill("Browser test password!");
    await page.locator("#account-form button[type=submit]").click();
    await page
      .locator("#account-name")
      .getByText("BrowserDriver", { exact: true })
      .waitFor();
  };
  try {
    const context = await browser.newContext({
        viewport: { width: 1360, height: 850 },
      }),
      page = await open(context);
    assert.equal(await page.locator("#profile-name").textContent(), "Guest");
    // Establish a guest customization before registration; it must survive logout.
    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    await page.locator('[data-item="vector"]').click();
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    await page.locator("#profile").click();
    await page.locator('[data-auth="register"]').click();
    await page.locator("#username").fill("BrowserDriver");
    await page.locator("#password").fill("Browser test password!");
    await page.screenshot({ path: "docs/account-register.png" });
    await page.locator("#account-form button[type=submit]").click();
    await page
      .locator("#account-name")
      .getByText("BrowserDriver", { exact: true })
      .waitFor();
    await page.locator('[data-avatar="fox"]').click();
    await page.locator('[data-title="line-runner"]').click();
    await page.waitForFunction(
      () => document.querySelector("#account-status").textContent === "Saved",
    );
    await page.screenshot({ path: "docs/account-profile.png" });
    await page.locator("#account-close").click();
    await page.locator("#garage-open").click();
    await page.locator("#new-preset").click();
    await page.locator("#customize-car").click();
    await page.locator('[data-category="paint"]').click();
    await page.locator('[data-color="#8173e9"]').click();
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    await page.locator("#settings-open").click();
    await page.locator('[data-tab="camera"]').click();
    await page.locator('[data-range="distance"]').click();
    await page.locator(".number-editor").fill("6.7");
    await page.keyboard.press("Enter");
    await page.locator("#close-settings").click();
    await page.evaluate(() => window.__arena.accounts.flush());
    await page.reload();
    await page.waitForFunction(
      () => window.__arena?.accounts.account?.username === "BrowserDriver",
    );
    assert.equal(
      await page.locator("#profile-title").textContent(),
      "Line Runner",
    );
    assert.equal(
      await page.evaluate(() => window.__arena.settings.value.camera.distance),
      6.7,
    );
    console.log(
      "PASS registration, profile, preset and settings survive browser reload",
    );
    const second = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      }),
      other = await open(second);
    assert.equal(await other.locator("#profile-name").textContent(), "Guest");
    await signIn(other);
    assert.equal(
      await other.evaluate(() => window.__arena.garage.current.blue),
      "#8173e9",
    );
    assert.equal(
      await other.evaluate(() => window.__arena.accounts.account.avatarId),
      "fox",
    );
    console.log("PASS independent browser session loads saved account");
    await other.locator('[data-avatar="comet"]').click();
    await other.evaluate(() => window.__arena.accounts.flush());
    await page.bringToFront();
    await page.locator("#profile").click();
    await page.locator('[data-avatar="robot"]').click();
    await page
      .locator("#account-status")
      .getByText("This account was updated on another device.", {
        exact: false,
      })
      .waitFor();
    await page.locator("#account-reload").click();
    await page.locator("#reload-yes").click();
    await page.waitForFunction(
      () => window.__arena.accounts.account.avatarId === "comet",
    );
    console.log(
      "PASS conflicting saves require explicit reload and never silently overwrite",
    );
    await page.locator("#account-logout").click();
    await page.locator("#account-form").waitFor();
    await page.locator("#account-close").click();
    assert.equal(await page.locator("#profile-name").textContent(), "Guest");
    assert.equal(
      await page.evaluate(() => window.__arena.garage.current.body),
      "vector",
    );
    console.log(
      "PASS logout revokes session and restores separate Guest garage",
    );
    await browser.close();
    browser = await launch();
    const fresh = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      }),
      restarted = await open(fresh);
    await signIn(restarted);
    assert.equal(
      await restarted.evaluate(() => window.__arena.accounts.account.avatarId),
      "comet",
    );
    console.log("PASS login after a full browser restart");
    await restarted.locator("#account-close").click();
    await app.close();
    apiClosed = true;
    await restarted.reload();
    await restarted.waitForFunction(() => window.__arena?.accounts.ready);
    assert.equal(
      await restarted.locator("#profile-name").textContent(),
      "Guest",
    );
    await restarted.locator("#play").click();
    await restarted.locator("#freeplay-mode").click();
    await restarted.waitForFunction(
      () => window.__arena.match.phase === "playing",
    );
    console.log("PASS unavailable backend leaves Guest free play working");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    if (!apiClosed) await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
