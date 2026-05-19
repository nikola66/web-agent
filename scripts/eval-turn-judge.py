#!/usr/bin/env python3
"""
Evaluate turn-judge ONNX on val/test JSONL and gate deploy on accuracy + confidence.

Example:
  python scripts/eval-turn-judge.py --min_accuracy 0.95 --min_high_conf_correct 0.99
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path


def load_rows(path: Path) -> list[dict]:
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def softmax(logits):
    import math

    m = max(logits)
    exps = [math.exp(x - m) for x in logits]
    s = sum(exps) or 1.0
    return [e / s for e in exps]


def run_eval(model_dir: Path, rows: list[dict], labels: list[str]) -> dict:
    try:
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer
    except ImportError as e:
        raise SystemExit("Missing deps: pip install onnxruntime transformers") from e

    onnx_path = model_dir / "turn-judge-int8.onnx"
    if not onnx_path.exists():
        onnx_path = model_dir / "model.onnx"
    if not onnx_path.exists():
        raise SystemExit(f"No ONNX model in {model_dir}")

    label2id = {l: i for i, l in enumerate(labels)}
    tokenizer = AutoTokenizer.from_pretrained(str(model_dir), local_files_only=True)
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])

    y_true = []
    y_pred = []
    confidences = []
    correct_conf = []

    for row in rows:
        text = row["text"]
        gold = row["label"]
        enc = tokenizer(text, truncation=True, max_length=384, padding="max_length", return_tensors="np")
        feeds = {
            "input_ids": enc["input_ids"].astype("int64"),
            "attention_mask": enc["attention_mask"].astype("int64"),
        }
        out = sess.run(None, feeds)[0]
        if out.ndim > 1:
            logits = out[0]
        else:
            logits = out
        probs = softmax(logits.tolist())
        best = int(max(range(len(probs)), key=lambda i: probs[i]))
        pred = labels[best]
        conf = probs[best]
        y_true.append(gold)
        y_pred.append(pred)
        confidences.append(conf)
        if pred == gold:
            correct_conf.append(conf)

    return {
        "y_true": y_true,
        "y_pred": y_pred,
        "confidences": confidences,
        "correct_conf": correct_conf,
    }


def metrics(labels: list[str], y_true: list[str], y_pred: list[str], confidences: list[float], correct_conf: list[float]) -> dict:
    n = len(y_true)
    acc = sum(1 for a, b in zip(y_true, y_pred) if a == b) / n if n else 0.0
    high_conf_correct = (
        sum(1 for c in correct_conf if c >= 0.99) / len(correct_conf) if correct_conf else 0.0
    )
    by_class = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    for gold, pred in zip(y_true, y_pred):
        for lab in labels:
            if gold == lab and pred == lab:
                by_class[lab]["tp"] += 1
            elif pred == lab and gold != lab:
                by_class[lab]["fp"] += 1
            elif gold == lab and pred != lab:
                by_class[lab]["fn"] += 1
    stop_fc = 0
    for gold, pred in zip(y_true, y_pred):
        if gold == "STOP" and pred == "CONTINUE":
            stop_fc += 1
    return {
        "n": n,
        "accuracy": acc,
        "pct_correct_ge_0_99": high_conf_correct,
        "mean_confidence": sum(confidences) / n if n else 0.0,
        "false_continue_on_stop": stop_fc / max(1, sum(1 for g in y_true if g == "STOP")),
        "per_class": dict(by_class),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data_dir", type=Path, default=Path("data/turn-judge"))
    ap.add_argument("--model_dir", type=Path, default=Path("models/turn-judge"))
    ap.add_argument("--min_accuracy", type=float, default=0.95)
    ap.add_argument("--min_high_conf_correct", type=float, default=0.99)
    ap.add_argument("--max_false_continue", type=float, default=0.02)
    ap.add_argument("--fail_on_threshold", action="store_true", default=True)
    args = ap.parse_args()

    labels = json.loads((args.model_dir / "labels.json").read_text(encoding="utf-8"))
    val_rows = load_rows(args.data_dir / "val.jsonl")
    test_rows = load_rows(args.data_dir / "test.jsonl")
    all_rows = val_rows + test_rows
    if not all_rows:
        raise SystemExit("No val/test rows")

    result = run_eval(args.model_dir, all_rows, labels)
    m = metrics(labels, result["y_true"], result["y_pred"], result["confidences"], result["correct_conf"])

    print(json.dumps(m, indent=2))
    ok = (
        m["accuracy"] >= args.min_accuracy
        and m["pct_correct_ge_0_99"] >= args.min_high_conf_correct
        and m["false_continue_on_stop"] <= args.max_false_continue
    )
    if args.fail_on_threshold and not ok:
        print(
            f"FAIL thresholds: accuracy>={args.min_accuracy}, "
            f"high_conf_correct>={args.min_high_conf_correct}, "
            f"false_continue<={args.max_false_continue}",
            file=sys.stderr,
        )
        sys.exit(1)
    print("PASS deploy thresholds")


if __name__ == "__main__":
    main()
