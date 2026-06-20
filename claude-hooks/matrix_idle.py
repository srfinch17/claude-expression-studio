#!/usr/bin/env python3
"""
matrix_idle.py — the "bored Claude" idle watcher for the ESP32-S3 LED matrix.

Spawned (detached) by matrix_signal.py when the `done` checkmark fires. It waits,
then — if the user still hasn't come back — plays a RANDOM fun animation, and keeps
doing so on a randomized cadence while the board stays idle. The point is the
board looking like Claude got bored waiting for input and started goofing off.

How it knows the user is "still idle": matrix_signal.py stamps an activity TOKEN in
.matrix_activity on every `working`/`done`. This watcher was handed the token that
was current when it spawned. Each time it wakes it re-reads the file:
  - token CHANGED  -> the user submitted a prompt (or a newer checkmark spawned a
                      newer watcher) -> this watcher exits silently.
  - token SAME     -> still idle -> play a fun animation, loop again.
After MATRIX_IDLE_CAP seconds of continuous idle it settles on a calm sleepy face
and exits, so the panel isn't flashing all night.

Honors the .matrix_off kill switch (checked every loop). Fails silent if the board
is unreachable. Reuses matrix_signal's art_to_hex/post_frames (same dir).

──────────────────────────────────────────────────────────────────────────────
ADDING / MODIFYING ANIMATIONS  (this is the easy part — no code edits needed):
The rotation is just a FOLDER of JSON files (default: ./bored_animations next to
this script). Each file is one animation in the SAME format `matrix_animate
save_as` writes:  { "description", "frames", "colors", "frame_ms", "loop" }.
  • ADD one     -> drop a .json file in the folder (e.g. copy what save_as wrote
                   to <repo>/mcp_server/expressions/<name>.json).
  • REMOVE one  -> delete (or move) its .json file.
  • EDIT one    -> tweak the frames/colors/frame_ms in its .json.
Changes are picked up automatically on the watcher's next goof — no restart.
Point MATRIX_IDLE_POOL_DIR at a different folder to use a different set.
──────────────────────────────────────────────────────────────────────────────

Usage:  python matrix_idle.py <activity_token>   (normally only the hook calls it)
Env overrides (seconds) — handy for testing without waiting minutes:
  MATRIX_IDLE_FIRST_MIN / _FIRST_MAX  first wait after the checkmark (def 75/120)
  MATRIX_IDLE_MIN / _MAX              gap between goofs while idle  (def 45/90)
  MATRIX_IDLE_CAP                     stop goofing after this much idle (def 600)
  MATRIX_IDLE_POOL_DIR                folder of animation JSONs (def ./bored_animations)
"""
import sys, os, json, time, random
import matrix_signal as ms  # reuse art_to_hex + post_frames + FLAG_OFF/ACTIVITY_FILE

FLAG_OFF = ms.FLAG_OFF
ACTIVITY_FILE = ms.ACTIVITY_FILE
POOL_DIR = os.environ.get("MATRIX_IDLE_POOL_DIR") or os.path.join(ms.HOOK_DIR, "bored_animations")


def _f(env, default):
    try:
        return float(os.environ.get(env, default))
    except Exception:
        return float(default)


FIRST_MIN = _f("MATRIX_IDLE_FIRST_MIN", 75)
FIRST_MAX = _f("MATRIX_IDLE_FIRST_MAX", 120)
GAP_MIN = _f("MATRIX_IDLE_MIN", 45)
GAP_MAX = _f("MATRIX_IDLE_MAX", 90)
CAP_SECS = _f("MATRIX_IDLE_CAP", 600)

# Calm resting face shown once at the idle cap, then the watcher exits. Kept
# embedded (not part of the random pool) so the board always has a sane "settle".
REST = (
    [
        ["WWWW....", "..WW....", ".WW.....", "WWWW....", ".....BBB", "......B.", ".....B..", ".....BBB"],
        ["WWWW....", "..WW....", ".WW.....", "WWWW....", "........", "........", "........", "........"],
    ],
    {"W": "#b4c8e6", "B": "#32509b"}, 600, 0,
)

# Fallback so the rotation is never empty even if the pool folder is missing.
DEFAULT_POOL = [
    (
        [[
            "..YYYY..", ".YYYYYY.", "YY.YY.YY", "YYYYYYYY",
            "Y.YYYY.Y", "YY....YY", ".YYYYYY.", "..YYYY..",
        ]],
        {"Y": "#ffc800"}, 150, 0,
    ),
]


def load_pool():
    """Read every *.json animation in POOL_DIR into a list of play-tuples.
    Malformed files are skipped. Returns DEFAULT_POOL if nothing usable loads."""
    pool = []
    try:
        names = sorted(n for n in os.listdir(POOL_DIR) if n.lower().endswith(".json"))
    except Exception:
        names = []
    for n in names:
        try:
            with open(os.path.join(POOL_DIR, n)) as f:
                d = json.load(f)
            pool.append((d["frames"], d["colors"],
                         int(d.get("frame_ms", 150)), int(d.get("loop", 0))))
        except Exception:
            continue  # bad/partial JSON — just skip it, never crash the watcher
    return pool or DEFAULT_POOL


def play(entry):
    frames_art, colors, frame_ms, loop = entry
    # idle=True: goof/Zz pushes keep the board's dead-man's-switch armed so the
    # screensaver can fire after the animation cycle, rather than disarming it.
    ms.post_frames([ms.art_to_hex(f, colors) for f in frames_art], frame_ms, loop, idle=True)


def current_token():
    try:
        with open(ACTIVITY_FILE) as f:
            return f.read().strip()
    except Exception:
        return None


def main():
    if len(sys.argv) < 2:
        return 0
    my_token = sys.argv[1]
    start = time.monotonic()
    first = True
    while True:
        gap = random.uniform(FIRST_MIN, FIRST_MAX) if first else random.uniform(GAP_MIN, GAP_MAX)
        first = False
        time.sleep(gap)
        if os.path.exists(FLAG_OFF):
            return 0                      # silenced via kill switch
        if current_token() != my_token:
            return 0                      # the user's back, or a newer watcher owns the board
        if time.monotonic() - start >= CAP_SECS:
            play(REST)                    # idle too long — settle on a calm face and stop
            return 0
        play(random.choice(load_pool()))  # reload each time so dropped-in JSONs appear live
    return 0


if __name__ == "__main__":
    sys.exit(main())
