import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";
import { credentialsSchema, saveSchema } from "../../shared/accounts.js";
import { Store } from "./database.js";
import type { ServerConfig } from "./config.js";
import { registerParties } from "./parties.js";
class ApiFault extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
};
export async function createApp(config: ServerConfig) {
  const app = Fastify({
    logger: false,
    bodyLimit: 32768,
    trustProxy: config.trustProxy,
    requestTimeout: 15000,
    routerOptions: { maxParamLength: 100 },
  });
  const store = new Store(config.database),
    sessionName = config.production ? "__Host-oa_session" : "oa_session";
  const dummyHash = await argon2.hash(randomBytes(32), passwordOptions);
  let passwordJobs = 0;
  const passwordWork = async <T>(work: () => Promise<T>) => {
    if (passwordJobs >= 4)
      throw new ApiFault(503, "BUSY", "Please try again in a moment.");
    passwordJobs++;
    try {
      return await work();
    } finally {
      passwordJobs--;
    }
  };
  const parse = <T>(
    schema: {
      safeParse: (
        body: unknown,
      ) =>
        | { success: true; data: T }
        | { success: false; error: { issues: { message: string }[] } };
    },
    body: unknown,
  ): T => {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      throw new ApiFault(
        400,
        "INVALID_DATA",
        parsed.error.issues[0]?.message ?? "Invalid request.",
      );
    return parsed.data;
  };
  const cookieOptions = {
    httpOnly: true,
    secure: config.production,
    sameSite: config.production ? ("none" as const) : ("lax" as const),
    path: "/",
    partitioned: config.production,
    maxAge: config.sessionSeconds,
  };
  await app.register(cookie);
  await app.register(cors, {
    origin: config.origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Arena-Client", "X-Arena-Party"],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    max: config.requestLimit ?? 180,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: {
        code: "RATE_LIMIT",
        message: "Too many requests. Please wait a minute.",
      },
    }),
  });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
    if (config.production)
      reply.header("Strict-Transport-Security", "max-age=31536000");
    const origin = req.headers.origin;
    if (origin && !config.origins.includes(origin))
      throw new ApiFault(
        403,
        "ORIGIN_DENIED",
        "This frontend origin is not allowed.",
      );
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        !origin ||
        !config.origins.includes(origin) ||
        req.headers["x-arena-client"] !== "1"
      )
        throw new ApiFault(
          403,
          "ORIGIN_DENIED",
          "Request origin could not be verified.",
        );
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new ApiFault(415, "CONTENT_TYPE", "Send JSON requests.");
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if ((error as { partyFault?: boolean }).partyFault)
      return reply
        .code((error as { statusCode: number }).statusCode)
        .send({ error: { code: "PARTY", message: (error as Error).message } });
    if (error instanceof ApiFault)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({
        error: {
          code: "INVALID_REQUEST",
          message:
            status === 429
              ? "Too many requests. Please wait a minute."
              : "The request could not be accepted.",
        },
      });
    // Never log request bodies, credentials, database rows or exception stacks.
    console.error("Account API internal error");
    return reply.code(503).send({
      error: {
        code: "UNAVAILABLE",
        message:
          "Account service is temporarily unavailable. Please try again.",
      },
    });
  });
  const authenticated = (token: unknown) => {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new ApiFault(401, "SIGNED_OUT", "Please log in.");
    const row = store.db
      .prepare(
        "SELECT account_id FROM sessions WHERE token_hash=? AND expires_at>?",
      )
      .get(digest(token), Date.now());
    if (!row) throw new ApiFault(401, "SIGNED_OUT", "Please log in.");
    return String(row.account_id);
  };
  const newSession = (id: string, old: unknown) => {
    const token = randomBytes(32).toString("base64url"),
      now = Date.now();
    store.transaction(() => {
      store.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
      if (typeof old === "string")
        store.db
          .prepare("DELETE FROM sessions WHERE token_hash=?")
          .run(digest(old));
      store.db
        .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
        .run(digest(token), id, now + config.sessionSeconds * 1000, now);
      store.db
        .prepare(
          "DELETE FROM sessions WHERE account_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE account_id=? ORDER BY created_at DESC LIMIT 10)",
        )
        .run(id, id);
    });
    return token;
  };
  const authRate = {
    rateLimit: { max: config.authLimit, timeWindow: "1 minute" },
  };
  app.get("/api/health", async () => ({ ok: true, version: 1 }));
  app.post("/api/auth/register", { config: authRate }, async (req, reply) => {
    const { username, password } = parse(credentialsSchema, req.body);
    const hash = await passwordWork(() =>
      argon2.hash(password, passwordOptions),
    );
    let id: string;
    try {
      id = store.create(username, hash);
    } catch (error) {
      if (
        store.db
          .prepare("SELECT id FROM accounts WHERE username_key=?")
          .get(username.toLowerCase())
      )
        throw new ApiFault(
          409,
          "USERNAME_TAKEN",
          "That username is already taken.",
        );
      throw error;
    }
    const token = newSession(id, req.cookies[sessionName]);
    reply.setCookie(sessionName, token, cookieOptions);
    return reply.code(201).send({ account: store.account(id) });
  });
  app.post("/api/auth/login", { config: authRate }, async (req, reply) => {
    const { username, password } = parse(credentialsSchema, req.body);
    const user = store.db
      .prepare("SELECT id,password_hash FROM accounts WHERE username_key=?")
      .get(username.toLowerCase());
    const valid = await passwordWork(() =>
      argon2.verify(user ? String(user.password_hash) : dummyHash, password),
    );
    if (!user || !valid)
      throw new ApiFault(
        401,
        "INVALID_LOGIN",
        "Username or password is incorrect.",
      );
    const id = String(user.id),
      token = newSession(id, req.cookies[sessionName]);
    reply.setCookie(sessionName, token, cookieOptions);
    return { account: store.account(id) };
  });
  app.post("/api/auth/logout", async (req, reply) => {
    const token = req.cookies[sessionName];
    if (token)
      store.db
        .prepare("DELETE FROM sessions WHERE token_hash=?")
        .run(digest(token));
    reply.clearCookie(sessionName, cookieOptions);
    return reply.code(204).send();
  });
  app.get("/api/me", async (req) => ({
    account: store.account(authenticated(req.cookies[sessionName])),
  }));
  app.put("/api/me/save", async (req) => {
    const id = authenticated(req.cookies[sessionName]),
      data = parse(saveSchema, req.body),
      result = store.save(id, data);
    if (result === "conflict")
      throw new ApiFault(
        409,
        "SAVE_CONFLICT",
        "This account was updated on another device. Load its latest save before changing it.",
      );
    if (result === "unowned")
      throw new ApiFault(
        403,
        "NOT_OWNED",
        "That item or title has not been unlocked.",
      );
    return { account: store.account(id) };
  });
  registerParties(app, config, (req) => {
    try {
      return store.account(authenticated(req.cookies[sessionName]));
    } catch {
      return null;
    }
  });
  app.addHook("onClose", async () => store.close());
  return { app, store, authenticated };
}
