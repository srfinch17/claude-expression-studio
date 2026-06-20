# Board Settings + Idle Screensaver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent, board-owned settings store (NVS, web- and MCP-editable) and a board-side idle screensaver state machine that runs Goof → Zz → rotating screensaver autonomously, surviving the host laptop sleeping.

**Architecture:** The board is the single source of truth. Settings live in NVS (`Preferences`, namespace `"matrix"`) with merge-on-boot so they survive flashes. Both the web page (`data/settings.html`) and new MCP tools edit the same `/api/settings` endpoint. The idle engine is a `millis()`-based dead-man's switch in `loop()`: armed by Claude's `Stop` hook, it enters a low-brightness screensaver rotation once the board goes quiet, and is disarmed by any real user/Claude command.

**Tech Stack:** Arduino C++ (ESP32-S3, FastLED, ArduinoJson, Preferences/NVS), vanilla HTML/JS web pages served from LittleFS, TypeScript MCP server (compiled to `dist/`), Python host hooks, vitest for TS unit tests.

## Global Constraints

- **Privacy:** never use the maintainer's real name in code/comments/docs — refer to "the user".
- **NVS namespace:** reuse the existing open handle `prefs` (`Preferences`, namespace `"matrix"`). Do NOT open a second namespace.
- **NVS key length ≤ 15 chars.** New keys: `idle_on`, `idle_apps`, `idle_after`, `idle_rot`, `idle_bri`, `def_bri`, `boot_anim`, `tz`, `set_ver`.
- **Claude cannot compile/flash.** Every firmware task ends with a **hardware-verification checklist the user runs** (flash, then report Serial/LED behavior) — not an automated test.
- **Hook live-copy sync:** `claude-hooks/*.py` have installed copies at `~/.claude/hooks/`. Edit BOTH or they drift.
- **MCP deploy:** TS edits are invisible until `npx tsc` rebuilds `dist/` AND `/mcp` reconnects. The PostToolUse hook auto-runs `tsc`; you still must reconnect.
- **Frames heap caution:** keep any frame payloads light; never fire heavy full-panel frame bursts (`bug_frames_heap_crash`).
- **Slider rule:** all sliders left=low / right=high; speed in fps where applicable.
- **Coordinate system:** `XY(x,y)=y*8+x` row-major (NOT serpentine); always draw via `setPixel`.
- **Versioning:** one canonical `VERSION`; bump via `npm run bump:minor` once shipped; redeploy all three artifacts.

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `esp32_matrix_webserver/settings.ino` | `Settings` struct, defaults, NVS load/merge/save, JSON (de)serialize, `SETTINGS_VERSION` | **New** |
| `esp32_matrix_webserver/idle_engine.ino` | Idle state globals, dead-man's switch tick, `enterScreensaver`/`pickIdleApp`/`leaveScreensaver`, arm/disarm | **New** |
| `esp32_matrix_webserver/esp32_matrix_webserver.ino` | Call `loadSettings()` in `setup()`; register routes; call `idleTick()` in `loop()`; `extern` decls | Modify |
| `esp32_matrix_webserver/api_handlers.ino` | `handleSettingsGet/Post`, `handleIdleArm`; mark non-idle commands as activity | Modify |
| `data/settings.html` | Settings form against `/api/settings` | **New** |
| `data/index.html` | Settings card/link | Modify |
| `mcp_server/settings.ts` | Pure helpers: validate/normalize a partial settings patch, parse/serialize `idle_apps` | **New** |
| `mcp_server/settings.test.ts` | vitest unit tests for `settings.ts` | **New** |
| `mcp_server/index.ts` | `matrix_get_settings` + `matrix_set_settings` tool defs + handlers | Modify |
| `claude-hooks/matrix_signal.py` (+ `~/.claude/hooks/` copy) | On `done`, also arm the board idle timer | Modify |
| `claude-hooks/matrix_idle.py` (+ copy) | Mark goof/Zz pushes as idle; terminal hands off to board | Modify |

---

## Task 1: Settings model + NVS merge-on-boot (firmware)

**Files:**
- Create: `esp32_matrix_webserver/settings.ino`
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (extern decls near other globals ~line 145; call `loadSettings()` in `setup()` right after the auto-resume block ~line 784)

**Interfaces:**
- Produces: a global `Settings settings;` struct; `void loadSettings();`, `void saveSettings();`, `String settingsToJson();`, `bool applySettingsJson(const String& body);`
- Consumes: existing global `Preferences prefs;` (already `prefs.begin("matrix", false)` at setup ~line 565), existing `brightness`, `resumeBri`.

- [ ] **Step 1: Create `settings.ino` with the model, defaults, and load/merge**

