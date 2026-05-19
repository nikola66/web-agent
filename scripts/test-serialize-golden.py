#!/usr/bin/env python3
"""Verify Python serialize matches tests/fixtures/turn-judge-serialize-golden.json."""

import json
import sys
from pathlib import Path

import importlib.util

ROOT = Path(__file__).resolve().parents[1]
_spec = importlib.util.spec_from_file_location(
    "ingest_turn_judge_data", ROOT / "scripts/ingest-turn-judge-data.py"
)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)
serialize_judge_input = _mod.serialize_judge_input

golden = json.loads((ROOT / "tests/fixtures/turn-judge-serialize-golden.json").read_text(encoding="utf-8"))
inp = golden["input"]
text = serialize_judge_input(inp["messages"], inp["toolState"], inp["runtimeState"])
if text != golden["text"]:
    print("serialize mismatch", file=sys.stderr)
    sys.exit(1)
print("serialize golden OK")
