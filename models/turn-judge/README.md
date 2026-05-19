# Turn judge model artifacts

Pre-trained ONNX classifier shipped with Web Agent. The sidecar loads these files by default (`server/turn-judge` → `models/turn-judge/`). **Do not delete** unless you replace them after retraining.

## Required files

| File | Role |
|------|------|
| `turn-judge-int8.onnx` | Runtime graph (~900 KB) |
| `model.onnx.data` | External weights (~87 MB, Git LFS) |
| `config.json` | Hugging Face model config for tokenizer |
| `tokenizer.json` | Tokenizer vocabulary |
| `tokenizer_config.json` | Tokenizer metadata |
| `labels.json` | Class labels: `CONTINUE`, `STOP`, `ASK_USER` |

## Not shipped (gitignored if present locally)

`hf_ckpt/`, `hf_final/`, and `model.onnx` are training leftovers — safe to delete. Optional retrain: [docs/turn-judge.md](../../docs/turn-judge.md).

## Clone note

Weights use Git LFS:

```bash
git lfs install
git lfs pull
```
