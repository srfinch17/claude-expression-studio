// shared/presence-card.js, the web presence-card render core. Pure helpers (unit-tested) +
// one DOM render fn (renderPresenceCard), factored out of the board's presence-card.html so the
// Studio web surface (studio/presence.html) shares one implementation rather than a third copy.
import { GENERIC } from "./presence-vocab.js";

// Intent -> appearance lookup, GENERIC on miss (never blank).
export function vocabFor(vocab, intent) {
  return (vocab && vocab[intent]) || GENERIC;
}

// Classify a PresenceData (one of progress/values/series) into a plain model for the DOM layer.
export function dataBlock(data) {
  if (!data || typeof data !== "object") return { kind: "none" };
  if ("progress" in data) {
    const pct = Math.round(Math.max(0, Math.min(1, Number(data.progress) || 0)) * 100);
    return { kind: "progress", pct };
  }
  if ("values" in data && Array.isArray(data.values)) {
    return { kind: "values", values: data.values };
  }
  if ("series" in data && Array.isArray(data.series)) {
    return { kind: "series", series: data.series, label: data.label, unit: data.unit };
  }
  return { kind: "none" };
}

// SVG polyline points for a min/max-normalized sparkline in a w×h box (3px vertical padding).
export function sparklinePoints(series, w, h) {
  const n = series.length;
  const min = Math.min(...series), max = Math.max(...series), span = (max - min) || 1;
  return series.map((v, i) =>
    `${(i / Math.max(1, n - 1)) * w},${h - ((v - min) / span) * (h - 6) - 3}`).join(" ");
}

// The "m-<motion> u-<urgency>" class the card element carries (urgency defaults to ambient).
export function motionClass(entry, urgency) {
  return `m-${(entry && entry.motion) || "none"} u-${urgency || "ambient"}`;
}

// "Ns ago" / "Nm ago" / ", ". tsSeconds is unix-seconds (0/falsey => ", ").
export function formatAge(tsSeconds, nowMs) {
  if (!tsSeconds) return ", ";
  const s = Math.max(0, Math.floor(nowMs / 1000) - tsSeconds);
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

// DOM render: write a PresenceMessage into a card element that contains
// .glyph .label .headline .detail .intent .data nodes. Sets --accent + the motion class on `el`.
export function renderPresenceCard(el, msg, vocab) {
  const v = vocabFor(vocab, msg.intent);
  el.style.setProperty("--accent", v.color);
  const set = (sel, txt) => { const n = el.querySelector(sel); if (n) n.textContent = txt; };
  set(".glyph", v.glyph);
  set(".label", v.label);
  set(".headline", msg.headline ?? "");
  set(".detail", msg.detail ?? "");
  set(".intent", msg.intent);
  const cls = motionClass(v, msg.urgency);
  if (el.className !== cls) el.className = cls;
  renderDataInto(el.querySelector(".data"), dataBlock(msg.data));
}

function renderDataInto(box, block) {
  if (!box) return;
  box.innerHTML = "";
  if (block.kind === "progress") {
    box.innerHTML = `<div class="bar"><i style="width:${block.pct}%"></i></div>` +
      `<div class="readout"><span class="v">${block.pct}%</span></div>`;
  } else if (block.kind === "values") {
    const row = document.createElement("div"); row.className = "readouts";
    for (const r of block.values) {
      const cell = document.createElement("div"); cell.className = "readout";
      const vEl = document.createElement("span"); vEl.className = "v"; vEl.textContent = String(r.value);
      if (r.unit) { const u = document.createElement("small"); u.textContent = r.unit; vEl.appendChild(u); }
      cell.appendChild(vEl);
      if (r.label) { const lEl = document.createElement("span"); lEl.className = "l"; lEl.textContent = r.label; cell.appendChild(lEl); }
      row.appendChild(cell);
    }
    box.appendChild(row);
  } else if (block.kind === "series") {
    if (block.label || block.unit) {
      const cap = document.createElement("div"); cap.className = "readout"; cap.style.marginBottom = "4px";
      const lEl = document.createElement("span"); lEl.className = "l";
      lEl.textContent = `${block.label ?? ""} ${block.unit ? `(${block.unit})` : ""}`.trim();
      cap.appendChild(lEl); box.appendChild(cap);
    }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "spark"); svg.setAttribute("viewBox", "0 0 320 56");
    svg.innerHTML = `<polyline fill="none" stroke="currentColor" stroke-width="2" ` +
      `stroke-linejoin="round" stroke-linecap="round" points="${sparklinePoints(block.series, 320, 56)}" />`;
    box.appendChild(svg);
  }
}
