import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  presetSchema,
  titles,
  type AccountData,
} from "../../shared/accounts.js";
import {
  partyAlphabet,
  partyModes,
  teamCapacity,
  normalizePartyCode,
  validPartyCode,
  type PartyMember,
  type PartyState,
  type PartyActions,
  type PartyReply,
} from "../../shared/party.js";
import { starter } from "../../shared/catalog.js";
import type { ServerConfig } from "./config.js";
type Player = {
  member: PartyMember;
  code: string | null;
  seen: number;
  notice: string;
};
export function registerParties(
  app: FastifyInstance,
  config: ServerConfig,
  account: (req: FastifyRequest) => AccountData | null,
) {
  const players = new Map<string, Player>(),
    parties = new Map<string, PartyState>();
  const cookieName = config.production ? "__Host-oa_party" : "oa_party";
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
    const party = p.code ? parties.get(p.code) : null;
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
    const a = account(req);
    if (a)
      for (const key of [
        "body",
        "wheels",
        "boost",
        "topper",
        "decal",
        "explosion",
      ] as const)
        if (!a.owned[key]?.includes(parsed.data[key]))
          return fail(403, "COSMETIC NOT OWNED");
    Object.assign(p.member, {
      name: a?.username ?? "Guest",
      title: titles.find((t) => t.id === a?.titleId)?.name ?? "Rookie",
      avatarId: a?.avatarId ?? "helmet",
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
            preset: starter(),
            team: null,
            ready: false,
          },
          code: null,
          seen: Date.now(),
          notice: "",
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
      heartbeat = 0;
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
      members: [p.member],
      mode: "1v1",
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
    if (party.members.length >= 4) return fail(409, "PARTY FULL");
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
    refresh(p, req, (req.body as { preset?: unknown })?.preset);
    return state(p);
  });
  app.post("/api/party/team", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null,
      team = (req.body as PartyActions["team"])?.team;
    if (!party) return fail(409, "JOIN A PARTY FIRST");
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
    if (party.stage === "teams")
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
  app.post("/api/party/stage", async (req) => {
    const p = get(req),
      party = p.code ? parties.get(p.code) : null;
    if (!party || party.hostId !== p.member.id)
      return fail(403, "ONLY THE HOST CAN CONTINUE");
    const stage = (req.body as PartyActions["stage"])?.stage;
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
}
