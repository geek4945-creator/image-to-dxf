# Image → DXF — browser edition (no server, no install)

Everything runs inside the browser tab: your image is **never uploaded**. Open `index.html` by double-clicking it (works from `file://`),
or put this folder on any static host (GitHub Pages, Netlify, S3, `python -m http.server`, IIS, …). No CDN: all libraries are in `js/`.

Tested in headless Chrome. Expected to work in current Chrome, Edge, Firefox, Safari (needs `<canvas>`, `createImageBitmap`, ES2018).

## Features
- **Inputs:** file picker, drag-and-drop, paste (Ctrl+V), live camera (`getUserMedia` + *Capture frame*), "Take photo" (phone camera app), image URL.
- **Processing:** threshold / Otsu, invert, blur, speckle + pinhole removal, simplify tolerance, min feature size, keep holes, drop full-image border.
- **Output:** width in mm or inches (values convert when you switch units); closed `LWPOLYLINE`s on layer `CUT`, `$INSUNITS` set, Y-up CAD orientation, DXF R2000 (AC1015).
- **Selection:** every outline is listed and clickable in the preview; select all / none / invert / "In area".
- **Grid + areas:** rows×cols or cell-size grid, click cells, or drag rectangles. Export can be limited to the area, or **clipped** at its boundary.
- **Split:** one file / one `CUT` layer; one file with a layer per contour (`CUT_007`) or per cell/area (`CUT_R1C2`); or a **zip** of separate DXFs (optional origin → 0,0).

## Files
| file | purpose |
|---|---|
| `index.html`, `style.css` | UI |
| `js/app.js` | UI logic, image loading, camera, URL fetch |
| `js/trace.js` | pure-JS pipeline: grayscale, Gaussian blur, Otsu, speckle removal, crack-edge contour tracing, Douglas-Peucker |
| `js/dxf.js` | DXF writer, selection/clip/split logic, tiny ZIP writer |
| `js/polygon-clipping.umd.min.js` | vendored [polygon-clipping](https://github.com/mfogel/polygon-clipping) 0.15.7 (MIT) for clip/intersection |

## Limits / notes
- **URL input** only works if the remote site sends CORS headers (`Access-Control-Allow-Origin`). Many don't; the UI then tells you to save the image and upload it.
  The Python/Windows edition fetches server-side and isn't subject to this.
- **PDF and TIFF** can't be decoded by browsers → export as PNG/JPG first (the Python edition reads TIFF; PDF needs PyMuPDF/poppler there).
- **Camera** requires permission, and a secure context: `https://`, `http://localhost`, or (Chrome/Edge) a local `file://` page. Some browsers block camera on `file://`; if so use `python -m http.server` here and open `http://localhost:8000`.
- Outlines are straight-line polylines (no curve fitting). Single threshold only; no perspective correction.
- Images larger than 2500 px are down-scaled; >60 MP rejected. Tracing runs on the UI thread (~0.1–0.5 s for a 2500 px image).
- Contour numbers are positional: changing settings that changes the number of outlines resets the selection to "all".
- Output was validated by re-reading with `ezdxf` (audit clean). Not tested in AutoCAD / specific cutter software.
- Tracing is on pixel corners (slightly larger by ≈½ px than the Python edition's pixel-centre outlines); counts match otherwise.
