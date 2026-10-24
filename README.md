# Image → DXF cut file

Web app that turns images into DXF cut files (closed `LWPOLYLINE`s on a `CUT` layer, real-world units).

**Inputs:** file upload / drag-and-drop (PNG, JPG, BMP, TIFF, WebP…, scanned images, PDF → first page), image from a URL (server-side
proxy with SSRF protection), live camera (`getUserMedia` + "Capture frame").

**Pipeline (OpenCV):** grayscale (alpha composited on white) → optional blur → threshold (manual or Otsu, live preview) → optional invert →
speckle/pinhole removal → contour tracing (outer + holes) → Douglas-Peucker simplification (tolerance in mm/in) → min-feature filter →
scale to chosen real width (mm or inch, Y flipped to CAD orientation) → DXF via `ezdxf`.

**Selection & grid:** each closed contour gets an ID, listed on the right and clickable in the preview. Select all / Clear / Invert / "In area".
Optional grid (rows × cols, or cell size in mm/in); tools: *Contours* (click to toggle), *Grid cells* (click to toggle), *Drag region* (draw rectangles).
Cells + rectangles form the "area of interest". Export includes only selected contours, optionally limited to the area, optionally **clipped** at the
area boundary, and optionally split: one file/one `CUT` layer, one file with a layer per contour (`CUT_007`) or per cell/area (`CUT_R1C2`),
or a zip of separate DXFs (one per contour/cell, optional origin-to-0,0).

