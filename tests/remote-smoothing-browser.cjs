const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const twoClients = process.env.OCTANE_TWO_CLIENTS === "1";
  const server = await staticGame(8292),
    signaling = await require("./local-peer-server.cjs").localPeer(9042);
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
    async function open(name, debug = false) {
      const context = await browser.newContext({
        viewport: { width: 480, height: 270 },
      });
      context.setDefaultTimeout(60000);
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
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(server.url + (debug ? "&netdebug" : ""));
      await page.waitForFunction(() => window.__arena);
      console.log("Opened", name);
      await page.evaluate(() => {
        __arena.party.transport.options = {
          host: "127.0.0.1",
          port: 9042,
          path: "/peer",
          secure: false,
          debug: 0,
          config: { iceServers: [] },
        };
      });
      // Software WebGL draws can starve the authority worker on CI. Auxiliary
      // clients keep updating physics, models and cameras but skip WebGL drawing.
      // The measured guest still renders every animation frame.
      if (!debug)
        await page.evaluate(() => {
          __arena.graphics.render = () => {};
        });
      return page;
    }
    const host = await open("Smooth Host"),
      guest = await open("Smooth Guest", true),
      watch = twoClients ? null : await open("Smooth Spectator");
    async function action(page, name, data = {}) {
      await page.waitForFunction(() => !__arena.party.busy);
      const r = await page.evaluate(
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
    if (watch) await action(watch, "join", { code });
    await action(host, "stage", { stage: "mode" });
    await action(host, "mode", { mode: "2v2bots" });
    await action(host, "stage", { stage: "teams" });
    await action(host, "team", { team: 0 });
    await action(guest, "team", { team: 0 });
    if (watch) await action(watch, "team", { team: "spectator" });
    await action(host, "launch");
    console.log("Launched PeerJS match");
    for (const page of [host, guest, ...(watch ? [watch] : [])])
      await page.waitForFunction(
        () =>
          __arena.networkView &&
          __arena.network.latest?.phase === "playing" &&
          !__arena.matchLoader.active,
      );
    console.log("Clients are playing");
    // Let shader uploads and worker startup settle before measuring packet Hz.
    await guest.waitForTimeout(3000);
    assert.equal(
      await host.locator("#network-debug").count(),
      0,
      "overlay defaults off",
    );
    await guest.waitForFunction(() =>
      document
        .querySelector("#network-debug")
        ?.textContent.includes("MAX EXTRAPOLATION  100 ms"),
    );
    if (watch) await watch.waitForFunction(() => __arena.networkView.spectator);
    const hostId = await host.evaluate(() => __arena.party.playerId);
    if (watch)
      await watch.evaluate((id) => {
        const view = __arena.networkView;
        view.spectator.target = id;
        const original = view.spectator.rig.update.bind(view.spectator.rig);
        view.spectator.rig.update = function (model, ...args) {
          const i = view.simulation.cars.findIndex((c) => c.id === id);
          window.spectatorUsesRendered =
            model === view.cars[i] &&
            model.position.distanceTo(
              view.simulation.cars[i].body.translation(),
            ) < 0.3;
          return original(model, ...args);
        };
      }, hostId);
    // Remote visuals must never use speculative collider proxies, even near the ball.
    await guest.evaluate(() => {
      __arena.networkView.prediction.proxyPose = () => {
        throw Error("Remote rendering used a prediction proxy");
      };
    });
    await guest.evaluate(() =>
      __arena.network.testNetwork.configure({
        latencyMs: 55,
        jitterMs: 22,
        loss: 0.04,
      }),
    );
    await host.evaluate(() =>
      __arena.input.keys.add(__arena.input.bindings.throttle),
    );
    const profile = await guest.evaluate(
      () =>
        new Promise((resolve) => {
          const start = performance.now(),
            samples = [];
          const initialProxySteps = __arena.networkView.proxySteps;
          function step() {
            const a = __arena,
              v = a.networkView,
              n = a.network;
            samples.push({
              at: performance.now(),
              tick: n.latest.tick,
              speculativeActive:
                v.prediction &&
                v.prediction.car.body.isEnabled() &&
                performance.now() - n.arrived < 250 &&
                v.prediction.pendingCount < 30,
              cars: v.cars.map((m, i) => ({
                id: v.simulation.cars[i].id,
                p: m.position.toArray(),
                q: m.quaternion.toArray(),
                proxy: Object.values(v.simulation.cars[i].body.translation()),
                kinematic: v.simulation.cars[i].body.isKinematic(),
                speculativeProxy: (() => {
                  const c = v.prediction?.simulation.cars.find(
                    (c) => c.id === v.simulation.cars[i].id,
                  );
                  return c && c !== v.prediction.car
                    ? Object.values(c.body.translation())
                    : null;
                })(),
              })),
            });
            if (performance.now() - start < 3000) requestAnimationFrame(step);
            else
              resolve({
                samples,
                diagnostics: n.diagnostics(),
                localId: a.party.playerId,
                remoteCount: v.cars.length - 1,
                proxySteps: v.proxySteps - initialProxySteps,
                confirmedContact: v.ballCorrection.contactSequence,
              });
          }
          requestAnimationFrame(step);
        }),
    );
    await host.evaluate(() => __arena.input.clear());
    fs.writeFileSync(
      ".tools/remote-smoothing-browser.json",
      JSON.stringify(profile, null, 2),
    );
    console.log(
      "Browser timing",
      JSON.stringify(profile.diagnostics),
      "proxy steps",
      profile.proxySteps,
    );
    const moving = profile.samples
      .slice(1)
      .filter(
        (s, i) =>
          s.tick === profile.samples[i].tick &&
          s.cars.some(
            (c) =>
              c.id !== profile.localId &&
              Math.hypot(
                ...c.p.map(
                  (v, k) =>
                    v - profile.samples[i].cars.find((p) => p.id === c.id).p[k],
                ),
              ) > 1e-5,
          ),
      ).length;
    assert.ok(profile.samples.length > 20, "render loop progresses");
    assert.equal(
      profile.remoteCount,
      3,
      "remote player plus two authoritative bots",
    );
    assert.ok(
      profile.diagnostics.snapshotReceiveHz > 20 &&
        profile.diagnostics.snapshotReceiveHz < 38,
      "about 30 unique state packets/sec",
    );
    assert.equal(profile.diagnostics.interpolationDelayMs, 100);
    assert.equal(profile.diagnostics.extrapolationLimitMs, 100);
    assert.ok(profile.diagnostics.bufferLength <= 32);
    assert.ok(
      profile.proxySteps > 200,
      "Kinematic display proxies advance at 120 Hz",
    );
    let maxProxyError = 0,
      maxSpeculativeProxyError = 0;
    for (const frame of profile.samples)
      for (const car of frame.cars) {
        assert.ok(
          car.kinematic,
          "Display/query car bodies are non-authoritative kinematic proxies",
        );
        if (car.id === profile.localId) continue;
        const error = Math.hypot(...car.p.map((v, i) => v - car.proxy[i]));
        maxProxyError = Math.max(maxProxyError, error);
        assert.ok(
          error < 0.5,
          "Remote display collider stays within a fixed-step travel of its visual",
        );
        // The existing predictor intentionally pauses after stale packets or
        // unacknowledged input. Its world is unused then; display/query proxies
        // above must continue at 120 Hz regardless.
        if (frame.speculativeActive && car.speculativeProxy)
          maxSpeculativeProxyError = Math.max(
            maxSpeculativeProxyError,
            Math.hypot(...car.p.map((v, i) => v - car.speculativeProxy[i])),
          );
      }
    assert.ok(
      maxSpeculativeProxyError < 1,
      "Existing speculative world uses the same remote visual timeline",
    );
    assert.ok(
      profile.samples.some((frame) => frame.speculativeActive),
      "Speculative proxy alignment is exercised while prediction is active",
    );
    profile.maxProxyError = maxProxyError;
    profile.maxSpeculativeProxyError = maxSpeculativeProxyError;
    if (profile.diagnostics.renderFPS > 40)
      assert.ok(moving > 8, "remote entities move between network packets");
    if (watch) {
      await watch.waitForFunction(() => window.spectatorUsesRendered === true);
      assert.ok(
        await watch.evaluate(() =>
          __arena.camera.position.toArray().every(Number.isFinite),
        ),
      );
    }
    assert.ok(
      (await guest.locator("#network-debug").textContent()).includes(
        "DUPLICATES",
      ),
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      ".tools/remote-smoothing-browser.json",
      JSON.stringify({ ...profile, betweenPackets: moving }, null, 2),
    );
    console.log(
      `PASS real PeerJS host/guest${watch ? "/spectator" : ""} + bots, 30Hz packets, render-frame interpolation, 120Hz kinematic proxies, jitter/loss and opt-in debug`,
      JSON.stringify({ ...profile.diagnostics, betweenPackets: moving }),
    );
  } finally {
    console.log("Closing browser test");
    await browser?.close();
    await server.close();
    await signaling.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
