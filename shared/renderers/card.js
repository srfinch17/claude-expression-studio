// shared/renderers/card.js, the desktop presence-card renderer. render(value) writes a
// { glyph, text, color } binding to an injected card element (.glyph / .text text nodes +
// the element's border color). The element is injected so this is testable with a fake.
export function makeCardRenderer({ el }) {
  return {
    id: "card",
    render(value) {
      if (!value || typeof value !== "object") return;   // card bindings are objects only
      const glyph = el.querySelector(".glyph");
      const text = el.querySelector(".text");
      if (glyph) glyph.textContent = value.glyph || "";
      if (text) text.textContent = value.text || "";
      if (value.color) el.style.borderColor = value.color;
    },
  };
}
