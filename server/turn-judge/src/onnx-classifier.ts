import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as ort from "onnxruntime-node";
import { AutoTokenizer, env } from "@xenova/transformers";

export type ClassifierDecision = {
  action: "continue" | "stop" | "ask_user";
  confidence: number;
  reason: string;
};

type Loaded = {
  session: ort.InferenceSession;
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  labels: string[];
};

let loadPromise: Promise<Loaded | null> | null = null;

function softmax(logits: Float32Array): Float32Array {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > max) max = logits[i];
  const out = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    out[i] = Math.exp(logits[i] - max);
    sum += out[i];
  }
  for (let i = 0; i < logits.length; i++) out[i] /= sum || 1;
  return out;
}

function labelToAction(label: string): ClassifierDecision["action"] {
  const u = String(label || "").toUpperCase();
  if (u === "CONTINUE") return "continue";
  if (u === "ASK_USER") return "ask_user";
  return "stop";
}

function defaultModelDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../models/turn-judge");
}

async function loadClassifier(): Promise<Loaded | null> {
  const modelDir = path.resolve(process.env.TURN_JUDGE_MODEL_DIR || defaultModelDir());
  const onnxPath = path.resolve(process.env.TURN_JUDGE_MODEL_PATH || path.join(modelDir, "turn-judge-int8.onnx"));
  const labelsPath = path.join(modelDir, "labels.json");
  if (!fs.existsSync(onnxPath) || !fs.existsSync(labelsPath)) return null;
  let labels: string[];
  try {
    labels = JSON.parse(fs.readFileSync(labelsPath, "utf8")) as string[];
    if (!Array.isArray(labels) || labels.length < 2) return null;
  } catch {
    return null;
  }
  const modelParent = path.dirname(modelDir);
  const modelId = path.basename(modelDir);
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = modelParent.endsWith(path.sep) ? modelParent : `${modelParent}${path.sep}`;
  const tokenizer = await AutoTokenizer.from_pretrained(modelId, {
    local_files_only: true,
    quantized: false,
  });
  const session = await ort.InferenceSession.create(onnxPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });
  return { session, tokenizer, labels };
}

function getLoadPromise(): Promise<Loaded | null> {
  if (!loadPromise) loadPromise = loadClassifier().catch(() => null);
  return loadPromise;
}

function toOnnxTensor(name: string, tensor: { dims: number[]; type: string; data: ArrayLike<number> | bigint[] }) {
  const dims = tensor.dims.map(Number);
  if (name === "attention_mask" || tensor.type?.includes("int")) {
    const data = tensor.data;
    const flat = data instanceof Float32Array ? Array.from(data).map((n) => Math.round(n)) : Array.from(data as ArrayLike<number>);
    const int64 = new BigInt64Array(flat.length);
    for (let i = 0; i < flat.length; i++) int64[i] = BigInt(flat[i] ?? 0);
    return new ort.Tensor("int64", int64, dims);
  }
  const f32 = Float32Array.from(tensor.data as ArrayLike<number>);
  return new ort.Tensor("float32", f32, dims);
}

export async function runClassifier(text: string): Promise<ClassifierDecision> {
  const loaded = await getLoadPromise();
  if (!loaded) {
    return { action: "stop", confidence: 0.01, reason: "classifier_unavailable" };
  }
  try {
    const enc = await loaded.tokenizer(text, {
      truncation: true,
      max_length: 384,
      padding: true,
    });
    const feeds: Record<string, ort.Tensor> = {};
    const inputIds = enc.input_ids;
    const attn = enc.attention_mask;
    if (!inputIds?.dims || !inputIds?.data) {
      return { action: "stop", confidence: 0.01, reason: "tokenize_failed" };
    }
    feeds.input_ids = toOnnxTensor("input_ids", inputIds);
    if (attn?.data && attn?.dims) {
      feeds.attention_mask = toOnnxTensor("attention_mask", attn);
    }
    const outputs = await loaded.session.run(feeds);
    const firstOut = Object.values(outputs)[0];
    if (!firstOut || !("data" in firstOut)) {
      return { action: "stop", confidence: 0.01, reason: "bad_onnx_output" };
    }
    const data = firstOut.data as Float32Array;
    const logits =
      data.length === loaded.labels.length
        ? data
        : data.length % loaded.labels.length === 0
          ? data.slice(-loaded.labels.length)
          : data.slice(0, loaded.labels.length);
    const probs = softmax(logits instanceof Float32Array ? logits : Float32Array.from(logits as ArrayLike<number>));
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    const label = loaded.labels[best] ?? "STOP";
    return {
      action: labelToAction(label),
      confidence: Number(probs[best] ?? 0),
      reason: `label:${label}`,
    };
  } catch {
    return { action: "stop", confidence: 0.01, reason: "classifier_inference_error" };
  }
}
