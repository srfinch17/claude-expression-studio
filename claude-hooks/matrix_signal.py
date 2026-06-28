#!/usr/bin/env python3
"""
matrix_signal.py — fire the manifest-resolved expression on the ESP32-S3 LED
matrix from the command line, so Claude Code HOOKS can drive the board.

Why this exists: hooks can't call the MCP server. This script resolves a
HARNESS MOMENT (e.g. `hook:Stop`) via the manifest + manifest_resolver.py, then
renders the pick directly to the board's HTTP API using only the Python stdlib.
It FAILS SILENTLY (exit 0) if the board is unreachable, so a turn/hook is never
blocked or broken by the board being off.

Usage:  python matrix_signal.py <moment>
        moment: a manifest harness moment key, e.g.
          hook:UserPromptSubmit  hook:Stop
          hook:PreToolUse:AskUserQuestion  hook:PreToolUse:ExitPlanMode
          hook:PostToolUse:AskUserQuestion  hook:PostToolUse:ExitPlanMode
          hook:Notification:permission_prompt
Env:    ESP32_URL (default http://esp32matrix.local)
        MATRIX_MCP_DIR (path to the repo's mcp_server/, for the expressions dir
                        and for locating shared/manifest.json)

Art/colors mirror peckworks-esp32s3matrix/mcp_server/expressions.ts (keep in sync
if those change).

Idle/"bored" feature: on the `hook:Stop` moment this also (a) records an activity
token and (b) spawns matrix_idle.py detached. That watcher waits and, if the user
hasn't come back, plays random fun animations until they do (or an idle cap is
hit). `hook:UserPromptSubmit` re-stamps the token, which makes any pending watcher
exit. See matrix_idle.py. The whole thing is silenced by the .matrix_off kill switch.
"""
import sys, os, json, urllib.request, subprocess, time, random

TIMEOUT = 2.5  # seconds; keep short so hooks stay snappy

HOOK_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_config():
    """Resolve (board_url, mcp_dir): env vars win, then ~/.claude/hooks/matrix_config.json
    (written by `npm run setup`), then neutral defaults. Keeps any machine-specific repo
    path OUT of source — the installer injects it, so the hooks run on any machine."""
    cfg = {}
    try:
        with open(os.path.join(HOOK_DIR, "matrix_config.json"), "r", encoding="utf-8") as f:
            cfg = json.load(f) or {}
    except Exception:
        cfg = {}
    board = os.environ.get("ESP32_URL") or cfg.get("board_url") or "http://esp32matrix.local"
    mcp_dir = os.environ.get("MATRIX_MCP_DIR") or cfg.get("mcp_dir") or ""
    return board, mcp_dir


BOARD_URL, MCP_DIR = _load_config()
FLAG_OFF = os.path.join(HOOK_DIR, ".matrix_off")        # kill switch
ACTIVITY_FILE = os.path.join(HOOK_DIR, ".matrix_activity")  # last-activity token
IDLE_WATCHER = os.path.join(HOOK_DIR, "matrix_idle.py")     # the "bored" watcher

sys.path.insert(0, HOOK_DIR)            # manifest_resolver.py sits next to this script
from manifest_resolver import resolve   # pure mirror of shared/resolver.js

# Firmware animation names — MIRROR of shared/firmware-names.js (keep in sync). These
# render via POST /api/display/animation (transient); everything else is a frame-expression.
FIRMWARE_NAMES = {
    "fire", "rainbow", "breathe", "wave", "solid", "liquid", "imu", "chiptemp",
    "weather", "timer_fill", "timer_snow", "timer_text", "clock", "matrix_rain",
    "snow", "dancefloor", "spiral", "starfield", "fireworks", "fireworks2",
    "comet", "sun", "frostbite", "calendar", "sound", "claudesweep",
}

EXPR_DIR = os.path.join(MCP_DIR, "expressions")


def _engine_url():
    """Where the local Studio engine listens — for mirroring hook renders to its SSE virtual
    board so the web panel (board.html) shows them even with NO board. Override with
    MATRIX_ENGINE_URL; else read the engine's port cache (.engine-url); else the default."""
    u = os.environ.get("MATRIX_ENGINE_URL")
    if u:
        return u.rstrip("/")
    try:
        with open(os.path.join(MCP_DIR, ".engine-url"), "r", encoding="utf-8") as f:
            cached = f.read().strip()
        if cached:
            return cached.rstrip("/")
    except Exception:
        pass
    return "http://127.0.0.1:8787"


