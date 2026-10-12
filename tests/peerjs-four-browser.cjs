const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8195);
  let browser;
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
    const pages = [],
      errors = [];
    for (let i = 0; i < 4; i++) {
      const c = await browser.newContext({
        viewport: { width: 1000, height: 650 },
      });
      c.setDefaultTimeout(60000);
      await c.addInitScript((i) => {
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name: "Peer " + i,
            avatarId: "helmet",
          }),
        );
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
      }, i);
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
      pages.push(p);
    }
    const host = pages[0],
      action = async (p, name, data = {}) => {
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
    for (const p of pages.slice(1)) await action(p, "join", { code });
    for (const p of pages)
      await p.waitForFunction(
        () =>
          window.__arena.party.state.members.length === 4 &&
          window.octaneArenaNetwork
            .diagnostics()
            .peers.every((p) => p.bidirectionalVerified),
      );
    assert.equal(
      await host.evaluate(
        () => window.octaneArenaNetwork.diagnostics().peers.length,
      ),
      3,
    );
    for (const p of pages.slice(1))
      assert.equal(
        await p.evaluate(
          () => window.octaneArenaNetwork.diagnostics().peers.length,
        ),
        1,
      );
    const ids = await Promise.all(
      pages.map((p) => p.evaluate(() => window.__arena.party.playerId)),
    );
    assert.equal(new Set(ids).size, 4);
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "2v2" });
    await action(host, "gamemode", { gameMode: "heatseeker" });
    await action(host, "stage", { stage: "teams" });
    for (let i = 0; i < 4; i++)
      await action(pages[i], "team", { team: i < 2 ? 0 : 1 });
    await action(pages[1], "ready", { ready: true });
    for (const p of pages)
      await p.waitForFunction(
        (id) =>
          window.__arena.party.state.members.find((m) => m.id === id).ready,
        ids[1],
      );
    await action(host, "launch");
    for (const p of pages)
      await p.waitForFunction(
        () =>
          window.__arena.network.latest?.phase === "playing" &&
          window.__arena.network.latest.cars.length === 4,
      );
    const snapshot = await host.evaluate(() => window.__arena.network.latest);
    await pages[2].evaluate(() =>
      window.__arena.party.transport.peer.disconnect(),
    );
    await pages[2].waitForFunction(
      () =>
        window.__arena.party.transport.peer.open &&
        !window.__arena.party.transport.peer.disconnected &&
        window.__arena.party.message === "CONNECTED",
    );
    assert.equal(
      await pages[2].evaluate(() => window.__arena.network.latest.matchId),
      snapshot.matchId,
      "Signaling reconnect keeps the active match",
    );
    assert.ok(
      await pages[2].evaluate(
        (tick) => window.__arena.network.latest.tick > tick,
        snapshot.tick,
      ),
      "Gameplay snapshots continue while signaling reconnects",
    );
    for (const p of pages) {
      const s = await p.evaluate(() => window.__arena.network.latest);
      assert.equal(s.matchId, snapshot.matchId);
      assert.equal(s.arenaId, snapshot.arenaId);
      assert.equal(s.gameMode, "heatseeker");
      assert.deepEqual(s.players.map((p) => p.id).sort(), ids.slice().sort());
    }
    await host.bringToFront();
    await host.keyboard.down("KeyW");
    await host.keyboard.down("ShiftLeft");
    for (let i = 0; i < 420; i++) {
      if (
        await host.evaluate(
          (id) =>
            window.__arena.network.latest.stats.find((s) => s.playerId === id)
              .touches > 0,
          ids[0],
        )
      )
        break;
      await host.evaluate(() => {
        const a = window.__arena,
          s = a.network.latest,
          c = s.cars.find((c) => c.id === a.party.playerId),
          q = c.rotation,
          dx = s.ball.position.x - c.position.x,
          dz = s.ball.position.z - c.position.z,
          fx = -2 * (q.x * q.z + q.y * q.w),
          fz = -(1 - 2 * (q.x * q.x + q.y * q.y)),
          rx = 1 - 2 * (q.y * q.y + q.z * q.z),
          rz = 2 * (q.x * q.z - q.y * q.w),
          e = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
        a.input.keys.delete(a.input.bindings.left);
        a.input.keys.delete(a.input.bindings.right);
        if (Math.abs(e) > 0.06)
          a.input.keys.add(
            e > 0 ? a.input.bindings.right : a.input.bindings.left,
          );
      });
      await host.waitForTimeout(80);
    }
    await host.keyboard.up("KeyW");
    await host.keyboard.up("ShiftLeft");
    await host.evaluate(() => window.__arena.input.clear());
    for (const p of pages)
      await p.waitForFunction(
        (id) =>
          window.__arena.network.latest.stats.find((s) => s.playerId === id)
            .touches > 0,
        ids[0],
      );
    for (const p of pages)
      await p.waitForFunction(
        () =>
          window.__arena.network.latest.score[0] +
            window.__arena.network.latest.score[1] >
          0,
      );
    const scored = await host.evaluate(
      () => window.__arena.network.latest.score,
    );
    for (const p of pages)
      await p.waitForFunction(
        (score) =>
          JSON.stringify(window.__arena.network.latest.score) ===
          JSON.stringify(score),
        scored,
      );
    for (const p of pages)
      await p.waitForFunction(
        () =>
          window.__arena.network.latest.phase === "replay" &&
          window.__arena.network.replayClip,
      );
    const replay = await host.evaluate(
      () => window.__arena.network.replayClip.goal.id,
    );
    for (const p of pages)
      assert.equal(
        await p.evaluate(() => window.__arena.network.replayClip.goal.id),
        replay,
      );
    for (const p of pages)
      assert.ok(
        await p.evaluate(() => {
          const c = window.__arena.network.replayClip;
          return (
            Math.abs(c.end - c.goal.time - 1) < 1e-7 &&
            c.events.filter((e) => e.kind === "goal").length === 1
          );
        }),
        "All peers receive the same full post-goal capture",
      );
    for (const p of pages)
      await p.evaluate(() => window.__arena.network.skipReplay());
    for (const p of pages)
      await p.waitForFunction(
        () => window.__arena.network.latest.phase === "countdown",
      );
    for (const p of pages)
      assert.deepEqual(
        await p.evaluate(() => window.__arena.network.latest.score),
        scored,
      );
    await action(pages[3], "leave");
    for (const p of pages.slice(0, 3))
      await p.waitForFunction(
        () =>
          window.__arena.party.state.members.length === 3 &&
          window.__arena.party.state.stage === "teams",
      );
    assert.equal(
      await host.evaluate(
        () => window.octaneArenaNetwork.diagnostics().peers.length,
      ),
      2,
    );
    await action(host, "leave");
    for (const p of pages.slice(1, 3))
      await p.waitForFunction(() => !window.__arena.party.state);
    assert.equal(server.apiRequests(), 0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS real PeerJS Cloud four-context star topology, roster/team/ready/setup, shared arena/Heatseeker authority, live input/contact/stats, synchronized goal and chunked replay, four-human skip/kickoff, disconnect cleanup and no backend",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
