import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { serializeJudgeInput } from "../src/serialize-judge-input.js";
import type { TurnJudgeRequest } from "../src/types.js";

const goldenPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../tests/fixtures/turn-judge-serialize-golden.json"
);

test("serializeJudgeInput matches golden fixture", () => {
  const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8")) as {
    input: TurnJudgeRequest;
    text: string;
  };
  assert.equal(serializeJudgeInput(golden.input), golden.text);
});
