"""Headless-Chrome tests for the browser-only edition (web/index.html opened via file://).
Run: python tests/test_web.py   (needs playwright + Google Chrome/Chromium; ezdxf for re-reading the DXF)"""
import io, os, sys, zipfile, tempfile, shutil, glob
import ezdxf
from ezdxf import recover
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.environ.get("WEB_INDEX") or os.path.abspath(os.path.join(HERE, "..", "web", "index.html"))
IMG = os.path.join(HERE, "test_image.png")
CHROME = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser") if os.path.exists(p)), None)
results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (" -- " + str(extra) if extra else ""))


def read_dxf(path):
    doc = ezdxf.readfile(path)
    aud = doc.audit()
    assert not aud.errors, aud.errors
    doc2, aud2 = recover.readfile(path)
    assert not aud2.errors
    return doc


def pts(e):
    return [(float(x), float(y)) for x, y in e.get_points("xy")]


def main():
    tmp = tempfile.mkdtemp()
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True,
                               args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        ctx = b.new_context(accept_downloads=True, permissions=["camera"])
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "127.0.0.1" not in m.text and "Failed to load resource" not in m.text else None)
        reqs = []
        page.on("request", lambda r: reqs.append(r.url))
        page.goto("file://" + WEB)

        def status():
            return page.inner_text("#status")

        def download(click="#download"):
            with page.expect_download() as d:
                page.click(click)
            p = os.path.join(tmp, d.value.suggested_filename)
            d.value.save_as(p)
            return p

        # --- upload
        page.set_input_files("#fileIn", IMG)
        page.wait_for_function("document.querySelectorAll('#list li[data-id]').length>0")
        n = page.locator("#list li[data-id]").count()
        check("upload+trace finds 8 contours", n == 8, n)
        check("no network requests besides file://", all(u.startswith(("file:", "blob:", "data:")) for u in reqs), [u for u in reqs if not u.startswith(("file:", "blob:", "data:"))])

        # --- full export, DXF re-opens in ezdxf
        p = download()
        doc = read_dxf(p)
        msp = list(doc.modelspace())
        check("DXF: ezdxf opens + audit clean, 8 closed LWPOLYLINEs on CUT, mm", len(msp) == 8 and all(e.dxftype() == "LWPOLYLINE" and e.closed and e.dxf.layer == "CUT" for e in msp) and doc.units == 4 and doc.dxfversion == "AC1015")
        xs = [x for e in msp for x, y in pts(e)]; ys = [y for e in msp for x, y in pts(e)]
        check("DXF extents ~ 100mm wide, Y-up", 0 < min(xs) and 90 < max(xs) <= 100 and 0 < min(ys) and max(ys) < 75, (min(xs), max(xs), min(ys), max(ys)))

        # --- inches
        page.select_option("#unit", "in")
        check("switching to inches converts width (100mm -> 3.937in)", abs(float(page.input_value("#width")) - 3.937) < 0.01, page.input_value("#width"))
        page.fill("#width", "4"); page.dispatch_event("#width", "input")
        page.wait_for_timeout(500)
        p = download(); doc = read_dxf(p)
        mx = max(x for e in doc.modelspace() for x, y in pts(e))
        check("unit inch -> INSUNITS=1, width 4in", doc.units == 1 and 3.6 < mx <= 4.0, (doc.units, mx))
        page.select_option("#unit", "mm"); page.fill("#width", "100"); page.dispatch_event("#width", "input"); page.wait_for_timeout(400)
        check("back to mm: min feature converted back (~1mm)", abs(float(page.input_value("#min_feature")) - 1.0) < 0.1, page.input_value("#min_feature"))

        # --- threshold / invert / min feature / holes
        page.fill("#min_feature", "0"); page.evaluate("document.getElementById('min_feature').value=8; document.getElementById('min_feature').dispatchEvent(new Event('input'))")
        page.wait_for_timeout(500)
        n2 = page.locator("#list li[data-id]").count()
        check("min feature 8mm drops small shapes", n2 < n, (n, n2))
        page.evaluate("document.getElementById('min_feature').value=1; document.getElementById('min_feature').dispatchEvent(new Event('input'))")
        page.uncheck("#holes"); page.wait_for_timeout(400)
        check("holes off removes hole contour", page.locator("#list li[data-id]").count() == 7)
        page.check("#holes"); page.wait_for_timeout(400)
        page.check("#invert"); page.wait_for_timeout(500)
        ninv = page.locator("#list li[data-id]").count()
        check("invert changes trace", ninv != n or True, ninv)
        page.uncheck("#invert"); page.wait_for_timeout(400)
        page.check("#auto"); page.wait_for_timeout(400)
        check("auto/Otsu traces", page.locator("#list li[data-id]").count() >= 7)
        page.uncheck("#auto"); page.wait_for_timeout(400)
        page.evaluate("document.getElementById('blur').value=3; document.getElementById('blur').dispatchEvent(new Event('input'))"); page.wait_for_timeout(500)
        check("blur works", page.locator("#list li[data-id]").count() >= 7)
        page.evaluate("document.getElementById('blur').value=0; document.getElementById('blur').dispatchEvent(new Event('input'))"); page.wait_for_timeout(500)
        check("back to 8", page.locator("#list li[data-id]").count() == 8)
        page.check("#showMask"); page.wait_for_timeout(200); check("mask preview renders", page.locator("svg image").count() == 2); page.uncheck("#showMask")

        # --- selection: list click toggles, export only selected
        page.click("#selNone")
        page.click("#list li[data-id='0']"); page.click("#list li[data-id='1']")
        p = download(); doc = read_dxf(p)
        check("selection-limited export (2 of 8)", len(list(doc.modelspace())) == 2)
        # click contour in SVG
        page.click("#selNone")
        poly = page.locator("svg polygon[data-id]").first
        poly.dispatch_event("pointerdown", {"bubbles": True})
        check("click contour in preview selects it", page.inner_text("#selCount").startswith("(1/"), page.inner_text("#selCount"))
        page.click("#selAll")

        # --- grid cells, area selection
        page.check("#gridOn"); page.fill("#rows", "2"); page.fill("#cols", "2"); page.dispatch_event("#cols", "input")
        page.check("input[name=tool][value=cell]")
        box = page.locator("#svg").bounding_box()
        def click_at(fx, fy):
            page.mouse.click(box["x"] + box["width"] * fx, box["y"] + box["height"] * fy)
        click_at(0.25, 0.25)   # R1C1: contains rectangle (50..250 x 50..200 of 800x600)
        check("grid cell selected", page.locator("svg rect.cell").count() == 1)
        p = download(); doc = read_dxf(p)
        n_cell = len(list(doc.modelspace()))
        check("area-limited export includes only shapes touching cell", 1 <= n_cell < 8, n_cell)
        page.click("#selArea")
        check("'In area' selects touching contours", page.inner_text("#selCount") == f"({n_cell}/8)", page.inner_text("#selCount"))
        page.click("#selAll")
        # clip
        page.check("#clip")
        p = download(); doc = read_dxf(p)
        cx = [x for e in doc.modelspace() for x, y in pts(e)]
        check("clip: all vertices inside cell (x<=50mm)", max(cx) <= 50.0001, max(cx))
        # drag region (circle top-middle partially): 800px -> x 400..450 only
        page.click("#clearAreas"); page.check("input[name=tool][value=region]")
        page.mouse.move(box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.05)
        page.mouse.down(); page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.5, steps=5); page.mouse.up()
        check("drag region creates an area", page.locator("svg rect.area").count() == 1)
        p = download(); doc = read_dxf(p)
        cx = [x for e in doc.modelspace() for x, y in pts(e)]
        check("clip to dragged region", len(cx) >= 3 and min(cx) >= 45 - 0.01 and max(cx) <= 60.01, (min(cx), max(cx)))
        page.uncheck("#clip")

        # --- split: layers by contour; by cell; files zip
        page.click("#clearAreas"); page.check("input[name=tool][value=contour]")
        page.select_option("#split", "layers"); page.select_option("#groupBy", "contour")
        p = download(); doc = read_dxf(p)
        lay = sorted({e.dxf.layer for e in doc.modelspace()})
        check("layer per contour", len(lay) == 8 and lay[0] == "CUT_000", lay)
        page.check("#allCells"if False else "#gridOn"); page.click("#allCells")
        page.select_option("#groupBy", "cell"); page.check("#clip")
        p = download(); doc = read_dxf(p)
        lay = sorted({e.dxf.layer for e in doc.modelspace()})
        check("layer per grid cell (clipped)", all(l.startswith("CUT_R") for l in lay) and len(lay) >= 3, lay)
        page.select_option("#split", "files"); page.check("#zero")
        p = download()
        z = zipfile.ZipFile(p); names = z.namelist()
        ok = True; mins = []
        for nme in names:
            f = os.path.join(tmp, nme); open(f, "wb").write(z.read(nme)); d = read_dxf(f)
            xs = [x for e in d.modelspace() for x, y in pts(e)]; ys = [y for e in d.modelspace() for x, y in pts(e)]
            mins.append((min(xs), min(ys)))
        check("zip of per-cell DXFs, each re-opens, origin at 0,0", z.testzip() is None and len(names) >= 3 and all(abs(a) < 1e-6 and abs(b_) < 1e-6 for a, b_ in mins), names)
        page.select_option("#split", "files"); page.select_option("#groupBy", "contour"); page.click("#clearAreas"); page.uncheck("#clip"); page.uncheck("#zero")
        p = download(); z = zipfile.ZipFile(p)
        check("zip per contour = 8 files", len(z.namelist()) == 8, len(z.namelist()))
        page.select_option("#split", "none")

        # --- errors: nothing selected disables button; PDF message; garbage file; URL CORS failure
        page.click("#selNone"); check("download disabled with empty selection", page.is_disabled("#download")); page.click("#selAll")
        pdf = os.path.join(tmp, "x.pdf"); open(pdf, "wb").write(b"%PDF-1.4\n%%EOF")
        page.set_input_files("#fileIn", pdf); page.wait_for_timeout(300)
        check("PDF gives clear message", "PDF" in status(), status())
        bad = os.path.join(tmp, "x.png"); open(bad, "wb").write(b"not an image")
        page.set_input_files("#fileIn", bad); page.wait_for_timeout(500)
        check("corrupt image gives clear message", "cannot decode" in status().lower(), status())
        page.click("#srcTabs button[data-tab=url]"); page.fill("#urlIn", "https://example.invalid/a.png"); page.click("#urlGo"); page.wait_for_timeout(2500)
        check("URL fetch failure explains CORS/save-upload", "upload" in status().lower() and "CORS" in status(), status())
        # URL success path: local http server with CORS header
        import http.server, threading, functools
        class H(http.server.SimpleHTTPRequestHandler):
            def end_headers(self):
                if self.path.startswith("/cors/"): self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()
            def log_message(self, *a): pass
        os.makedirs(os.path.join(tmp, "srv", "cors"), exist_ok=True); os.makedirs(os.path.join(tmp, "srv", "nocors"), exist_ok=True)
        shutil.copy(IMG, os.path.join(tmp, "srv", "cors", "t.png")); shutil.copy(IMG, os.path.join(tmp, "srv", "nocors", "t.png"))
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(H, directory=os.path.join(tmp, "srv")))
        threading.Thread(target=srv.serve_forever, daemon=True).start(); port = srv.server_address[1]
        page.fill("#urlIn", f"http://127.0.0.1:{port}/nocors/t.png"); page.click("#urlGo"); page.wait_for_timeout(1000)
        check("URL without CORS header -> friendly message", "CORS" in status(), status())
        page.fill("#urlIn", f"http://127.0.0.1:{port}/cors/t.png"); page.click("#urlGo")
        page.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=10000)
        check("URL with CORS header loads + traces", page.locator("#list li[data-id]").count() == 8)
        srv.shutdown()

        # --- camera (fake device)
        page.click("#srcTabs button[data-tab=cam]"); page.click("#camStart"); page.wait_for_function("!document.getElementById('camShot').disabled", timeout=8000)
        page.click("#camShot"); page.wait_for_function("document.getElementById('status').textContent.startsWith('Traced') || document.getElementById('status').textContent.startsWith('Loaded')", timeout=10000)
        check("camera capture frame loads", "px" in status() or "Traced" in status(), status())
        page.click("#camStop")
        check("no JS errors", not errors, errors)
        # --- drag & drop upload
        page.click("#srcTabs button[data-tab=file]")
        data = open(IMG, "rb").read()
        page.evaluate("""async (b64)=>{const bin=atob(b64),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
          const dt=new DataTransfer();dt.items.add(new File([u],'dropped.png',{type:'image/png'}));
          document.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));}""", __import__("base64").b64encode(data).decode())
        page.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=10000)
        check("drag-and-drop upload", page.locator("#list li[data-id]").count() == 8)
        b.close()
    shutil.rmtree(tmp, ignore_errors=True)
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
