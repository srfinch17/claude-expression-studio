# UI Revamp — Phase 3 (remaining pages + sweep + 1.1.0) Implementation Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Bring every remaining page onto the Phase-1 shell (`app.css`/`backnav.js`), do a final consistency audit, and ship the revamp as **v1.1.0**.

**Architecture:** Same re-shell recipe proven in Phase 2 (T5): swap inline `<style>`→`app.css`+favicon, `.wrap --accent-page`, replace `.back` link with `backnav.js`, group controls into `.subcard`/`.subhead`, default-on debounced live-apply where it makes sense, framed full-strength preview, mobile-first; preserve each page's logic + POST payload field names. Web/LittleFS only — **no firmware change**.

## Global Constraints
- Web/LittleFS only — no `.ino` change. Preserve every page's `/api/*` POST body field names (firmware contract). Distributable repo: "the user".
- Calibration Lab (`calibrate.html`) is the preview EXCEPTION — it deliberately shows the real corrected output; align its chrome only, do NOT make its preview full-strength.
- `presence-card.html` is a standalone desktop card (excluded from board chrome `header.js`/`backnav.js`) — align to `app.css` tokens only.

## Pages
- **Control pages (re-shell, default-on live-apply where sensible):** `text.html`, `clock.html`, `calendar.html`, `timer.html`, `sound.html`, `sketch.html`, `emoji.html`, `temp.html` (chip-temp). Parent `/` (Home) except temp→`/system.html`.
- **System hub + config:** `system.html` → pure grid hub (app.css cards → Settings/Chip Temp/Calibration Lab/IMU); `settings.html` (form → tokens, parent `/system.html`); `imu.html` (diagnostic → tokens, parent `/system.html`); `calibrate.html` (chrome→app.css + backnav parent `/system.html`, preview UNCHANGED); `grid_test.html` (redirect stub → app.css).
- **`presence-card.html`** — tokens only.

## Tasks

### P3-T1: Re-shell the 7 control pages (subagent batch + adversarial review)
- [ ] Dispatch a subagent to re-shell `text/clock/calendar/timer/sound/sketch/emoji` onto the shell (recipe above; ZIP-like free-text fields and the sketch canvas keep explicit Apply, not keystroke live-apply). Verify each via local threaded server + Playwright (console clean, back-pill, no inline style block, preview lit if present, mobile no-overflow, POST fields unchanged).
- [ ] Adversarial code-review the 7 pages vs firmware `applyAnimationBody`/handlers + their committed versions (payload fields, dead controls, shell consistency). Fix findings.
- [ ] Commit.

### P3-T2: System hub + config pages (inline)
- [ ] `system.html` → grid hub (cards: Settings, Chip Temp (`temp.html`), Calibration Lab (`calibrate.html`), IMU (`imu.html`)), backnav Home, no inline controls.
- [ ] Re-shell `settings.html`, `imu.html`, `temp.html` onto app.css (backnav parent `/system.html`); `calibrate.html` chrome→app.css + backnav (preview untouched); `grid_test.html` redirect stub → app.css; `presence-card.html` → tokens.
- [ ] Verify each (Playwright). Commit.

### P3-T3: Final consistency audit + dead-code cleanup
- [ ] Playwright sweep EVERY page on the local server: console clean, back-pill present + correct parent, app.css linked, mobile no horizontal overflow at 390px, all hub card links resolve.
- [ ] Remove the dead `ledsim.js`/`dim()` from `matrix_rain.html`/`snow.html` (flagged in Phase 2 review) and any other dead code found.
- [ ] Commit.

### P3-T4: Deploy + bump v1.1.0 + finish
- [ ] User uploads `data/` (LittleFS) — final revamp upload. Real-board Playwright spot-check + a couple of live-apply→framebuffer confirmations.
- [ ] User review gate (desktop + phone) across the now-fully-consistent UI.
- [ ] `npm run bump:minor` → 1.1.0 (stamps version.h/version.json/package.json). **Web/MCP-only revamp:** upload web (version.json) + `/mcp` reconnect (package.json). Firmware version.h stamp = expected cosmetic DRIFT (no firmware change; flash deferred to the next real firmware change) — note in the finish summary, like PR #18.
- [ ] `npm run check` (note expected fw drift), restore board brightness, then superpowers:finishing-a-development-branch → PR/merge.

## Self-Review
Covers spec's "remaining control pages + system + sweep → bump 1.1.0 → finish" (Phase-3 scope). Calibration-Lab preview exception + presence-card carve-out honored. Reuses the Phase-2-proven subagent+adversarial-review loop for the repetitive batch.
