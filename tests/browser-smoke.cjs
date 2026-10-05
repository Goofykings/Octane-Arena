// Optional local QA helper; uses an existing Playwright installation and Chrome.
// Invoke with PLAYWRIGHT_MODULE set to an installed Playwright package path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
(async () => {
  const root = path.resolve("dist");
  const server = http.createServer((req, res) => {
    if (req.url === "/favicon.ico") {
      res.writeHead(204);
      return res.end();
    }
    const relative = decodeURIComponent(req.url.split("?")[0]).replace(
      /^\/repository\//,
      "",
    );
    const file = path.resolve(root, relative === "" ? "index.html" : relative);
    if (!file.startsWith(root + path.sep) && file !== root) {
      res.writeHead(403);
      return res.end();
    }
    fs.readFile(file, (err, data) => {
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
            : "text/html",
      );
      res.end(data);
    });
  });
  await new Promise((resolve) => server.listen(4178, "127.0.0.1", resolve));
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
    args: ["--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text() + " " + m.location().url);
    });

    const assert = (ok, message) => {
      if (!ok) throw Error(message);
      console.log("PASS " + message);
    };
    await page.goto("http://127.0.0.1:4178/repository/?test");
    await page.waitForFunction(() => !!window.__arena);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(350);
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getTiming().iterations))
          .map((a) => a.finished.catch(() => {})),
      ),
    );
    const sizes = await page.evaluate(() =>
      ["play", "garage-open", "settings-open"].map((id) => {
        const e = document.getElementById(id),
          b = e.getBoundingClientRect();
        return {
          width: b.width,
          height: b.height,
          x: b.x,
          clip: getComputedStyle(e).clipPath,
        };
      }),
    );
    assert(
      sizes[1].width === sizes[2].width &&
        sizes[1].height === sizes[2].height &&
        sizes[1].clip === sizes[2].clip &&
        sizes[0].width > sizes[1].width &&
        sizes.every((s) => s.x < 150),
      "Home buttons align and share the requested dimensions",
    );
    assert(
      await page.evaluate(() => document.fonts.check("700 20px Rajdhani")),
      "Bundled game font loads under a repository subpath",
    );
    await page.screenshot({ path: "docs/home.png" });
    await page.locator("#garage-open").click();
    await page.locator("#new-preset").click();
    await page.locator("#customize-car").click();
    assert(
      (await page.locator("[data-category]").count()) === 7,
      "Garage has all seven separate categories",
    );
    await page.locator('[data-item="vector"]').click();
    await page.locator('[data-category="paint"]').click();
    await page.locator('[data-color="#8173e9"]').click();
    await page.locator("#team-preview").click();
    await page.locator('[data-color="#e36a30"]').click();
    await page.locator('[data-category="wheels"]').click();
    await page.locator('[data-item="disc"]').click();
    await page.locator('[data-category="boost"]').click();
    await page.locator('[data-item="ember"]').click();
    await page.locator('[data-category="decal"]').click();
    await page.locator('[data-item="circuit"]').click();
    await page.locator('[data-category="paint"]').click();
    await page.mouse.move(1100, 440);
    await page.mouse.down();
    await page.mouse.move(1250, 440, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "docs/garage-customize.png" });
    await page.reload();
    await page.waitForFunction(() => !!window.__arena);
    const preset = await page.evaluate(() => window.__arena.garage.current);
    assert(
      preset.body === "vector" &&
        preset.blue === "#8173e9" &&
        preset.orange === "#e36a30" &&
        preset.wheels === "disc" &&
        preset.boost === "ember" &&
        preset.decal === "circuit",
      "Body, both paints, cosmetics and preset selection survive reload",
    );
    await page.locator("#garage-open").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "docs/garage.png" });
    await page.locator("#garage-back").click();
    await page.locator("#settings-open").click();
    await page.locator("#infiniteBoost").uncheck();
    await page.locator("#showHitboxes").check();
    await page.locator("#quickChat").selectOption("friends");
    await page.locator('[data-tab="camera"]').click();
    await page.locator('[data-range="fov"]').click();
    await page.locator(".number-editor").fill("999");
    await page.keyboard.press("Enter");
    assert(
      (await page.locator("#fov").inputValue()) === "110",
      "Typed camera values clamp to maximum",
    );
    await page.locator('[data-range="fov"]').click();
    await page.locator(".number-editor").fill("-100");
    await page.keyboard.press("Tab");
    assert(
      (await page.locator("#fov").inputValue()) === "60",
      "Typed camera values clamp to minimum on blur",
    );
    await page.locator('[data-range="fov"]').click();
    await page.locator(".number-editor").fill("80");
    await page.keyboard.press("Enter");
    await page.locator("#distance").fill("6.2");
    await page.screenshot({ path: "docs/settings-camera.png" });
    await page.locator('[data-tab="controls"]').click();
    await page.locator('[data-action="throttle"]').click();
    await page.keyboard.press("i");
    await page.locator('[data-action="boost"]').click();
    await page.keyboard.press("i");
    assert(
      (await page.locator(".binding.conflict").count()) === 2,
      "Duplicate key bindings produce a warning",
    );
    await page.locator('[data-action="boost"]').click();
    await page.keyboard.press("ShiftLeft");
    for (const action of ["trainingReset", "possession", "dribble", "launch"])
      assert(
        await page.locator(`[data-action="${action}"]`).isVisible(),
        `Training binding ${action} is available`,
      );
    await page.locator('[data-action="launch"]').click();
    await page.keyboard.press("l");
    await page.waitForTimeout(150);
    await page.locator('[data-tab="graphics"]').click();
    await page.locator('[data-quality="low"]').click();
    const low = await page.evaluate(() => ({
      ratio: window.__arena.graphics.renderer.getPixelRatio(),
      shadows: window.__arena.graphics.renderer.shadowMap.enabled,
      quality: window.__arena.graphics.quality,
    }));
    await page.locator('[data-quality="high"]').click();
    const high = await page.evaluate(() => ({
      ratio: window.__arena.graphics.renderer.getPixelRatio(),
      shadows: window.__arena.graphics.renderer.shadowMap.enabled,
    }));
    assert(
      low.ratio < high.ratio && !low.shadows && high.shadows,
      "Graphics presets change resolution and shadow rendering",
    );
    await page.locator('[data-tab="audio"]').click();
    await page.locator("#audio-master").fill("35");
    await page.locator("#audio-engine").fill("20");
    await page.screenshot({ path: "docs/settings-audio.png" });
    await page.locator("#close-settings").click();
    await page.reload();
    await page.waitForFunction(() => !!window.__arena);
    const prefs = await page.evaluate(() => window.__arena.settings.value);
    assert(
      prefs.camera.fov === 80 &&
        prefs.camera.distance === 6.2 &&
        prefs.audio.master === 0.35 &&
        prefs.audio.engine === 0.2 &&
        prefs.bindings.throttle === "KeyI" &&
        prefs.bindings.launch === "KeyL" &&
        !prefs.infiniteBoost &&
        prefs.showHitboxes &&
        prefs.quickChat === "friends",
      "Settings and custom keybinds persist across reload",
    );
    await page.locator("#play").click();
    await page.waitForTimeout(300);
    assert(
      (await page.locator(".mode-card:disabled").count()) === 1 &&
        (await page.locator("#friend-mode").isEnabled()),
      "Friend matches are enabled; only ranked remains disabled",
    );
    await page.screenshot({ path: "docs/modes.png" });
    await page.locator("#bot-mode").click();
    await page.locator("#countdown").getByText("3", { exact: true }).waitFor();
    const kickoffPose = await page.evaluate(() => {
      const c = window.__arena.simulation.cars[0];
      return {
        position: { ...c.body.translation() },
        rotation: { ...c.body.rotation() },
        boost: c.boost,
      };
    });
    await page.keyboard.down("d");
    await page.keyboard.down("i");
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("Space");
    await page.waitForFunction(
      () =>
        Math.abs(window.__arena.visuals[0].userData.frontWheels[0].rotation.y) >
        0.2,
    );
    const kickoffAfter = await page.evaluate(() => {
      const a = window.__arena,
        c = a.simulation.cars[0];
      return {
        position: { ...c.body.translation() },
        rotation: { ...c.body.rotation() },
        boost: c.boost,
        phase: a.match.phase,
      };
    });
    assert(
      kickoffAfter.phase === "countdown" &&
        JSON.stringify(kickoffPose) ===
          JSON.stringify({
            position: kickoffAfter.position,
            rotation: kickoffAfter.rotation,
            boost: kickoffAfter.boost,
          }),
      "Kickoff wheels steer while chassis, boost and jump remain locked",
    );
    for (const key of ["d", "i", "ShiftLeft", "Space"])
      await page.keyboard.up(key);
    assert(
      await page.locator(".scoreboard").isVisible(),
      "Match scoreboard remains visible",
    );
    await page.screenshot({ path: "docs/countdown.png" });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    assert(
      (await page.locator("#clock").textContent()) === "5:00",
      "Pausing freezes the kickoff clock",
    );
    await page.screenshot({ path: "docs/pause.png" });
    await page.locator("#pause-controls").click();
    assert(
      (await page
        .locator('[data-tab="controls"]')
        .getAttribute("aria-selected")) === "true",
      "Pause controls opens bindings",
    );
    await page.locator("#close-settings").click();
    await page.locator("#resume").click();
    await page.waitForFunction(() => window.__arena.match.phase === "playing", {
      timeout: 10000,
    });
    await page.keyboard.down("w");
    await page.waitForTimeout(220);
    const oldInput = await page.evaluate(
      () => window.__arena.input.sample().throttle,
    );
    await page.keyboard.up("w");
    await page.keyboard.down("i");
    await page.keyboard.down("d");
    await page.waitForTimeout(300);
    const inputState = await page.evaluate(() => ({
      throttle: window.__arena.input.sample().throttle,
      steer: window.__arena.visuals[0].userData.frontWheels[0].rotation.y,
    }));
    await page.keyboard.up("d");
    assert(
      oldInput === 0 &&
        inputState.throttle === 1 &&
        Math.abs(inputState.steer) > 0.1,
      "Rebound throttle works and front wheels visibly steer",
    );
    await page.keyboard.down("ShiftLeft");
    await page
      .waitForFunction(
        () =>
          window.__arena.simulation.cars[0].boost < 99 &&
          window.__arena.audio.boostGain.gain.value > 0.1,
        null,
        { timeout: 5000 },
      )
      .catch(async (error) => {
        console.log(
          "BOOST DIAGNOSTIC",
          await page.evaluate(() => ({
            phase: window.__arena.match.phase,
            input: window.__arena.input.sample(),
            boost: window.__arena.simulation.cars[0].boost,
            boosting: window.__arena.simulation.cars[0].boosting,
            gain: window.__arena.audio.boostGain.gain.value,
            audioState: window.__arena.audio.ctx.state,
            audioTime: window.__arena.audio.ctx.currentTime,
          })),
        );
        throw error;
      });
    const boostState = await page.evaluate(() => ({
      boost: window.__arena.simulation.cars[0].boost,
      boostGain: window.__arena.audio.boostGain.gain.value,
      engineFreq: window.__arena.audio.engine.frequency.value,
    }));
    assert(
      boostState.boost < 99 && boostState.boostGain > 0.1,
      "Boost exhaust/audio activate and boost drains",
    );
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("i");
    await page.waitForFunction(
      () => window.__arena.audio.boostGain.gain.value < 0.002,
      null,
      { timeout: 5000 },
    );
    assert(
      await page.evaluate(
        () => window.__arena.audio.boostGain.gain.value < 0.002,
      ),
      "Boost audio stops independently of residual vehicle speed",
    );
    assert(
      await page.evaluate(() => {
        const a = window.__arena;
        const c = a.simulation.cars[0].collider,
          m = a.hitboxes.group.children[0],
          h = c.halfExtents();
        return (
          m.position.distanceTo(c.translation()) < 0.001 &&
          Math.abs(m.scale.z - h.z) < 0.0001
        );
      }),
      "Hitbox overlay follows actual collider dimensions and position",
    );
    assert(
      (await page.locator("#bot-tag").textContent()).length > 0,
      "Bot gets a curated nametag",
    );
    await page.screenshot({ path: "docs/gameplay.png" });
    await page.evaluate(() => {
      const a = window.__arena,
        p = a.pads.items[6];
      a.simulation.cars[0].reset(p.x, p.z, 0);
      a.simulation.cars[0].boost = 0;
    });
    await page.waitForFunction(
      () => window.__arena.simulation.cars[0].boost === 12,
    );
    const pickup = await page.evaluate(() => ({
      pulse: window.__arena.pads.items[6].pulse,
      animations: document.querySelector(".boost-hud").getAnimations().length,
    }));
    assert(
      pickup.pulse > 0 && pickup.animations > 0,
      "Pad pickup triggers short pad and HUD feedback",
    );
    await page.evaluate(() =>
      window.__arena.simulation.ball.setTranslation(
        { x: 0, y: 1, z: -53 },
        true,
      ),
    );
    await page.waitForFunction(() => window.__arena.match.phase === "goal");
    await page.keyboard.down("ShiftLeft");
    await page.keyboard.down("q");
    await page.waitForTimeout(150);
    assert(
      await page.evaluate(() => window.__arena.simulation.cars[0].boosting),
      "Goal explosion keeps player boost controls active",
    );
    await page.screenshot({ path: "docs/goal-explosion.png" });
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.up("q");
    for (const large of [false, true]) {
      await page.evaluate((large) => {
        const a = window.__arena,
          pad = a.pads.items.find((p) => p.large === large);
        // Keep time available for deterministic UI/effect inspection.
        a.match.freeze = 2;
        pad.cooldown = 0;
        a.simulation.cars[0].reset(pad.x, pad.z, 0);
        a.simulation.cars[0].boost = 20;
      }, large);
      await page.waitForFunction(
        (large) =>
          window.__arena.simulation.cars[0].boost === (large ? 100 : 32),
        large,
      );
      assert(
        await page.evaluate((large) => {
          const a = window.__arena,
            p = a.pads.items.find((p) => p.large === large);
          return (
            a.match.phase === "goal" &&
            p.cooldown > 0 &&
            p.pulse > 0 &&
            document.querySelector(".boost-hud").getAnimations().length > 0
          );
        }, large),
        `Post-goal ${large ? "large" : "small"} pad refills boost, animates, and starts cooldown`,
      );
    }
    await page.waitForFunction(
      () => window.__arena.match.phase === "countdown",
    );
    assert(
      await page.evaluate(
        () =>
          window.__arena.simulation.cars[0].boost === 33 &&
          window.__arena.pads.items.every((p) => p.cooldown === 0),
      ),
      "Post-goal pickups preserve normal kickoff boost/pad reset",
    );
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    if (await page.locator("#leave-confirm").evaluate((d) => d.open))
      await page.locator("#leave-confirm-yes").click();
    await page.locator("#settings-open").click();
    await page.locator('[data-tab="gameplay"]').click();
    await page.locator("#infiniteBoost").check();
    await page.locator("#showHitboxes").uncheck();
    await page.locator("#close-settings").click();
    await page.locator("#play").click();
    await page.locator("#freeplay-mode").click();
    assert(
      await page.evaluate(
        () =>
          window.__arena.match.phase === "playing" &&
          window.__arena.match.countdown === 0,
      ),
      "Free Play enters immediately without countdown",
    );
    assert(
      await page.locator(".scoreboard").isHidden(),
      "Free Play hides the entire scoreboard",
    );
    assert(
      (await page.locator("#countdown").textContent()) === "",
      "Free Play has no countdown text",
    );
    // Freeze physics, but retain live keyboard dispatch, to inspect exact action placement.
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.qaStep = s.step;
      s.step = () => {};
    });
    await page.keyboard.press("1");
    await page.waitForTimeout(150);
    assert(
      await page.evaluate(
        () =>
          window.__arena.match.phase === "playing" &&
          window.__arena.simulation.ball.linvel().y === 0,
      ),
      "Training reset is instant and clears ball velocity",
    );
    await page.keyboard.press("2");
    await page.waitForTimeout(150);
    assert(
      await page.evaluate(() => {
        const s = window.__arena.simulation;
        return s.ball.translation().z < s.cars[0].body.translation().z - 1;
      }),
      "Possession keyboard action places the ball ahead",
    );
    await page.keyboard.press("3");
    await page.waitForTimeout(150);
    assert(
      await page.evaluate(() => {
        const s = window.__arena.simulation;
        return s.ball.translation().y > s.cars[0].body.translation().y + 1;
      }),
      "Dribble keyboard action places the ball over the hood",
    );
    await page.keyboard.press("l");
    await page.waitForTimeout(150);
    const launchOne = await page.evaluate(
      () => window.__arena.simulation.ball.linvel().y,
    );
    await page.keyboard.press("l");
    await page.waitForTimeout(150);
    const launchTwo = await page.evaluate(
      () => window.__arena.simulation.ball.linvel().y,
    );
    assert(
      launchOne === 6 && launchTwo === 12,
      "Rebound launch key chains upward impulses without cooldown",
    );
    await page.keyboard.press("4");
    await page.waitForTimeout(150);
    assert(
      await page.evaluate(
        () => window.__arena.simulation.ball.linvel().y === 12,
      ),
      "Old launch binding is inactive",
    );
    await page.evaluate(() => {
      const s = window.__arena.simulation;
      s.step = s.qaStep;
    });
    await page.keyboard.press("1");
    await page.waitForTimeout(150);
    const ballMode = await page.evaluate(
      () => window.__arena.cameraControl.ballMode,
    );
    await page.keyboard.press("c");
    await page.waitForTimeout(150);
    assert(
      (await page.evaluate(() => window.__arena.cameraControl.ballMode)) !==
        ballMode,
      "Camera key switches to the other camera mode",
    );
    await page.keyboard.press("c");
    await page.waitForTimeout(150);
    await page.keyboard.down("ShiftLeft");
    await page.waitForTimeout(200);
    assert(
      await page.evaluate(
        () =>
          window.__arena.simulation.cars[0].boost === 100 &&
          !window.__arena.simulation.cars[1].body.isEnabled() &&
          window.__arena.match.remaining === 300,
      ),
      "Free play disables the bot and supports infinite boost without running a match clock",
    );
    await page.keyboard.up("ShiftLeft");
    await page.keyboard.press("Escape");
    await page.locator("#pause-home").click();
    if (await page.locator("#leave-confirm").evaluate((d) => d.open))
      await page.locator("#leave-confirm-yes").click();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: "docs/home-small.png" });
    assert(
      errors.length === 0,
      "No browser runtime errors: " + errors.join("; "),
    );
    console.log("Browser checks completed.");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
