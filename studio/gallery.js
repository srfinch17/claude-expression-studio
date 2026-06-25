import { resolveExpression } from "../shared/expressions.js";
import { Panel } from "../shared/render.js";
import { FIRMWARE_SIMS } from "../shared/firmware-sims.js";

const REDUCE = matchMedia("(prefers-reduced-motion:reduce)").matches;
const GROUP_ORDER = ["orphan", "canned", "wait", "ask", "bored", "firmware"];
const GROUP_TITLE = {
  orphan:   "Orphans — no rotation",
  canned:   "Canned glyphs (matrix_express)",
  wait:     "Wait pool",
  ask:      "Ask-* hooks",
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

function cell(grid, name, desc, group, approved) {
  const el = document.createElement("div");
  el.className = "cell" + (group === "orphan" ? " orphan" : "") + (approved ? " approved" : "");
  if (approved) {
    const ck = document.createElement("div"); ck.className = "check"; ck.textContent = "✓"; ck.title = "Approved / done"; el.appendChild(ck);
  }
  const cv = document.createElement("canvas"); cv.width = 128; cv.height = 128;
  el.appendChild(cv);
  const nm = document.createElement("div"); nm.className = "name"; nm.textContent = name; el.appendChild(nm);
  const ds = document.createElement("div"); ds.className = "desc"; ds.textContent = desc || ""; el.appendChild(ds);
  const bd = document.createElement("div"); bd.className = "badge " + group; bd.textContent = GROUP_TITLE[group]; el.appendChild(bd);
  grid.appendChild(el);
  return cv;
}

async function build() {
  const root = document.getElementById("root");
  let data;
  try {
    data = await (await fetch("./gallery-data.json")).json();
  } catch (e) {
    root.innerHTML = `<p class="err">Could not load ./gallery-data.json — run <code>npm run build:gallery</code>. (${e.message})</p>`;
    return;
  }

  const byGroup = { orphan: [], canned: [], wait: [], ask: [], bored: [], firmware: [] };
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
          const cv = cell(grid, it.name, it.description, group, it.approved);
          const expr = resolveExpression(it);
          const p = new Panel(cv); p.setFrames(expr.frames, expr.frame_ms); panels.push(p);
        }
      } catch (e) {
        const err = document.createElement("div"); err.className = "err"; err.textContent = `${it.name}: ${e.message}`; grid.appendChild(err);
      }
    }
  }

  if (!REDUCE) {
    let last = performance.now();
    (function loop(now) {
      const dt = now - last; last = now;
      for (const p of panels) p.tick(dt, now);
      requestAnimationFrame(loop);
    })(performance.now());
  }
}
build();
