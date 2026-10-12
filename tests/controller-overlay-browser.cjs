const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { build } = require("esbuild");
const http = require("node:http"),
  assert = require("node:assert/strict");
(async () => {
  // Isolated real UI/input modules; no production debug hooks or mocked UI logic.
  const compiled = await build({
    stdin: {
      contents: `
    import { Input } from './src/input/input';
    import { MatchOverlay } from './src/ui/match-overlay';
    import { MenuNavigation } from './src/input/menu-navigation';
    import { starter } from './shared/catalog';
    document.body.innerHTML = '<div id="app"><section data-nav-scope="home"><button id="play">PLAY</button><button id="garage-open">GARAGE</button></section></div>';
    const input = new Input();
    input.controller.settings.bindings.chat = { type: 'button', button: 16 };
    const messages = [];
    const overlay = new MatchOverlay(document.body, input, text => { messages.push(text); return true; }, () => {}, () => {});
    const navigation = new MenuNavigation(input.controller, () => overlay.close(), () => input.clear());
    const players = [{id:'stable-human',name:'Pilot',team:0,preset:starter()}];
    const stats = [{playerId:'stable-human',score:0,goals:0,assists:0,saves:0,shots:0,touches:0,ping:null}];
    Object.assign(window, { fixture: { input, overlay, messages, stats } });
    function frame(){input.poll(); overlay.update('fixture-match',players,stats,[],[0,0],'stable-human',input.isHeld('scoreboard'),true); navigation.update(1/60,true,input.capturing); requestAnimationFrame(frame);}
    requestAnimationFrame(frame);
  `,
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<html><body><script>${compiled.outputFiles[0].text}</script></body></html>`,
    );
  });
  await new Promise((r) => server.listen(8226, "127.0.0.1", r));
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
    await page.addInitScript(() => {
      window.pad = {
        id: "DualSense",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      Object.defineProperty(navigator, "getGamepads", {
        value: () => [window.pad],
      });
    });
    await page.goto("http://127.0.0.1:8226");
    await page.waitForFunction(() => window.fixture);
    await page.evaluate(
      () => (window.pad.buttons[16] = { value: 1, pressed: true }),
    );
    await page.locator("#chat-input").waitFor({ state: "visible" });
    assert.equal(
      await page
        .locator("#chat-input")
        .evaluate((e) => document.activeElement === e),
      true,
    );
    await page.evaluate(() => {
      window.pad.buttons[7] = { value: 1, pressed: true };
      window.pad.buttons[0] = { value: 1, pressed: true };
    });
    await page.evaluate(
      () => (window.pad.buttons[13] = { value: 1, pressed: true }),
    );
    await page.waitForTimeout(100);
    assert.equal(
      await page
        .locator("#chat-input")
        .evaluate((e) => document.activeElement === e),
      true,
      "D-pad cannot steal chat focus",
    );
    await page.keyboard.type("wasd controller chat");
    const typing = await page.evaluate(() => window.fixture.input.sample());
    assert.equal(typing.throttle, 0);
    assert.equal(typing.jump, false);
    assert.equal(typing.steer, 0);
    await page.keyboard.press("Enter");
    assert.deepEqual(await page.evaluate(() => window.fixture.messages), [
      "wasd controller chat",
    ]);
    await page.locator("#chat-input").waitFor({ state: "hidden" });
    assert.equal(
      await page.evaluate(() => window.fixture.input.sample().jump),
      false,
      "Held jump is quarantined on chat exit",
    );
    await page.evaluate(() => {
      window.pad.buttons.forEach((b) => {
        b.value = 0;
        b.pressed = false;
      });
      window.fixture.stats[0].score = 62;
      window.fixture.stats[0].saves = 1;
    });
    await page.waitForTimeout(50);
    await page.evaluate(
      () => (window.pad.buttons[8] = { value: 1, pressed: true }),
    );
    await page.locator("#match-board").waitFor({ state: "visible" });
    assert.match(await page.locator("#match-board").textContent(), /62/);
    await page.evaluate(() => {
      window.fixture.stats[0].score = 162;
      window.fixture.stats[0].goals = 1;
    });
    await page.waitForFunction(() =>
      document.getElementById("match-board").textContent.includes("162"),
    );
    await page.evaluate(
      () => (window.pad.buttons[8] = { value: 0, pressed: false }),
    );
    await page.locator("#match-board").waitFor({ state: "hidden" });
    await page.evaluate(
      () => (window.pad.buttons[16] = { value: 1, pressed: true }),
    );
    await page.locator("#chat-input").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#chat-input").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      "PASS real chat/scoreboard UI: controller rebind opens chat, typing suppresses movement/jump, send/cancel and held-input quarantine, scoreboard hold/live stats/release",
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
