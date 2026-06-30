// studio/gallery.js — the Gallery page's browser renderer. Fetches the prebuilt
// ./gallery-data.json (emitted by scripts/build-gallery-data.mjs), then draws every
// expression onto its own bloom Panel canvas, sectioned by rotation role (orphan / wired /
// canned / wait / ask / bored / firmware) so you can SEE the whole library and which moments
// each piece is wired to. Saved expressions render from baked frames; firmware entries run
// their JS sim live. Edit/approve affordances appear only when a live engine is reachable
// (the POST routes exist) — on a static Pages host the Gallery is browse-only.
import { resolveExpression } from "../shared/expressions.js";
import { Panel } from "../shared/render.js";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";

const GROUP_ORDER = ["orphan", "wired", "canned", "wait", "ask", "bored", "firmware"];
const GROUP_TITLE = {
  orphan:   "Orphans (no rotation)",
  wired:    "Wired (other moments)",
  canned:   "Canned glyphs (matrix_express)",
  wait:     "Wait pool",
  ask:      "Ask / attention",
  bored:    "Bored pool",
  firmware: "Firmware animations",
};
const FW_DEFAULTS = {
  claudesweep: {},
  frostbite:   { mist: 40, sparkle: 20 },
  fire:        { palette: "classic", intensity: 6 },
  matrix_rain: { theme: "classic", frame_ms: 60 },
  snow:        { frame_ms: 110, flakeColor: "#dce6ff" },
  fireworks:   {},
  dancefloor:  { palette: 0, hold: 6 },
};

const panels = [];

// Edit affordances (✎ edit link, approve toggle) require BOTH a saved expression and a live
// engine to write through. On a static host (no engine) the Gallery is purely browse.
export function showEditAffordances(editable, hasEngine) {
  return editable && hasEngine;
}

function cell(grid, name, desc, group, approved, editable, canApprove) {
  const el = document.createElement("div");
  el.className = "cell" + (group === "orphan" ? " orphan" : "") + (approved ? " approved" : "");
  if (approved) {
    const ck = document.createElement("div"); ck.className = "check"; ck.textContent = "✓"; ck.title = "Approved / done"; el.appendChild(ck);
  }
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  el.appendChild(cv);
  const nm = document.createElement("div"); nm.className = "name"; nm.textContent = name; el.appendChild(nm);
  const showEdits = showEditAffordances(editable, canApprove);
  if (showEdits) { const ed = document.createElement("a"); ed.className = "editlink"; ed.href = `./frame-editor.html?name=${encodeURIComponent(name)}`;
    ed.textContent = "✎ edit"; ed.title = "Edit this expression"; el.appendChild(ed); }
  if (showEdits) {
    let isApproved = approved;
    const tg = document.createElement("button"); tg.className = "approvetoggle";
    const paint = () => { tg.textContent = isApproved ? "✓ approved" : "○ approve"; tg.classList.toggle("on", isApproved); };
    paint();
    tg.onclick = async () => {
      tg.disabled = true;
      try {
        const r = await fetch(`/api/approval/${encodeURIComponent(name)}`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ approved: !isApproved }),
        });
        const res = await r.json();
        if (res.ok) {
          isApproved = res.approved;
          el.classList.toggle("approved", isApproved);
          let ck = el.querySelector(".check");
          if (isApproved && !ck) { ck = document.createElement("div"); ck.className = "check"; ck.textContent = "✓"; ck.title = "Approved / done"; el.insertBefore(ck, el.firstChild); }
          else if (!isApproved && ck) { ck.remove(); }
          paint();
        }
      } catch { /* leave state unchanged on network error */ }
      tg.disabled = false;
    };
    el.appendChild(tg);
  }
  const ds = document.createElement("div"); ds.className = "desc"; ds.textContent = desc || ""; el.appendChild(ds);
  const bd = document.createElement("div"); bd.className = "badge " + group; bd.textContent = group; el.appendChild(bd);
  grid.appendChild(el);
  return cv;
}

async function build() {
  const root = document.getElementById("root");
  let data;
  try {
    data = await (await fetch("./gallery-data.json")).json();
  } catch (e) {
    root.innerHTML = `<p class="err">Could not load ./gallery-data.json. Run <code>npm run build:gallery</code>. (${e.message})</p>`;
    return;
  }

  // Approval needs the engine (the POST route). Probe once; if absent, the toggle is hidden.
  let canApprove = false;
  try { canApprove = (await fetch("/api/manifest")).ok; } catch { canApprove = false; }

  const byGroup = { orphan: [], wired: [], canned: [], wait: [], ask: [], bored: [], firmware: [] };
  for (const e of data.expressions) (byGroup[e.group] ||= []).push(e);

  for (const group of GROUP_ORDER) {
    const items = group === "firmware"
      ? data.firmware.map((n) => ({ name: n, firmware: true }))
      : (byGroup[group] || []);
    if (!items.length) continue;
    const h2 = document.createElement("h2");
    h2.innerHTML = `${GROUP_TITLE[group]} <span class="count">${items.length}</span>`;
    root.appendChild(h2);
    const grid = document.createElement("div"); grid.className = "grid"; root.appendChild(grid);
    for (const it of items) {
      try {
        if (it.firmware) {
          const cv = cell(grid, it.name, "generative firmware animation", "firmware");
          const sim = FIRMWARE_SIMS[it.name](FW_DEFAULTS[it.name] || {});
          const p = new Panel(cv); p.setStepper(() => sim.frame(), sim.frame_ms); panels.push(p);
        } else {
          const cv = cell(grid, it.name, it.description, group, it.approved, it.source === "saved", canApprove);
          const expr = resolveExpression(it);
          const p = new Panel(cv); p.setFrames(expr.frames, expr.frame_ms); panels.push(p);
        }
      } catch (e) {
        const err = document.createElement("div"); err.className = "err"; err.textContent = `${it.name}: ${e.message}`; grid.appendChild(err);
      }
    }
  }

  const REDUCE = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (!REDUCE) {
    let last = performance.now();
    (function loop(now) {
      const dt = now - last; last = now;
      for (const p of panels) p.tick(dt, now);
      requestAnimationFrame(loop);
    })(performance.now());
  }
}
if (typeof document !== "undefined") build();