```cpp
// settings.ino — persistent board settings (NVS namespace "matrix").
// Merge-on-boot: an upgraded flash keeps existing user values and only fills in
// newly-added keys with their defaults. NVS survives a normal Sketch upload, so
// settings persist across flashes; only a full chip-erase wipes them.

// Bump ONLY for a deliberate breaking change that must reset users to defaults.
// Normal additions are pure merges and do NOT need a bump.
static const uint16_t SETTINGS_VERSION = 1;

struct Settings {
  bool     idleOn;        // master switch for the screensaver engine
  String   idleApps;      // CSV of enabled screensaver type names
  uint32_t idleAfterS;    // seconds of board silence before screensaver starts
  uint32_t idleRotS;      // seconds between screensaver re-picks
  uint8_t  idleBri;       // brightness during the screensaver
  uint8_t  defBri;        // boot brightness
  String   bootAnim;      // pinned boot animation type ("" = auto-resume)
  String   tz;            // POSIX TZ for the clock ("" = none)
};

// The rotation universe (mirrors mcp_server/idle.ts IDLE_APPS). Keep aligned.
static const char* IDLE_APPS_DEFAULT =
  "fire,matrix_rain,clock,fireworks,frostbite,snow,dancefloor";

Settings settings;

void loadSettings() {
  // Per-key defaulting: read if present, else write the default. isKey() avoids
  // the harmless NOT_FOUND log noise on a fresh NVS (same pattern as auto-resume).
  settings.idleOn     = prefs.isKey("idle_on")   ? prefs.getBool("idle_on", true)            : (prefs.putBool("idle_on", true), true);
  settings.idleApps   = prefs.isKey("idle_apps") ? prefs.getString("idle_apps", IDLE_APPS_DEFAULT) : (prefs.putString("idle_apps", IDLE_APPS_DEFAULT), String(IDLE_APPS_DEFAULT));
  settings.idleAfterS = prefs.isKey("idle_after")? prefs.getUInt("idle_after", 120)          : (prefs.putUInt("idle_after", 120), 120);
  settings.idleRotS   = prefs.isKey("idle_rot")  ? prefs.getUInt("idle_rot", 240)            : (prefs.putUInt("idle_rot", 240), 240);
  settings.idleBri    = prefs.isKey("idle_bri")  ? prefs.getUChar("idle_bri", 5)             : (prefs.putUChar("idle_bri", 5), 5);
  settings.defBri     = prefs.isKey("def_bri")   ? prefs.getUChar("def_bri", 40)             : (prefs.putUChar("def_bri", 40), 40);
  settings.bootAnim   = prefs.isKey("boot_anim") ? prefs.getString("boot_anim", "")          : (prefs.putString("boot_anim", ""), String(""));
  settings.tz         = prefs.isKey("tz")        ? prefs.getString("tz", "")                 : (prefs.putString("tz", ""), String(""));

  uint16_t stored = prefs.getUShort("set_ver", 0);
  if (stored != SETTINGS_VERSION) {
    // v1: no migration needed — just stamp. Future breaking changes branch here.
    prefs.putUShort("set_ver", SETTINGS_VERSION);
  }
  Serial.printf("Settings loaded: idleOn=%d after=%us rot=%us idleBri=%u defBri=%u apps=%s\n",
                settings.idleOn, settings.idleAfterS, settings.idleRotS,
                settings.idleBri, settings.defBri, settings.idleApps.c_str());
}

void saveSettings() {
  prefs.putBool("idle_on", settings.idleOn);
  prefs.putString("idle_apps", settings.idleApps);
  prefs.putUInt("idle_after", settings.idleAfterS);
  prefs.putUInt("idle_rot", settings.idleRotS);
  prefs.putUChar("idle_bri", settings.idleBri);
  prefs.putUChar("def_bri", settings.defBri);
  prefs.putString("boot_anim", settings.bootAnim);
  prefs.putString("tz", settings.tz);
}

String settingsToJson() {
  String j = "{";
  j += "\"settings_version\":" + String(SETTINGS_VERSION);
  j += ",\"idle_enabled\":"   + String(settings.idleOn ? "true" : "false");
  j += ",\"idle_apps\":\""    + escapeJson(settings.idleApps) + "\"";
  j += ",\"idle_after_secs\":" + String(settings.idleAfterS);
  j += ",\"idle_rotate_secs\":" + String(settings.idleRotS);
  j += ",\"idle_brightness\":"  + String(settings.idleBri);
  j += ",\"default_brightness\":" + String(settings.defBri);
  j += ",\"boot_animation\":\"" + escapeJson(settings.bootAnim) + "\"";
  j += ",\"timezone\":\""      + escapeJson(settings.tz) + "\"";
  j += "}";
  return j;
}

// Partial update: only keys present in the body change. Returns false on bad JSON.
bool applySettingsJson(const String& body) {
  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) return false;
  if (!doc["idle_enabled"].isNull())     settings.idleOn     = doc["idle_enabled"].as<bool>();
  if (!doc["idle_apps"].isNull())        settings.idleApps   = String((const char*)(doc["idle_apps"] | settings.idleApps.c_str()));
  if (!doc["idle_after_secs"].isNull())  settings.idleAfterS = constrain((long)(doc["idle_after_secs"] | (long)settings.idleAfterS), 5L, 3600L);
  if (!doc["idle_rotate_secs"].isNull()) settings.idleRotS   = constrain((long)(doc["idle_rotate_secs"] | (long)settings.idleRotS), 10L, 3600L);
  if (!doc["idle_brightness"].isNull())  settings.idleBri    = constrain((int)(doc["idle_brightness"] | settings.idleBri), 1, 255);
  if (!doc["default_brightness"].isNull()) settings.defBri   = constrain((int)(doc["default_brightness"] | settings.defBri), 0, 255);
  if (!doc["boot_animation"].isNull())   settings.bootAnim   = String((const char*)(doc["boot_animation"] | settings.bootAnim.c_str()));
  if (!doc["timezone"].isNull())         settings.tz         = String((const char*)(doc["timezone"] | settings.tz.c_str()));
  saveSettings();
  return true;
}
```

