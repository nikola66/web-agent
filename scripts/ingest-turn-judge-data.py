#!/usr/bin/env python3
"""
Ingest open agent-trajectory datasets into turn-judge JSONL (train/val/test).

Silver labels (offline only):
  CONTINUE — more steps remain in the episode
  STOP     — terminal step in the episode
  ASK_USER — from seed rows only (sparse)

Example:
  python scripts/ingest-turn-judge-data.py
  python scripts/ingest-turn-judge-data.py --max_total_rows 10000
  python scripts/ingest-turn-judge-data.py --seeds_only
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

TASK_HEADER = "TASK: Decide whether Web Agent should continue, stop, or ask the user."


def serialize_judge_input(
    messages: list[dict[str, str]],
    tool_state: dict,
    runtime_state: dict,
) -> str:
    last_messages = messages[-3:]
    lines = [
        TASK_HEADER,
        "",
        "MESSAGES:",
        *[f"{m['role'].upper()}: {m['content'][:1500]}" for m in last_messages],
        "",
        "TOOL_STATE:",
        json.dumps(tool_state, separators=(",", ":")),
        "",
        "RUNTIME_STATE:",
        json.dumps(runtime_state, separators=(",", ":")),
    ]
    return "\n".join(lines)


def default_runtime(round_n: int = 2) -> dict:
    return {
        "round": round_n,
        "maxRounds": 64,
        "autoContinueNudges": 0,
        "maxAutoContinueNudges": 20,
        "textOnly": False,
        "planMode": False,
    }


def step_text(step: dict) -> str:
    parts: list[str] = []
    for key in ("thought", "response", "text", "action"):
        val = step.get(key)
        if isinstance(val, str) and val.strip():
            parts.append(val.strip())
    obs = step.get("observation")
    if isinstance(obs, str) and obs.strip():
        parts.append(obs.strip()[:400])
    return "\n\n".join(parts)[:4000]


def tool_names_from_action(action: str) -> list[str]:
    a = (action or "").strip().lower()
    if not a:
        return []
    if a.startswith("bash") or "shell" in a:
        return ["run_shell"]
    if "edit" in a:
        return ["edit_file"]
    if "read" in a:
        return ["read_file"]
    if "grep" in a or "find" in a:
        return ["grep"]
    return ["run_shell"]


def rows_from_trajectory(
    user_goal: str,
    trajectory: list,
    *,
    start_round: int = 2,
) -> list[dict]:
    if not trajectory:
        return []
    steps = [s for s in trajectory if isinstance(s, dict)]
    if not steps:
        return []
    goal = (user_goal or "Solve the software engineering task.").strip()[:4000]
    out: list[dict] = []
    n = len(steps)
    tool_calls = 0
    for i, step in enumerate(steps):
        assistant = step_text(step)
        action = str(step.get("action") or "")
        has_tool = bool(action.strip())
        if has_tool:
            tool_calls += 1
        is_last = i >= n - 1
        label = "STOP" if is_last else "CONTINUE"
        tool_state = {
            "executedToolsInTurn": has_tool,
            "lastToolNames": tool_names_from_action(action) if has_tool else [],
            "lastToolErrorCount": 0,
            "totalToolCallsInTurn": max(tool_calls, 1 if has_tool else 0),
            "webSearchCount": 0,
            "webFetchCount": 0,
        }
        messages = [
            {"role": "user", "content": goal},
            {"role": "assistant", "content": assistant or (" " if has_tool else "Done.")},
        ]
        text = serialize_judge_input(
            messages,
            tool_state,
            default_runtime(start_round + i),
        )
        out.append({"text": text, "label": label})
    return out


def load_seed_rows(data_dir: Path) -> list[dict]:
    rows: list[dict] = []
    for name in ("train.jsonl", "val.jsonl", "test.jsonl"):
        path = data_dir / name
        if not path.exists():
            continue
        with path.open(encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
    return rows


def ingest_swe_agent(max_samples: int, seed: int) -> list[dict]:
    try:
        from datasets import load_dataset
    except ImportError as e:
        raise SystemExit("Install datasets: .venv-turn-judge/bin/pip install datasets") from e

    rows: list[dict] = []
    print(f"Streaming nebius/SWE-agent-trajectories (max {max_samples} rows)...")
    ds = load_dataset("nebius/SWE-agent-trajectories", split="train", streaming=True)
    for ex in ds:
        traj = ex.get("trajectory")
        if not isinstance(traj, list) or len(traj) < 2:
            continue
        goal = str(
            ex.get("problem_statement")
            or ex.get("issue")
            or ex.get("instance_id")
            or "Fix the repository issue."
        )
        rows.extend(rows_from_trajectory(goal, traj))
        if len(rows) >= max_samples:
            break
    random.Random(seed).shuffle(rows)
    return rows[:max_samples]


def split_rows(rows: list[dict], seed: int) -> tuple[list[dict], list[dict], list[dict]]:
    rng = random.Random(seed)
    rng.shuffle(rows)
    n = len(rows)
    test_n = max(1, int(n * 0.08))
    val_n = max(1, int(n * 0.12))
    test = rows[:test_n]
    val = rows[test_n : test_n + val_n]
    train = rows[test_n + val_n :]
    return train, val, test


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data_dir", type=Path, default=Path("data/turn-judge"))
    ap.add_argument(
        "--max_total_rows",
        type=int,
        default=10_000,
        help="Hard cap on train+val+test rows (default 10000)",
    )
    ap.add_argument(
        "--max_samples",
        type=int,
        default=0,
        help="Max rows from open HF data (0 = auto: max_total_rows minus seeds)",
    )
    ap.add_argument("--seeds_only", action="store_true")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    if args.max_total_rows < 100 or args.max_total_rows > 10_000:
        raise SystemExit("--max_total_rows must be between 100 and 10000")

    seed_rows = load_seed_rows(args.data_dir)
    ask_seeds = [r for r in seed_rows if r.get("label") == "ASK_USER"]
    other_seeds = [r for r in seed_rows if r.get("label") != "ASK_USER"]
    seed_count = len(other_seeds) + len(ask_seeds)

    if args.seeds_only:
        open_rows = []
    else:
        open_budget = args.max_samples or max(0, args.max_total_rows - seed_count)
        try:
            open_rows = ingest_swe_agent(open_budget, args.seed)
        except Exception as exc:
            print(f"Open-data ingest failed ({exc}); using seeds only.", flush=True)
            open_rows = []

    combined = open_rows + other_seeds + ask_seeds

    if not combined:
        raise SystemExit("No rows produced. Use --seeds_only or check HF access.")

    if len(combined) > args.max_total_rows:
        rng = random.Random(args.seed)
        rng.shuffle(combined)
        combined = combined[: args.max_total_rows]

    train, val, test = split_rows(combined, args.seed)

    write_jsonl(args.data_dir / "train.jsonl", train)
    write_jsonl(args.data_dir / "val.jsonl", val)
    write_jsonl(args.data_dir / "test.jsonl", test)
    total = len(train) + len(val) + len(test)
    print(
        f"Wrote {len(train)} train, {len(val)} val, {len(test)} test "
        f"({total} total, cap {args.max_total_rows}; "
        f"{len(open_rows)} open, {seed_count} seeds)"
    )


if __name__ == "__main__":
    main()
