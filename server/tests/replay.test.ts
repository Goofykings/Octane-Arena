import { test } from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { NetworkMatch, initializeMatchPhysics } from "../src/network-match.js";
import { createApp } from "../src/app.js";
import { starter } from "../../shared/catalog";
import { neutralInput } from "../../shared/player";
import { decodeReplay } from "../../shared/replay";
import type { MatchSnapshot, NetPlayer } from "../../shared/network";

const roster = (count: number): NetPlayer[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: "Same Name",
    team: (i % 2) as 0 | 1,
    controller: "remote",
    preset: starter(),
    avatarId: i ? "fox" : "robot",
  }));
function goal(game: NetworkMatch) {
  game.match.phase = "playing";
  for (let i = 0; i < 650; i++) game.step(i);
  game.simulation.lastTouchId = game.players[0].id;
  game.simulation.lastTouchTime = game.simulation.clock;
  game.simulation.ball.setTranslation({ x: 0, y: 2, z: -53 }, true);
  game.simulation.ball.setLinvel({ x: 0, y: 0, z: -21 }, true);
  game.match.tick(game.simulation, game.pads);
  assert.equal(game.match.phase, "goal");
  game.match.freeze = 0;
  game.step();
  assert.equal(game.match.phase, "replay");
}
test("authoritative 1v1/2v2 skip validation, frozen physics, stale votes and disconnect unanimity", async () => {
  await initializeMatchPhysics();
  for (const count of [2, 4]) {
    const game = new NetworkMatch(roster(count));
    try {
      goal(game);
      const id = game.match.replay!.clip.goal.id;
      const frozen = game.simulation.world.takeSnapshot();
      assert.equal(game.snapshot().replay!.eligible.length, count);
      assert.equal(game.skipReplay("outsider", id), false);
      assert.equal(game.skipReplay("p0", "old"), false);
      game.accept("p0", 1, {
        ...neutralInput(),
        boost: true,
        jump: true,
        throttle: 1,
      });
      for (let i = 0; i < 120; i++) game.step();
      assert.deepEqual(game.simulation.world.takeSnapshot(), frozen);
      assert.ok(game.skipReplay("p0", id));
      assert.equal(game.skipReplay("p0", id), false);
      assert.equal(game.match.phase, "replay");
      assert.deepEqual(game.snapshot().replay!.votes, ["p0"]);
      for (let i = 1; i < count - 1; i++)
        assert.ok(game.skipReplay(`p${i}`, id));
      game.disconnect(`p${count - 1}`);
      assert.equal(game.match.phase, "countdown");
      assert.equal(game.match.countdown, 3);
      assert.deepEqual(game.snapshot().score, [1, 0]);
      assert.ok(game.pads.items.every((p) => p.cooldown === 0));
      assert.equal(game.skipReplay("p0", id), false);
    } finally {
      game.dispose();
    }
  }
  const game = new NetworkMatch(roster(2));
  try {
    goal(game);
    const id = game.match.replay!.clip.goal.id;
    game.disconnect("p1");
    assert.equal(game.match.phase, "replay");
    game.connected("p1");
    assert.equal(game.snapshot().replay!.eligible.length, 2);
    assert.ok(game.skipReplay("p0", id));
    assert.equal(game.match.phase, "replay");
    assert.ok(game.skipReplay("p1", id));
    assert.equal(game.match.phase, "countdown");
  } finally {
    game.dispose();
  }
});

test("real sockets receive one authoritative 120-Hz clip and synchronized skip votes; session identity cannot be spoofed", async () => {
  const origin = "http://localhost:4186";
  const { app, partyMatches } = await createApp({
    host: "127.0.0.1",
    port: 0,
    database: ":memory:",
    origins: [origin],
    production: false,
    trustProxy: false,
    authLimit: 100,
    sessionSeconds: 600,
  });
  const sockets: WebSocket[] = [];
  const snapshots: MatchSnapshot[][] = [[], []];
  const clips: unknown[][] = [[], []];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const port = (app.server.address() as { port: number }).port;
    const headers = {
      origin,
      "x-arena-client": "1",
      "content-type": "application/json",
    };
    const tokens: string[] = [],
      ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const reply = (
        await app.inject({
          method: "POST",
          url: "/api/party/session",
          headers,
          payload: { preset: starter(), newSession: true },
        })
      ).json();
      tokens.push(reply.sessionToken);
      ids.push(reply.playerId);
    }
    const action = (i: number, name: string, payload = {}) =>
      app.inject({
        method: "POST",
        url: "/api/party/" + name,
        headers: { ...headers, "x-arena-party": tokens[i] },
        payload,
      });
    const code = (await action(0, "create")).json().party.code;
    await action(1, "join", { code });
    await action(0, "stage", { stage: "mode" });
    await action(0, "stage", { stage: "teams" });
    await action(0, "team", { team: 0 });
    await action(1, "team", { team: 1 });
    for (let i = 0; i < 2; i++)
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(
          `ws://127.0.0.1:${port}/api/match/socket`,
          { origin },
        );
        sockets.push(socket);
        socket.on("error", reject);
        socket.on("open", () =>
          socket.send(JSON.stringify({ type: "auth", token: tokens[i] })),
        );
        socket.on("message", (raw) => {
          const message = JSON.parse(raw.toString());
          if (message.type === "connected") resolve();
          if (message.type === "snapshot") snapshots[i].push(message);
          if (message.type === "replay") {
            decodeReplay(message);
            clips[i].push(message);
          }
        });
      });
    await action(0, "launch");
    const game = partyMatches.matches.get(code)!;
    goal(game);
    const replayId = game.match.replay!.clip.goal.id;
    const wait = async (check: () => boolean) => {
      const end = Date.now() + 3000;
      while (!check() && Date.now() < end)
        await new Promise((r) => setTimeout(r, 10));
      assert.ok(check(), "Socket state did not arrive");
    };
    await wait(
      () =>
        clips.every((c) => c.length === 1) &&
        snapshots.every((s) => s.some((f) => f.phase === "replay")),
    );
    assert.deepEqual(clips[0], clips[1]);
    assert.equal(game.match.replay!.clip.count >= 600, true);
    // Extra playerId is untrusted: only the authenticated connection may vote.
    sockets[0].send(
      JSON.stringify({
        type: "REPLAY_SKIP_REQUEST",
        matchId: game.id,
        replayId,
        playerId: ids[1],
      }),
    );
    await wait(() =>
      snapshots.every((list) =>
        list.some((s) => s.replay?.votes.includes(ids[0])),
      ),
    );
    assert.deepEqual(game.snapshot().replay!.votes, [ids[0]]);
    assert.equal(game.match.phase, "replay");
    sockets[0].send(
      JSON.stringify({
        type: "REPLAY_SKIP_REQUEST",
        matchId: "wrong-match",
        replayId,
      }),
    );
    sockets[0].send(
      JSON.stringify({
        type: "REPLAY_SKIP_REQUEST",
        matchId: game.id,
        replayId,
      }),
    );
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(game.snapshot().replay!.votes.length, 1);
    sockets[1].send(
      JSON.stringify({
        type: "REPLAY_SKIP_REQUEST",
        matchId: game.id,
        replayId,
      }),
    );
    await wait(
      () =>
        game.match.phase === "countdown" &&
        snapshots.every((s) =>
          s.some((f) => f.phase === "countdown" && f.reset > 1),
        ),
    );
    assert.equal(game.snapshot().score[0], 1);
    assert.ok(clips.every((c) => c.length === 1));
  } finally {
    sockets.forEach((s) => s.terminate());
    await app.close();
  }
});
