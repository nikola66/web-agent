/** Decode recorded audio to mono 16 kHz float32 for Whisper. */

export const WHISPER_SAMPLE_RATE = 16_000;

function mixToMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < buffer.length; i++) out[i] += ch[i] / buffer.numberOfChannels;
  }
  return out;
}

export function resampleTo16k(mono: Float32Array, sourceRate: number): Float32Array {
  if (sourceRate === WHISPER_SAMPLE_RATE) return mono;
  const outLen = Math.max(1, Math.round((mono.length * WHISPER_SAMPLE_RATE) / sourceRate));
  const out = new Float32Array(outLen);
  const ratio = sourceRate / WHISPER_SAMPLE_RATE;
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const lo = Math.floor(src);
    const hi = Math.min(lo + 1, mono.length - 1);
    const frac = src - lo;
    out[i] = (mono[lo] ?? 0) * (1 - frac) + (mono[hi] ?? 0) * frac;
  }
  return out;
}

async function decodeArrayBuffer(buf: ArrayBuffer): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    return resampleTo16k(mixToMono(decoded), decoded.sampleRate);
  } finally {
    await ctx.close();
  }
}

export async function decodeBlobToMono16k(blob: Blob): Promise<Float32Array> {
  return decodeArrayBuffer(await blob.arrayBuffer());
}

export async function decodeBytesToMono16k(
  bytes: Uint8Array,
  mimeHint = "audio/wav"
): Promise<Float32Array> {
  const copy = bytes.slice();
  const blob = new Blob([copy], { type: mimeHint });
  return decodeBlobToMono16k(blob);
}