> Note: `escapeJson` is a `static` helper in `api_handlers.ino`. Because all `.ino`
> files concatenate into one translation unit, `settings.ino` can call it as long as
> `settings.ino` sorts AFTER `api_handlers.ino` alphabetically — it does ("a" < "s").
> If the build complains about ordering, add a forward declaration
> `static String escapeJson(const String&);` at the top of `settings.ino`.

- [ ] **Step 2: Add extern decls + call `loadSettings()` in setup()**

In `esp32_matrix_webserver.ino`, near the other globals (~line 145) the struct/globals are already defined in `settings.ino` (same TU), so no extern needed — but `loadSettings()` must be called. Add it in `setup()` immediately AFTER the auto-resume block (after line 784), then apply `defBri` only if NVS had no committed brightness yet:

```cpp
  loadSettings();   // settings.ino — load persisted settings (merge-on-boot)
  // If this is a fresh board (no committed brightness key), honor default_brightness.
  if (!prefs.isKey("bri")) {
    brightness = settings.defBri;
    resumeBri  = brightness;
    FastLED.setBrightness(brightness);
  }
```

- [ ] **Step 3: Hardware verification (USER FLASHES)**

Ask the user to **Sketch → Upload**, open Serial Monitor, and report:
- Expected on first boot after this change: a line `Settings loaded: idleOn=1 after=120s rot=240s idleBri=5 defBri=40 apps=fire,matrix_rain,...`.
- Then **reflash again** and confirm the same line still shows the SAME values (proves NVS persisted, not re-defaulted).

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/settings.ino esp32_matrix_webserver/esp32_matrix_webserver.ino
git commit -m "feat(fw): persistent settings model with NVS merge-on-boot"
```

---

## Task 2: `/api/settings` GET/POST + status exposure (firmware)

**Files:**
- Modify: `esp32_matrix_webserver/api_handlers.ino` (add handlers after `handlePresencePost` ~line 781; add `settings_version` to `handleStatus` ~line 690)
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (register routes ~line 738)

**Interfaces:**
- Consumes: `settingsToJson()`, `applySettingsJson()` from Task 1; `sendJson()`, `server` (existing).
- Produces: routes `GET /api/settings`, `POST /api/settings`.

- [ ] **Step 1: Add the handlers in `api_handlers.ino`**

```cpp
// GET /api/settings — full current settings as JSON.
void handleSettingsGet() {
  sendJson(200, settingsToJson());
}

// POST /api/settings — partial update; only provided keys change. Persists + applies.
void handleSettingsPost() {
  if (!applySettingsJson(server.arg("plain"))) {
    sendJson(400, "{\"error\":\"Invalid JSON\"}");
    return;
  }
  FastLED.setBrightness(brightness);   // default_brightness change shouldn't surprise; live bri unchanged here
  sendJson(200, settingsToJson());     // echo the new full settings
}
```

- [ ] **Step 2: Expose `settings_version` in `handleStatus`**

In `handleStatus` (after the `web_version` line ~689):

```cpp
  json += ",\"settings_version\":" + String(SETTINGS_VERSION);
```

- [ ] **Step 3: Register the routes**

In `esp32_matrix_webserver.ino` after line 738 (`/api/grid-test/set`):

```cpp
  server.on("/api/settings",              HTTP_GET,  handleSettingsGet);
  server.on("/api/settings",              HTTP_POST, handleSettingsPost);
```

- [ ] **Step 4: Hardware verification (USER FLASHES + curls)**

After **Sketch → Upload**, ask the user to run (PowerShell), substituting the board IP:
```
curl http://<board-ip>/api/settings
curl -X POST http://<board-ip>/api/settings -H "Content-Type: application/json" -d "{\"idle_after_secs\":300}"
curl http://<board-ip>/api/settings
```
Expected: first GET shows all keys; POST echoes settings with `idle_after_secs:300`; second GET still shows `300` (persisted). Reflash and GET again → still `300`.

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/api_handlers.ino esp32_matrix_webserver/esp32_matrix_webserver.ino
git commit -m "feat(fw): /api/settings GET+POST and settings_version in status"
```

---

## Task 3: Settings web page + index link

**Files:**
- Create: `esp32_matrix_webserver/data/settings.html`
- Modify: `esp32_matrix_webserver/data/index.html` (add a Settings card)

**Interfaces:**
- Consumes: `GET/POST /api/settings` from Task 2.
- Produces: a user-facing page; an index card linking to `/settings.html`.

- [ ] **Step 1: Create `data/settings.html`**

