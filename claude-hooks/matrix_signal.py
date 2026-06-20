#!/usr/bin/env python3
"""
matrix_signal.py — fire a canned expression on the ESP32-S3 LED matrix from the
command line, so Claude Code HOOKS can drive the board deterministically.

Why this exists: the named expressions (working/done/alert/sleep) live in the
matrix MCP server (mcp_server/expressions.ts), which hooks can't call. This script
reproduces the exact art + the MCP's wire format and POSTs it to the board's
/api/display/frames endpoint (the same call the MCP makes), using only the Python
stdlib. It FAILS SILENTLY (exit 0) if the board is unreachable, so a turn/hook is
never blocked or broken by the board being off.

Usage:  python matrix_signal.py <name>
        names: wait | working | done | alert | sleep | party
        ("wait" = weighted-random pick from the wait pool — the snake plus any
         saved wait-* expression; this is what the UserPromptSubmit hook fires.
         "working" forces the default snake specifically.)
Env:    ESP32_URL (default http://esp32matrix.local)
        MATRIX_MCP_DIR (path to the repo's mcp_server/, for the wait pool files)

Art/colors mirror peckworks-esp32s3matrix/mcp_server/expressions.ts (keep in sync
if those change).

Idle/"bored" feature: on the `done` signal this also (a) records an activity
token and (b) spawns matrix_idle.py detached. That watcher waits and, if the user
hasn't come back, plays random fun animations until they do (or an idle cap is
hit). `working` re-stamps the token, which makes any pending watcher exit. See
matrix_idle.py. The whole thing is silenced by the .matrix_off kill switch.
"""
import sys, os, json, urllib.request, subprocess, time, random

BOARD_URL = os.environ.get("ESP32_URL", "http://esp32matrix.local")
TIMEOUT = 2.5  # seconds; keep short so hooks stay snappy

HOOK_DIR = os.path.dirname(os.path.abspath(__file__))
FLAG_OFF = os.path.join(HOOK_DIR, ".matrix_off")        # kill switch
ACTIVITY_FILE = os.path.join(HOOK_DIR, ".matrix_activity")  # last-activity token
IDLE_WATCHER = os.path.join(HOOK_DIR, "matrix_idle.py")     # the "bored" watcher

# (frames, colors, frame_ms, loop) — copied verbatim from expressions.ts
EXPR = {
    "working": (
        [
            ["AA......","AA......","BB......","BB......","CC......","CC......","........","........"],
            ["BBAA....","BBAA....","CC......","CC......","........","........","........","........"],
            ["CCBBAA..","CCBBAA..","........","........","........","........","........","........"],
            ["..CCBBAA","..CCBBAA","........","........","........","........","........","........"],
            ["....CCBB","....CCBB","......AA","......AA","........","........","........","........"],
            ["......CC","......CC","......BB","......BB","......AA","......AA","........","........"],
            ["........","........","......CC","......CC","......BB","......BB","......AA","......AA"],
            ["........","........","........","........","......CC","......CC","....AABB","....AABB"],
            ["........","........","........","........","........","........","..AABBCC","..AABBCC"],
            ["........","........","........","........","........","........","AABBCC..","AABBCC.."],
            ["........","........","........","........","AA......","AA......","BBCC....","BBCC...."],
            ["........","........","AA......","AA......","BB......","BB......","CC......","CC......"],
        ],
        {"A": "#c8e6ff", "B": "#5a6773", "C": "#2c3338"}, 80, 0,
    ),
    "done": (
        [
            ["........",".......G","......GG","G....GG.","GG..GG..",".GGGG...","..GG....","........"],
            ["GGGGGGGG","GGGGGGG.","GGGGGG..",".GGGG..G","..GG..GG","G....GGG","GG..GGGG","GGGGGGGG"],
            ["........",".......G","......GG","G....GG.","GG..GG..",".GGGG...","..GG....","........"],
            ["GGGGGGGG","GGGGGGG.","GGGGGG..",".GGGG..G","..GG..GG","G....GGG","GG..GGGG","GGGGGGGG"],
            ["........",".......G","......GG","G....GG.","GG..GG..",".GGGG...","..GG....","........"],
            ["GGGGGGGG","GGGGGGG.","GGGGGG..",".GGGG..G","..GG..GG","G....GGG","GG..GGGG","GGGGGGGG"],
            ["........",".......G","......GG","G....GG.","GG..GG..",".GGGG...","..GG....","........"],
        ],
        {"G": "#00c83c"}, 220, 1,
    ),
    "alert": (
        [
            ["...AA...","...AA...","...AA...","...AA...","...AA...","........","...AA...","...AA..."],
            ["AAA..AAA","AAA..AAA","AAA..AAA","AAA..AAA","AAA..AAA","AAAAAAAA","AAA..AAA","AAA..AAA"],
            ["...AA...","...AA...","...AA...","...AA...","...AA...","........","...AA...","...AA..."],
            ["AAA..AAA","AAA..AAA","AAA..AAA","AAA..AAA","AAA..AAA","AAAAAAAA","AAA..AAA","AAA..AAA"],
            ["...AA...","...AA...","...AA...","...AA...","...AA...","........","...AA...","...AA..."],
            ["AAA..AAA","AAA..AAA","AAA..AAA","AAA..AAA","AAA..AAA","AAAAAAAA","AAA..AAA","AAA..AAA"],
            ["...AA...","...AA...","...AA...","...AA...","...AA...","........","...AA...","...AA..."],
        ],
        {"A": "#ffa000"}, 220, 1,
    ),
    "sleep": (
        [
            ["WWWW....","..WW....",".WW.....","WWWW....",".....BBB","......B.",".....B..",".....BBB"],
            ["WWWW....","..WW....",".WW.....","WWWW....","........","........","........","........"],
        ],
        {"W": "#b4c8e6", "B": "#32509b"}, 600, 0,
    ),
    "party": (
        [
            ["..W...C.","M...G...","...Y...W",".C...M..","..M...G.","Y...W...","...C...M",".G...Y.."],
            [".G...Y..","..W...C.","M...G...","...Y...W",".C...M..","..M...G.","Y...W...","...C...M"],
            ["...C...M",".G...Y..","..W...C.","M...G...","...Y...W",".C...M..","..M...G.","Y...W..."],
            ["Y...W...","...C...M",".G...Y..","..W...C.","M...G...","...Y...W",".C...M..","..M...G."],
            ["..M...G.","Y...W...","...C...M",".G...Y..","..W...C.","M...G...","...Y...W",".C...M.."],
            [".C...M..","..M...G.","Y...W...","...C...M",".G...Y..","..W...C.","M...G...","...Y...W"],
            ["...Y...W",".C...M..","..M...G.","Y...W...","...C...M",".G...Y..","..W...C.","M...G..."],
            ["M...G...","...Y...W",".C...M..","..M...G.","Y...W...","...C...M",".G...Y..","..W...C."],
        ],
        {"M": "#ff28b4", "C": "#28c8ff", "Y": "#ffc800", "G": "#00c83c", "W": "#ffffff"}, 130, 0,
    ),
}


