const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
(async () => {
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
      headless: true,
      args: ["--enable-unsafe-swiftshader"],
    });
    const url = "https://goofykings.github.io/Octane-Arena/",
      root = path.resolve("dist"),
      pages = [],
      errors = [];
    const open = async (test = false) => {
      const c = await browser.newContext();
      c.setDefaultTimeout(45000);
      await c.addInitScript(() =>
        localStorage.setItem(
          "octane-arena-settings",
          JSON.stringify({ quality: "low" }),
        ),
      );
      // Rehearse the current local build at the real secure Pages origin/base path.
      // This does not publish or claim the deployed website was updated.
      await c.route(url + "**", async (route) => {
        const u = new URL(route.request().url()),
          relative = u.pathname.slice("/Octane-Arena/".length) || "index.html",
          file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file))
          return route.fulfill({ status: 404, body: "" });
        await route.fulfill({
          status: 200,
          body: fs.readFileSync(file),
          contentType: file.endsWith(".js")
            ? "text/javascript"
            : file.endsWith(".css")
              ? "text/css"
              : file.endsWith(".ttf")
                ? "font/ttf"
                : "text/html",
        });
      });
      const p = await c.newPage();
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(url + (test ? "?test" : ""));
      await p.locator("#party-create").waitFor();
      pages.push(p);
      return p;
    };
    const host = await open(),
      guest = await open();
    await host.locator("#party-create").click();
    await host.locator("#party-code").waitFor({ state: "visible" });
    const code = (await host.locator("#party-code").textContent())
      .trim()
      .slice(-6);
    await guest.locator("#party-join-open").click();
    await guest.locator("#party-input").fill(code);
    await guest.locator('#party-join button[type="submit"]').click();
    for (const p of [host, guest]) {
      await p.waitForFunction(
        () =>
          document.querySelectorAll("#party-members .party-avatar").length ===
          2,
      );
      await p.waitForFunction(
        () =>
          window.octaneArenaNetwork.diagnostics().peers[0]
            ?.bidirectionalVerified,
      );
      assert.equal(await p.evaluate(() => window.isSecureContext), true);
      assert.equal(await p.evaluate(() => typeof window.__arena), "undefined");
    }
    const probe = await open(true);
    await probe.evaluate(async (code) => {
      const a = window.__arena,
        t = a.party.transport;
      await t.register();
      window.versionRejection = "";
      t.onParty = (_link, p) => {
        if (p.type === "party-rejected") window.versionRejection = p.message;
      };
      const link = t.connect(code);
      link.connection.on("open", () =>
        link.connection.send({
          type: "party-hello",
          version: "incompatible-version",
          profile: {
            localPlayerId: a.accounts.profile.value.localPlayerId,
            name: "Version Probe",
            avatarId: "helmet",
            avatarColor: "#83E4FF",
          },
          preset: a.garage.current,
        }),
      );
    }, code);
    await probe.waitForFunction(
      () => window.versionRejection === "GAME VERSION MISMATCH",
    );
    assert.equal(
      await host.locator("#party-members .party-avatar").count(),
      2,
      "Rejected handshake never adds a ghost member",
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS real PeerJS Cloud secure connection at rehearsed normal HTTPS GitHub Pages origin/base path without test hooks for host/guest, bidirectional data, and clean incompatible-version rejection; local assets only, not a deployment",
    );
  } finally {
    if (browser) await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
