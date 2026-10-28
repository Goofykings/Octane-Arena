const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8285);
  const signaling = process.env.PEER_TEST_MODULE
    ? await require("./local-peer-server.cjs").localPeer()
    : null;
  let browser;
  const results = [],
    errors = [];
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
      const context = await browser.newContext({
        viewport: { width: 960, height: 540 },
      });
      context.setDefaultTimeout(90000);
      await context.addInitScript((name) => {
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        );
        localStorage.setItem(
          "octane-arena-profile",
          JSON.stringify({
            profileVersion: 1,
            localPlayerId: crypto.randomUUID(),
            name,
            avatarId: "helmet",
          }),
        );
        document.hasFocus = () => true;
        Object.defineProperty(document, "hidden", { get: () => false });
      }, name);
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      if (process.env.PEER_TRACE)
        p.on("console", (m) => console.log(name, m.text()));
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
      if (signaling)
        await p.evaluate((port) => {
          __arena.party.transport.options = {
            host: "127.0.0.1",
            port,
            path: "/peer",
            secure: false,
            debug: 0,
            config: { iceServers: [] },
          };
        }, signaling.port);
      return p;
    }
    const host = await open("Smooth Host"),
      guest = await open("Smooth Guest"),
      watch = await open("Smooth Watch");
    async function action(p, name, data = {}) {
      await p.waitForFunction(() => !__arena.party.busy);
      const result = await p.evaluate(
        async ({ name, data }) => ({
          ok: await __arena.party.action(name, data),
          message: __arena.party.message,
        }),
        { name, data },
      );
      if (!result.ok)
        console.log(
          "JOIN DIAGNOSTICS",
          await p.evaluate(() => ({
            diagnostics: octaneArenaNetwork.diagnostics(),
            links: [...__arena.party.transport.links].map((l) => ({
              open: l.connection.open,
              state: l.connection.peerConnection?.connectionState,
              ice: l.connection.peerConnection?.iceConnectionState,
              motion: l.motion?.readyState,
            })),
            errors: __arena.party.message,
          })),
        );
      assert.ok(result.ok, name + ": " + result.message);
    }
    await action(host, "create");
    const code = await host.evaluate(() => __arena.party.state.code);
    await action(guest, "join", { code });
    await action(watch, "join", { code });
    for (const p of [host, guest, watch])
      await p.waitForFunction(
        () =>
          __arena.party.state.members.length === 3 &&
          octaneArenaNetwork
            .diagnostics()
            .peers.every((p) => p.bidirectionalVerified),
      );
    if (process.env.PEER_JOIN_ONLY) {
      console.log("PASS local WebRTC party join");
      return;
    }
    for (const [mode, format] of [
      ["soccar", "1v1"],
      ["soccar", "2v2bots"],
      ["heatseeker", "1v1"],
      ["hoops", "1v1"],
      ["dropshot", "2v2bots"],
      ["rumble", "1v1"],
    ]) {
      await action(host, "stage", { stage: "mode" });
      await action(host, "gamemode", { gameMode: mode });
      await action(host, "mode", { mode: format });
      await action(host, "stage", { stage: "teams" });
      await action(host, "team", { team: 0 });
      await action(guest, "team", { team: format === "2v2bots" ? 0 : 1 });
      await action(watch, "team", { team: "spectator" });
      await action(host, "launch");
      for (const p of [host, guest, watch])
        await p.waitForFunction(
          () =>
            __arena.network.latest?.phase === "playing" &&
            __arena.networkView &&
            !__arena.matchLoader.active,
        );
      assert.equal(
        await guest.locator("#network-debug").count(),
        0,
        "Diagnostics overlay disabled by default",
      );
      await guest.evaluate(() =>
        __arena.network.testNetwork.configure({
          latencyMs: 60,
          jitterMs: 18,
          loss: 0.06,
        }),
      );
      await host.evaluate(() => {
        __arena.input.keys.add(__arena.input.bindings.throttle);
        __arena.input.keys.add(__arena.input.bindings.boost);
      });
      await guest.evaluate(() => {
        __arena.input.keys.add(__arena.input.bindings.throttle);
        __arena.input.keys.add(__arena.input.bindings.boost);
      });
      // Collect actual per-render transforms, packet cadence, camera motion and boundedness.
      const profile = await guest.evaluate(
        () =>
          new Promise((resolve) => {
            const start = performance.now(),
              samples = [];
            const step = () => {
              const a = __arena,
                n = a.network,
                v = a.networkView;
              if (!v) return resolve({ error: "view disappeared" });
              const remote = v.simulation.cars.findIndex(
                  (c) => c.id !== a.party.playerId,
                ),
                p = v.cars[remote].position;
              samples.push({
                at: performance.now(),
                tick: n.latest.tick,
                x: p.x,
                y: p.y,
                z: p.z,
                bx: v.ball.position.x,
                by: v.ball.position.y,
                bz: v.ball.position.z,
                cam: a.camera.position.toArray(),
              });
              if (performance.now() - start < 2500) requestAnimationFrame(step);
              else
                resolve({
                  samples,
                  metrics: n.diagnostics(),
                  predicted: !!v.prediction,
                  pending: v.prediction?.pendingCount,
                  matchId: n.latest.matchId,
                  players: n.latest.players.length,
                  physicsBallEnabled: v.prediction?.simulation.ball.isEnabled(),
                  tiles: n.latest.dropshot?.revision,
                });
            };
            requestAnimationFrame(step);
          }),
      );
      if (profile.metrics?.snapshotReceiveHz <= 10) {
        fs.writeFileSync(".tools/network-acceptance-failure.json",JSON.stringify(profile,null,2));
        console.log("LOW RATE", JSON.stringify(profile.metrics));
        console.log("HOST", await host.evaluate(()=>({metrics:octaneArenaNetwork.diagnostics(),status:__arena.network.status,phase:__arena.network.latest.phase,tick:__arena.network.latest.tick,contacts:__arena.network.latest.contacts})));
      }
      assert.ok(!profile.error, profile.error);
      assert.ok(profile.samples.length > 15, "Render loop advances");
      assert.ok(
        profile.metrics.snapshotReceiveHz > 10,
        "Live motion packets received",
      );
      assert.ok(profile.metrics.bufferLength <= 32);
      assert.ok(profile.predicted);
      assert.ok(
        Number.isFinite(profile.metrics.correctionRotationRadians),
        "Finite reconciliation rotation",
      );
      assert.equal(
        profile.physicsBallEnabled,
        true,
        "Speculative collision ball is enabled",
      );
      const channels = await guest.evaluate(
        () => octaneArenaNetwork.diagnostics().peers,
      );
      assert.ok(
        channels.every(
          (p) =>
            p.channels.state === "open" &&
            p.motionOrdered === false &&
            p.motionMaxRetransmits === 0,
        ),
        "Motion channel is unordered with no retries",
      );
      const movement = profile.samples.slice(1).map((s, i) => ({
        same: s.tick === profile.samples[i].tick,
        distance: Math.hypot(
          s.x - profile.samples[i].x,
          s.y - profile.samples[i].y,
          s.z - profile.samples[i].z,
        ),
      }));
      const betweenPackets = movement.filter(
        (s) => s.same && s.distance > 1e-6,
      ).length;
      const ballBetweenPackets = profile.samples
        .slice(1)
        .filter(
          (s, i) =>
            s.tick === profile.samples[i].tick &&
            Math.hypot(
              s.bx - profile.samples[i].bx,
              s.by - profile.samples[i].by,
              s.bz - profile.samples[i].bz,
            ) > 1e-6,
        ).length;
      if (profile.metrics.renderFPS > 40) {
        assert.ok(
          betweenPackets > 5,
          "Remote car moves between packet arrivals",
        );
        if (["hoops", "dropshot", "heatseeker"].includes(mode))
          assert.ok(
            ballBetweenPackets > 5,
            "Ball moves between packet arrivals",
          );
      }

      if (format === "2v2bots")
        assert.equal(
          profile.players,
          4,
          "Bots use independent host transforms",
        );
      const spectator = await watch.evaluate(() => ({
        hasPrediction: !!__arena.networkView.prediction,
        hasCamera: !!__arena.networkView.spectator,
        finite: __arena.camera.position.toArray().every(Number.isFinite),
        match: __arena.network.latest.matchId,
      }));
      assert.equal(spectator.hasPrediction, false);
      assert.ok(spectator.hasCamera && spectator.finite);
      assert.equal(spectator.match, profile.matchId);
      await host.evaluate(() => __arena.input.clear());
      await guest.evaluate(() => __arena.input.clear());
      await guest.evaluate(() => __arena.network.testNetwork.configure({}));
      results.push({
        mode,
        format,
        samples: profile.samples.length,
        betweenPackets,
        ballBetweenPackets,
        ...profile.metrics,
      });
      console.log(
        "PASS PeerJS",
        mode,
        format,
        JSON.stringify({
          samples: profile.samples.length,
          betweenPackets,
          ballBetweenPackets,
          receiveHz: profile.metrics.snapshotReceiveHz,
          renderFPS: profile.metrics.renderFPS,
          jitter: profile.metrics.jitterMs,
        }),
      );
      await action(host, "rtc-end", {
        matchId: profile.matchId,
        reason: "disconnect",
      });
      for (const p of [host, guest, watch])
        await p.waitForFunction(() => __arena.party.state.stage !== "match");
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      ".tools/network-peer-browser.json",
      JSON.stringify(results, null, 2),
    );
    console.log(
      "PASS production PeerJS host/guest/spectator, 1v1/2v2 bots, all five modes, artificial jitter/loss, disabled debug overlay, prediction isolation and cleanup",
    );
  } finally {
    await browser?.close();
    await server.close();
    await signaling?.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
