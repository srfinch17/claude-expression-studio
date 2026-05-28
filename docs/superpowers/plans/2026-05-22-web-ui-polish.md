# Web UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three issues in the ESP32 Matrix web UI: center and constrain the index page card grid, redesign the brightness slider with a heat warning, and center content on all sub-pages.

**Architecture:** All changes are self-contained edits to HTML files in `esp32_matrix_webserver/data/`. No new files, no shared assets, no build step — each file is vanilla HTML/CSS/JS served directly from the ESP32 filesystem.

**Tech Stack:** Vanilla HTML, CSS, JavaScript. `localStorage` for brightness persistence across page loads.

---

## Task 1: Index page — center and constrain the card grid

**Files:**
- Modify: `esp32_matrix_webserver/data/index.html`

- [ ] **Step 1: Add `.wrap` CSS rule**

In `index.html`, inside the `<style>` block, add this rule after the `body { ... }` rule:

```css
.wrap { max-width: 720px; margin: 0 auto; }
```

- [ ] **Step 2: Wrap body content**

Replace the current body structure (everything inside `<body>`) so it reads:

```html
<body>
  <div class="wrap">
    <header>
      <h1>ESP32-S3 Matrix</h1>
      <p class="subtitle">Web control panel — served directly from the board</p>
    </header>

    <div class="apps">
      <!-- all the <a class="card"> elements stay unchanged -->
    </div>

    <div class="panel">
      <!-- Quick Controls panel stays unchanged -->
    </div>

    <footer>Board IP: <span id="ip">…</span></footer>
  </div>
</body>
```

The only change is adding `<div class="wrap">` immediately after `<body>` and `</div>` immediately before `</body>`. All inner content is untouched.

- [ ] **Step 3: Verify visually**

