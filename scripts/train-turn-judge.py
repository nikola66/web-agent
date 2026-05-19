#!/usr/bin/env python3
"""
Train the Web Agent turn-state classifier (MiniLM + 3-way head) and export ONNX.

Requires: python3 -m venv .venv-turn-judge && .venv-turn-judge/bin/pip install torch transformers datasets accelerate onnx onnxruntime onnxscript

Example:
  python scripts/train-turn-judge.py --data_dir data/turn-judge --out_dir models/turn-judge

Exports:
  model.onnx, turn-judge-int8.onnx (dynamic quant), tokenizer assets, labels.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

def load_rows(path: Path):
    rows = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data_dir", type=Path, default=Path("data/turn-judge"))
    ap.add_argument("--out_dir", type=Path, default=Path("models/turn-judge"))
    ap.add_argument("--base_model", type=str, default="nreimers/MiniLM-L6-H384-uncased")
    ap.add_argument("--epochs", type=int, default=0, help="0 = auto from dataset size")
    ap.add_argument("--batch_size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--max_length", type=int, default=384)
    ap.add_argument("--eval_after_train", action="store_true", default=True)
    ap.add_argument("--no_eval_after_train", action="store_false", dest="eval_after_train")
    args = ap.parse_args()

    try:
        import torch
        from datasets import Dataset
        from transformers import AutoModelForSequenceClassification, AutoTokenizer, Trainer, TrainingArguments
    except ImportError as e:
        raise SystemExit(
            "Missing deps. Install torch, transformers, datasets (see script docstring).\n"
            f"Import error: {e}"
        ) from e

    labels = ["CONTINUE", "STOP", "ASK_USER"]
    label2id = {l: i for i, l in enumerate(labels)}
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / "labels.json").write_text(json.dumps(labels), encoding="utf-8")

    train_rows = load_rows(args.data_dir / "train.jsonl")
    val_rows = load_rows(args.data_dir / "val.jsonl") if (args.data_dir / "val.jsonl").exists() else []
    if not train_rows:
        raise SystemExit("No training rows; run scripts/ingest-turn-judge-data.py first")

    epochs = args.epochs or (3 if len(train_rows) > 2000 else 3)

    def encode_split(rows):
        texts = [r["text"] for r in rows]
        y = [label2id[r["label"]] for r in rows]
        return {"text": texts, "label": y}

    train_ds = Dataset.from_dict(encode_split(train_rows))
    eval_ds = Dataset.from_dict(encode_split(val_rows)) if val_rows else None

    tokenizer = AutoTokenizer.from_pretrained(args.base_model)
    from collections import Counter

    counts = Counter(r["label"] for r in train_rows)
    total = sum(counts.values()) or 1
    class_weight = torch.tensor(
        [total / (len(labels) * max(counts.get(l, 1), 1)) for l in labels], dtype=torch.float32
    )

    model = AutoModelForSequenceClassification.from_pretrained(
        args.base_model, num_labels=len(labels), id2label={i: l for i, l in enumerate(labels)}, label2id=label2id
    )

    class WeightedTrainer(Trainer):
        def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
            labels_t = inputs.pop("labels")
            outputs = model(**inputs)
            loss_fn = torch.nn.CrossEntropyLoss(weight=class_weight.to(outputs.logits.device))
            loss = loss_fn(outputs.logits, labels_t)
            return (loss, outputs) if return_outputs else loss

    def tokenize(batch):
        return tokenizer(batch["text"], truncation=True, max_length=args.max_length, padding="max_length")

    train_ds = train_ds.map(tokenize, batched=True)
    if eval_ds:
        eval_ds = eval_ds.map(tokenize, batched=True)

    training_args = TrainingArguments(
        output_dir=str(args.out_dir / "hf_ckpt"),
        learning_rate=args.lr,
        per_device_train_batch_size=args.batch_size,
        num_train_epochs=epochs,
        eval_strategy="epoch" if eval_ds else "no",
        logging_steps=10,
        save_strategy="no",
        report_to=[],
    )

    trainer = WeightedTrainer(
        model=model,
        args=training_args,
        train_dataset=train_ds,
        eval_dataset=eval_ds,
    )
    trainer.train()
    model.eval()
    out_final = args.out_dir / "hf_final"
    trainer.save_model(str(out_final))
    tokenizer.save_pretrained(str(out_final))

    onnx_out = args.out_dir / "model.onnx"
    dummy = tokenizer("TASK: hello", return_tensors="pt")
    torch.onnx.export(
        model,
        (dummy["input_ids"], dummy["attention_mask"]),
        str(onnx_out),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch", 1: "seq"},
            "attention_mask": {0: "batch", 1: "seq"},
            "logits": {0: "batch"},
        },
        opset_version=14,
    )

    try:
        from onnxruntime.quantization import QuantType, quantize_dynamic

        quantize_dynamic(
            model_input=str(onnx_out),
            model_output=str(args.out_dir / "turn-judge-int8.onnx"),
            weight_type=QuantType.QInt8,
        )
    except Exception as exc:
        print(f"Skipping dynamic quant ({exc}); copy fp32 model as int8 path.")
        import shutil

        shutil.copy(onnx_out, args.out_dir / "turn-judge-int8.onnx")

    import shutil

    for name in ("config.json", "tokenizer_config.json", "tokenizer.json"):
        src = out_final / name
        if src.exists():
            shutil.copy(src, args.out_dir / name)
    onnx_out.unlink(missing_ok=True)
    shutil.rmtree(args.out_dir / "hf_ckpt", ignore_errors=True)
    shutil.rmtree(out_final, ignore_errors=True)
    print(f"Wrote ONNX + tokenizer under {args.out_dir}")

    if args.eval_after_train:
        import subprocess

        subprocess.run(
            [
                sys.executable,
                str(Path(__file__).resolve().parent / "eval-turn-judge.py"),
                "--model_dir",
                str(args.out_dir),
                "--data_dir",
                str(args.data_dir),
            ],
            check=False,
        )

if __name__ == "__main__":
    main()
