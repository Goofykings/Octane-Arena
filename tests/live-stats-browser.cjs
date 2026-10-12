const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  { resolve } = require("node:path"),
  { pathToFileURL } = require("node:url");
(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app, partyMatches } = await startLan(8112, ":memory:", {
    matchTransport: "server",
  });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const errors = [];
    const open = async () => {
      const c = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      await c.addInitScript(() => {
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name: "Same",
            avatarId: "helmet",
          }),
        );
      });
      const p = await c.newPage();
      p.setDefaultTimeout(45000);
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto("http://127.0.0.1:8112/?test");
      await p.waitForFunction(() => window.__arena);
      return p;
    };
    const local = await open();
    assert.equal(
      await local.evaluate(
        () =>
          window.__arena.simulation.players[0].id ===
          window.__arena.simulation.cars[0].id,
      ),
      true,
      "Local profile UUID is assigned to both roster and car",
    );
    await local.locator("#play").click();
    await local.locator("#bot-mode").click();
    await local.waitForFunction(() => window.__arena.match.phase === "playing");
    const localId = await local.evaluate(
      () => window.__arena.simulation.cars[0].id,
    );
    await local.keyboard.down("Tab");
    await local.locator("#match-board").waitFor({ state: "visible" });
    const style = await local.locator("#match-board").evaluate((e) => ({
      background: getComputedStyle(e).backgroundColor,
      radius: getComputedStyle(e).borderRadius,
    }));
    assert.match(style.background, /0\.76/);
    assert.equal(style.radius, "12px");
    await local.evaluate(() => {
      const s = window.__arena.simulation;
      s.cars[1].body.setEnabled(false);
      s.cars[0].reset(0, -32, 0);
      s.cars[0].body.setLinvel({ x: 0, y: 0, z: -10 }, true);
      s.ball.setTranslation({ x: 0, y: 0.975, z: -35 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      s.ballPose.snap();
    });
    await local.keyboard.down("KeyW");
    await local.waitForFunction(
      (id) => window.__arena.match.stats.players.get(id).goals === 1,
      localId,
    );
    await local.keyboard.up("KeyW");
    await local.waitForFunction(
      (id) =>
        Number(
          document.querySelector(`[data-player="${id}"] span:nth-child(3)`)
            .textContent,
        ) === 1,
      localId,
    );
    assert.ok(
      await local.evaluate(
        (id) =>
          window.__arena.match.stats.players.get(id).touches > 0 &&
          window.__arena.match.stats.players.get(id).shots > 0,
        localId,
      ),
    );
    const total = await local.evaluate(
      (id) => window.__arena.match.stats.players.get(id).score,
      localId,
    );
    assert.ok(total >= 112);
    assert.equal(
      Number(
        await local
          .locator(`#match-board [data-player="${localId}"] span`)
          .nth(1)
          .textContent(),
      ),
      total,
      "Open scoreboard rerenders live goal/touch/shot totals",
    );
    assert.equal(
      await local
        .locator('#match-board [data-team="0"] header strong')
        .textContent(),
      "1",
    );
    await local.keyboard.up("Tab");
    await local.locator("#match-board").waitFor({ state: "hidden" });
    await local.waitForFunction(() => window.__arena.match.phase === "replay");
    assert.equal(
      await local.evaluate(
        (id) => window.__arena.match.stats.players.get(id).score,
        localId,
      ),
      total,
    );
    await local.keyboard.press("Space");
    await local.waitForFunction(() => window.__arena.match.phase === "playing");
    assert.equal(
      await local.evaluate(
        (id) => window.__arena.match.stats.players.get(id).score,
        localId,
      ),
      total,
      "Kickoff preserves totals",
    );
    await local.evaluate(() => {
      const s = window.__arena.simulation;
      s.cars[0].reset(0, 45, 0);
      s.cars[0].body.setLinvel({ x: 0, y: 0, z: -8 }, true);
      s.ball.setTranslation({ x: 0, y: 0.975, z: 42 }, true);
      s.ball.setLinvel({ x: 0, y: 0, z: 15 }, true);
      s.ballPose.snap();
    });
    await local.waitForFunction(
      (id) => window.__arena.match.stats.players.get(id).saves === 1,
      localId,
    );
    assert.equal(await local.locator("#match-board").isVisible(), false);
    await local.keyboard.down("Tab");
    await local.locator("#match-board").waitFor({ state: "visible" });
    await local.waitForFunction(
      (id) =>
        document.querySelector(`[data-player="${id}"] span:nth-child(5)`)
          .textContent === "1",
      localId,
    );
    assert.ok(
      Number(
        await local
          .locator(`#match-board [data-player="${localId}"] span`)
          .nth(1)
          .textContent(),
      ) >=
        total + 52,
      "Hidden-board save is present on reopen",
    );
    await local.keyboard.up("Tab");
    await local.context().close();

    const host = await open(),
      guest = await open(),
      pages = [host, guest];
    const action = async (p, name, data = {}) => {
      await p.waitForFunction(() => !window.__arena.party.busy);
      const r = await p.evaluate(
        async ({ name, data }) => ({
          ok: await window.__arena.party.action(name, data),
          message: window.__arena.party.message,
        }),
        { name, data },
      );
      assert.equal(r.ok, true, r.message);
    };
    await action(host, "create");
    const code = await host.evaluate(() => window.__arena.party.state.code);
    await action(guest, "join", { code });
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "2v2bots" });
    await action(host, "launch");
    for (const p of pages)
      await p.waitForFunction(
        () => window.__arena.network.latest?.phase === "playing",
      );
    const hostId = await host.evaluate(() => window.__arena.party.playerId),
      guestId = await guest.evaluate(() => window.__arena.party.playerId);
    const game = partyMatches.matches.get(code),
      s = game.simulation,
      m = game.match;
    const car = s.cars.find((c) => c.id === hostId),
      teammate = s.cars.find((c) => c.id === guestId);
    s.cars.filter((c) => c.team === 1).forEach((c) => c.body.setEnabled(false));
    await host.bringToFront();
    await host.keyboard.down("Tab");
    await host.locator("#match-board").waitFor({ state: "visible" });
    car.reset(0, -15, 0);
    car.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
    teammate.reset(25, 20, 0);
    s.ball.setTranslation({ x: 0, y: 0.975, z: -18 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    s.ballPose.snap();
    await host.waitForFunction(
      (id) =>
        window.__arena.network.latest.stats.find((p) => p.playerId === id)
          .touches > 0,
      hostId,
    );
    const passScore = m.stats.players.get(hostId).score,
      b = s.ball.translation();
    car.reset(25, 15, 0);
    teammate.reset(b.x, b.z + 1.65, 0, b.y);
    teammate.body.setLinvel({ x: 0, y: 0, z: -16 }, true);
    for (const p of pages)
      await p.waitForFunction(
        (id) =>
          window.__arena.network.latest.stats.find((s) => s.playerId === id)
            .goals === 1,
        guestId,
      );
    assert.equal(m.stats.players.get(hostId).assists, 1);
    assert.equal(m.stats.players.get(hostId).score, passScore + 50);
    for (const p of pages) {
      await p.bringToFront();
      await p.keyboard.down("Tab");
      await p.locator("#match-board").waitFor({ state: "visible" });
      await p.waitForFunction(
        ({ hostId, guestId }) =>
          document.querySelector(`[data-player="${hostId}"] span:nth-child(4)`)
            ?.textContent === "1" &&
          document.querySelector(`[data-player="${guestId}"] span:nth-child(3)`)
            ?.textContent === "1",
        { hostId, guestId },
      );
      assert.equal(
        await p
          .locator('#match-board [data-team="0"] header strong')
          .textContent(),
        "1",
      );
      await p.keyboard.up("Tab");
    }
    const accumulated = m.stats.snapshot().map(({ ping, ...v }) => v);
    await host.waitForFunction(
      () => window.__arena.network.latest.phase === "replay",
    );
    assert.deepEqual(
      m.stats.snapshot().map(({ ping, ...v }) => v),
      accumulated,
    );
    m.kickoff(s);
    await host.waitForFunction(
      () => window.__arena.network.latest.phase === "playing",
    );
    assert.deepEqual(
      m.stats.snapshot().map(({ ping, ...v }) => v),
      accumulated,
    );
    car.reset(0, 45, 0);
    car.body.setLinvel({ x: 0, y: 0, z: -8 }, true);
    teammate.reset(25, 20, 0);
    s.ball.setTranslation({ x: 0, y: 0.975, z: 42 }, true);
    s.ball.setLinvel({ x: 0, y: 0, z: 15 }, true);
    s.ballPose.snap();
    for (const p of pages)
      await p.waitForFunction(
        (id) =>
          window.__arena.network.latest.stats.find((s) => s.playerId === id)
            .saves === 1,
        hostId,
      );
    for (const p of pages) {
      await p.bringToFront();
      await p.keyboard.down("Tab");
      await p.waitForFunction(
        (id) =>
          document.querySelector(`[data-player="${id}"] span:nth-child(5)`)
            .textContent === "1",
        hostId,
      );
      await p.keyboard.up("Tab");
    }
    await host.bringToFront();
    await host.keyboard.down("Tab");
    await host.locator("#match-board").waitFor({ state: "visible" });
    await host.screenshot({ path: "docs/live-scoreboard-rounded.png" });
    await host.keyboard.up("Tab");
    m.start(s, "network");
    for (const p of pages)
      await p.waitForFunction(
        () => window.__arena.network.latest.stats.every((s) => s.score === 0),
        null,
        { timeout: 30000 },
      );
    assert.deepEqual(errors, []);
    console.log(
      "PASS UUID boot identity, local physical touch/shot/goal/save, live open/closed scoreboard, translucent rounded container, real server pass/assist/goal/save synchronized by ID to both clients with duplicate names, replay/kickoff preservation and new-match reset",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