Open `esp32_matrix_webserver/data/index.html` directly in a browser (file://). Resize the window:
- Wide (>720px): cards should sit in a centered block, not spanning edge-to-edge.
- Medium (~600px): grid should show 3 columns.
- Narrow (~450px): grid should show 2 columns.
- Very narrow (~300px): grid should show 1 column.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/index.html
git commit -m "fix: center and constrain card grid on index page"
```

---

## Task 2: Index page — brightness slider redesign

**Files:**
- Modify: `esp32_matrix_webserver/data/index.html`

- [ ] **Step 1: Add CSS for the heat gradient and warning row**

In the `<style>` block, add these rules (after the `.status.err` rule works fine):

```css
.heat-track { position: relative; height: 5px; border-radius: 3px; background: linear-gradient(to right, #22882a 0%, #22882a 16%, #e8b800 30%, #f97316 42%, #cc2200 100%); margin: 4px 0; }
.heat-lock-line { position: absolute; left: 39.2%; top: -3px; bottom: -3px; width: 2px; background: rgba(255,255,255,0.22); border-radius: 1px; }
.heat-labels { display: flex; justify-content: space-between; font-size: 0.62rem; color: #555; margin-bottom: 10px; }
.heat-labels .safe { color: #22882a; }
.heat-labels .hot  { color: #f97316; }
.warn-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid #3a1a00; border-radius: 7px; background: #130900; }
.warn-row input[type=checkbox] { accent-color: #f97316; width: 14px; height: 14px; margin-top: 2px; flex-shrink: 0; cursor: pointer; }
.warn-text { font-size: 0.75rem; color: #c05000; line-height: 1.4; }
.warn-text strong { color: #f97316; }
```

- [ ] **Step 2: Replace the brightness HTML block**

Find this block inside the Quick Controls panel:

```html
<div class="row">
  <label>Brightness: <strong id="bval">40</strong></label>
  <input type="range" id="brightness" min="0" max="255" value="40" oninput="updateBrightness(this.value)">
</div>
```

Replace it with:

```html
<div class="row">
  <label>Brightness: <strong id="bval" style="display:inline-block;min-width:2.5ch;text-align:right">10</strong></label>
  <input type="range" id="brightness" min="0" max="255" value="10" oninput="updateBrightness(this.value)">
</div>
<div class="heat-track"><div class="heat-lock-line"></div></div>
<div class="heat-labels">
  <span>0</span><span class="safe">safe</span><span>100</span><span class="hot">&#x26A0; hot</span><span>255</span>
</div>
<div class="warn-row">
  <input type="checkbox" id="cbHighBright" onchange="onHighBrightToggle()">
  <span class="warn-text"><strong>&#x26A0; Heat warning:</strong> above 100 risks overheating. Check to unlock.</span>
</div>
```

- [ ] **Step 3: Replace the JavaScript block**

Replace the entire `<script>` block (everything between `<script>` and `</script>`) with:

```javascript
document.getElementById('ip').textContent = window.location.hostname;

function setStatus(msg, isErr) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status' + (isErr ? ' err' : '');
}

async function post(url, data) {
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return r.ok;
  } catch { return false; }
}

async function clearDisplay() {
  const ok = await post('/api/display/clear', {});
  setStatus(ok ? 'Display cleared.' : 'Error — is the board reachable?', !ok);
}

// ── Brightness ────────────────────────────────────────────────────────────────

let brightTimer;

(function initBrightness() {
  const storedVal = localStorage.getItem('matrix_brightness');
  const highUnlocked = localStorage.getItem('matrix_highbright') === '1';
  let val = storedVal !== null ? +storedVal : 10;
  if (!highUnlocked && val > 100) val = 100;
  document.getElementById('brightness').value = val;
  document.getElementById('bval').textContent = val;
  document.getElementById('cbHighBright').checked = highUnlocked;
})();

function onHighBrightToggle() {
  const unlocked = document.getElementById('cbHighBright').checked;
  localStorage.setItem('matrix_highbright', unlocked ? '1' : '0');
  if (!unlocked) {
    const slider = document.getElementById('brightness');
    if (+slider.value > 100) {
      slider.value = 100;
      document.getElementById('bval').textContent = 100;
      localStorage.setItem('matrix_brightness', '100');
      clearTimeout(brightTimer);
      brightTimer = setTimeout(async () => {
        const ok = await post('/api/brightness', { level: 100 });
        setStatus(ok ? 'Brightness updated.' : 'Error updating brightness.', !ok);
      }, 250);
    }
  }
}

function updateBrightness(rawVal) {
  let val = +rawVal;
  const unlocked = document.getElementById('cbHighBright').checked;
  if (!unlocked && val > 100) {
    val = 100;
    document.getElementById('brightness').value = 100;
  }
  document.getElementById('bval').textContent = val;
  localStorage.setItem('matrix_brightness', String(val));
  clearTimeout(brightTimer);
  brightTimer = setTimeout(async () => {
    const ok = await post('/api/brightness', { level: val });
    setStatus(ok ? 'Brightness updated.' : 'Error updating brightness.', !ok);
  }, 250);
}
```

- [ ] **Step 4: Verify visually**

Open `index.html` in a browser:
1. Slider should start at 10. Value display should not jitter as you drag left (the `min-width:2.5ch` keeps it stable).
2. Drag slider right past 100 — it should snap back to 100 while checkbox is unchecked.
3. Check the warning checkbox — now drag past 100. Should go all the way to 255.
4. Uncheck the checkbox while slider is at e.g. 150 — should immediately snap to 100 and send to board.
5. Reload the page — slider should restore from `localStorage`.
6. Set slider to 150, reload — should clamp to 100 (checkbox unchecked resets on reload too).

- [ ] **Step 5: Commit**

```bash
git add esp32_matrix_webserver/data/index.html
git commit -m "feat: redesign brightness slider with heat warning and safe-range lock"
```

---

## Task 3: Sub-pages — center all content

**Files — all modified the same way:**
- `esp32_matrix_webserver/data/fire.html`
- `esp32_matrix_webserver/data/liquid.html`
- `esp32_matrix_webserver/data/text.html`
- `esp32_matrix_webserver/data/imu.html`
- `esp32_matrix_webserver/data/weather.html`
- `esp32_matrix_webserver/data/temp.html`
- `esp32_matrix_webserver/data/timer.html`
- `esp32_matrix_webserver/data/clock.html`
- `esp32_matrix_webserver/data/animations.html`
- `esp32_matrix_webserver/data/matrix_rain.html`
- `esp32_matrix_webserver/data/emoji.html`

The change is identical for every file — apply it to each one in sequence.

- [ ] **Step 1: Add `.wrap` CSS to each file**

In each file's `<style>` block, add this rule after the `body { ... }` rule:

```css
.wrap { max-width: 760px; margin: 0 auto; }
```

- [ ] **Step 2: Wrap body content in each file**

In each file, add `<div class="wrap">` as the first child of `<body>`, and `</div>` as the last child before `</body>`.

Before:
```html
<body>
  <a href="/" class="back">← Home</a>
  <h1>...</h1>
  ... rest of content ...
</body>
```

After:
```html
<body>
  <div class="wrap">
    <a href="/" class="back">← Home</a>
    <h1>...</h1>
    ... rest of content ...
  </div>
</body>
```

**Note for `clock.html`:** Its back link is inside a `<header>` element rather than a standalone `<a>`. Same treatment — the `<div class="wrap">` wraps the `<header>` and everything after it.

- [ ] **Step 3: Verify two representative pages**

Open `fire.html` in a browser: the canvas preview + controls should be centered and not span the full window at wide viewports.

Open `animations.html` in a browser: the animation grid cards should be centered.

- [ ] **Step 4: Commit**

```bash
git add esp32_matrix_webserver/data/fire.html \
        esp32_matrix_webserver/data/liquid.html \
        esp32_matrix_webserver/data/text.html \
        esp32_matrix_webserver/data/imu.html \
        esp32_matrix_webserver/data/weather.html \
        esp32_matrix_webserver/data/temp.html \
        esp32_matrix_webserver/data/timer.html \
        esp32_matrix_webserver/data/clock.html \
        esp32_matrix_webserver/data/animations.html \
        esp32_matrix_webserver/data/matrix_rain.html \
        esp32_matrix_webserver/data/emoji.html
git commit -m "fix: center page content on all sub-pages"
```
