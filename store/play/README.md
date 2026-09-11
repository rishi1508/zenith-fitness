# Play Store visual assets

Generated with headless Chromium (puppeteer) rendering HTML/CSS/SVG to PNG at
exact target pixel sizes, plus ImageMagick for cropping/inspection. Brand
mark reproduced from `public/icon.svg` (rounded-square badge, orange→red
gradient `#f97316`→`#dc2626`, white flame). Fonts: Sora 700 (headlines/name),
Manrope (body/tagline), both fetched from Google Fonts and embedded.

All PNGs below are 8-bit sRGB, truecolor, **no alpha channel** (verified by
reading the PNG `IHDR` colour-type byte — value `2` = truecolor, no
transparency).

## Files and where they go in Play Console

| File | Size | Play Console field |
| --- | --- | --- |
| `store/play/icon-512.png` | 512x512, 60 KB | Main store listing → Graphics → App icon |
| `store/play/feature-graphic-1024x500.png` | 1024x500, 108 KB | Main store listing → Graphics → Feature graphic |
| `store/play/screenshots/01-home.png` … `06-analytics.png` | 1080x2340 each, 184–836 KB | Main store listing → Graphics → Phone screenshots (upload in this numeric order) |

`store/play/screenshots/CAPTIONS.md` lists each screenshot's headline and
source screen for reference.

## PWA / app icons (outside `store/play/`)

| File | Size | Purpose |
| --- | --- | --- |
| `public/icon-192.png` | 192x192 | Standard PWA icon, opaque dark background, mark at ~80% (≈10% padding) |
| `public/icon-512.png` | 512x512 | Same, larger size |
| `public/icon-192-maskable.png` | 192x192 | Maskable PWA icon — full-bleed brand gradient background, flame mark alone, sized well inside the central 80% safe circle |
| `public/icon-512-maskable.png` | 512x512 | Same, larger size |

These are not referenced by `public/manifest.json` yet — it currently only
lists `icon.svg` (`sizes: "any"`, `purpose: "any maskable"`). Wiring the new
PNGs into the manifest's `icons` array (and optionally `index.html` for
Apple touch icons) is a follow-up edit outside this task's allowed file set.

## Screenshot source and cropping

Built from the existing 824x1830 captures (412x915 @2x) in the sweep-member
dark-mode set and the owner-analytics set. Five of the six sources had the
in-app "Update available" banner (or "Get the Android app" banner) rendered
under the header; each was inspected pixel-by-pixel (sampling column colour
values) and the exact banner rows were cropped out, then the header and the
content below were rejoined:

- `01-home.png`, `03-health.png`, `30-nutrition.png`, `50-profile.png`:
  banner occupied rows 128–319 of 1830 — cropped, header (rows 0–127)
  rejoined directly to content (rows 320–1829).
- `04-mygym.png`: same banner crop, but the "Public feed / Announcements"
  tab strip directly beneath the banner was itself partially hidden behind
  the banner in the source capture (a pre-existing app z-index/overlay
  quirk, not something introduced by this crop), so it rendered with
  clipped pill corners once the banner was removed. Cropped further down
  (to row 386) to skip that strip entirely and start from the clean
  "Share something…" card instead.
- `01-dark-top.png` (owner analytics): thinner amber banner occupied rows
  132–235 — cropped the same way.

Each cropped source was then scaled to 920px wide (fit width, ~80px margins
inside the 1080px canvas) and set inside an 8px-bezel rounded frame below a
Sora 700 headline, on a `#0f0f0f` background.

## What was not done / left as-is

- Did not touch the pre-existing `store/play/LISTING.md`,
  `store/play/DATA_SAFETY.md`, `store/play/CONTENT_RATING.md`, or
  `store/play/HEALTH_DECLARATION.md` — out of scope for this visual-assets
  task.
- Did not wire the new icon PNGs into `public/manifest.json` or
  `index.html` — editing those files was outside the allowed file set for
  this task (see above).
- No tablet, Chromebook, Wear OS, or promo-video assets were requested or
  produced — only the phone screenshots, feature graphic, and app icon.
- The `03-mygym.png` screenshot is the largest file (~836 KB) because the
  framed photo has a lot of fine detail; still well within any Play Console
  per-image size limit (8 MB for JPEG/PNG screenshots).