def art_to_hex(rows, colors):
    out = []
    for row in rows:
        for ch in row:
            out.append("000000" if ch == "." else colors[ch].replace("#", "").lower())
    return "".join(out)


def arm_board_idle():
    """Tell the board to arm its dead-man's-switch screensaver (best-effort)."""
    try:
        req = urllib.request.Request(
            BOARD_URL + "/api/idle/arm", data=b"{}",
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass  # never break the turn


def post_frames(frames_hex, frame_ms, loop, idle=False):
    """POST a pre-rendered animation to the board. Fails silently if unreachable.

    idle=True marks the payload as idle content (keeps the board's dead-man's-switch
    armed). Default False so all normal expressions (wait/working/done) disarm as usual.
    """
    body = {"frames": frames_hex, "frame_ms": frame_ms, "loop": loop, "idle": idle}
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        f"{BOARD_URL}/api/display/frames", data=data,
        headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception:
        pass  # board offline / unreachable — never block a turn


def send_named(name):
    e = EXPR.get(name)
    if not e:
        return
    frames_art, colors, frame_ms, loop = e
    post_frames([art_to_hex(f, colors) for f in frames_art], frame_ms, loop)


# --- Weighted wait pool (mirrors mcp_server/wait.ts + index.ts resolveWait) ---
# matrix_express("wait") in the MCP plays a WEIGHTED-RANDOM pick from the wait
# pool: the canned "working" snake plus any saved expression named "wait-*".
# This lets the UserPromptSubmit hook do the SAME pick, so the automatic busy
# indicator matches the MCP (default 50% wait-rainbow / 30% wait-orbit / 20%
# working snake — set in mcp_server/wait-weights.json, read at RUNTIME). Reads
# the repo's JSON directly; no MCP call. Fails silently back to "working" if
# anything is missing, so a turn is never blocked.
MCP_DIR = os.environ.get(
    "MATRIX_MCP_DIR",
    r"C:\Users\srfin\Dropbox\Dev\repos\peckworks-esp32s3matrix\mcp_server",
)
EXPR_DIR = os.path.join(MCP_DIR, "expressions")
WAIT_WEIGHTS_FILE = os.path.join(MCP_DIR, "wait-weights.json")
WAIT_BUILTINS = ["working"]   # canned wait animations (drawn from EXPR above)
WAIT_PREFIX = "wait-"
WAIT_ANIMATIONS = ["claudesweep"]   # firmware anims in the wait pool (not frame expressions)


def post_animation(anim_type, transient=True):
    """Best-effort POST /api/display/animation for a firmware-animation wait pick."""
    try:
        body = json.dumps({"type": anim_type, "transient": transient}).encode()
        req = urllib.request.Request(BOARD_URL + "/api/display/animation", data=body,
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


def build_wait_pool():
    """Built-ins + firmware-animation entries + any saved wait-*.json (de-duped)."""
    pool = list(WAIT_BUILTINS) + list(WAIT_ANIMATIONS)
    try:
        for fn in os.listdir(EXPR_DIR):
            if fn.startswith(WAIT_PREFIX) and fn.endswith(".json"):
                nm = fn[:-5]
                if nm not in pool:
                    pool.append(nm)
    except Exception:
        pass
    return pool


def load_wait_weights():
    try:
        with open(WAIT_WEIGHTS_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        w = raw.get("weights")
        return w if isinstance(w, dict) else {}
    except Exception:
        return {}


def pick_wait(pool, weights):
    """Weighted random, mirroring wait.ts pickWait: weight defaults to 1, clamped
    >= 0; zero-weight dropped; if everything zeroes out, fall back to uniform."""
    if not pool:
        return WAIT_BUILTINS[0]
    entries = [(n, max(0.0, float(weights.get(n, 1)))) for n in pool]
    entries = [(n, w) for n, w in entries if w > 0] or [(n, 1.0) for n in pool]
    total = sum(w for _, w in entries)
    r = random.random() * total
    for n, w in entries:
        r -= w
        if r < 0:
            return n
    return entries[-1][0]


def send_saved(name):
    """Load a saved wait-*.json {colors,frames,frame_ms,loop} and POST it."""
    try:
        with open(os.path.join(EXPR_DIR, name + ".json"), "r", encoding="utf-8") as f:
            e = json.load(f)
        colors = e.get("colors", {})
        post_frames([art_to_hex(f, colors) for f in e["frames"]],
                    e.get("frame_ms", 150), e.get("loop", 0))
        return True
    except Exception:
        return False


def send_wait():
    """Pick one wait animation by weight and play it (snake, firmware anim, or a saved wait-*)."""
    name = pick_wait(build_wait_pool(), load_wait_weights())
    if name in WAIT_ANIMATIONS:
        if not post_animation(name):
            send_named("working")  # never leave the board blank
    elif name in EXPR:
        send_named(name)
    elif not send_saved(name):
        send_named("working")  # never leave the board blank


def write_activity_token():
    """Stamp a fresh token marking 'Claude just did something'. A change in this
    token is how a pending idle watcher learns the user is back and should exit."""
    token = "%d-%04d" % (time.time_ns(), random.randint(0, 9999))
    try:
        with open(ACTIVITY_FILE, "w") as f:
            f.write(token)
    except Exception:
        pass
    return token


def spawn_idle_watcher(token):
    """Launch matrix_idle.py fully detached so the hook returns immediately and
    the watcher outlives this process. Pass the token it must keep matching."""
    if not os.path.exists(IDLE_WATCHER):
        return
    kwargs = dict(stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                  stderr=subprocess.DEVNULL, close_fds=True)
    if os.name == "nt":
        # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW
        kwargs["creationflags"] = 0x00000008 | 0x00000200 | 0x08000000
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen([sys.executable, IDLE_WATCHER, token], **kwargs)
    except Exception:
        pass  # never let a spawn failure break the turn


def main():
    if len(sys.argv) < 2:
        return 0
    # At-will kill switch: if the flag file exists next to this script, no-op.
    # `touch ~/.claude/hooks/.matrix_off` to silence the board this session;
    # `del`/`rm` it to re-enable. Takes effect immediately (checked per call),
    # no restart needed. Hooks stay registered either way.
    if os.path.exists(FLAG_OFF):
        return 0
    name = sys.argv[1].strip().lower()
    # wait + working + done are the real "Claude activity" beats — stamp the token
    # so any stale idle watcher exits. (Manual alert/sleep/party don't touch it.)
    token = write_activity_token() if name in ("wait", "working", "done") else None
    if name == "wait":
        send_wait()       # weighted-random pick from the wait pool (the hook path)
    else:
        send_named(name)  # a specific expression by name (working forces the snake)
    # The checkmark arms boredom: if the user doesn't come back, the watcher goofs off.
    if name == "done" and token is not None:
        # send_named("done") above posted with idle=False (disarms); re-arm AFTER it.
        arm_board_idle()
        spawn_idle_watcher(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
