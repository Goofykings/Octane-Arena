import {
  NetworkMatch,
  initializeMatchPhysics,
} from "../game/authoritative-match";
import { FixedLoop } from "../physics/loop";
import { replayMessage } from "../../shared/replay";
import type { NetPlayer } from "../../shared/network";
import type { ArenaId } from "../../shared/arenas";
import type { PlayerInput } from "../../shared/player";

import type { SoccerMode } from "../../shared/soccer";
export type AuthorityCommand =
  | {
      type: "start";
      players: NetPlayer[];
      arenaId: ArenaId;
      matchId: string;
      gameMode?: SoccerMode;
    }
  | { type: "input"; id: string; sequence: number; input: PlayerInput }
  | { type: "connected" | "disconnected"; id: string }
  | { type: "skip"; id: string; replayId: string };
let game: NetworkMatch | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<AuthorityCommand>) => void) | null;
  postMessage: (data: unknown) => void;
};
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "start") {
    if (game || timer) return;
    void (async () => {
      await initializeMatchPhysics();
      game = new NetworkMatch(
        message.players,
        message.arenaId,
        message.matchId,
        message.gameMode ?? "soccar",
      );
      const loop = new FixedLoop();
      let previous = performance.now(),
        lastTick = -4,
        replayId = "";
      scope.postMessage(game.snapshot());
      timer = setInterval(() => {
        try {
          const now = performance.now();
          loop.advance((now - previous) / 1000, () => game!.step(now));
          previous = now;
          if (game!.tick - lastTick < 4) return;
          lastTick = game!.tick;
          const clip = game!.match.replay?.clip;
          if (clip && clip.goal.id !== replayId) {
            replayId = clip.goal.id;
            scope.postMessage(replayMessage(game!.id, clip));
          }
          scope.postMessage(game!.snapshot());
        } catch {
          clearInterval(timer);
          scope.postMessage({
            type: "error",
            message: "Match simulation stopped. Return to the lobby.",
          });
        }
      }, 8);
    })().catch(() =>
      scope.postMessage({
        type: "error",
        message: "Match could not start. Return to the lobby.",
      }),
    );
    return;
  }
  if (!game) return;
  if (message.type === "input")
    game.accept(message.id, message.sequence, message.input);
  else if (message.type === "connected") game.connected(message.id);
  else if (message.type === "disconnected") game.disconnect(message.id);
  else if (message.type === "skip")
    game.skipReplay(message.id, message.replayId);
};
