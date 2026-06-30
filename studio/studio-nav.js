// studio/studio-nav.js, a tiny shared top-nav linking the Studio surfaces. Self-injecting,
// no markup required: drop `<script type="module" src="./studio-nav.js"></script>` into any
// studio page and it prepends a Gallery / Editor / Board switcher (current page highlighted).
// Non-sticky by design so it never fights each page's own sticky header.

const PAGES = [
  { file: "index.html", label: "Gallery" },
  { file: "editor.html", label: "Editor" },
  { file: "board.html", label: "Board" },
  { file: "presence.html", label: "Presence" },
];
// frame-editor.html is a leaf reached via "✎ edit", it shows the nav (to get back out) but
// highlights its parent, the Gallery.
const here = (location.pathname.split("/").pop() || "index.html");
const activeFile = here === "frame-editor.html" ? "index.html" : here;

const nav = document.createElement("nav");
nav.id = "studio-nav";
nav.innerHTML =
  `<a class="snav-brand" href="./index.html">◆ Expression Studio</a>` +
  `<span class="snav-links">` +
  PAGES.map((p) => `<a class="snav${p.file === activeFile ? " active" : ""}" href="./${p.file}">${p.label}</a>`).join("") +
  `</span>`;

const style = document.createElement("style");
style.textContent = `
  #studio-nav { display:flex; align-items:center; gap:18px; background:#07070b;
    border-bottom:1px solid #1e1e26; padding:8px 16px;
    font:13px 'IBM Plex Mono',ui-monospace,monospace; }
  #studio-nav .snav-brand { color:#ff5008; font-weight:600; letter-spacing:.02em; text-decoration:none; }
  #studio-nav .snav-links { display:flex; gap:6px; }
  #studio-nav .snav { color:#9a9aa8; text-decoration:none; padding:3px 11px; border-radius:6px;
    border:1px solid transparent; }
  #studio-nav .snav:hover { color:#e8e8ef; }
  #studio-nav .snav.active { color:#22ddff; border-color:#22ddff44; background:#22ddff14; }
`;
document.head.appendChild(style);
document.body.insertBefore(nav, document.body.firstChild);
