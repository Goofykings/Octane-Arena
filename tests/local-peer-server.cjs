// Test-only child process: PeerServer owns recurring housekeeping timers.
const { fork } = require("node:child_process");
exports.localPeer = async (port = 9027) => {
  const child = fork(__filename, [], {
    env: { ...process.env, OCTANE_TEST_PEER_PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  await new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("error", reject);
    child.once("exit", code => reject(Error("Local signaling exited: " + code)));
  });
  return {
    port,
    close: () => new Promise(resolve => {
      if (child.exitCode !== null || child.signalCode) return resolve();
      child.once("exit", resolve);
      child.kill();
    }),
  };
};
if (require.main === module) {
  const http = require("node:http"), { createRequire } = require("node:module"), path = require("node:path");
  const root = process.env.PEER_TEST_MODULE || path.resolve(".tools/peer-test/node_modules/peer");
  const from = createRequire(path.join(root, "package.json"));
  const express = from("express"), { ExpressPeerServer } = require(root);
  const app = express(), server = http.createServer(app);
  app.use("/peer", ExpressPeerServer(server, { path: "/", allow_discovery: false }));
  server.listen(Number(process.env.OCTANE_TEST_PEER_PORT), "127.0.0.1", () => process.send("ready"));
}
