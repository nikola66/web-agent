import test from "node:test";
import assert from "node:assert/strict";

import { resampleTo16k, WHISPER_SAMPLE_RATE } from "../src/core/voice/audio-decode.ts";

test("resampleTo16k preserves length ratio for simple downsampling", () => {
  const sourceRate = 48_000;
  const seconds = 1;
  const source = new Float32Array(sourceRate * seconds);
  for (let i = 0; i < source.length; i++) source[i] = Math.sin(i / 100);
  const out = resampleTo16k(source, sourceRate);
  assert.equal(out.length, WHISPER_SAMPLE_RATE * seconds);
});

test("resampleTo16k is identity at 16 kHz", () => {
  const source = new Float32Array([0, 0.5, -0.5, 1]);
  const out = resampleTo16k(source, WHISPER_SAMPLE_RATE);
  assert.deepEqual(Array.from(out), Array.from(source));
});
