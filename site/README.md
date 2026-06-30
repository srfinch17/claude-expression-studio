# `site/`, the public showcase

`index.html` is a **self-contained landing page** for the project: a live, in-browser
8×8 LED-matrix simulation that plays Claude's *real* expression frames (the same
char-art + color maps from `mcp_server/expressions`), an interactive playground, the
presence-protocol pitch, and the install steps.

- **No build step, no dependencies to install.** One HTML file. Fonts load from the
  Google Fonts CDN; everything else (the renderer + frame data) is inline.
- **No hardware required**, the simulation is pure canvas. Respects
  `prefers-reduced-motion` (falls back to static lit frames).

## Preview locally

```bash
python -m http.server 8765 --directory site
# open http://localhost:8765/
```

(Open over `http://`, not `file://`, the page is fine either way, but a server
matches how it'll be hosted.)

## Publish on GitHub Pages

Pick one, the page is portable, so any of these work:

**A. GitHub Actions (recommended, keeps `site/` where it is).**
Add `.github/workflows/pages.yml`:
```yaml
name: Deploy site to Pages
on: { push: { branches: [master], paths: ['site/**'] } }
permissions: { pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.deploy.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with: { path: site }
      - id: deploy
        uses: actions/deploy-pages@v4
```
Then in **Settings → Pages → Source**, choose **GitHub Actions**. The site lands at
`https://<user>.github.io/peckworks-esp32s3matrix/`.

**B. Deploy from a folder.** Copy `index.html` into `/docs` and set
**Settings → Pages → Deploy from a branch → `/docs`**. Simplest, no Actions.

**C. Any static host.** Netlify / Vercel / Cloudflare Pages, point it at `site/`.

## Wiring up the one-click browser flasher (later)

The showcase currently links to the GitHub **Releases** download for installation. To
make the **ESP Web Tools** one-click browser flasher work on the live site, the
firmware needs to be served over `https` next to a manifest:

1. `npm run build:release` produces `release/manifest.json` + the merged `.bin` (and
   `release/index.html`, the dedicated flasher page).
2. Host those alongside the site (commit them to the Pages source, or attach the
   `.bin` to a GitHub Release and point `manifest.json`'s part `path` at the asset URL
   to avoid committing a 4 MB binary).
3. Surface the flasher from the install section.

Until then the offline `flash.bat` / `flash.sh` in the release is the working install
path, which is what the page says.

## Deploying the full studio to Pages

The landing page here is the front door, but the Pages deploy publishes the **whole
read-only showcase**, landing + Expression Studio Gallery + the desk/board sim, 
assembled by `scripts/build-pages.mjs` into a gitignored `pages-dist/` bundle.

- **Workflow:** `.github/workflows/pages.yml` runs the build and deploys on every push to
  `feat/expression-studio` and `master`, plus manual runs (Actions tab → "Run workflow").
- **One-time repo setting:** Settings → Pages → **Source: "GitHub Actions"**.
- **URLs:** `https://<user>.github.io/<repo>/` → landing · `/studio/` → Gallery ·
  `/studio/board.html` → board sim.

The site is read-only: there is no engine on a static host, so edit/approve affordances
are hidden (they reappear only when the local engine is running). Build it locally with
`npm run build:pages` and serve `pages-dist/` with any static server to preview.
