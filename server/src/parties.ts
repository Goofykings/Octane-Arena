import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { presetSchema } from "../../shared/accounts.js";
import {
  localIdentitySchema,
  defaultAvatarColor,
} from "../../shared/local-profile.js";
import {
  partyAlphabet,
  partyMaxPlayers,
  partyModes,
  teamCapacity,
  normalizePartyCode,
  validPartyCode,
  type PartyMember,
  type PartyState,
  type PartyActions,
  type PartyReply,
} from "../../shared/party.js";
import { soccerModes } from "../../shared/soccer.js";
import { starter } from "../../shared/catalog.js";
import type { ServerConfig } from "./config.js";
import { NetworkMatches } from "./network.js";
import { initializeMatchPhysics } from "./network-match.js";
import { chooseMatchArena, type ArenaId } from "../../shared/arenas";
import { rtcSignalSchema, type RtcEnvelope } from "../../shared/rtc";
import { iceConfiguration } from "./rtc-config";
type Player = {
  member: PartyMember;
  code: string | null;
  seen: number;
  notice: string;
  signals: RtcEnvelope[];
  signalSequence: number;
};
export async function registerParties(
  app: FastifyInstance,
  config: ServerConfig,
) {
  await initializeMatchPhysics();
  const players = new Map<string, Player>(),
    parties = new Map<string, PartyState>();
  let previousRtcArena: ArenaId | undefined;
  const endRtc = (party: PartyState, notice = "") => {
    party.stage = "teams";
    delete party.matchId;
    delete party.matchArenaId;
    delete party.matchHostId;
    delete party.matchFinished;
    for (const p of players.values())
      if (p.code === party.code) p.notice = notice;
  };
  const cookieName = config.production ? "__Host-oa_party" : "oa_party";
  const matches = new NetworkMatches(
    app,
    config,
    (token) => {
      const p = players.get(token);
      return p
        ? {
            id: p.member.id,
            code: p.code,
            touch: () => {
              p.seen = Date.now();
            },
          }
        : null;
    },
    (code, reason) => {
      const party = parties.get(code);
      if (party) {
        party.stage = "teams";
        delete party.matchId;
        delete party.matchArenaId;
      }
      if (reason)
        for (const p of players.values())
          if (p.code === code) p.notice = reason;
    },
  );
  const tokenFor = (req: FastifyRequest) =>
    typeof req.headers["x-arena-party"] === "string"
      ? req.headers["x-arena-party"]
      : (req.cookies[cookieName] ?? "");
  const fail = (status: number, message: string) => {
    throw Object.assign(new Error(message), {
      statusCode: status,
      partyFault: true,
    });
  };
  const leave = (p: Player) => {
    if (p.code) matches.stop(p.code, "PLAYER LEFT — MATCH ENDED");
    const party = p.code ? parties.get(p.code) : null;
    if (party?.transport === "webrtc" && party.stage === "match")
      endRtc(party, "PLAYER LEFT — MATCH ENDED");
    p.signals = [];
    p.code = null;
    p.member.ready = false;
    p.member.team = null;
    if (!party) return;
    party.members = party.members.filter((m) => m.id !== p.member.id);
    if (!party.members.length) parties.delete(party.code);
    else if (party.hostId === p.member.id) party.hostId = party.members[0].id;
  };
  const prune = () => {
    for (const [token, p] of players)
      if (Date.now() - p.seen > 45000) {
        leave(p);
        players.delete(token);
      }
  };
  const timer = setInterval(prune, 5000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));
  const get = (req: FastifyRequest) => {
    prune();
    const p = players.get(tokenFor(req));
    if (!p) return fail(401, "PARTY SESSION EXPIRED");
    p.seen = Date.now();
    return p;
  };
  const refresh = (p: Player, req: FastifyRequest, preset: unknown) => {
    const parsed = presetSchema.safeParse(preset);
    if (!parsed.success) return fail(400, "INVALID CAR PRESET");
    const raw = (req.body as { profile?: unknown })?.profile;
    const identity =
      raw === undefined ? null : localIdentitySchema.safeParse(raw);
    if (identity && !identity.success)
      return fail(400, "INVALID LOCAL PROFILE");
    if (
      identity?.success &&
      p.member.localPlayerId &&
      p.member.localPlayerId !== identity.data.localPlayerId
    )
      return fail(409, "LOCAL ID CANNOT CHANGE DURING A SESSION");
    Object.assign(p.member, {
      ...(identity?.success ? identity.data : {}),
      title: "Rookie",
      preset: parsed.data,
    });
  };
  const state = (p: Player): PartyReply => ({
    playerId: p.member.id,
    party: p.code ? (parties.get(p.code) ?? null) : null,
    notice: p.notice,
  });
  app.post(
    "/api/party/session",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      prune();
      let token = (req.body as { newSession?: boolean })?.newSession
          ? ""
          : tokenFor(req),
        p = token ? players.get(token) : undefined;
      if (!p) {
        if (players.size >= 10000) return fail(503, "PARTY SERVICE BUSY");
        token = randomBytes(32).toString("base64url");
        p = {
          member: {
            id: randomUUID(),
            name: "Guest",
            title: "Rookie",
            avatarId: "helmet",
            avatarColor: defaultAvatarColor,
            preset: starter(),
            team: null,
            ready: false,
          },
          code: null,
          seen: Date.now(),
          notice: "",
          signals: [],
          signalSequence: 0,
        };
        players.set(token!, p);
      }
      refresh(p, req, (req.body as { preset?: unknown })?.preset);
      p.seen = Date.now();
      reply.setCookie(cookieName, token!, {
        httpOnly: true,
        secure: config.production,
        sameSite: config.production ? "none" : "lax",
        partitioned: config.production,
        path: "/",
        maxAge: 86400,
      });
      return { ...state(p), sessionToken: token };
    },
  );
  app.get("/api/party", async (req) => state(get(req)));
  app.get("/api/party/rtc-config", async (req) =>
    iceConfiguration(config, get(req).member.id),
  );
  app.post(
    "/api/party/signal",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req) => {
      const sender = get(req),
        party = sender.code ? parties.get(sender.code) : null;
      const parsed = rtcSignalSchema.safeParse(req.body);
      if (!parsed.success) return fail(400, "INVALID CONNECTION MESSAGE");
      if (!party || party.transport !== "webrtc")
        return fail(409, "JOIN A WEBRTC PARTY FIRST");
      const signal = parsed.data;
      const recipient = Array.from(players.values()).find(
        (p) => p.member.id === signal.to && p.code === sender.code,
      );
      if (!recipient || recipient === sender)
        return fail(403, "PLAYER IS NOT IN YOUR PARTY");
      if (
        sender.member.id !== party.hostId &&
        recipient.member.id !== party.hostId
      )
        return fail(403, "CONNECT THROUGH THE PARTY HOST");
      if (
        signal.data.kind === "description" &&
        (signal.data.description.type === "offer") !==
          (sender.member.id === party.hostId)
      )
        return fail(403, "INVALID CONNECTION ROLE");
      recipient.signals = recipient.signals.filter(
        (s) => s.expires > Date.now(),
      );
      if (recipient.signals.length >= 128)
        return fail(429, "CONNECTION QUEUE FULL — RETRY");
      recipient.signals.push({
        ...signal,
        from: sender.member.id,
        code: party.code,
        sequence: ++recipient.signalSequence,
        expires: Date.now() + 60000,
      });
      return state(sender);
    },
  );
  app.get("/api/party/signals", async (req) => {
    const p = get(req),
      after = Number((req.query as { after?: string }).after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0)
      return fail(400, "INVALID CONNECTION CURSOR");
    p.signals = p.signals.filter((s) => s.expires > Date.now());
    return { signals: p.signals.filter((s) => s.sequence > after) };
  });
  app.post("/api/party/rtc-end", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    const data = req.body as { matchId?: unknown; reason?: unknown };
    if (
      !party ||
      party.transport !== "webrtc" ||
      party.stage !== "match" ||
      party.matchId !== data.matchId
    )
      return fail(409, "MATCH IS NO LONGER ACTIVE");
    if (data.reason === "finished") {
      if (party.matchHostId !== p.member.id)
        return fail(403, "ONLY THE MATCH HOST CAN REPORT RESULTS");
      party.matchFinished = true;
    } else if (data.reason === "disconnect")
      endRtc(party, "PLAYER CONNECTION LOST — MATCH ENDED");
    else return fail(400, "INVALID MATCH RESULT");
    return state(p);
  });
  // Renew presence without polling lobby snapshots while SSE is healthy.
  app.post("/api/party/heartbeat", async (req, reply) => {
    get(req);
    return reply.code(204).send();
  });
  // Server-sent lobby snapshots: updates arrive without waiting for the
  // recovery poll. Inputs and physics never travel on this channel.
  const streams = new Set<() => void>();
  app.addHook("preClose", async () => {
    for (const close of streams) close();
  });
  app.get("/api/party/events", async (req, reply) => {
    const p = get(req);
    for (const [key, value] of Object.entries(reply.getHeaders()))
      if (value !== undefined) reply.raw.setHeader(key, value);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.hijack();
    let previous = "",
      heartbeat = 0,
      signalCursor = 0;
    const publish = () => {
      // Only incoming client requests renew presence; a half-open stream must
      // not keep a disconnected player in the party forever.
      if (players.get(tokenFor(req)) !== p) {
        close();
        return;
      }
      const data = JSON.stringify(state(p));
      if (data !== previous) {
        reply.raw.write(`data: ${data}\n\n`);
        previous = data;
      } else if (++heartbeat % 40 === 0) reply.raw.write(": heartbeat\n\n");
      p.signals = p.signals.filter((s) => s.expires > Date.now());
      for (const signal of p.signals)
        if (signal.sequence > signalCursor) {
          reply.raw.write(`event: signal\ndata: ${JSON.stringify(signal)}\n\n`);
          signalCursor = signal.sequence;
        }
    };
    const interval = setInterval(publish, 100);
    const close = () => {
      clearInterval(interval);
      streams.delete(close);
      reply.raw.end();
    };
    streams.add(close);
    reply.raw.on("close", close);
    publish();
  });
  app.post("/api/party/create", async (req) => {
    const p = get(req);
    if (p.code) return state(p);
    let code: string;
    do {
      code = Array.from(
        { length: 6 },
        () => partyAlphabet[randomInt(partyAlphabet.length)],
      ).join("");
    } while (parties.has(code));
    p.code = code;
    p.notice = "";
    p.member.team = 0;
    p.member.ready = false;
    parties.set(code, {
      code,
      hostId: p.member.id,
      maxPlayers: partyMaxPlayers,
      transport:
        config.matchTransport ?? (config.production ? "webrtc" : "server"),
      members: [p.member],
      mode: "1v1",
      gameMode: "soccar",
      stage: "home",
    });
    return state(p);
  });
  app.post("/api/party/join", async (req) => {
    const p = get(req),
      raw = (req.body as { code?: unknown })?.code;
    if (typeof raw !== "string" || raw.length > 32)
      return fail(400, "INVALID CODE");
    const code = normalizePartyCode(raw);
    if (!validPartyCode(code)) return fail(400, "INVALID CODE");
    const party = parties.get(code);
    if (!party) return fail(404, "PARTY NOT FOUND");
    if (p.code === code) return state(p);
    if (party.stage === "match") return fail(409, "MATCH IN PROGRESS");
    if (party.members.length >= party.maxPlayers)
      return fail(409, "PARTY FULL");
    if (
      party.stage === "teams" &&
      party.mode !== "2v2" &&
      party.members.length >= 2
    )
      return fail(409, "THIS MODE HAS TWO PLAYER SLOTS");
    leave(p);
    p.code = code;
    p.notice = "";
    p.member.team =
      party.stage === "teams"
        ? null
        : (([0, 1] as const).find(
            (team) =>
              party.members.filter((m) => m.team === team).length <
              teamCapacity(party.mode, team),
          ) ?? null);
    party.members.push(p.member);
    return state(p);
  });
  app.post("/api/party/leave", async (req) => {
    const p = get(req);
    leave(p);
    p.notice = "";
    return state(p);
  });
  app.post("/api/party/kick", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN KICK");
    const target = (req.body as { playerId?: unknown })?.playerId;
    if (target === p.member.id) return fail(400, "CANNOT KICK YOURSELF");
    const victim = Array.from(players.values()).find(
      (v) => v.member.id === target && v.code === party.code,
    );
    if (!victim) return fail(404, "PLAYER NOT FOUND");
    leave(victim);
    victim.notice = "YOU WERE REMOVED FROM THE PARTY";
    return state(p);
  });
  app.put("/api/party/appearance", async (req) => {
    const p = get(req);
    if (p.code && parties.get(p.code)?.stage === "match") return state(p);
    refresh(p, req, (req.body as { preset?: unknown })?.preset);
    return state(p);
  });
  app.post("/api/party/team", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null,
      team = (req.body as PartyActions["team"])?.team;
    if (!party) return fail(409, "JOIN A PARTY FIRST");
    if (party.stage === "match") return fail(409, "MATCH IN PROGRESS");
    if (team !== null && team !== 0 && team !== 1)
      return fail(400, "INVALID TEAM");
    if (
      team !== null &&
      party.members.filter((m) => m.id !== p.member.id && m.team === team)
        .length >= teamCapacity(party.mode, team)
    )
      return fail(409, "TEAM FULL");
    p.member.team = team;
    p.member.ready = false;
    return state(p);
  });
  app.post("/api/party/ready", async (req) => {
    const p = get(req),
      ready = (req.body as PartyActions["ready"])?.ready;
    if (!p.code) return fail(409, "JOIN A PARTY FIRST");
    if (typeof ready !== "boolean") return fail(400, "INVALID READY STATE");
    if (ready && p.member.team === null)
      return fail(409, "CHOOSE A TEAM FIRST");
    p.member.ready = ready;
    return state(p);
  });
  app.post("/api/party/mode", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null,
      mode = (req.body as PartyActions["mode"])?.mode;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN CHANGE MODE");
    if (!partyModes.some((m) => m.id === mode))
      return fail(400, "INVALID MODE");
    if (party.stage === "teams" || party.stage === "match")
      return fail(409, "RETURN TO MODE SELECTION FIRST");
    party.mode = mode;
    const counts = [0, 0];
    for (const m of party.members) {
      m.ready = false;
      if (m.team !== null && ++counts[m.team] > teamCapacity(mode, m.team))
        m.team = null;
    }
    return state(p);
  });
  app.post("/api/party/gamemode", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    const gameMode = (req.body as PartyActions["gamemode"])?.gameMode;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN CHANGE GAMEMODE");
    if (party.stage === "match" || party.stage === "teams")
      return fail(409, "RETURN TO MATCH SETUP FIRST");
    if (!soccerModes.some((m) => m.id === gameMode))
      return fail(400, "INVALID GAMEMODE");
    party.gameMode = gameMode;
    party.members.forEach((m) => (m.ready = false));
    return state(p);
  });
  app.post("/api/party/stage", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN CONTINUE");
    const stage = (req.body as PartyActions["stage"])?.stage;
    if (party.stage === "match") return fail(409, "MATCH IN PROGRESS");
    if (stage !== "home" && stage !== "mode" && stage !== "teams")
      return fail(400, "INVALID LOBBY STAGE");
    if (stage === "teams" && party.stage !== "mode")
      return fail(409, "CHOOSE A MODE FIRST");
    if (stage === "teams" && party.mode !== "2v2" && party.members.length > 2)
      return fail(409, "CHOOSE 2 VS 2 FOR MORE THAN TWO PLAYERS");
    if (stage === "teams")
      for (const m of party.members) {
        m.team = null;
        m.ready = false;
      }
    party.stage = stage;
    return state(p);
  });
  app.post("/api/party/disconnect", async (req) => {
    const p = get(req);
    leave(p);
    p.notice = "";
    return state(p);
  });
  app.post("/api/party/launch", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN START");
    if (party.stage === "mode") {
      const required =
        teamCapacity(party.mode, 0) + teamCapacity(party.mode, 1);
      if (party.members.length !== required)
        return fail(
          409,
          "THIS FORMAT NEEDS " +
            required +
            " PLAYERS - CHOOSE ANOTHER FORMAT OR INVITE FRIENDS",
        );
      const counts = [0, 0];
      for (const m of party.members) {
        if (
          m.team !== null &&
          counts[m.team] < teamCapacity(party.mode, m.team)
        )
          counts[m.team]++;
        else m.team = null;
      }
      for (const m of party.members)
        if (m.team === null) {
          const team = counts[0] < teamCapacity(party.mode, 0) ? 0 : 1;
          m.team = team;
          counts[team]++;
        }
    } else if (party.stage !== "teams")
      return fail(409, "OPEN MATCH SETUP FIRST");
    const blue = party.members.filter((m) => m.team === 0).length,
      orange = party.members.filter((m) => m.team === 1).length;
    if (
      party.members.some((m) => m.team === null) ||
      blue !== teamCapacity(party.mode, 0) ||
      orange !== teamCapacity(party.mode, 1)
    )
      return fail(409, "FILL BOTH TEAMS BEFORE STARTING");
    try {
      if (party.transport === "webrtc") {
        party.matchId = randomUUID();
        party.matchHostId = party.hostId;
        party.matchArenaId = chooseMatchArena(previousRtcArena);
        previousRtcArena = party.matchArenaId;
        party.matchFinished = false;
      } else {
        const game = matches.start(party);
        party.matchId = game.id;
      }
      party.stage = "match";
      for (const member of players.values())
        if (member.code === party.code) member.notice = "";
    } catch {
      return fail(503, "MATCH COULD NOT START — TRY AGAIN");
    }
    return state(p);
  });
  app.post("/api/party/return", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN RETURN EVERYONE");
    if (party.transport === "webrtc") {
      if (!party.matchFinished) return fail(409, "MATCH IS STILL PLAYING");
      endRtc(party);
      return state(p);
    }
    if (matches.matches.get(party.code)?.match.phase !== "finished")
      return fail(409, "MATCH IS STILL PLAYING");
    matches.stop(party.code);
    return state(p);
  });
  return matches;
}