A self-contained page (match the existing pages' inline-CSS style). It must: fetch
`/api/settings` on load, populate the form, and POST changed values. Include the idle
per-app checkboxes derived from the rotation universe.

```html
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Board Settings</title>
<style>
  body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;padding:16px}
  h1{font-size:1.2rem} fieldset{border:1px solid #333;border-radius:8px;margin:12px 0;padding:12px}
  legend{color:#9cf;padding:0 6px} label{display:block;margin:8px 0}
  input[type=range]{width:100%} .row{display:flex;justify-content:space-between;align-items:center;gap:8px}
  button{background:#2a6;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:1rem}
  a{color:#9cf} .apps label{display:inline-flex;align-items:center;gap:6px;margin-right:12px}
  #status{margin-left:10px;color:#7f7}
</style></head><body>
<p><a href="/">&larr; Back</a></p>
<h1>Board Settings</h1>
<form id="f">
  <fieldset><legend>Idle screensaver</legend>
    <label class="row"><span>Enabled</span><input type="checkbox" id="idle_enabled"></label>
    <div class="apps" id="apps"></div>
    <label>Start after <output id="after_o"></output> s
      <input type="range" id="idle_after_secs" min="5" max="900" step="5"></label>
    <label>Re-pick every <output id="rot_o"></output> s
      <input type="range" id="idle_rotate_secs" min="10" max="900" step="5"></label>
    <label>Idle brightness <output id="ibri_o"></output>
      <input type="range" id="idle_brightness" min="1" max="60"></label>
  </fieldset>
  <fieldset><legend>Display</legend>
    <label>Default brightness <output id="dbri_o"></output>
      <input type="range" id="default_brightness" min="0" max="255"></label>
    <label>Default boot animation
      <input type="text" id="boot_animation" placeholder="(blank = resume last)"></label>
  </fieldset>
  <fieldset><legend>Clock</legend>
    <label>Timezone (POSIX TZ)
      <input type="text" id="timezone" placeholder="e.g. MST7MDT,M3.2.0,M11.1.0"></label>
  </fieldset>
  <button type="submit">Save</button><span id="status"></span>
</form>
<script>
const APPS=["fire","matrix_rain","clock","fireworks","frostbite","snow","dancefloor"];
const $=id=>document.getElementById(id);
function renderApps(csv){
  const on=new Set((csv||"").split(",").filter(Boolean));
  $("apps").innerHTML=APPS.map(a=>`<label><input type="checkbox" class="app" value="${a}" ${on.has(a)?"checked":""}>${a}</label>`).join("");
}
function bindOut(id,oid){const e=$(id),o=$(oid);const u=()=>o.value=e.value;e.addEventListener("input",u);u();}
async function load(){
  const s=await (await fetch("/api/settings")).json();
  $("idle_enabled").checked=s.idle_enabled;
  $("idle_after_secs").value=s.idle_after_secs;
  $("idle_rotate_secs").value=s.idle_rotate_secs;
  $("idle_brightness").value=s.idle_brightness;
  $("default_brightness").value=s.default_brightness;
  $("boot_animation").value=s.boot_animation||"";
  $("timezone").value=s.timezone||"";
  renderApps(s.idle_apps);
  bindOut("idle_after_secs","after_o");bindOut("idle_rotate_secs","rot_o");
  bindOut("idle_brightness","ibri_o");bindOut("default_brightness","dbri_o");
}
$("f").addEventListener("submit",async e=>{
  e.preventDefault();
  const apps=[...document.querySelectorAll(".app:checked")].map(c=>c.value).join(",");
  const body={
    idle_enabled:$("idle_enabled").checked, idle_apps:apps,
    idle_after_secs:+$("idle_after_secs").value, idle_rotate_secs:+$("idle_rotate_secs").value,
    idle_brightness:+$("idle_brightness").value, default_brightness:+$("default_brightness").value,
    boot_animation:$("boot_animation").value.trim(), timezone:$("timezone").value.trim()
  };
  await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  $("status").textContent="Saved ✓"; setTimeout(()=>$("status").textContent="",1500);
});
load();
</script></body></html>
```

- [ ] **Step 2: Add a Settings card to `data/index.html`**

Read `data/index.html`, find the existing card list, and add (matching the existing card markup — adapt the class names to whatever the file uses):

```html
<a class="card" href="/settings.html">⚙️ Settings</a>
```

- [ ] **Step 3: Hardware verification (USER UPLOADS LittleFS)**

Because `data/` changed, the user must run **Ctrl+Shift+P → "Upload LittleFS to Pico/ESP8266/ESP32"** (close Serial Monitor first). Then:
- Open `http://<board-ip>/` → the Settings card appears and links to the page.
- Open the Settings page → form populates from current settings.
- Change a slider, Save, reload → value persists. Confirm via `GET /api/settings`.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/settings.html esp32_matrix_webserver/data/index.html
git commit -m "feat(web): settings page + index link"
```

---

## Task 4: Idle screensaver engine (firmware)

**Files:**
- Create: `esp32_matrix_webserver/idle_engine.ino`
- Modify: `esp32_matrix_webserver/api_handlers.ino` (mark activity in non-idle commands; add `handleIdleArm`)
- Modify: `esp32_matrix_webserver/esp32_matrix_webserver.ino` (call `idleTick()` in loop; register `/api/idle/arm`)

**Interfaces:**
- Consumes: `settings` (Task 1), `applyAnimationBody()` (api_handlers.ino), `brightness`, `FastLED`, `pickIdleApp` semantics (re-implemented in C++).
- Produces: `void idleTick();`, `void idleNoteActivity(bool isIdleContent);`, `void idleArm();`, global flags.

- [ ] **Step 1: Create `idle_engine.ino`**

```cpp
// idle_engine.ino — board-side "dead-man's switch" screensaver.
// Armed by Claude's Stop hook (POST /api/idle/arm). While the host goof-watcher
// keeps pushing frames, idleNoteActivity(true) resets the timer WITHOUT disarming,
// so the board stays out of the way. When the host falls silent (cap reached or
// laptop sleeps), the timer expires and the board enters a low-brightness rotation
// of enabled screensaver apps. Any real command (idleNoteActivity(false)) disarms.

static bool     idleArmed         = false;  // Claude signaled idle; eligible to screensaver
static bool     screensaverOn     = false;  // currently rotating
static uint32_t idleLastActivityMs= 0;      // last command received (idle or not)
static uint32_t idleNextPickMs    = 0;      // when to pick the next app
static String   idleLastPick      = "";     // avoid immediate repeats
static uint8_t  briBeforeIdle     = 40;     // restore target if a real command interrupts

// Split the enabled-apps CSV into a temp list and pick one at random (no repeat).
static String idlePickType() {
  // Count tokens.
  String csv = settings.idleApps; if (csv.length() == 0) return "";
  // Collect into a small fixed array (rotation universe is tiny).
  String types[16]; int n = 0;
  int start = 0;
  while (start < (int)csv.length() && n < 16) {
    int comma = csv.indexOf(',', start);
    if (comma < 0) comma = csv.length();
    String t = csv.substring(start, comma); t.trim();
    if (t.length()) types[n++] = t;
    start = comma + 1;
  }
  if (n == 0) return "";
  if (n == 1) return types[0];
  // Pick, avoiding an immediate repeat.
  String pick;
  for (int tries = 0; tries < 8; tries++) {
    pick = types[random(n)];
    if (pick != idleLastPick) break;
  }
  return pick;
}

static void idleLaunch(const String& type) {
  idleLastPick = type;
  FastLED.setBrightness(settings.idleBri);
  // Launch via the shared animation path. Minimal body — each app has sane defaults.
  String body = "{\"type\":\"" + type + "\"}";
  applyAnimationBody(body);   // sets animationName, animationActive, etc.
}

void idleArm() {
  if (!settings.idleOn) return;
  idleArmed = true;
  idleLastActivityMs = millis();   // start counting from now
}

// Called by every received display command. isIdleContent=true for the host
// goof/Zz pushes (keep armed, just reset timer); false for real user/Claude actions.
void idleNoteActivity(bool isIdleContent) {
  idleLastActivityMs = millis();
  if (isIdleContent) return;
  idleArmed = false;
  if (screensaverOn) { screensaverOn = false; }  // a real command takes over
}

void idleTick() {
  if (!settings.idleOn) { screensaverOn = false; return; }
  uint32_t now = millis();
  if (!screensaverOn) {
    if (idleArmed && (now - idleLastActivityMs) > (uint32_t)settings.idleAfterS * 1000UL) {
      briBeforeIdle = brightness;
      screensaverOn = true;
      idleNextPickMs = 0;   // pick immediately
    }
  }
  if (screensaverOn && now >= idleNextPickMs) {
    String t = idlePickType();
    if (t.length()) idleLaunch(t);
    idleNextPickMs = now + (uint32_t)settings.idleRotS * 1000UL;
  }
}
```

> `random(n)` is the Arduino PRNG (returns 0..n-1). It's fine here; no seeding needed
> for a screensaver. `applyAnimationBody` already exists and is what `handleAnimation`
> uses — reusing it keeps one launch path.

- [ ] **Step 2: Wire activity marking into the real command handlers**

In `api_handlers.ino`, add `idleNoteActivity(false);` at the TOP of the real,
user/Claude-driven handlers so any of them disarms idle: `handleAnimation`,
`handleText`, `handleMatrix`, `handleBrightness`, `handleClear`. Example for
`handleAnimation` (insert as first line of the function body):

```cpp
  idleNoteActivity(false);   // a real command — disarm idle / cancel screensaver
```

For `handleFrames` (the expression/goof channel), the marking depends on a flag the
caller sends — see Step 3.

- [ ] **Step 3: Add the idle marker to `handleFrames` + the arm handler**

In `handleFrames`, after the JSON is parsed, read an optional `idle` boolean and mark
accordingly (default false = real content):

```cpp
  bool idleContent = doc["idle"] | false;   // host goof/Zz pushes set this true
  idleNoteActivity(idleContent);
```

Add the arm handler (near the other handlers):

```cpp
// POST /api/idle/arm — Claude's Stop hook calls this when a turn ends. Arms the
// dead-man's switch so the board will screensaver once it goes quiet.
void handleIdleArm() {
  idleArm();
  sendJson(200, "{\"status\":\"ok\",\"armed\":true}");
}
```

- [ ] **Step 4: Register the route + call `idleTick()` in loop()**

In `esp32_matrix_webserver.ino` after the settings routes (Task 2):

```cpp
  server.on("/api/idle/arm",              HTTP_POST, handleIdleArm);
```

And in `loop()`, after the animation-tick block (after ~line 896, outside the frame-rate
`if`), call:

```cpp
  idleTick();   // idle_engine.ino — dead-man's switch screensaver
```

- [ ] **Step 5: Hardware verification (USER FLASHES — multi-part)**

After **Sketch → Upload**, ask the user to verify each:
1. **Arm + screensaver:** set a SHORT timeout for testing — `POST /api/settings {"idle_after_secs":10,"idle_rotate_secs":15}` — then `POST /api/idle/arm`. Within ~10s the board should start a random screensaver at dim brightness, and switch to a different one ~every 15s.
2. **No-hijack:** `POST /api/display/animation {"type":"snow"}` then `POST /api/idle/arm`... then immediately `POST /api/display/animation {"type":"fire"}`. Fire should stay (the real command disarmed idle); no screensaver should start.
3. **Idle content keeps armed:** `POST /api/idle/arm`, then every ~8s `POST /api/display/frames {"frames":["<one light frame>"],"frame_ms":150,"loop":0,"idle":true}`. Screensaver should NOT start while these arrive; stop them and within `idle_after_secs` it should.
4. Restore sane timeouts via the settings page when done.

- [ ] **Step 6: Commit**

```bash
git add esp32_matrix_webserver/idle_engine.ino esp32_matrix_webserver/api_handlers.ino esp32_matrix_webserver/esp32_matrix_webserver.ino
git commit -m "feat(fw): board-side idle screensaver dead-man's switch"
```

---

## Task 5: Host hooks — arm on done, mark goof as idle (Python)

**Files:**
- Modify: `claude-hooks/matrix_signal.py` AND its live copy `~/.claude/hooks/matrix_signal.py`
- Modify: `claude-hooks/matrix_idle.py` AND its live copy `~/.claude/hooks/matrix_idle.py`

**Interfaces:**
- Consumes: `POST /api/idle/arm` (Task 4); the `idle` flag on `/api/display/frames` (Task 4).
- Produces: an armed board on `done`; goof/Zz pushes that don't disarm.

- [ ] **Step 1: Arm the board on `done` in `matrix_signal.py`**

Find the board base URL the script already uses for posting frames (the same host/IP
config as `post_frames`). Add a tiny helper and call it on `done`:

```python
def arm_board_idle():
    """Tell the board to arm its dead-man's-switch screensaver (best-effort)."""
    try:
        import urllib.request, json as _json
        req = urllib.request.Request(
            BOARD_URL + "/api/idle/arm", data=b"{}",
            headers={"Content-Type": "application/json"}, method="POST")
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass  # never break the turn
```

In `main()`, in the `if name == "done"` branch (alongside `spawn_idle_watcher`):

```python
    if name == "done" and token is not None:
        arm_board_idle()
        spawn_idle_watcher(token)
```

> Use whatever the file already defines for the board address (e.g. `BOARD_URL` /
> `ESP32_URL` env). If none exists, read `os.environ.get("ESP32_URL","http://esp32matrix.local")`
> at top of file, matching the MCP default, so a customer install needs no edits.

- [ ] **Step 2: Mark goof/Zz pushes as idle content in `matrix_idle.py`**

`matrix_idle.py` plays via `ms.post_frames(...)`. Add the `idle` flag so these pushes
don't disarm the board. Update `post_frames` in `matrix_signal.py` to accept and send
it, defaulting false (so normal expressions are unaffected):

```python
def post_frames(frames_hex, frame_ms, loop, idle=False):
    payload = {"frames": frames_hex, "frame_ms": frame_ms, "loop": loop, "idle": idle}
    # ... existing POST of `payload` to /api/display/frames ...
```

Then in `matrix_idle.py`'s `play()`:

```python
def play(entry):
    frames_art, colors, frame_ms, loop = entry
    ms.post_frames([ms.art_to_hex(f, colors) for f in frames_art], frame_ms, loop, idle=True)
```

The terminal `REST` (Zz) likewise goes through `play()`, so it's marked idle and the
board's timer takes over after it — exactly Goof → Zz → Screensaver. No other change
to the watcher's lifecycle is needed.

- [ ] **Step 3: Sync live copies**

Copy both edited files to `~/.claude/hooks/` (the installed copies the harness runs):

```bash
cp claude-hooks/matrix_signal.py ~/.claude/hooks/matrix_signal.py
cp claude-hooks/matrix_idle.py ~/.claude/hooks/matrix_idle.py
```

- [ ] **Step 4: Manual verification**

With the board flashed (Task 4) and short timeouts set: finish a Claude turn (triggers
the `Stop` hook → `done`). Confirm via Serial or `GET /api/status` that the board armed,
the goof animations play, and after they stop the screensaver rotation begins. Submit a
new prompt → the `wait` signal disarms and the screensaver stops.

- [ ] **Step 5: Commit**

```bash
git add claude-hooks/matrix_signal.py claude-hooks/matrix_idle.py
git commit -m "feat(hooks): arm board idle on done; mark goof/Zz as idle content"
```

---

## Task 6: MCP settings helpers — pure logic with tests (TS, TDD)

**Files:**
- Create: `mcp_server/settings.ts`
- Create: `mcp_server/settings.test.ts`

**Interfaces:**
- Produces: `normalizeSettingsPatch(input: Record<string, unknown>): Record<string, unknown>` (drops unknown keys, coerces types, leaves only valid keys for POST); `parseIdleApps(csv: string): string[]`; `serializeIdleApps(list: string[]): string`; `KNOWN_SETTING_KEYS: string[]`.
- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing tests**

```ts
// settings.test.ts
import { describe, it, expect } from "vitest";
import { normalizeSettingsPatch, parseIdleApps, serializeIdleApps, KNOWN_SETTING_KEYS } from "./settings.js";

describe("parseIdleApps", () => {
  it("splits a CSV and trims", () => {
    expect(parseIdleApps("fire, clock ,snow")).toEqual(["fire", "clock", "snow"]);
  });
  it("returns [] for empty", () => {
    expect(parseIdleApps("")).toEqual([]);
  });
});

describe("serializeIdleApps", () => {
  it("joins with commas", () => {
    expect(serializeIdleApps(["fire", "snow"])).toBe("fire,snow");
  });
});

describe("normalizeSettingsPatch", () => {
  it("keeps only known keys", () => {
    const out = normalizeSettingsPatch({ idle_after_secs: 300, bogus: 1 });
    expect(out).toEqual({ idle_after_secs: 300 });
  });
  it("coerces numeric strings to numbers", () => {
    expect(normalizeSettingsPatch({ idle_brightness: "5" })).toEqual({ idle_brightness: 5 });
  });
  it("coerces booleans", () => {
    expect(normalizeSettingsPatch({ idle_enabled: "true" })).toEqual({ idle_enabled: true });
  });
  it("exposes the known keys", () => {
    expect(KNOWN_SETTING_KEYS).toContain("idle_after_secs");
    expect(KNOWN_SETTING_KEYS).toContain("timezone");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd mcp_server && npx vitest run settings.test.ts`
Expected: FAIL — `Cannot find module './settings.js'`.

- [ ] **Step 3: Implement `settings.ts`**

```ts
// settings.ts — pure helpers for the MCP settings tools. The board validates and
// clamps; these just shape a partial patch (drop unknown keys, coerce types) so
// Claude's free-form args become a clean POST body.

export const KNOWN_SETTING_KEYS = [
  "idle_enabled", "idle_apps", "idle_after_secs", "idle_rotate_secs",
  "idle_brightness", "default_brightness", "boot_animation", "timezone",
] as const;

const NUMERIC = new Set(["idle_after_secs", "idle_rotate_secs", "idle_brightness", "default_brightness"]);
const BOOLEAN = new Set(["idle_enabled"]);

export function parseIdleApps(csv: string): string[] {
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function serializeIdleApps(list: string[]): string {
  return list.map((s) => s.trim()).filter(Boolean).join(",");
}

export function normalizeSettingsPatch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of KNOWN_SETTING_KEYS) {
    if (!(key in input) || input[key] === undefined || input[key] === null) continue;
    let v = input[key];
    if (NUMERIC.has(key)) v = Number(v);
    else if (BOOLEAN.has(key)) v = v === true || v === "true";
    else v = String(v);
    out[key] = v;
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd mcp_server && npx vitest run settings.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add mcp_server/settings.ts mcp_server/settings.test.ts
git commit -m "feat(mcp): settings patch-normalization helpers + tests"
```

---

## Task 7: MCP tools — `matrix_get_settings` / `matrix_set_settings`

**Files:**
- Modify: `mcp_server/index.ts` (import helpers; add 2 tool defs in the ListTools array ~line 632; add 2 cases in the CallTool switch ~line 805)

**Interfaces:**
- Consumes: `get`/`post` helpers (`index.ts`), `normalizeSettingsPatch` (Task 6).
- Produces: tools `matrix_get_settings`, `matrix_set_settings`.

- [ ] **Step 1: Import the helpers**

Near the top imports (alongside `import { IDLE_APPS, ... } from "./idle.js";` line 32):

```ts
import { normalizeSettingsPatch } from "./settings.js";
```

- [ ] **Step 2: Add the tool definitions**

In the ListTools array (after the last tool def, before the array closes ~line 632):

```ts
    {
      name: "matrix_get_settings",
      description:
        "Read the board's current persistent settings — idle screensaver behavior (enabled, which apps rotate, how long before it starts, how often it re-picks, idle brightness), default brightness, default boot animation, and clock timezone. Use this to answer questions like 'what's my idle timeout?' or before changing a setting.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "matrix_set_settings",
      description:
        "Change one or more board settings (persisted on the board, survives reflash). Only the fields you provide change. Fields: idle_enabled (bool), idle_apps (comma-separated app names from: fire, matrix_rain, clock, fireworks, frostbite, snow, dancefloor), idle_after_secs (seconds of quiet before the screensaver starts), idle_rotate_secs (seconds between screensaver changes), idle_brightness (1-255, screensaver dimness), default_brightness (0-255 on boot), boot_animation (animation type to show on power-up, or empty to resume last), timezone (POSIX TZ string for the clock). Example: 'start the screensaver after 5 minutes' -> { idle_after_secs: 300 }.",
      inputSchema: {
        type: "object",
        properties: {
          idle_enabled: { type: "boolean" },
          idle_apps: { type: "string", description: "Comma-separated enabled screensaver apps." },
          idle_after_secs: { type: "number" },
          idle_rotate_secs: { type: "number" },
          idle_brightness: { type: "number" },
          default_brightness: { type: "number" },
          boot_animation: { type: "string" },
          timezone: { type: "string" },
        },
      },
    },
```

- [ ] **Step 3: Add the CallTool cases**

In the `switch (name)` block (after the `matrix_idle` case ~line 805):

```ts
      case "matrix_get_settings": {
        const r = await get("/api/settings");
        return { content: [{ type: "text", text: r.ok ? r.body : `Error ${r.status}: ${r.body}` }] };
      }

      case "matrix_set_settings": {
        const patch = normalizeSettingsPatch(args as Record<string, unknown>);
        if (Object.keys(patch).length === 0) {
          return { content: [{ type: "text", text: "No recognized settings to change." }] };
        }
        const r = await post("/api/settings", patch);
        return { content: [{ type: "text", text: r.ok ? `Settings updated: ${r.body}` : `Error ${r.status}: ${r.body}` }] };
      }
```

- [ ] **Step 4: Build + reconnect + verify**

The PostToolUse hook runs `tsc`; confirm no TS errors. Then **`/mcp` reconnect**. Verify:
- `matrix_get_settings` returns the board's settings JSON.
- `matrix_set_settings` with `{ idle_after_secs: 300 }` updates it; a follow-up
  `matrix_get_settings` shows `300`. Try a natural phrasing through Claude
  ("turn off snow in the screensaver rotation") and confirm `idle_apps` updates.

- [ ] **Step 5: Commit**

```bash
git add mcp_server/index.ts
git commit -m "feat(mcp): matrix_get_settings + matrix_set_settings tools"
```

---

## Task 8: Version bump + docs

**Files:**
- Modify: `CLAUDE.md` (Settings section + API surface + MCP tools), `README.md` (optional features row)
- Run: `npm run bump:minor`

**Interfaces:** none (documentation + release).

- [ ] **Step 1: Document the feature**

Add to `CLAUDE.md`: a short **Settings** section (NVS-backed, merge-on-boot, `/api/settings`,
settings page, `matrix_get_settings`/`matrix_set_settings`), the new API rows
(`GET/POST /api/settings`, `POST /api/idle/arm`), and the idle-screensaver behavior
(Goof → Zz → board screensaver, governed by settings).

- [ ] **Step 2: Bump the version**

```bash
npm run bump:minor
```
This rewrites `VERSION`, stamps `version.h` / `data/version.json` / `mcp_server/package.json`,
and commits `chore: bump vX.Y.Z`.

- [ ] **Step 3: Deploy checklist (USER)**

Remind the user this isn't live until each artifact is redeployed:
- Firmware: **Sketch → Upload**
- Web: **LittleFS upload** (settings.html / index.html / version.json)
- MCP: `tsc` already ran via hook → **`/mcp` reconnect**

Then run `matrix_version` (MCP) or `npm run check` to confirm all three report the new version with no `⚠ DRIFT`.

- [ ] **Step 4: Commit docs**

```bash
git add CLAUDE.md README.md
git commit -m "docs: settings foundation + idle screensaver"
```

---

## Self-Review Notes

- **Spec coverage:** Part 1 → Tasks 1–3; Part 2 (seed settings) → Task 1 model + Task 3 UI; Part 3 (idle engine) → Task 4 + Task 5; Part 4 (MCP) → Tasks 6–7; Part 5 (distribution: graceful defaults via merge-on-boot, `ESP32_URL` reuse in hook + MCP, no per-user setup, conversational-first tool descriptions) → addressed across Tasks 1, 5, 7. Versioning → Task 8.
- **Deferred spec questions resolved here:** idle-arm = dedicated `/api/idle/arm` (Task 4); `idle_apps` encoding = CSV of type names (Task 1); existing `matrix_idle` tool stays separate from the always-on screensaver (the screensaver reads the firmware CSV; `matrix_idle.ts` keeps its own lineup — noted as conceptual-alignment, not shared code).
- **Type consistency:** firmware `applySettingsJson`/`settingsToJson` use the same JSON key names the web page and MCP send (`idle_enabled`, `idle_apps`, `idle_after_secs`, `idle_rotate_secs`, `idle_brightness`, `default_brightness`, `boot_animation`, `timezone`). MCP `normalizeSettingsPatch` whitelists exactly those keys.
- **Known limitation (acceptable for v1):** the screensaver rotation universe is duplicated between `mcp_server/idle.ts` (IDLE_APPS) and the firmware CSV default — flagged in the spec; kept aligned by convention.
