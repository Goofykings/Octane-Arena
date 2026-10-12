const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict");
const { staticGame } = require("./static-game.cjs");
(async () => {
  const server = await staticGame(8194);
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
    const errors = [],
      pages = [];
    const open = async (name, identity) => {
      const c = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      c.setDefaultTimeout(45000);
      await c.addInitScript(
        ({ name, identity }) => {
          localStorage.setItem(
            "octane-arena-profile",
            JSON.stringify({
              profileVersion: 1,
              localPlayerId: identity ?? crypto.randomUUID(),
              name,
              avatarId: "helmet",
            }),
          );
          localStorage.setItem(
            "octane-arena-settings",
            JSON.stringify({ quality: "low" }),
          );
        },
        { name, identity },
      );
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(server.url);
      await p.waitForFunction(() => window.__arena);
      pages.push(p);
      return p;
    };
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
    const host = await open("Peer Host"),
      guest = await open("Peer Guest");
    await host.locator("#party-create").click();
    await host.waitForFunction(() => window.__arena.party.state);
    const code = await host.evaluate(() => window.__arena.party.state.code),
      hostId = await host.evaluate(() => window.__arena.party.playerId);
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    assert.equal(
      await host.evaluate(() => window.__arena.party.transport.peer.id),
      code,
    );
    assert.notEqual(hostId, code);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code.toLowerCase());
    assert.equal(await guest.locator("#party-input").inputValue(), code);
    await guest.locator('#party-join button[type="submit"]').click();
    await guest.waitForFunction(
      () => window.__arena.party.state?.members.length === 2,
    );
    for (const p of [host, guest])
      await p.waitForFunction(
        () =>
          window.octaneArenaNetwork.diagnostics().peers[0]
            ?.bidirectionalVerified,
      );
    assert.notEqual(
      await guest.evaluate(() => window.__arena.party.transport.peer.id),
      code,
    );
    assert.notEqual(
      await guest.evaluate(() => window.__arena.party.transport.peer.id),
      await guest.evaluate(() => window.__arena.party.playerId),
    );
    console.log(
      "PASS public PeerJS Cloud code/open/DataConnection/HELLO/WELCOME/roster and bidirectional ping/pong on static Pages-path assets",
    );
    // Actual occupied cloud ID: the first candidate collides, then fresh RNG wins.
    const collision = await open("Collision Host");
    await collision.evaluate((code) => {
      const original = crypto.getRandomValues.bind(crypto),
        alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      window.collisionAttempts = 0;
      crypto.getRandomValues = (array) => {
        if (array.length === 16 && window.collisionAttempts++ === 0) {
          for (let i = 0; i < array.length; i++)
            array[i] = alphabet.indexOf(code[i % 6]);
          return array;
        }
        return original(array);
      };
    }, code);
    await action(collision, "create");
    const vacantCode = await collision.evaluate(
      () => window.__arena.party.state.code,
    );
    assert.notEqual(vacantCode, code);
    assert.ok(await collision.evaluate(() => window.collisionAttempts >= 2));
    await action(collision, "leave");
    await collision.context().close();
    const duplicate = await open("Duplicate", hostId);
    const denied = await duplicate.evaluate(
      async (code) => ({
        ok: await window.__arena.party.action("join", { code }),
        message: window.__arena.party.message,
      }),
      code,
    );
    assert.equal(denied.ok, false);
    assert.match(denied.message, /PROFILE/);
    await duplicate.context().close();
    const missing = await open("Missing Party");
    const bad = await missing.evaluate(async () => ({
      ok: await window.__arena.party.action("join", { code: "ABCDE" }),
      message: window.__arena.party.message,
    }));
    assert.equal(bad.ok, false);
    const unavailable = await missing.evaluate(
      async (code) => ({
        ok: await window.__arena.party.action("join", { code }),
        message: window.__arena.party.message,
      }),
      vacantCode,
    );
    assert.equal(unavailable.ok, false);
    assert.match(unavailable.message, /NOT FOUND/);
    await missing.context().close();
    assert.equal(
      await host.evaluate(() => window.__arena.party.state.members.length),
      2,
    );
    // Signaling loss does not tear down established data channels.
    await guest.evaluate(() =>
      window.__arena.party.transport.peer.disconnect(),
    );
    await guest.waitForFunction(
      () =>
        window.__arena.party.transport.peer.open &&
        !window.__arena.party.transport.peer.disconnected &&
        window.__arena.party.message === "CONNECTED",
    );
    assert.equal(
      await guest.evaluate(() => window.__arena.party.state.members.length),
      2,
    );
    await action(host, "stage", { stage: "mode" });
    await action(host, "launch");
    for (const p of [host, guest])
      await p.waitForFunction(
        () => window.__arena.network.latest?.phase === "playing",
      );
    const match = await host.evaluate(() => window.__arena.network.latest);
    assert.equal(
      (await guest.evaluate(() => window.__arena.network.latest)).matchId,
      match.matchId,
    );
    assert.equal(
      (await guest.evaluate(() => window.__arena.network.latest)).arenaId,
      match.arenaId,
    );
    await host.bringToFront();
    await host.keyboard.down("KeyW");
    await host.keyboard.down("ShiftLeft");
    for (let i = 0; i < 240; i++) {
      if (
        await host.evaluate(
          (id) =>
            window.__arena.network.latest.stats.find((s) => s.playerId === id)
              .touches > 0,
          hostId,
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
    for (const p of [host, guest])
      await p.waitForFunction(
        (id) =>
          window.__arena.network.latest.stats.find((s) => s.playerId === id)
            .touches > 0,
        hostId,
      );
    await host.keyboard.press("KeyT");
    await host.locator("#chat-input").fill("PeerJS hello");
    await host.keyboard.press("Enter");
    await guest.waitForFunction(() =>
      document
        .querySelector("#match-chat .chat-lines")
        .textContent.includes("PeerJS hello"),
    );
    await guest.bringToFront();
    await guest.keyboard.down("Tab");
    await guest.locator("#match-board").waitFor({ state: "visible" });
    await guest.keyboard.up("Tab");
    const hostState = await host.evaluate(() => window.__arena.network.latest),
      guestState = await guest.evaluate(() => window.__arena.network.latest);
    assert.equal(guestState.cars.length, 2);
    assert.ok(hostState.players.every((p) => p.localPlayerId === p.id));
    await action(guest, "leave");
    await host.waitForFunction(
      () =>
        window.__arena.party.state.members.length === 1 &&
        window.__arena.party.state.stage === "teams",
    );
    await guest.waitForFunction(() => !window.__arena.party.state);
    await action(guest, "join", { code });
    await host.waitForFunction(
      () => window.__arena.party.state.members.length === 2,
    );
    await action(host, "leave");
    await guest.waitForFunction(() => !window.__arena.party.state);
    assert.match(
      await guest.evaluate(() => window.__arena.party.message),
      /HOST DISCONNECTED/,
    );
    await action(host, "create");
    assert.notEqual(
      await host.evaluate(() => window.__arena.party.state.code),
      code,
    );
    await action(host, "leave");
    assert.equal(
      server.apiRequests(),
      0,
      "No old API/signaling/socket backend used",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS real PeerJS Cloud collision retry, invalid/missing/duplicate profile handling, signaling reconnect with intact WebRTC, same authority match/arena, actual driving/ball touch/stat sync, chat, scoreboard, leave/rejoin, host closure/new code and zero API requests",
    );
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
