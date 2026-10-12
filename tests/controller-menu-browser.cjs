const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8227);
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
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "octane-arena-settings",
        JSON.stringify({ quality: "low" }),
      );
      window.pad = {
        id: "Controller UI fixture",
        index: 0,
        connected: true,
        mapping: "standard",
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({
          value: 0,
          pressed: false,
        })),
      };
      window.pads = [window.pad];
      Object.defineProperty(navigator, "getGamepads", {
        value: () => window.pads,
      });
    });
    await page.goto(server.url);
    await page.waitForFunction(() => window.__arena);
    const frames = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            let left = 2;
            const tick = () =>
              left-- ? requestAnimationFrame(tick) : resolve();
            requestAnimationFrame(tick);
          }),
      );
    const press = async (index) => {
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { value: 1, pressed: true }),
        index,
      );
      await frames();
      await page.evaluate(
        (i) => (window.pad.buttons[i] = { value: 0, pressed: false }),
        index,
      );
      await frames();
    };
    const dir = { up: 12, down: 13, left: 14, right: 15 };
    const active = (selector) =>
      page.evaluate(
        (selector) =>
          !!document.querySelector(".gamepad-focus")?.matches(selector),
        selector,
      );
    const focusId = () =>
      page.evaluate(() => document.querySelector(".gamepad-focus")?.id);
    // The planner only observes geometry; all navigation/activation is Gamepad input.
    const go = async (selector) => {
      for (let attempts = 0; attempts < 80; attempts++) {
        if (await active(selector)) return;
        const direction = await page.evaluate((selector) => {
          const a = document.querySelector(".gamepad-focus"),
            b = document.querySelector(selector);
          if (!a || !b) throw Error("Missing navigation target: " + selector);
          const ra = a.getBoundingClientRect(),
            rb = b.getBoundingClientRect();
          if (a.matches("[data-nav-cycle]")) return "down";
          if (a.matches("[role=tab]") && !b.matches("[role=tab]"))
            return "down";
          const dx = (rb.left + rb.right - ra.left - ra.right) / 2,
            dy = (rb.top + rb.bottom - ra.top - ra.bottom) / 2;
          return Math.abs(dy) > 15
            ? dy < 0
              ? "up"
              : "down"
            : dx < 0
              ? "left"
              : "right";
        }, selector);
        await press(dir[direction]);
      }
      throw Error(
        "Could not reach " + selector + "; focused " + (await focusId()),
      );
    };
    const select = async (selector) => {
      await go(selector);
      await press(0);
    };
    const back = () => press(1);
    await press(3);
    assert.equal(
      await focusId(),
      "play",
      "Any controller input highlights Play with no prior mouse activity",
    );
    await press(13);
    assert.equal(await focusId(), "garage-open");
    await press(0);
    await select("#customize-car");
    await press(5);
    assert.ok(await active('[data-category="paint"]'));
    await select(".swatch");
    await back();
    assert.equal(await focusId(), "customize-car");
    await back();
    assert.equal(
      await focusId(),
      "garage-open",
      "Return restores opener focus",
    );
    console.log("PASS controller home/garage and opener memory");
    await press(13);
    assert.equal(await focusId(), "settings-open");
    await press(0);
    await press(13);
    assert.equal(await focusId(), "infiniteBoost");
    const infinite = await page.locator("#infiniteBoost").isChecked();
    await press(0);
    assert.equal(await page.locator("#infiniteBoost").isChecked(), !infinite);
    await press(13);
    assert.equal(await focusId(), "quickChat");
    await press(15);
    assert.equal(await page.locator("#quickChat").inputValue(), "friends");
    await press(5);
    assert.equal(await focusId(), "tab-camera");
    await press(13);
    assert.equal(await focusId(), "fov");
    const fov = Number(await page.locator("#fov").inputValue());
    await press(15);
    assert.equal(Number(await page.locator("#fov").inputValue()), fov + 1);
    await press(5);
    assert.equal(await focusId(), "tab-controls");
    await go('[data-controller="jump"]');
    await press(14);
    assert.ok(await active('[data-action="jump"]'));
    await press(0);
    assert.ok(await page.locator("#binding-capture").isVisible());
    await back();
    assert.equal(
      await page.locator("#binding-capture").isVisible(),
      false,
      "Controller Back cancels keyboard capture",
    );
    await press(15);
    assert.ok(await active('[data-controller="jump"]'));
    await press(0);
    assert.ok(await page.locator("#binding-capture").isVisible());
    await press(3);
    assert.equal(await page.locator("#binding-capture").isVisible(), false);
    assert.equal(
      await page.evaluate(
        () => window.__arena.settings.value.controller.bindings.jump.button,
      ),
      3,
    );
    await press(0);
    await page.evaluate(
      () => (window.pad.buttons[9] = { value: 1, pressed: true }),
    );
    await page.waitForFunction(() => !window.__arena.input.capturing);
    await page.evaluate(
      () => (window.pad.buttons[9] = { value: 0, pressed: false }),
    );
    await frames();
    assert.equal(
      await page.evaluate(
        () => window.__arena.settings.value.controller.bindings.jump.button,
      ),
      3,
      "Hold Options cancels without replacing the binding",
    );
    await select("#reset-controller");
    await press(5);
    assert.equal(await focusId(), "tab-graphics");
    await select('[data-quality="medium"]');
    await press(5);
    assert.equal(await focusId(), "tab-audio");
    await press(13);
    assert.equal(await focusId(), "audio-master");
    const volume = Number(await page.locator("#audio-master").inputValue());
    await press(14);
    assert.equal(
      Number(await page.locator("#audio-master").inputValue()),
      volume - 1,
    );
    await back();
    assert.equal(await focusId(), "settings-open");
    console.log(
      "PASS controller settings tabs/columns/toggles/sliders/binding/reset",
    );
    await page.mouse.move(100, 100);
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.uiInput),
      "mouse",
    );
    assert.equal(await page.locator(".gamepad-focus").count(), 0);
    await page.evaluate(() => {
      window.pad.axes[0] = 0.06;
      window.pad.buttons[7] = { value: 0.05, pressed: false };
    });
    await frames();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.uiInput),
      "mouse",
      "Drift/noise cannot reactivate controller UI",
    );
    await press(3);
    assert.equal(
      await focusId(),
      "settings-open",
      "Controller restores previous selection after mouse switch",
    );
    await page.evaluate(() =>
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerType: "mouse",
          clientX: 100.3,
          clientY: 100,
        }),
      ),
    );
    await frames();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.uiInput),
      "controller",
      "Tiny cursor jitter ignored",
    );
    await page.evaluate(() => {
      window.pad.axes.fill(0);
      window.pad.buttons[7] = { value: 0, pressed: false };
    });
    await go("#play");
    await press(0);
    await select("#extra-mode");
    assert.equal(await focusId(), "training-mode");
    await press(0);
    assert.ok((await focusId()).startsWith("training-"));
    await press(0);
    await page.waitForFunction(
      () => window.__arena.extraSession?.id === "training",
    );
    await press(9);
    await page.waitForFunction(() => window.__arena.extraSession.paused);
    await select("#training-settings");
    await back();
    assert.equal(await focusId(), "training-settings");
    await select("#training-exit");
    await select("#play");
    await select("#extra-mode");
    await select("#rings-mode");
    await press(9);
    await select("#rings-exit");
    await select("#play");
    await select("#extra-mode");
    await select("#dribble-mode");
    await press(9);
    await select("#dribble-exit");
    console.log(
      "PASS controller Extra Modes and training/rings/dribble overlays",
    );
    await select("#play");
    await select("#freeplay-mode");
    await select('.arena-option:not([aria-pressed="true"])');
    await select("#freeplay-launch");
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await press(9);
    await select("#pause-home");
    await page.waitForFunction(() => window.__arena.match.phase === "home");
    await select("#play");
    await select("#bot-mode");
    assert.equal(await focusId(), "bot-size-cycle");
    await press(15);
    assert.equal(await page.locator("#bot-size").textContent(), "2v2");
    await press(13);
    assert.equal(await focusId(), "bot-difficulty-cycle");
    await press(15);
    assert.equal(
      await page.locator("#bot-difficulty").textContent(),
      "INTERMEDIATE",
    );
    await press(13);
    assert.equal(await focusId(), "bot-launch");
    await press(0);
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await press(9);
    await select("#pause-controls");
    await back();
    assert.equal(await focusId(), "pause-controls");
    await back();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await press(9);
    await select("#pause-home");
    await page.waitForFunction(
      () => document.getElementById("leave-confirm").open,
    );
    assert.equal(
      await focusId(),
      "leave-confirm-stay",
      "Confirmation respects the existing safe autofocus",
    );
    await back();
    await page.waitForFunction(() => window.__arena.match.phase === "playing");
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.recordTouch(s.cars[0].id);
      s.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: -10 }, true);
      s.ballPose.snap();
    });
    await page.waitForFunction(() => window.__arena.match.phase === "replay");
    await frames();
    assert.equal(await focusId(), "replay-skip-button");
    await press(0);
    await page.waitForFunction(
      () => window.__arena.match.phase === "countdown",
    );
    await page.evaluate(() => {
      window.__arena.match.phase = "finished";
      window.__arena.match.message = "TEST COMPLETE";
    });
    await frames();
    assert.equal(await focusId(), "again");
    await back();
    await page.waitForFunction(() => window.__arena.match.phase === "home");
    await select("#profile");
    await select("#profile-avatar-edit");
    await select('[data-avatar="robot"]');
    await select("#profile-avatar-color");
    await page
      .locator(".controller-color-editor")
      .waitFor({ state: "visible" });
    await page.keyboard.type("#abc123");
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() =>
        window.__arena.accounts.profile.value.avatarColor.toLowerCase(),
      ),
      "#abc123",
    );
    await back();
    await select("#profile-edit-name");
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Controller Pilot");
    await back();
    await select('#profile-form button[type="submit"]');
    assert.equal(
      await page.evaluate(() => window.__arena.accounts.profile.value.name),
      "Controller Pilot",
    );
    await back();
    await select("#game-version");
    await back();
    console.log(
      "PASS Free Play/map choice, leave confirmation, real goal/replay skip, profile icon/custom hex/name and version menu",
    );
    // Text entry is the explicit exception; focus/back use only controller.
    await select("#party-join-open");
    assert.equal(await focusId(), "party-input");
    await press(0);
    await page.keyboard.type("ABCD12");
    await back();
    await press(15);
    assert.notEqual(await focusId(), "party-input");
    await back();
    assert.equal(await focusId(), "party-join-open");
    // Render the actual party/setup components with a deterministic party fixture.
    // This checks menu actions, not internet connectivity.
    await page.evaluate(() => {
      const a = window.__arena,
        p = a.party;
      window.partyActions = [];
      p.action = async (action, data = {}) => {
        window.partyActions.push({ action, data });
        if (action === "create")
          p.state = {
            code: "ABCD12",
            hostId: p.playerId,
            maxPlayers: 4,
            stage: "home",
            mode: "1v1",
            gameMode: "soccar",
            members: [
              {
                id: p.playerId,
                name: "Host",
                avatarId: "helmet",
                preset: structuredClone(a.garage.current),
                team: null,
                ready: false,
              },
              {
                id: "fixture-friend",
                name: "Friend",
                avatarId: "helmet",
                preset: structuredClone(a.garage.current),
                team: 0,
                ready: false,
              },
            ],
          };
        if (action === "stage") p.state.stage = data.stage;
        if (action === "mode") p.state.mode = data.mode;
        if (action === "gamemode") p.state.gameMode = data.gameMode;
        if (action === "team") p.state.members[0].team = data.team;
        if (action === "leave") p.state = null;
        p.changed();
        return true;
      };
    });
    await select("#party-create");
    await select("#play");
    assert.equal(await focusId(), "gamemode-cycle");
    await press(15);
    assert.equal(
      await page.locator("#setup-gamemode").textContent(),
      "HEATSEEKER",
    );
    await press(14);
    assert.equal(await page.locator("#setup-gamemode").textContent(), "SOCCAR");
    await press(13);
    assert.equal(await focusId(), "party-size-cycle");
    await press(15);
    await press(15);
    assert.equal(
      await page.evaluate(() => window.__arena.party.state.mode),
      "2v2bots",
    );
    await select("#party-continue");
    await select('.party-team-join[data-team="0"]');
    await select("#party-launch");
    assert.ok(
      await page.evaluate(() =>
        window.partyActions.some((x) => x.action === "launch"),
      ),
    );
    await back();
    await back();
    await select("#party-leave");
    await page.evaluate(() => (window.pads = []));
    await frames();
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.uiInput),
      "mouse",
    );
    assert.equal(await page.locator(".gamepad-focus").count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS controller-only Home/Play/Garage/Settings tabs/toggles/sliders/binds/resets/graphics/audio, Extra/Training/Rings/Dribble, bot size/difficulty, pause/end, party text/setup/Soccar/Heatseeker/team/launch UI; focus memory, mouse mode/jitter/drift/disconnect",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