def broadcast_engine(event):
    """Best-effort: mirror a DisplayEvent ({"kind":"frames","wire":{...}} or
    {"kind":"animation","type":...}) to the engine's POST /api/render so board.html (the no-board
    web panel) shows hook-driven renders. NEVER blocks or raises — the board path is primary."""
    try:
        data = json.dumps(event).encode("utf-8")
        req = urllib.request.Request(
            _engine_url() + "/api/render", data=data,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        urllib.request.urlopen(req, timeout=1.0).read()
    except Exception:
        pass  # engine not running / unreachable — the board is still the primary target


def load_manifest():
    # Repo-first (sibling of mcp_server/), then the in-bundle copy (installed .mcpb).
    for cand in (os.path.join(MCP_DIR, "..", "shared", "manifest.json"),
                 os.path.join(MCP_DIR, "shared-runtime", "manifest.json")):
        try:
            with open(cand, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            continue
    return None


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
            ["........","...AA...","...AA...","...AA...","........","...AA...","...AA...","........"],
            ["........","...BB...","...BB...","...BB...","........","...BB...","...BB...","........"],
            ["........","...CC...","...CC...","...CC...","........","...CC...","...CC...","........"],
            ["........","...DD...","...DD...","...DD...","........","...DD...","...DD...","........"],
            ["........","...EE...","...EE...","...EE...","........","...EE...","...EE...","........"],
            ["........","...FF...","...FF...","...FF...","........","...FF...","...FF...","........"],
            ["........","...EE...","...EE...","...EE...","........","...EE...","...EE...","........"],
            ["........","...DD...","...DD...","...DD...","........","...DD...","...DD...","........"],
            ["........","...CC...","...CC...","...CC...","........","...CC...","...CC...","........"],
            ["........","...BB...","...BB...","...BB...","........","...BB...","...BB...","........"],
        ],
        {"A": "#401800", "B": "#6b2800", "C": "#953800", "D": "#c04800", "E": "#eb5800", "F": "#ff6000"}, 120, 0,
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
    armed). Default False so all normal expressions (working/done) disarm as usual.
    """
    # mirror to the engine's virtual board first, so the web panel updates even if the board hangs
    broadcast_engine({"kind": "frames", "wire": {"frames": frames_hex, "frame_ms": frame_ms, "loop": loop}})
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


def post_brightness(level):
    try:
        data = json.dumps({"level": level}).encode("utf-8")
        req = urllib.request.Request(BOARD_URL + "/api/brightness", data=data,
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=TIMEOUT).read()
    except Exception:
        pass


def post_animation(anim_type, params=None, transient=True):
    """Best-effort POST /api/display/animation for a firmware-animation pick (transient)."""
    # mirror to the engine's virtual board so the no-board web panel shows the animation
    broadcast_engine({"kind": "animation", "type": anim_type})
    try:
        body = {"type": anim_type, "transient": transient}
        if params:
            body.update(params)
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(BOARD_URL + "/api/display/animation", data=data,
                                     headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
        return True
    except Exception:
        return False


def send_named(name):
    e = EXPR.get(name)
    if not e:
        return
    frames_art, colors, frame_ms, loop = e
    post_frames([art_to_hex(f, colors) for f in frames_art], frame_ms, loop)


def send_saved(name):
    """Load ANY saved expression JSON {colors,frames,frame_ms,loop} by name and POST
    it (ask-*, idle, …). Best-effort: returns False on miss / board offline."""
    try:
        with open(os.path.join(EXPR_DIR, name + ".json"), "r", encoding="utf-8") as f:
            e = json.load(f)
        colors = e.get("colors", {})
        post_frames([art_to_hex(f, colors) for f in e["frames"]],
                    e.get("frame_ms", 150), e.get("loop", 0))
        return True
    except Exception:
        return False


def render_resolved(resolved):
    """Render a manifest-resolved pick. Mirrors the MCP's decideRender/runPlan."""
    if not resolved:
        return
    value = resolved.get("value")
    if not isinstance(value, str):
        return
    if resolved.get("brightness") is not None:
        post_brightness(resolved["brightness"])
    if value in FIRMWARE_NAMES:
        if not post_animation(value, resolved.get("params") or {}):
            send_named("working")        # never blank
        return
    if value in EXPR:
        send_named(value)
        return
    if not send_saved(value):
        send_named("working")            # never blank


def render_moment(moment):
    manifest = load_manifest()
    if not manifest:
        send_named("working")            # degrade, never blank
        return
    render_resolved(resolve(manifest, {"harness": "claude-code", "renderer": "esp32-8x8", "moment": moment}))


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
    if os.path.exists(FLAG_OFF):         # at-will kill switch
        return 0
    moment = sys.argv[1].strip()
    # "user is active" beats stamp the token (any pending idle watcher then exits);
    # the Stop beat arms the board's screensaver + spawns the bored watcher.
    is_done = (moment == "hook:Stop")
    is_active = moment in ("hook:UserPromptSubmit",
                           "hook:PostToolUse:AskUserQuestion",
                           "hook:PostToolUse:ExitPlanMode")
    token = write_activity_token() if (is_active or is_done) else None
    render_moment(moment)
    if is_done and token is not None:
        arm_board_idle()
        spawn_idle_watcher(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
