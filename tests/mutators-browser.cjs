const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8261);
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: [
        "--enable-unsafe-swiftshader",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    async function open(name) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.setDefaultTimeout(60000);
      await ctx.addInitScript((name) => {
        if (!localStorage.getItem("octane-arena-profile"))
          localStorage.setItem(
            "octane-arena-profile",
            JSON.stringify({
              profileVersion: 1,
              localPlayerId: crypto.randomUUID(),
              name,
              avatarId: "helmet",
            }),
          );
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        window.pad = {
          id: "Mutator controller fixture",
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
      }, name);
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
      return p;
    }
    async function action(p, name, data = {}) {
      await p.waitForFunction(() => !__arena.party.busy);
      const r = await p.evaluate(
        async ({ name, data }) => ({
          ok: await __arena.party.action(name, data),
          message: __arena.party.message,
        }),
        { name, data },
      );
      assert.ok(r.ok, r.message);
    }
    const host = await open("Host");
    await host.locator("#garage-open").click();
    await host.locator("#new-preset").click();
    await host.locator("#new-preset").click();
    const original = await host.evaluate(() =>
      __arena.garage.presets.map((p) => p.id),
    );
    await host.locator('[data-rename="1"]').click();
    await host.locator("#preset-name").fill("  Circuit One  ");
    await host.keyboard.press("Enter");
    await host.waitForFunction(
      () => !document.querySelector(".preset-dialog").open,
    );
    assert.equal(
      await host.evaluate(() => __arena.garage.presets[1].name),
      "Circuit One",
    );
    await host.locator('[data-rename="1"]').click();
    await host.locator("#preset-name").fill("   ");
    await host.keyboard.press("Enter");
    await host.waitForFunction(() =>
      document.querySelector(".preset-error").textContent.includes("1-32"),
    );
    await host.keyboard.press("Escape");
    assert.equal(
      await host.evaluate(() => __arena.garage.presets[1].name),
      "Circuit One",
    );
    await host.locator('[data-delete="0"]').click();
    assert.equal(await host.evaluate(() => __arena.garage.presets.length), 3);
    await host.locator("#preset-cancel").click();
    await host.reload();
    await host.waitForFunction(() => window.__arena);
    await host.locator("#garage-open").click();
    assert.equal(
      await host.locator('[data-equip="1"]').textContent(),
      "Circuit One",
    );
    // Simulated Gamepad API buttons use the real shared menu navigator.
    async function button(p, index) {
      await p.evaluate(
        (index) => (pad.buttons[index] = { pressed: true, value: 1 }),
        index,
      );
      await p.waitForTimeout(240);
      await p.evaluate(
        (index) => (pad.buttons[index] = { pressed: false, value: 0 }),
        index,
      );
      await p.waitForTimeout(160);
    }
    await host.locator('[data-delete="2"]').click();
    await button(host, 0);
    await host.waitForFunction(
      () => !document.querySelector(".preset-dialog").open,
    );
    assert.equal(
      await host.evaluate(() => __arena.garage.presets.length),
      3,
      "controller confirm defaults to Cancel",
    );
    await host.locator('[data-delete="2"]').click();
    await button(host, 15);
    await button(host, 15);
    await host.waitForFunction(
      () => document.activeElement?.id === "preset-confirm",
    );
    await button(host, 0);
    await host.waitForFunction(() => __arena.garage.presets.length === 2);
    assert.deepEqual(
      await host.evaluate(() => __arena.garage.presets.map((p) => p.id)),
      original.slice(0, 2),
    );
    assert.ok(
      await host.evaluate(() =>
        __arena.garage.presets.some((p) => p.id === __arena.garage.selected),
      ),
    );
    await host.locator('[data-delete="1"]').click();
    await host.locator("#preset-confirm").click();
    assert.ok(await host.locator('[data-delete="0"]').isDisabled());
    await host.locator("#garage-back").click();
    await host.locator("#play").click();
    await host.locator("#bot-mode").click();
    await host.locator("#bot-mutators").click();
    const botDialog = host.locator(".mutators-panel[open]");
    assert.equal(await botDialog.locator(".mutator-row").count(), 9);
    await button(host, 0);
    await button(host, 15);
    await host.waitForFunction(
      () => __arena.botSetup.mutators.matchLength === "10 MINUTES",
    );
    await button(host, 13);
    await host.waitForFunction(
      () => document.activeElement?.dataset.mutator === "boostAmount",
    );
    await button(host, 15);
    await host.waitForFunction(
      () => __arena.botSetup.mutators.boostAmount === "NO BOOST",
    );
    await botDialog.locator("[data-reset]").click();
    await host.waitForFunction(
      () => __arena.botSetup.mutators.matchLength === "5 MINUTES",
    );
    async function cycle(dialog, key, value) {
      for (let i = 0; i < 6; i++) {
        if (
          (await dialog.locator('[data-value="' + key + '"]').textContent()) ===
          value
        )
          return;
        await dialog
          .locator('[data-key="' + key + '"][data-step=next]')
          .click();
      }
      throw Error("Could not select " + key + " " + value);
    }
    for (const size of [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 520, height: 600 },
    ]) {
      await host.setViewportSize(size);
      const layout = await botDialog.evaluate((panel) => {
        const grid = panel.querySelector(".mutators-rows"),
          r = grid.getBoundingClientRect();
        return {
          scroll:
            grid.scrollHeight > grid.clientHeight + 1 ||
            grid.scrollWidth > grid.clientWidth + 1,
          bounds: { x: r.x, y: r.y, right: r.right, bottom: r.bottom },
          rows: [...panel.querySelectorAll(".mutator-row")].map((row) => {
            const b = row.getBoundingClientRect();
            return { x: b.x, y: b.y, right: b.right, bottom: b.bottom };
          }),
          footer: panel.querySelector("footer").getBoundingClientRect().bottom,
        };
      });
      assert.equal(
        layout.scroll,
        false,
        "all nine mutators fit without scrolling",
      );
      assert.equal(layout.rows.length, 9);
      assert.ok(
        layout.rows[5].x > layout.rows[0].right,
        "mutators form two side-by-side lists",
      );
      assert.ok(
        Math.abs(layout.rows[5].y - layout.rows[0].y) < 1,
        "both lists start at the same height",
      );
      for (const row of layout.rows)
        assert.ok(
          row.y >= layout.bounds.y - 1 &&
            row.bottom <= layout.bounds.bottom + 1,
        );
      assert.ok(layout.footer <= size.height, "footer remains visible");
    }
    await host.setViewportSize({ width: 1280, height: 720 });
    await cycle(botDialog, "gravity", "LOW");
    await cycle(botDialog, "ballSize", "GIGANTIC");
    await cycle(botDialog, "boostAmount", "UNLIMITED");
    await cycle(botDialog, "matchLength", "UNLIMITED");
    await host.screenshot({ path: ".tools/mutators-menu.png" });
    await botDialog.locator("[data-nav-back]").click();
    await host.locator("#bot-launch").click();
    await host.waitForFunction(
      () => __arena.match.phase === "playing" && !__arena.matchLoader.active,
    );
    assert.equal(await host.locator("#clock").textContent(), "UNLIMITED");
    const local = await host.evaluate(() => ({
      mutators: __arena.match.mutators,
      gravity: __arena.simulation.world.gravity.y,
      radius: __arena.simulation.ballCollider.radius(),
      scale: __arena.replayView.ball?.scale.x,
      boosts: __arena.simulation.cars.map((c) => c.boost),
    }));
    assert.equal(local.scale, 1.65);
    assert.equal(local.gravity, -3.25);
    assert.ok(local.boosts.every((b) => b === 100));
    assert.equal(local.mutators.ballSize, "GIGANTIC");
    // Play and leave a real configured local match: HOME must restore the world defaults.
    await host.evaluate(() => __arena.match.finish());
    await host.locator("#home").click();
    await host.waitForFunction(() => __arena.match.phase === "home");
    assert.equal(
      await host.evaluate(() => __arena.simulation.world.gravity.y),
      -6.5,
    );
    assert.equal(
      await host.evaluate(() => __arena.simulation.mutators.gravity),
      "DEFAULT",
    );
    await host.locator("#play").click();
    await host.locator("#freeplay-mode").click();
    await host.locator("#freeplay-launch").click();
    await host.waitForFunction(() => __arena.match.phase === "playing");
    assert.equal(
      await host.evaluate(() => __arena.simulation.mutators.ballSize),
      "DEFAULT",
    );
    await host.evaluate(() => __arena.match.finish());
    await host.locator("#home").click();
    console.log(
      "PASS garage dialogs/persistence/controller and local mutator UI/physics/default restoration",
    );
    const guest = await open("Guest");
    const guestRemembered = await guest.evaluate(() =>
      localStorage.getItem("octane-arena-mutators"),
    );
    await host.locator("#party-create").click();
    await host.waitForFunction(() => __arena.party.state);
    const code = await host.evaluate(() => __arena.party.state.code);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state?.members.length === 2 &&
          window.octaneArenaNetwork
            .diagnostics()
            .peers.every((p) => p.bidirectionalVerified),
      );
    await host.locator("#party-start").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state.stage === "mode" &&
          document.getElementById("party-flow").open,
      );
    await host.locator("#party-mutators").click();
    await guest.locator("#party-mutators").click();
    const hd = host.locator(".mutators-panel[open]"),
      gd = guest.locator(".mutators-panel[open]");
    assert.ok(await gd.locator("[data-reset]").isDisabled());
    assert.equal(await gd.locator("[data-step]:enabled").count(), 0);
    await button(guest, 0);
    for (let i = 0; i < 8; i++) await button(guest, 13);
    await guest.waitForFunction(
      () => document.activeElement?.dataset.mutator === "ballBounciness",
    );
    const guestRow = await gd
      .locator("[data-mutator=ballBounciness]")
      .boundingBox();
    assert.ok(
      guestRow.y + guestRow.height <= 720,
      "read-only rows remain visible with controller",
    );
    await cycle(hd, "gravity", "HIGH");
    await cycle(hd, "boostAmount", "NO BOOST");
    await cycle(hd, "airJumps", "3");
    await guest.waitForFunction(
      () =>
        __arena.party.state.mutators.gravity === "HIGH" &&
        document.querySelector(".mutators-panel[open] [data-value=gravity]")
          .textContent === "HIGH",
    );
    assert.equal(
      await guest.evaluate(() => localStorage.getItem("octane-arena-mutators")),
      guestRemembered,
      "host preferences do not overwrite guest local choices",
    );
    const denied = await guest.evaluate(() =>
      __arena.party.action("mutators", {
        mutators: { ...__arena.party.state.mutators, gravity: "LOW" },
      }),
    );
    assert.equal(denied, false);
    assert.equal(
      await host.evaluate(() => __arena.party.state.mutators.gravity),
      "HIGH",
    );
    await hd.locator("[data-nav-back]").click();
    await gd.locator("[data-nav-back]").click();
    await host.locator("#party-continue").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state.stage === "teams" &&
          document.getElementById("party-flow").open &&
          !__arena.matchLoader.active,
      );
    await host.locator('.party-team-join[data-team="0"]').click();
    await guest.locator('.party-team-join[data-team="1"]').click();
    await host.waitForFunction(() =>
      __arena.party.state.members.every((m) => m.team !== null),
    );
    await host.locator("#party-launch").click();
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "playing" &&
          __arena.networkView &&
          __arena.network.latest.tick > 100,
      );
    const states = await Promise.all(
      [host, guest].map((p) =>
        p.evaluate(() => ({
          config: __arena.network.latest.mutators,
          visualConfig: __arena.networkView.simulation.mutators,
          radius: __arena.networkView.simulation.ballCollider.radius(),
          scale: __arena.networkView.ball.scale.x,
          gravity: __arena.networkView.simulation.world.gravity.y,
          boosts: __arena.network.latest.cars.map((c) => c.boost),
          clock: document.getElementById("clock").textContent,
        })),
      ),
    );
    assert.deepEqual(states[0].config, states[1].config);
    for (const state of states) {
      assert.deepEqual(state.visualConfig, state.config);
      assert.equal(state.gravity, -9.75);
      assert.equal(state.scale, 1.65);
      assert.ok(state.boosts.every((b) => b === 0));
      assert.equal(state.clock, "UNLIMITED");
    }
    console.log(
      "PASS actual PeerJS party broadcast, host-only edits, immutable match launch configuration, native worker authority and synchronized size/gravity/boost/timer in two browser sessions",
    );
    await action(guest, "leave");
    await action(host, "leave");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
