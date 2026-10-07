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
    const errors = [];
    const createPage = async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      context.setDefaultTimeout(20000);
      await context.addInitScript(() =>
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        ),
      );
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto("http://127.0.0.1:8099/?test");
      await page.waitForFunction(
        () => window.__arena && window.__arena.party.connection === "connected",
      );
      return page;
    };
    const page = await createPage();
    for (const [width, height] of [
      [2560, 1440],
      [1920, 1080],
      [1366, 768],
      [1280, 720],
      [800, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      const version = page.locator("#game-version");
      assert.equal(await version.textContent(), "V0.1.4");
      const bounds = await version.boundingBox();
      assert.ok(
        bounds.x > width / 2 &&
          bounds.y > height * 0.8 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= height,
      );
      await version.click();
      await page
        .locator("#version-updates")
        .evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)));
      assert.equal(
        await page.evaluate(() => window.__arena.mouseLook.dragging),
        false,
      );
      assert.equal(await page.locator("#version-updates li").count(), 2);
      assert.match(
        await page.locator("#version-updates").textContent(),
        /Multiplayer through LAN.*Coming Soon.*New Car Models.*Coming Soon/s,
      );
      const panel = await page.locator("#version-updates").boundingBox();
      assert.ok(
        panel.x >= 0 &&
          panel.y >= 0 &&
          panel.x + panel.width <= width + 1 &&
          panel.y + panel.height <= height + 1,
      );
      if (width === 1280)
        await page.screenshot({ path: "docs/upcoming-updates.png" });
      await page.locator(".updates-back").click();
      assert.equal(await page.locator("#version-updates").isVisible(), false);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator("#settings-open").click();
    await page.locator('[data-tab="camera"]').click();
    const slider = await page.locator("#transition").boundingBox();
    await page.mouse.move(slider.x + 5, slider.y + slider.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      slider.x + slider.width - 5,
      slider.y + slider.height / 2,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.__arena.mouseLook.active),
      false,
    );
    await page.locator("#close-settings").click();
    const drag = async (p, x = 850, y = 380) => {
      await p.bringToFront();
      await p.mouse.move(x, y);
      await p.mouse.down();
      await p.mouse.move(x + 260, y - 95, { steps: 12 });
      await p.waitForFunction(
        () => Math.abs(window.__arena.mouseLook.yaw) > 0.1,
      );
      assert.equal(await p.evaluate(() => document.pointerLockElement), null);
    };
    const release = async (p) => {
      const orbit = await p.evaluate(
        () => window.__arena.mouseLook.behavior === "orbit",
      );
      const before = await p.evaluate(() => window.__arena.mouseLook.targetYaw);
      await p.mouse.up();
      await p.waitForFunction(() => !window.__arena.mouseLook.moving, null, {
        timeout: 30000,
      });
      if (orbit) {
        const settled = await p.evaluate(() => window.__arena.mouseLook.yaw);
        assert.ok(
          Math.abs(
            Math.atan2(Math.sin(settled - before), Math.cos(settled - before)),
          ) > 0.01,
          "Display camera coasts after release",
        );
        await p.waitForTimeout(250);
        assert.ok(
          Math.abs(
            (await p.evaluate(() => window.__arena.mouseLook.yaw)) - settled,
          ) < 1e-5,
          "Display view stays at the settled angle",
        );
      } else
        assert.equal(
          await p.evaluate(() => window.__arena.mouseLook.active),
          false,
        );
    };
    const beforeCar = await page.evaluate(() =>
      window.__arena.homeLobby.group.children[0].quaternion.toArray(),
    );
    const beforeCamera = await page.evaluate(() =>
      window.__arena.camera.position.toArray(),
    );
    await drag(page);
    const orbitCamera = await page.evaluate(() =>
      window.__arena.camera.position.toArray(),
    );
    assert.ok(
      Math.hypot(...orbitCamera.map((v, i) => v - beforeCamera[i])) > 0.5,
    );
    assert.deepEqual(
      await page.evaluate(() =>
        window.__arena.homeLobby.group.children[0].quaternion.toArray(),
      ),
      beforeCar,
    );
    await release(page);
    await page.mouse.move(850, 380);
    await page.mouse.down();
    await page.evaluate(() => {
      const a = window.__arena;
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: a.cameraDrag.pointer,
          clientX: 100000,
          clientY: 380,
          buttons: 1,
        }),
      );
      window.mouseLimit = a.mouseLook.targetYaw;
      window.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: a.cameraDrag.pointer,
          clientX: 99990,
          clientY: 380,
          buttons: 1,
        }),
      );
    });
    assert.ok(
      await page.evaluate(
        () =>
          Math.abs(window.mouseLimit) > Math.PI &&
          window.__arena.mouseLook.targetYaw > window.mouseLimit + 0.04,
      ),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.__arena.mouseLook.dragging),
      false,
    );
    await page.mouse.move(850, 380);
    await page.mouse.down();
    await page.evaluate(() => {
      const a = window.__arena;
      document
        .getElementById("app")
        .releasePointerCapture(a.cameraDrag.pointer);
    });
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.__arena.mouseLook.dragging),
      false,
    );
    await page.waitForFunction(() => !window.__arena.mouseLook.moving);
    console.log(
      "PASS responsive version panel, continuous Home orbit with momentum/friction, unchanged car and pointer cleanup",
    );

    await page.locator("#garage-open").click();
    await page.locator("#customize-car").click();
    await page.locator('[data-category="wheels"]').click();
    const carRotation = await page.evaluate(() =>
      window.__arena.preview.car.quaternion.toArray(),
    );
    await drag(page);
    assert.deepEqual(
      await page.evaluate(() =>
        window.__arena.preview.car.quaternion.toArray(),
      ),
      carRotation,
    );
    await page.mouse.move(5, 5);
    await release(page);
    await page.locator('[data-item="disc"]').click();
    assert.equal(
      await page.evaluate(() => window.__arena.mouseLook.dragging),
      false,
    );
    assert.equal(
      await page.evaluate(() => window.__arena.garage.current.wheels),
      "disc",
    );
    await page.mouse.move(850, 380);
    await page.mouse.down();
    await page.evaluate(() =>
      window.dispatchEvent(
        new PointerEvent("pointercancel", {
          pointerId: window.__arena.cameraDrag.pointer,
        }),
      ),
    );
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => window.__arena.mouseLook.dragging),
      false,
    );
    await page.locator("#garage-back").click();
    await page.locator("#garage-back").click();
    console.log(
      "PASS Garage camera orbit without rotating car, release outside, cancel and usable customization",
    );

    for (const mode of ["freeplay", "bot"]) {
      await page.locator("#play").click();
      await page.locator(`#${mode}-mode`).click();
      if (mode === "freeplay") await page.locator("#freeplay-launch").click();
      await page.waitForFunction(() =>
        ["playing", "countdown"].includes(window.__arena.match.phase),
      );
      assert.equal(await page.locator("#game-version").isVisible(), false);
      await page.evaluate(() => {
        window.__arena.match.phase = "countdown";
        window.__arena.match.countdown = 1000;
      });
      for (const ballMode of [false, true]) {
        await page.evaluate(
          (ballMode) => (window.__arena.cameraControl.ballMode = ballMode),
          ballMode,
        );
        const pose = await page.evaluate(() => ({
          p: window.__arena.simulation.cars[0].body.translation(),
          q: window.__arena.simulation.cars[0].body.rotation(),
        }));
        await drag(page);
        assert.equal(
          await page.evaluate(() => window.__arena.cameraControl.ballMode),
          ballMode,
        );
        assert.deepEqual(
          await page.evaluate(() => ({
            p: window.__arena.simulation.cars[0].body.translation(),
            q: window.__arena.simulation.cars[0].body.rotation(),
          })),
          pose,
        );
        await release(page);
      }
      await page.keyboard.press("Escape");
      await page.locator("#pause-home").click();
      if (mode === "bot") await page.locator("#leave-confirm-yes").click();
      await page.waitForFunction(
        () => window.__arena.ui.root.dataset.screen === "home",
      );
    }
    console.log(
      "PASS Free Play/VS Bot Car and Ball Cam free look, unchanged chassis, return and preserved camera mode",
    );

    const friend = await createPage();
    const action = async (p, name, payload = {}) => {
      await p.bringToFront();
      for (let attempt = 0; attempt < 10; attempt++) {
        await p.waitForFunction(() => !window.__arena.party.busy);
        const result = await p.evaluate(
          async ({ name, payload }) => {
            const party = window.__arena.party;
            if (party.busy) return null;
            const ok = await party.action(name, payload);
            return { ok, message: party.message };
          },
          { name, payload },
        );
        if (!result) continue;
        assert.equal(result.ok, true, result.message);
        return;
      }
      throw Error("Party stayed busy");
    };
    await action(page, "create");
    const code = await page.evaluate(() => window.__arena.party.state.code);
    await action(friend, "join", { code });
    await action(page, "stage", { stage: "mode" });
    await action(page, "stage", { stage: "teams" });
    await action(page, "team", { team: 0 });
    await action(friend, "team", { team: 1 });
    for (const p of [page, friend])
      await p.evaluate(() => {
        window.mouseQaRender = window.__arena.graphics.render;
        window.__arena.graphics.render = () => {};
      });
    await action(page, "launch");
    for (const p of [page, friend]) {
      await p.waitForFunction(
        () => window.__arena.networkView && window.__arena.network.latest,
      );
      await p.evaluate(
        () => (window.__arena.graphics.render = window.mouseQaRender),
      );
      await drag(p);
      assert.equal(
        await p.evaluate(
          () =>
            window.__arena.networkView.camera.mouseLook ===
            window.__arena.mouseLook,
        ),
        true,
      );
      assert.equal(
        await p.evaluate(() => window.__arena.networkView.camera.ballMode),
        true,
      );
      await release(p);
    }
    await action(friend, "leave");
    assert.deepEqual(errors, []);
    console.log(
      "PASS independent LAN client mouse look, Ball Cam return, unchanged transport and clean party leave",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
