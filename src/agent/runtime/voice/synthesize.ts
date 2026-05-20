/**
 * Local TTS inside the Nodebox runtime via Kokoro-82M.
 *
 * Pipeline: text → `kokoro-js` (`KokoroTTS.generate`) → Float32 PCM at the
 * model's native 24 kHz → linear resample to 16 kHz mono → `@breezystack/lamejs`
 * MP3 encoder → Buffer. The buffer is what `sendTelegramAudio` POSTs to
 * Telegram's `sendAudio` endpoint.
 *
 * Why MP3 + sendAudio rather than OGG/Opus + sendVoice: a pure-JS OGG/Opus
 * encoder that runs reliably inside the Nodebox runtime is not available
 * today (the maintained options bind to native libopus, which the
 * WebContainer cannot load). MP3 via lamejs is rock-solid, pure JS,
 * 30 KB at runtime, and Telegram plays the result inline with full
 * controls. The dispatcher surfaces this as "voice reply (audio)" so
 * users understand the medium.
 *
 * Model files are mirrored into the Nodebox FS at boot by `adapter.ts`
 * (`writeModelAssets`). `env.allowRemoteModels = false` is enforced via
 * the existing `transformers-env.ts` helper — Kokoro itself sits on top
 * of `@huggingface/transformers`, so the same gate applies.
 */

import fs from "node:fs/promises";
import nodePath from "node:path";
import { workspaceStatePath } from "../constants.js";
import { logDebugEvent } from "../logging/debug-log.js";

const KOKORO_REL = ".webagent/models/onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_VOICE = "af_bella";
const MP3_SAMPLE_RATE = 16_000;
const MP3_KBPS = 48;
const MAX_TTS_CHARS = 2_500;

type KokoroAudio = {
  audio: Float32Array;
  sampling_rate: number;
  toWav?: () => Uint8Array;
  save?: (path: string) => Promise<void>;
};
type KokoroPipeline = {
  generate(text: string, options?: { voice?: string }): Promise<KokoroAudio>;
};

let cachedPipeline: Promise<KokoroPipeline> | null = null;

async function loadKokoro(): Promise<KokoroPipeline> {
  if (cachedPipeline) return cachedPipeline;
  cachedPipeline = (async () => {
    const modelAbs = workspaceStatePath(KOKORO_REL);
    try {
      await fs.access(nodePath.join(modelAbs, "config.json"));
    } catch (err) {
      throw new Error(
        `Kokoro model files missing at ${modelAbs}. Adapter should have mirrored ` +
          `public/models/onnx-community/Kokoro-82M-v1.0-ONNX/ into Nodebox at boot — ` +
          `if this is a fresh deploy, rebuild and verify writeModelAssets ran. ` +
          `Original: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const transformers = (await import("@huggingface/transformers")) as typeof import("@huggingface/transformers");
    transformers.env.allowLocalModels = true;
    transformers.env.allowRemoteModels = false;
    transformers.env.localModelPath = workspaceStatePath(".webagent/models") + nodePath.sep;

    const { KokoroTTS } = (await import("kokoro-js")) as typeof import("kokoro-js");
    const pipe = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
      dtype: "q8f16",
      device: "wasm",
    });
    return pipe as unknown as KokoroPipeline;
  })().catch((err) => {
    cachedPipeline = null;
    throw err;
  });
  return cachedPipeline;
}

function linearResample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.floor(input.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const srcIndex = i * ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = srcIndex - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

function floatToInt16(buf: Float32Array): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

async function encodePcmToMp3(pcm: Int16Array, sampleRate: number): Promise<Buffer> {
  const lamejs = (await import("@breezystack/lamejs")) as typeof import("@breezystack/lamejs");
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, MP3_KBPS);
  const chunks: Uint8Array[] = [];
  const sampleBlockSize = 1152;
  for (let i = 0; i < pcm.length; i += sampleBlockSize) {
    const slice = pcm.subarray(i, i + sampleBlockSize);
    const buf = encoder.encodeBuffer(slice);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));
  }
  const flushed = encoder.flush();
  if (flushed.length > 0) chunks.push(new Uint8Array(flushed));

  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = Buffer.allocUnsafe(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface SynthesizeResult {
  mp3: Buffer;
  durationSec: number;
  synthMs: number;
  encodeMs: number;
  voice: string;
}

export async function synthesizeMp3(text: string, voice = DEFAULT_VOICE): Promise<SynthesizeResult> {
  const trimmed = String(text || "").trim().slice(0, MAX_TTS_CHARS);
  if (!trimmed) {
    return {
      mp3: Buffer.alloc(0),
      durationSec: 0,
      synthMs: 0,
      encodeMs: 0,
      voice,
    };
  }

  const pipeline = await loadKokoro();
  const synthStart = Date.now();
  const audio = await pipeline.generate(trimmed, { voice });
  const synthMs = Date.now() - synthStart;

  const sourceRate = Math.round(audio.sampling_rate || 24_000);
  const mono =
    sourceRate === MP3_SAMPLE_RATE
      ? audio.audio
      : linearResample(audio.audio, sourceRate, MP3_SAMPLE_RATE);
  const pcm = floatToInt16(mono);

  const encodeStart = Date.now();
  const mp3 = await encodePcmToMp3(pcm, MP3_SAMPLE_RATE);
  const encodeMs = Date.now() - encodeStart;

  const durationSec = mono.length / MP3_SAMPLE_RATE;
  await logDebugEvent("voice_synthesized", {
    voice,
    chars: trimmed.length,
    durationSec: Math.round(durationSec * 100) / 100,
    synthMs,
    encodeMs,
    mp3Bytes: mp3.byteLength,
  });

  return { mp3, durationSec, synthMs, encodeMs, voice };
}
