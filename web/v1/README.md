# Image → DXF — browser edition (no server, no install)

Everything runs inside the browser tab: your image is **never uploaded**. Open `index.html` by double-clicking it (works from `file://`),
or put this folder on any static host (GitHub Pages, Netlify, S3, `python -m http.server`, IIS, …). No CDN: all libraries are in `js/`.

Tested in headless Chrome. Expected to work in current Chrome, Edge, Firefox, Safari (needs `<canvas>`, `createImageBitmap`, ES2018).

## Features
- **Inputs:** file picker, drag-and-drop, paste (Ctrl+V), live camera (`getUserMedia` + *Capture frame*), "Take photo" (phone camera app), image URL.
- **Processing:** threshold / Otsu, invert, blur, speckle + pinhole removal, simplify tolerance, min feature size, keep holes, drop full-image border.
- **Output:** closed `LWPOLYLINE`s on layer `CUT` (open ones where tabs are cut), `$INSUNITS` set, Y-up CAD orientation, DXF R2000 (AC1015).
- **Selection:** every outline is listed and clickable in the preview; select all / none / invert / "In area".
- **Grid + areas:** rows×cols or cell-size grid, click cells, or drag rectangles. Export can be limited to the area, or **clipped** at its boundary.
- **Split:** one file / one `CUT` layer; one file with a layer per contour (`CUT_007`) or per cell/area (`CUT_R1C2`); or a **zip** of separate DXFs (optional origin → 0,0).

### v3 features (all in this browser edition)
- **Clear image** (button above the preview): removes the image and resets traced contours, selection, grid, cells/areas, zones, crop and tab marks; revokes every object URL it created (image, crop, last download) and stops the camera. The same file can be loaded again afterwards.
- **Output size & units:** *Units* default to **inches** (default width 10 in, `$INSUNITS` = 1; mm gives `$INSUNITS` = 4) and the choice is remembered on the device (localStorage key `i2d.unit`). Every size field (width, height, tolerance, min feature, cell, tab width/spacing) shows the current unit next to it, numbers you type are always read in that unit, and toggling units converts the displayed values (coordinates are really in that unit). *Set size by*: **Width**, **Height**, **Scale %** (100 % = 96 px per inch) or **PPI/DPI** (image pixels per inch). *Lock aspect ratio* (unlocked = independent width and height). **Width / height refer to** (default **traced shapes**): the size you type is the *bounding box of the shapes that end up in the DXF* (selected contours, after zones / area / clip), so the DXF measures exactly what you entered, whatever blank margin the picture has. Choose **whole image frame** to size the full picture instead (the DXF shapes are then smaller than the entered number, and the UI says so), or **full original image** while cropped (keeps the scale of the uncropped picture). All fields apply as you type (no read-only fields: typing in Width/Height/Scale/PPI makes that field drive the size); changing *Set size by* or the reference keeps the current scale. The readout reads *DXF will measure W × H in (mm)*, and after each download a **DXF check** line re-reads the generated file (LWPOLYLINE vertices + `$INSUNITS`) and compares it with the size you set. Switching units keeps the physical size (and converts tolerance, min feature, cell size, tab width/spacing). Scale %/PPI refer to the working resolution (images over 2500 px are down-scaled first; the physical size is unaffected). Tab gaps on an outermost extreme can trim a DXF edge by up to one tab width. The DXF keeps the shapes at their position in the picture; tick *origin to 0,0* to move the artwork's lower-left corner to the origin.
- **Cut inside first:** DXF entities are written deepest-nesting first (holes in letters/numbers, islands inside holes, … then the outer cut), so the cutter finishes inner shapes before the part is released. Nesting is computed geometrically. Optional **nearest-neighbour** ordering (greedy, within each nesting level; closed rings are rotated to start at the nearest vertex) and optional layers **CUT_INNER / CUT_OUTER** (one-file mode). *Show cut order numbers* draws the sequence in the preview. Works with clipping, tabs and every split mode (zip files are ordered individually).
- **Tabs (hold-in bridges):** leave small uncut gaps so parts stay attached until the job ends. Mark contours with the ⊓ button in the list, use *Add tabs to selected*, or tick *Tabs on all outer cuts*. *Only outer contours* skips holes. Settings: tab width (current units) and either a number of tabs per contour or a spacing. The closed polyline is split into **open LWPOLYLINEs** with gaps (gap centres evenly spaced, nudged onto a straight edge when one is close, so each gap is exactly the tab width). Tabs are applied after clipping, then the order is applied; contours too small (perimeter < 3 × tab width) stay closed and are reported. Gaps are drawn in the preview.
- **Zones:** with the *Zones* tool drag on the image to draw a rectangle (mouse, pen or touch); drag a zone to move it, drag its 8 handles to resize, *Delete* key / list button to remove. Each zone has a **cuts on/off** switch: contours inside an *off* zone are excluded from the DXF (a contour is "inside" if its centroid **or** its bounding-box centre lies in the zone; an off zone wins over an on zone). Bulk buttons per zone: **Enable all** (select every contour in the zone and switch the zone on), **Disable all** (deselect them), **Invert** (flip their selection), **Delete**; plus *Add zone* and *Clear all zones*.
- **Crop / focus:** *Draw crop area* (Crop tool), then *Focus / Crop to area*: the source pixels are cropped **before tracing**, the DXF origin is the crop's lower-left corner. You can crop again inside the crop; *Reset crop* restores the full image. *Width/height refer to* the traced shapes (default), the cropped area's frame, or the full image (scale preserved). Cropping clears selection, zones, grid areas and tab marks (they are tied to image coordinates).

