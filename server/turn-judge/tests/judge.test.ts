import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Fastify from "fastify";
import { judgeTurn } from "../src/turn-judge.js";

test("OPTIONS /judge answers CORS preflight", async () => {
  const app = Fastify();
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "content-type");
    if (request.method === "OPTIONS") {
      return reply.code(204).send();
    }
  });
  app.post("/judge", async () => ({ action: "stop" }));
  const res = await app.inject({ method: "OPTIONS", url: "/judge" });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  await app.close();
});

test("model-only judge returns model source when classifier loads", async (t) => {
  const modelDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../models/turn-judge"
  );
  if (!fs.existsSync(path.join(modelDir, "turn-judge-int8.onnx"))) {
    t.skip("ONNX model not present");
    return;
  }
  const r = await judgeTurn({
    messages: [
      { role: "user", content: "Stop all cron jobs" },
      { role: "assistant", content: "Done. All cron jobs have been stopped." },
    ],
    toolState: {
      executedToolsInTurn: true,
      lastToolNames: ["cron_register"],
      lastToolErrorCount: 0,
      totalToolCallsInTurn: 3,
    },
    runtimeState: {
      round: 2,
      maxRounds: 64,
      autoContinueNudges: 0,
      maxAutoContinueNudges: 20,
      textOnly: false,
      planMode: false,
    },
  });
  assert.equal(r.source, "model");
  assert.ok(r.confidence > 0);
});
