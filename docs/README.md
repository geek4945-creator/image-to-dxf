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
- **Output size & units:** *Units* mm / inches (`$INSUNITS` = 4 / 1, coordinates are really in that unit). *Set size by*: **Width**, **Height**, **Scale %** (100 % = 96 px per inch) or **PPI/DPI** (image pixels per inch). *Lock aspect ratio* (unlocked = independent width and height, i.e. non-uniform scaling). The live line under the controls shows the resulting size in inches and mm. Switching units keeps the physical size (and converts tolerance, min feature, cell size, tab width/spacing). Scale %/PPI refer to the working resolution (images over 2500 px are down-scaled first).
- **Cut inside first:** DXF entities are written deepest-nesting first (holes in letters/numbers, islands inside holes, … then the outer cut), so the cutter finishes inner shapes before the part is released. Nesting is computed geometrically. Optional **nearest-neighbour** ordering (greedy, within each nesting level; closed rings are rotated to start at the nearest vertex) and optional layers **CUT_INNER / CUT_OUTER** (one-file mode). *Show cut order numbers* draws the sequence in the preview. Works with clipping, tabs and every split mode (zip files are ordered individually).
- **Tabs (hold-in bridges):** leave small uncut gaps so parts stay attached until the job ends. Mark contours with the ⊓ button in the list, use *Add tabs to selected*, or tick *Tabs on all outer cuts*. *Only outer contours* skips holes. Settings: tab width (current units) and either a number of tabs per contour or a spacing. The closed polyline is split into **open LWPOLYLINEs** with gaps (gap centres evenly spaced, nudged onto a straight edge when one is close, so each gap is exactly the tab width). Tabs are applied after clipping, then the order is applied; contours too small (perimeter < 3 × tab width) stay closed and are reported. Gaps are drawn in the preview.
- **Zones:** with the *Zones* tool drag on the image to draw a rectangle (mouse, pen or touch); drag a zone to move it, drag its 8 handles to resize, *Delete* key / list button to remove. Each zone has a **cuts on/off** switch: contours inside an *off* zone are excluded from the DXF (a contour is "inside" if its centroid **or** its bounding-box centre lies in the zone; an off zone wins over an on zone). Bulk buttons per zone: **Enable all** (select every contour in the zone and switch the zone on), **Disable all** (deselect them), **Invert** (flip their selection), **Delete**; plus *Add zone* and *Clear all zones*.
- **Crop / focus:** *Draw crop area* (Crop tool), then *Focus / Crop to area*: the source pixels are cropped **before tracing**, the DXF origin is the crop's lower-left corner. You can crop again inside the crop; *Reset crop* restores the full image. *Width/height refer to* **the full image (scale preserved**, default) or **the cropped area**. Cropping clears selection, zones, grid areas and tab marks (they are tied to image coordinates).

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
`python tests/test_web.py` (core workflow) and `python tests/test_features.py` (v3 features, desktop 1400×900 and iPhone 390×844 touch, light + dark; re-opens every DXF in ezdxf with audit).
Set `WEB_URL=https://geek4945-creator.github.io/image-to-dxf/` to run either against the live site, `SHOTS=dir` to save screenshots, `ONLY=t_tabs` to run one feature.
