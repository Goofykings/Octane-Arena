const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const { startLan } = await import(
    pathToFileURL(resolve("server/dist/server/src/lan.js")).href
  );
  const { app, partyMatches } = await startLan(8102, ":memory:", {
    matchTransport: "webrtc",
    stunUrls: [],
  });
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const errors = [],
      sockets = [];
    const open = async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      context.setDefaultTimeout(30000);
      await context.addInitScript(() =>
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        ),
      );
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("websocket", (socket) => sockets.push(socket.url()));
      await p.goto("http://127.0.0.1:8102/?test");
      await p.waitForFunction(
        () =>
          window.__arena?.party.connection === "connected" &&
          !window.__arena.party.busy,
      );
      await p.evaluate(() => {
        window.qaRender = window.__arena.graphics.render;
        window.__arena.graphics.render = () => {};
      });
      return p;
    };
    const action = async (p, name, data = {}) => {
      for (let i = 0; i < 15; i++) {
        await p.waitForFunction(() => !window.__arena.party.busy);
        const result = await p.evaluate(
          async ({ name, data }) => {
            const party = window.__arena.party;
            if (party.busy) return null;
            return {
              ok: await party.action(name, data),
              message: party.message,
            };
          },
          { name, data },
        );
        if (!result) continue;
        assert.equal(result.ok, true, result.message);
        return;
      }
      throw Error("Party stayed busy");
    };
    const host = await open(),
      guest = await open();
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state?.code);
    const code = await host.evaluate(() => window.__arena.party.state.code);
    assert.equal(
      await host.evaluate(() => window.__arena.party.state.transport),
      "webrtc",
    );
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator("#party-join button[type=submit]").click();
    const ids = [
      await host.evaluate(() => window.__arena.party.playerId),
      await guest.evaluate(() => window.__arena.party.playerId),
    ];
    await host.waitForFunction(
      (id) => window.__arena.network.rtc.ready(id),
      ids[1],
    );
    await guest.waitForFunction(
      (id) => window.__arena.network.rtc.ready(id),
      ids[0],
    );
    console.log(
      "PASS actual browser WebRTC channels connect through existing Create/Join Party",
    );
    const launch = async (pages, mode, teams) => {
      await action(host, "stage", { stage: "mode" });
      await action(host, "mode", { mode });
      await action(host, "stage", { stage: "teams" });
      for (let i = 0; i < pages.length; i++)
        await action(pages[i], "team", { team: teams[i] });
      await action(host, "launch");
      for (const p of pages)
        await p.waitForFunction(
          () => window.__arena.network.latest?.phase === "playing",
          null,
          { polling: 50, timeout: 45000 },
        );
      const matchId = await host.evaluate(
        () => window.__arena.network.latest.matchId,
      );
      for (const p of pages)
        assert.equal(
          await p.evaluate(() => window.__arena.network.latest.matchId),
          matchId,
        );
      assert.equal(partyMatches.matches.size, 0);
      assert.deepEqual(
        sockets,
        [],
        "WebRTC matches must not silently use the server WebSocket transport",
      );
      return matchId;
    };
    await launch([host, guest], "1v1", [0, 1]);
    const pose = await host.evaluate(
      (id) =>
        window.__arena.network.latest.cars.find((c) => c.id === id).position,
      ids[0],
    );
    await host.bringToFront();
    await host.keyboard.down("KeyW");
    await host.keyboard.down("ShiftLeft");
    await host.waitForTimeout(1000);
    await host.keyboard.up("ShiftLeft");
    await host.keyboard.up("KeyW");
    await guest.waitForFunction(
      ({ id, pose }) => {
        const car = window.__arena.network.latest.cars.find((c) => c.id === id);
        return (
          Math.hypot(car.position.x - pose.x, car.position.z - pose.z) > 2 &&
          car.boost < 33
        );
      },
      { id: ids[0], pose },
    );
    const remotePose = await guest.evaluate(
      (id) =>
        window.__arena.network.latest.cars.find((c) => c.id === id).position,
      ids[1],
    );
    await guest.bringToFront();
    await guest.keyboard.down("KeyW");
    await guest.keyboard.down("KeyA");
    await guest.waitForTimeout(1000);
    await guest.keyboard.up("KeyW");
    await guest.keyboard.up("KeyA");
    await host.waitForFunction(
      ({ id, pose }) => {
        const p = window.__arena.network.latest.cars.find(
          (c) => c.id === id,
        ).position;
        return Math.hypot(p.x - pose.x, p.z - pose.z) > 2;
      },
      { id: ids[1], pose: remotePose },
    );
    for (const p of [host, guest])
      await p.waitForFunction(
        () => window.__arena.network.snapshots.length >= 8,
      );
    const a = await host.evaluate(() => window.__arena.network.snapshots),
      b = await guest.evaluate(() => window.__arena.network.snapshots);
    const common = a.find((s) => b.some((t) => t.tick === s.tick));
    assert.ok(common, "Peers must share authoritative ticks");
    const remote = b.find((s) => s.tick === common.tick);
    for (const key of [
      "cars",
      "ball",
      "pads",
      "score",
      "phase",
      "arenaId",
      "kickoffFormationId",
    ])
      assert.deepEqual(
        JSON.parse(JSON.stringify(remote[key])),
        JSON.parse(JSON.stringify(common[key])),
      );
    console.log(
      "PASS host worker 120-Hz 1v1 authority, independent controls/boost, common ball/pads/score/kickoff and identical shared ticks",
    );
    await guest.evaluate(() => {
      const peers = window.__arena.network.rtc,
        receive = peers.onData;
      peers.onData = (id, data) => {
        if (data.type === "replay") window.qaReplay = data;
        receive(id, data);
      };
    });
    const replaySize = await host.evaluate((id) => {
      const a = window.__arena,
        s = a.network.latest,
        count = 600,
        padCount = s.pads.length,
        stride = 14 + s.cars.length * 52 + padCount;
      const data = {
        type: "replay",
        matchId: s.matchId,
        clip: {
          goal: {
            id: crypto.randomUUID(),
            time: 5,
            scorerId: a.party.playerId,
            team: 0,
            ownGoal: false,
            lastTouchId: a.party.playerId,
            touchTime: 4,
            ballSpeed: 20,
            focus: { x: 0, y: 1, z: 50 },
          },
          carIds: s.cars.map((c) => c.id),
          padCount,
          stride,
          count,
          start: 0,
          end: 5,
          events: [],
          times: Array.from({ length: count }, (_, i) => i / 120),
          frames: Array.from(
            { length: count * stride },
            (_, i) => Math.sin(i) * 20,
          ),
        },
      };
      a.network.rtc.sendReplay(id, data);
      return data.clip.frames.length;
    }, ids[1]);
    await guest.waitForFunction(() => !!window.qaReplay, null, {
      timeout: 45000,
      polling: 50,
    });
    assert.equal(
      await guest.evaluate(() => window.qaReplay.clip.frames.length),
      replaySize,
    );
    assert.equal(
      await guest.evaluate(() => window.__arena.network.latest.phase),
      "playing",
    );
    console.log(
      "PASS large reliable replay transfer while live snapshots continue",
    );
    const beforeTick = await guest.evaluate(
      () => window.__arena.network.latest.tick,
    );
    await host.evaluate(
      (id) => window.__arena.network.rtc.peers.get(id).pc.close(),
      ids[1],
    );
    await host.waitForFunction(
      (id) => window.__arena.network.rtc.ready(id),
      ids[1],
      { timeout: 30000 },
    );
    await guest.waitForFunction(
      (tick) => window.__arena.network.latest?.tick > tick + 120,
      beforeTick,
      { polling: 50 },
    );
    console.log("PASS peer disconnect/reconnect resumes the same match");
    await action(guest, "leave");
    await host.waitForFunction(
      () =>
        window.__arena.party.state?.stage === "teams" &&
        !window.__arena.network.latest,
    );
    await action(host, "stage", { stage: "mode" });
    await action(guest, "join", { code });
    await launch([host, guest], "2v2bots", [0, 0]);
    const botIds = await host.evaluate(() =>
      window.__arena.network.latest.players
        .filter((p) => p.controller === "bot")
        .map((p) => p.id),
    );
    assert.equal(botIds.length, 2);
    assert.equal(
      await guest.evaluate(() => window.__arena.network.latest.cars.length),
      4,
    );
    await action(host, "rtc-end", {
      matchId: await host.evaluate(() => window.__arena.network.latest.matchId),
      reason: "finished",
    });
    await action(host, "return");
    await host.waitForFunction(() => !window.__arena.network.latest);
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "2v2" });
    const third = await open(),
      fourth = await open();
    for (const p of [third, fourth]) await action(p, "join", { code });
    await launch([host, guest, third, fourth], "2v2", [0, 0, 1, 1]);
    for (const p of [host, guest, third, fourth])
      assert.equal(
        await p.evaluate(
          () =>
            new Set(window.__arena.network.latest.cars.map((c) => c.id)).size,
        ),
        4,
      );
    assert.equal(
      await host.evaluate(() => window.__arena.network.rtc.peers.size),
      3,
    );
    assert.equal(
      await fourth.evaluate(() => window.__arena.network.rtc.peers.size),
      1,
    );
    await action(host, "leave");
    for (const p of [guest, third, fourth])
      await p.waitForFunction(
        () =>
          window.__arena.party.state?.stage === "teams" &&
          !window.__arena.network.latest,
      );
    assert.equal(
      await guest.evaluate(() => window.__arena.party.state.hostId),
      ids[1],
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS 2v2bots, four-browser 2v2, host-leave match cleanup/party host transfer, preserved roster IDs and no runtime errors",
    );
  } finally {
    if (browser) await browser.close();
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