## Hard Version 1.5 (current)
The browser edition (and the Windows app, which now serves the same interface) is **Hard Version 1.5** - the exact build is shown in the
*Version* menu as "Hard Version 1.5 (build 1.5.0-bNN)" and in `docs/version.json`. **Hard Version 1** stays available at
[`/v1/`](https://geek4945-creator.github.io/image-to-dxf/v1/) (link in the Version menu), git tag `hard-v1.0`, and its release zip.

- **Tabs:** Trace · Edit · Frame · Layers · Table/Output · Fold/Box · 3D Preview · History · **All** (All = the classic single-page layout). Every setting has an ⓘ help bubble; *Reset settings to default* (asks first, keeps the image, re-traces).
- **Cut order** restarts per table pass (Pass 1 cuts first).
- **Edit:** zoom (buttons, wheel, pinch) and pan; select, eraser (whole cut or one segment), draw line (Finish/Close), move vertex, straighten, connect/bridge, split; snap; undo/redo (40 steps); recalc cut order. Drawn lines export on `CUT_EDIT`.
- **Frame:** rectangle, rounded or circle/ellipse; offset and width; single outline or a band (double outline); optional bridges that join the art to the frame (unioned into one cut). Shown in the preview and exported (`CUT_FRAME`).
- **Layers:** N brightness-threshold layers (auto or manual thresholds), stacked preview, base plate, alignment holes or registration marks (`REG`); zip of one DXF per layer and/or a single DXF with `LAYER_1…N`.
- **DXF format:** R2000 LWPOLYLINE (default), **TorchMate-friendly** (R12/AC1009, closed POLYLINE, inches, one `CUT` layer), **R12 compatible** (AC1009).
- **Fold / Box:** outside or inside L × W × H, thickness T, inside radius R, K-factor (presets steel 0.44, aluminium 0.42, stainless 0.45, editable), angle (90° default). BA = a·(R+K·T), OSSB = (R+T)·tan(a/2), BD = 2·OSSB − BA; flat pattern laid out as a cross with bend lines (`BEND` layer) at the centre of each bend zone, corner relief holes (auto Ø = 2(T+R)), kerf allowance, plain-English step-by-step breakdown, everything recomputed live. Optional images per face, scaled to that face's flat size, cut out of the face. Example: 0.125 in steel, R 0.125, K 0.44, 90° → BA 0.2827 in, BD 0.2173 in.
- **3D Preview** (loaded only when opened): the folded box with a fold slider and animation, or the layer stack; orbit/zoom by mouse or touch; cut-outs shown.
- **History:** opened images are saved in the browser (IndexedDB, persistent storage requested; cap by count and MB) - reopen, delete, clear. Windows app: `%APPDATA%\ImageToDXF\history`.
- **Updates:** the site checks `version.json` (no cache) on load, every 15 min and when the tab becomes visible; it reloads itself when no image is open, otherwise shows a banner. The Windows app checks GitHub Releases and can install updates (optional auto-update on start).

## Editions
- **Python/Flask** (this folder): full server version (URL fetch server-side, PDF/TIFF input).
- **Browser-only** (`docs/`, served by GitHub Pages at https://geek4945-creator.github.io/image-to-dxf/; `web/` is an identical copy used by the Windows package): same workflow, 100 % client-side static files, open `index.html` — see `docs/README.md`. Only this edition has the v3 features below.
- **Windows package**: `image-to-dxf-windows.zip` (setup.bat → setup.ps1 installs Python if needed, venv, shortcuts; run.bat starts the local app serving `web/` at `/` with history/update APIs, the older Flask screen at `/classic/`) — see `WINDOWS-INSTALL.md`.

## Browser edition v3 features
Clear image · output size in inches (default, 10 in wide, `$INSUNITS`=1; choice remembered) or mm by width, height, scale % or PPI with aspect lock; the size applies to the **traced shapes' bounding box** by default (so the DXF measures exactly what you enter; optional *whole image frame* reference), live readout of the real DXF size, and a **DXF check** that re-reads the downloaded file (`$INSUNITS` follows the unit) ·
**Cut inside first** (inner contours written before outer ones, optional nearest-neighbour order and CUT_INNER/CUT_OUTER layers) ·
**Tabs / hold-in bridges** (per contour or all outer cuts; width, count or spacing; written as open polylines with gaps; shown in preview) ·
**Zones** (drag-drawn, movable, resizable, listed; on/off per zone, bulk enable/disable/invert by centre-in-zone; off zones are excluded from export; works on touch) ·
**Crop / focus** on part of the image (cropped before tracing, origin at crop corner, size reference = shapes / image frame / full image). Details: `docs/README.md`.
**Merge touching cuts** (union with undo) · **Re-scan area** (local re-trace of a missed spot) · **Assess whole crop** (local settings for a crop) · **Table size & material moves** (passes, park marker, registration marks, overlay). See `docs/README.md`.
These are not in the Python/Flask edition.

## Run
```bash
cd image-to-dxf
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
PORT=5000 python app.py            # http://127.0.0.1:5000   (HOST=0.0.0.0 to expose on LAN)
```
`python launcher.py` picks a free port and opens the browser. PDF input is optional: `pip install -r requirements-pdf.txt` (PyMuPDF; no poppler needed) or install poppler's `pdftoppm`; without either, PDFs get a clear error. Camera access needs `localhost` or HTTPS.
Tests: `pip install -r requirements-dev.txt && python -m pytest -q tests/test_all.py` and, for the browser edition (needs Chrome + `pip install playwright ezdxf pillow`), `python tests/test_web.py`, `python tests/test_web_size.py` (DXF size in in/mm) `python tests/test_web_v15.py` (Hard 1.5 features), `python -m pytest tests/test_desktop_api.py` (Windows API) and `python tests/test_features.py` (v3 features; `WEB_URL=<live url>` runs them against a deployed copy).

## API
| endpoint | purpose |
|---|---|
| `POST /api/upload` (multipart `file`) | → `{id,width,height}` |
| `POST /api/fetch` `{url}` | same, via SSRF-safe fetch |
| `GET /api/image/<id>` | normalized grayscale PNG |
| `POST /api/trace` `{id,params,mask?}` | → `{paths (px coords), info{items:[{id,hole,w,h,area}]}, mask}` |
| `POST /api/dxf` `{id,params,selected?,regions?,clip?,split?,group_by?,zero_origin?}` | DXF (or zip when `split:"files"`) |

`params`: `threshold, auto, invert, blur, speckle (px), tolerance, width, unit (mm|in), min_feature, holes, drop_frame`.
`regions`: `[{rect:[x0,y0,x1,y1] (image px, y down), label}]`. `split`: `none|layers|files`; `group_by`: `contour|cell`.

## Security
URLs: http/https only, no credentials, every redirect hop re-validated, hostname resolved and **all** addresses must be public
(blocks loopback/private/link-local/reserved/multicast), re-checked at connect time (anti DNS-rebinding), proxies ignored, 20 MB cap, timeouts.
Uploads capped at 25 MB; images >60 MP rejected; working resolution capped at 2500 px.

## Limitations
- Contour IDs are positional: changing trace settings that changes the contour count resets selection to "all".
- Output is polylines (no curve fitting); small tolerance = more vertices. Pixel-accurate tracing, no sub-pixel/potrace smoothing.
- Single-threshold black/white only (no colour separation); photos need good contrast/lighting. No perspective correction for camera/scans.
- Images are held in server memory (last 30); single-process dev server (Flask), no auth.
- Clipping treats each contour independently (a hole ring clipped to an area becomes its own closed outline); region/contour tests are geometric.
- Selection "In area" button uses bounding boxes in the browser; the server does the exact intersection on export.