## Files
| file | purpose |
|---|---|
| `index.html`, `style.css` | UI |
| `js/app.js` | UI logic, image loading, camera, URL fetch, size/zones/crop/tabs UI |
| `js/trace.js` | pure-JS pipeline: grayscale, Gaussian blur, Otsu, speckle removal, crack-edge contour tracing, Douglas-Peucker |
| `js/dxf.js` | DXF writer, selection/clip/split logic, nesting depth + cut ordering + tabs (`buildPlan`), tiny ZIP writer |
| `js/polygon-clipping.umd.min.js` | vendored [polygon-clipping](https://github.com/mfogel/polygon-clipping) 0.15.7 (MIT) for clip/intersection |

## Limits / notes
- **URL input** only works if the remote site sends CORS headers (`Access-Control-Allow-Origin`). Many don't; the UI then tells you to save the image and upload it.
  The Python/Windows edition fetches server-side and isn't subject to this.
- **PDF and TIFF** can't be decoded by browsers → export as PNG/JPG first (the Python edition reads TIFF; PDF needs PyMuPDF/poppler there).
- **Camera** requires permission, and a secure context: `https://`, `http://localhost`, or (Chrome/Edge) a local `file://` page. Some browsers block camera on `file://`; if so use `python -m http.server` here and open `http://localhost:8000`.
- Outlines are straight-line polylines (no curve fitting). Single threshold only; no perspective correction.
- Images larger than 2500 px are down-scaled; >60 MP rejected. Tracing runs on the UI thread (~0.1–0.5 s for a 2500 px image).
- Zones, crop and the grid are axis-aligned rectangles. Cut order is a greedy heuristic, not an optimal route. Tab positions are approximate (evenly spaced), not placed by feature.
- Contour numbers are positional: changing settings that changes the number of outlines resets the selection to "all".
- Output was validated by re-reading with `ezdxf` (audit clean). Not tested in AutoCAD / specific cutter software.
- Tracing is on pixel corners (slightly larger by ≈½ px than the Python edition's pixel-centre outlines); counts match otherwise.

## Tests
`pip install ezdxf playwright pillow` (+ Google Chrome), then from the repo root:
`python tests/test_web.py` (core workflow) and `python tests/test_web_size.py` (DXF size/units/reference/DXF check), `python tests/test_features.py` (v3 features, desktop 1400×900 and iPhone 390×844 touch, light + dark; re-opens every DXF in ezdxf with audit).
Set `WEB_URL=https://geek4945-creator.github.io/image-to-dxf/` to run either against the live site, `SHOTS=dir` to save screenshots, `ONLY=t_tabs` to run one feature.

## Edit tools (merge, re-scan, crop assessment) and table passes
- **Merge touching cuts:** contours that touch, overlap or lie within *Touch tolerance* (current units, default 0.01 in; note 1 image pixel may be larger, the note tells you) are unioned into one outline with the vendored polygon-clipping (shared internal edges removed, holes kept). Scope: all, only selected, or inside a zone. Shows "N → M" counts; **Undo** restores. Works with cut-inside-first, tabs, zones, clip and split. Re-tracing (Processing sliders) discards merge/re-scan edits (a notice says so).
- **Re-scan area:** *Re-scan* tool, drag a rectangle (mouse or touch) over a missed shape. That region is re-traced from the source pixels with its own threshold / local Otsu / contrast stretch / invert / blur / speckle / simplify / min size; green live preview; *Add to cuts* merges the new contours (near-identical existing ones are skipped; optional *Replace existing contours inside the area*). Undo available.
- **Assess whole crop:** after cropping, *Re-assess entire cropped section* re-traces the whole crop with local settings (local Otsu from the crop pixels only, optional contrast stretch, manual threshold, blur, detail sliders) independent of the global sliders. The size reference keeps working.
- **Table size & material moves:** tick *Break the job into passes that fit my table*; presets (24x24 … 60x120 in) or custom length/height (current units, remembered in localStorage), start corner, overlap/registration margin, torch park (table corner or custom X,Y), registration marks (REG_MARK on the earlier pass / REG_ALIGN on the next: same physical marks), output *one DXF per pass (zip, with cut_plan.txt)* or *single DXF with layers SECTION_n + TABLE_FRAME*. Preview shows table frames, pass blocks, break lines and park points. Each pass file is in table coordinates (0,0 = table lower-left) and ends with a PARK marker (POINT + CIRCLE + TEXT "PASS 1/3 PARK - move material X -47 Y 0 in"). Cuts crossing a break: *continue in the next pass* (clipped to open polylines, the line along the break is not cut twice) or *keep whole contours* (assigned by centre; warnings when a contour does not fit, or is larger than the table). Cut-inside-first order, tabs, zones and merge are respected (tabs on clipped pieces: the pieces are open already).
Tests: `tests/test_web_edit.py`, `tests/test_web_table.py` (desktop + iPhone, light + dark).
