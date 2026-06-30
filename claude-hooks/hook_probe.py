#!/usr/bin/env python3
"""hook_probe.py, TEMPORARY instrumentation to learn what Claude Code hooks
actually fire (and in what ORDER) when Claude waits for input.

Why: the awaiting-input display feature
(docs/superpowers/specs/2026-06-21-awaiting-input-display-design.md) depends on
unverified hook behavior, does PreToolUse fire for the built-in AskUserQuestion /
ExitPlanMode tools? does Stop fire while a question is pending (and clobber the
'?' animation)? when does PostToolUse fire for those tools, on display or on the
user's answer? does Notification fire with permission_prompt? Rather than guess,
we measure.

HOW TO USE (≈5 min):
  1. Merge claude-hooks/settings.probe.snippet.json into ~/.claude/settings.json
     (fix the YOU path). It ADDS probe logging to events; it does NOT touch the
     board and runs alongside your existing matrix hooks.
  2. Restart Claude Code (hooks load at session start).
  3. Do three things so the log captures them, noting the wall-clock order:
       a. let Claude ask you a question (AskUserQuestion),
       b. let Claude present a plan for approval (ExitPlanMode / plan mode),
       c. trigger a tool that needs permission.
     Then ANSWER each, so we also see the post-answer events.
  4. Send me ~/.claude/hook_probe.log (or paste it). Then REMOVE the probe block
     from settings.json and restart, it's only for this measurement.

It appends one line per event to ~/.claude/hook_probe.log and never blocks.
The event name is passed as argv[1]; tool / notification details come from the
hook's JSON payload on stdin.
"""
import sys
import os
import json
import time

LOG = os.path.join(os.path.expanduser("~"), ".claude", "hook_probe.log")


def main():
    event = sys.argv[1] if len(sys.argv) > 1 else "?"
    raw = ""
    try:
        raw = sys.stdin.read()
    except Exception:
        pass
    tool = ""
    extra = ""
    try:
        d = json.loads(raw) if raw.strip() else {}
        tool = d.get("tool_name", "") or ""
        # notification type lives under different keys across versions, grab any.
        extra = (d.get("notification_type") or d.get("type")
                 or d.get("message") or "")
        if isinstance(extra, str):
            extra = extra[:40]
    except Exception:
        pass
    line = "%s  %-16s tool=%-22s info=%s\n" % (
        time.strftime("%H:%M:%S.") + ("%03d" % (int(time.time() * 1000) % 1000)),
        event, tool or "-", extra or "-")
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass  # never block a turn


if __name__ == "__main__":
    main()
