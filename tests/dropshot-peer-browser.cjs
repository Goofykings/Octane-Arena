const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8275);
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
    const errors = [];
    async function open(name) {
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      ctx.setDefaultTimeout(60000);
      await ctx.addInitScript((name) => {
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
      }, name);
      const p = await ctx.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
      return p;
    }
    const host = await open("Dropshot Host"),
      guest = await open("Dropshot Guest"),
      watch = await open("Dropshot Watch");
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
    await action(host, "create");
    const code = await host.evaluate(() => __arena.party.state.code);
    await action(guest, "join", { code });
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state.members.length === 2 &&
          window.octaneArenaNetwork
            .diagnostics()
            .peers.every((p) => p.bidirectionalVerified),
      );
    await action(host, "stage", { stage: "mode" });
    assert.equal(await host.locator("#party-dropshot").count(), 0);
    // Select through the existing host-controlled gamemode carousel.
    for (let i = 0; i < 4; i++) {
      await host.waitForFunction(() => !__arena.party.busy);
      await host.locator('[data-cycle="gamemode"][data-direction="1"]').click();
      await host.waitForFunction(() => !__arena.party.busy);
    }
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          __arena.party.state.gameMode === "dropshot" &&
          __arena.party.state.mode === "3v3",
      );
    const denied = await guest.evaluate(async () => ({
      ok: await __arena.party.action("gamemode", { gameMode: "soccar" }),
      message: __arena.party.message,
    }));
    assert.equal(denied.ok, false, "host owns mode");
    await action(host, "mode", { mode: "2v2bots" });
    await action(host, "stage", { stage: "teams" });
    await action(host, "team", { team: 0 });
    await action(guest, "team", { team: 0 });
    await action(host, "launch");
    for (const p of [host, guest]) {
      await p.waitForFunction(
        () =>
          __arena.network.latest?.phase === "playing" &&
          __arena.networkView &&
          !__arena.matchLoader.active,
      );
      assert.deepEqual(
        await p.evaluate(() => [
          __arena.network.latest.gameMode,
          __arena.network.latest.arenaId,
          __arena.arena.mapId,
          __arena.networkView.ball.userData.dropshot,
          __arena.network.latest.pads.length,
        ]),
        ["dropshot", "dropshot", "dropshot", true, 0],
      );
    }
    // Real host worker + intermediate bot inputs generate actual floor damage.
    try {
      await guest.waitForFunction(
        () => (__arena.network.latest?.dropshot?.revision ?? 0) > 0,
      );
    } catch (error) {
      console.error(
        "No bot-generated floor damage:",
        await guest.evaluate(() => ({
          snapshot: __arena.network.latest,
          diagnostics: window.octaneArenaNetwork.diagnostics(),
        })),
      );
      throw error;
    }
    // Join after real damage occurred: the watcher never saw earlier tile events.
    await action(watch, "join", { code });
    await watch.waitForFunction(
      () =>
        __arena.network.latest?.gameMode === "dropshot" &&
        __arena.networkView?.spectator &&
        !__arena.matchLoader.active,
    );
    assert.equal(
      await watch.evaluate(
        () =>
          __arena.party.state.members.find(
            (m) => m.id === __arena.party.playerId,
          ).team,
      ),
      "spectator",
    );
    assert.equal(
      await watch.evaluate(() => __arena.network.latest.players.length),
      4,
      "Late viewer does not create a car",
    );
    await Promise.all(
      [host, guest, watch].map((p) =>
        p.waitForFunction(() => __arena.arena.dropshotTiles?.includes("1")),
      ),
    );
    const epoch = await host.evaluate(
      () => __arena.network.latest.dropshot.epoch,
    );
    for (const p of [guest, watch])
      assert.equal(
        await p.evaluate(() => __arena.network.latest.dropshot.epoch),
        epoch,
      );
    assert.ok(
      await watch.evaluate(
        () => __arena.network.latest.dropshot.lastTouchTeam !== null,
      ),
    );
    const hostId = await host.evaluate(() => __arena.party.playerId),
      initial = await guest.evaluate(
        (id) => __arena.network.latest.cars.find((c) => c.id === id).position.z,
        hostId,
      );
    await host.keyboard.down("w");
    await host.keyboard.down("Shift");
    await guest.waitForFunction(
      ({ id, z }) =>
        __arena.network.latest.cars.find((c) => c.id === id).position.z <
        z - 0.8,
      { id: hostId, z: initial },
    );
    await host.keyboard.up("w");
    await host.keyboard.up("Shift");
    await watch.waitForFunction(() => __arena.networkView.spectator);
    for (let i = 0; i < 4; i++) {
      await watch.evaluate(() => __arena.networkView.spectator.cycle(1));
      await watch.waitForTimeout(150);
      assert.ok(
        await watch.evaluate(() =>
          [
            ...__arena.camera.position.toArray(),
            ...__arena.camera.quaternion.toArray(),
          ].every(Number.isFinite),
        ),
      );
    }
    await watch.screenshot({ path: ".tools/dropshot-spectator.png" });
    await guest.screenshot({ path: ".tools/dropshot-party.png" });
    await action(guest, "leave");
    await host.waitForFunction(() => __arena.party.state.members.length === 2);
    await action(watch, "leave");
    await action(host, "leave");
    assert.deepEqual(errors, []);
    assert.equal(server.apiRequests(), 0);
    console.log(
      "PASS three isolated browsers over real PeerJS Cloud/WebRTC: host-only Dropshot selection, 3v3 default/flexible 2vBots, shared tile damage/charge/no-pads/jump-ball match, replicated input, late spectator full-state recovery/cameras and clean leave. Not a physical two-device NAT test.",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
