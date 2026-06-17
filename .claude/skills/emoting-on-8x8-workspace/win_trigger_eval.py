#!/usr/bin/env python3
"""Windows-safe skill-triggering evaluator.

The official skill-creator run_eval.py uses select.select() on subprocess pipes,
which fails on Windows (WinError 10038 — pipes aren't sockets). This reimplements
just the triggering measurement with a blocking thread-read, and restricts the
nested `claude -p` agents to read-only tools (Skill, Read) so they can't edit
files or hit the LED board.

Detection mirrors run_eval.py's first-tool-use logic, but targets the actually
installed skill: since emoting-on-8x8 lives in .claude/skills/, a temp command
would compete with it. So a query "triggers" if the model's first tool use is the
Skill tool naming emoting-on-8x8 (or a Read of its SKILL.md). To test a different
description, edit SKILL.md and re-run.
"""
import json, os, re, sys, time, uuid, argparse, threading, subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

PROJECT_ROOT = Path(__file__).resolve().parents[3]   # ...\peckworks-esp32s3matrix
SKILL_MD = PROJECT_ROOT / ".claude" / "skills" / "emoting-on-8x8" / "SKILL.md"


def read_description() -> str:
    text = SKILL_MD.read_text(encoding="utf-8")
    m = re.search(r"^description:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def detect_from_line(ev, state, clean_name):
    """Apply the same first-tool-use detection as run_eval.py. Returns
    True/False once decided, else None."""
    t = ev.get("type")
    if t == "stream_event":
        se = ev.get("event", {}); st = se.get("type", "")
        if st == "content_block_start":
            cb = se.get("content_block", {})
            if cb.get("type") == "tool_use":
                nm = cb.get("name", "")
                if nm in ("Skill", "Read"):
                    state["pending"] = nm; state["acc"] = ""
                else:
                    return False
        elif st == "content_block_delta" and state.get("pending"):
            d = se.get("delta", {})
            if d.get("type") == "input_json_delta":
                state["acc"] += d.get("partial_json", "")
                if clean_name in state["acc"]:
                    return True
        elif st in ("content_block_stop", "message_stop"):
            if state.get("pending"):
                return clean_name in state["acc"]
            if st == "message_stop":
                return False
    elif t == "assistant":
        for ci in ev.get("message", {}).get("content", []):
            if ci.get("type") != "tool_use":
                continue
            nm = ci.get("name", ""); inp = ci.get("input", {})
            if nm == "Skill" and clean_name in inp.get("skill", ""):
                return True
            if nm == "Read" and clean_name in inp.get("file_path", ""):
                return True
            return False
    elif t == "result":
        return False
    return None


SKILL_NAME = "emoting-on-8x8"


def run_single(query, description, model, timeout=150):
    clean_name = SKILL_NAME   # detect the actually-installed skill
    env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
    cmd = ["claude", "-p", query, "--output-format", "stream-json", "--verbose",
           "--include-partial-messages", "--model", model,
           "--allowedTools", "Skill", "Read"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         cwd=str(PROJECT_ROOT), env=env, text=True,
                         encoding="utf-8", errors="replace", bufsize=1)
    timer = threading.Timer(timeout, p.kill); timer.start()
    state, decided = {}, None
    try:
        for line in p.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            d = detect_from_line(ev, state, clean_name)
            if d is not None:
                decided = d
                break
    finally:
        timer.cancel()
        if p.poll() is None:
            p.kill()
        try:
            p.wait(timeout=5)
        except Exception:
            pass
    return bool(decided)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval-set", required=True)
    ap.add_argument("--model", default="claude-opus-4-8")
    ap.add_argument("--reps", type=int, default=3)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    evals = json.loads(Path(args.eval_set).read_text(encoding="utf-8"))
    desc = read_description()
    print(f"Description under test ({len(desc)} chars):\n{desc}\n", flush=True)
    print(f"{len(evals)} queries x {args.reps} reps, model={args.model}\n", flush=True)

    # Build the full job list (query_idx, rep)
    jobs = [(i, r) for i in range(len(evals)) for r in range(args.reps)]
    counts = [0] * len(evals)

    def work(job):
        i, _ = job
        return i, run_single(evals[i]["query"], desc, args.model)

    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(work, j) for j in jobs]
        for fut in as_completed(futs):
            i, trig = fut.result()
            if trig:
                counts[i] += 1
            done += 1
            print(f"  [{done}/{len(jobs)}] q{i} -> {'TRIGGER' if trig else 'no'}", flush=True)

    print("\n=== RESULTS ===", flush=True)
    rows, correct, fp, fn = [], 0, [], []
    for i, e in enumerate(evals):
        rate = counts[i] / args.reps
        pred = rate >= 0.5
        exp = e["should_trigger"]
        ok = pred == exp
        correct += ok
        if pred and not exp:
            fp.append(i)
        if not pred and exp:
            fn.append(i)
        rows.append({"idx": i, "query": e["query"], "should_trigger": exp,
                     "trigger_rate": rate, "predicted": pred, "correct": ok})
        mark = "OK " if ok else "XX "
        print(f"{mark} q{i} exp={'Y' if exp else 'N'} rate={rate:.2f}  {e['query'][:70]}", flush=True)

    acc = correct / len(evals)
    print(f"\nAccuracy: {correct}/{len(evals)} = {acc:.0%}", flush=True)
    print(f"False POSITIVES (should NOT trigger but did): {[r['idx'] for r in rows if r['idx'] in fp]}", flush=True)
    print(f"False NEGATIVES (should trigger but didn't): {[r['idx'] for r in rows if r['idx'] in fn]}", flush=True)

    out = args.out or str(Path(args.eval_set).with_name("trigger_results.json"))
    Path(out).write_text(json.dumps({"description": desc, "accuracy": acc,
                                     "rows": rows}, indent=2), encoding="utf-8")
    print(f"\nWrote {out}", flush=True)


if __name__ == "__main__":
    main()
