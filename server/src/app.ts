import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";

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
export async function createApp(config: ServerConfig) {
  const app = Fastify({
    logger: false,
    bodyLimit: 32768,
    trustProxy: config.trustProxy,
    requestTimeout: 15000,
    routerOptions: { maxParamLength: 100 },
  });
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
    const allowedOrigin =
      !!origin &&
      (config.origins.includes(origin) ||
        (config.allowSameOrigin === true &&
          origin === `${req.protocol}://${req.headers.host}`));
    if (origin && !allowedOrigin)
      throw new ApiFault(
        403,
        "ORIGIN_DENIED",
        "This frontend origin is not allowed.",
      );
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!origin || !allowedOrigin || req.headers["x-arena-client"] !== "1")
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
    console.error("Party API internal error");
    return reply.code(503).send({
      error: {
        code: "UNAVAILABLE",
        message: "Party service is temporarily unavailable. Please try again.",
      },
    });
  });
  app.get("/api/health", async () => ({ ok: true, version: 1 }));
  app.get("/health", async () => ({ status: "ok" }));
  const partyMatches = await registerParties(app, config);
  return { app, partyMatches };
}
