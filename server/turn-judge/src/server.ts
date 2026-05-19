import Fastify from "fastify";
import type { TurnJudgeRequest } from "./types.js";
import { judgeTurn } from "./turn-judge.js";

const app = Fastify({ logger: true });

app.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  reply.header("Access-Control-Allow-Headers", "content-type");
  if (request.method === "OPTIONS") {
    return reply.code(204).send();
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "web-agent-turn-judge",
}));

app.post("/judge", async (request, reply) => {
  const startedAt = Date.now();

  try {
    const body = request.body as TurnJudgeRequest;
    if (!body?.messages || !Array.isArray(body.messages)) {
      reply.code(400);
      return { error: "bad_request", detail: "messages required" };
    }
    const result = await judgeTurn(body);
    return {
      ...result,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    request.log.error(error);
    reply.code(200);
    return {
      action: "stop" as const,
      confidence: 0,
      reason: "judge_error_fallback_stop",
      source: "fallback" as const,
      latencyMs: Date.now() - startedAt,
    };
  }
});

const port = Number(process.env.TURN_JUDGE_PORT || 8787);
const host = process.env.TURN_JUDGE_HOST || "127.0.0.1";

await app.listen({ port, host });
