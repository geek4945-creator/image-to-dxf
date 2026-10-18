"""Headless-Chrome tests for DXF output SIZE (width/height/scale/PPI, inches/mm, size reference, DXF check).
Regression for: "DXF comes out smaller than the size I set in inches" (size used to be applied to the whole image frame, not the traced shapes).
Run: python tests/test_web_size.py   (WEB_URL=https://... runs against a deployed copy)"""
import os, sys, tempfile, shutil, zipfile
import ezdxf
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.abspath(os.path.join(HERE, "..", "docs", "index.html"))
URL = os.environ.get("WEB_URL") or "file://" + WEB
IMG = os.path.join(HERE, "test_image.png")
CHROME = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser") if os.path.exists(p)), None)
results = []


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (" -- " + str(extra) if extra else ""))


def extents(path):
    doc = ezdxf.readfile(path)
    xs, ys = [], []
    for e in doc.modelspace():
        for x, y in e.get_points("xy"):
            xs.append(x); ys.append(y)
    return doc, (min(xs), min(ys), max(xs), max(ys)), max(xs) - min(xs), max(ys) - min(ys)


def main():
    tmp = tempfile.mkdtemp()
    # image with big blank margins: a 300x200 black rounded block + an 'O' with a hole on a 1000x800 white page
    mg = os.path.join(tmp, "margins.png")
    im = Image.new("RGB", (1000, 800), "white"); d = ImageDraw.Draw(im)
    d.rectangle([300, 250, 600, 450], fill="black"); d.ellipse([650, 300, 750, 400], fill="black"); d.ellipse([675, 325, 725, 375], fill="white")
    im.save(mg)
    big = os.path.join(tmp, "big.png")      # > 2500 px: working-resolution downscale
    im = Image.new("RGB", (4000, 3000), "white"); d = ImageDraw.Draw(im)
    d.rectangle([1000, 800, 3000, 2200], fill="black"); im.save(big)
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True)
        ctx = b.new_context(accept_downloads=True); page = ctx.new_page()
        errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL)

        def load(path, n=None):
            page.set_input_files("#fileIn", path)
            page.wait_for_function("document.querySelectorAll('#list li[data-id]').length>0 && document.getElementById('status').textContent.startsWith('Traced')", timeout=20000)
            page.wait_for_timeout(300)

        def setf(k, v):                    # type like a user: fill() fires input; no blur / change needed
            page.fill("#" + k, str(v)); page.wait_for_timeout(450)

        def export():
            with page.expect_download() as dl:
                page.click("#download")
            p = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(p); return p

        def near(a, b, tol=1e-3):
            return abs(a - b) <= tol

        # ---------- DEFAULT STATE: inches, 10 in wide, INSUNITS=1, unit labels everywhere, choice persisted in localStorage
        load(mg)
        check("default unit is inches", page.input_value("#unit") == "in")
        check("default width is 10 in", near(float(page.input_value("#width")), 10.0, 1e-6), page.input_value("#width"))
        us = page.eval_on_selector_all(".u", "els=>els.filter(e=>e.offsetParent!==null).map(e=>e.textContent)")
        check("every visible unit label says 'in' (width, height, tolerance, min feature, tab width)", us and all(u == "in" for u in us) and len(us) >= 5, us)
        check("readout shows the unit", " in " in page.inner_text("#sizeOut"), page.inner_text("#sizeOut"))
        p = export(); doc, bb, w, h = extents(p)
        check("untouched defaults export inches: INSUNITS=1 and 10.000 in wide", doc.units == 1 and near(w, 10.0), (doc.units, w))
        page.select_option("#unit", "mm"); page.wait_for_timeout(300)
        check("toggling to mm converts the displayed width 10 in -> 254 mm", near(float(page.input_value("#width")), 254.0, 1e-3), page.input_value("#width"))
        check("labels switch to mm", all(u == "mm" for u in page.eval_on_selector_all(".u", "els=>els.filter(e=>e.offsetParent!==null).map(e=>e.textContent)")))
        p = export(); doc, bb, w, h = extents(p)
        check("after toggle the DXF is 254 mm wide, INSUNITS=4", doc.units == 4 and near(w, 254.0, 1e-3), (doc.units, w))
        page.reload(); page.wait_for_function("document.getElementById('unit').value==='mm'", timeout=5000)
        check("unit choice persisted across reload (mm)", page.input_value("#unit") == "mm" and near(float(page.input_value("#width")), 100.0, 1e-6), (page.input_value("#unit"), page.input_value("#width")))
        page.select_option("#unit", "in"); page.reload(); page.wait_for_timeout(500)
        check("persisted back to inches after reload", page.input_value("#unit") == "in" and near(float(page.input_value("#width")), 10.0, 1e-6))
        load(mg)

        # ---------- ROOT CAUSE reproduction + fix: inches width, blank margins around the artwork
        check("default size reference is the traced shapes", page.input_value("#sizeRef") == "shapes")
        page.select_option("#unit", "in"); setf("width", 10)
        p = export(); doc, bb, w, h = extents(p)
        check("10 in width -> DXF is 10.000 in wide (was ~8.8 when the image frame was sized)", doc.units == 1 and near(w, 10.0), w)
        check("height follows the shapes' aspect (lock on)", near(h, 10.0 * 201 / 451, 2e-3), h)
        check("height field shows the shapes' height", near(float(page.input_value("#height")), h, 2e-3), page.input_value("#height"))
        txt = page.inner_text("#sizeOut")
        check("readout states the real DXF size", "DXF will measure 10.000" in txt and f"{h:.3f}" in txt, txt)
        chk = page.inner_text("#dxfCheck")
        check("DXF check line shown, re-read from file, matches", "DXF check" in chk and "✓" in chk and "10" in chk, chk)
        ck = page.evaluate("window.__lastExport.check")
        check("DXF check numbers equal ezdxf measurement", near(ck["width"], w, 1e-4) and near(ck["height"], h, 1e-4) and ck["unit"] == "in" and ck["ok"], ck)

        # ---------- type height (lock on) -> that drives the size
        setf("height", 5)
        p = export(); doc, bb, w, h = extents(p)
        check("typing Height=5 in (locked) gives DXF height 5.000 in", near(h, 5.0) and near(w, 5.0 * 451 / 201, 2e-3), (w, h))
        check("typing in height switched 'Set size by' to Height", page.input_value("#sizeBy") == "height")
        # ---------- unlock aspect: width and height independent
        page.uncheck("#lock"); page.wait_for_timeout(200); setf("width", 8)
        p = export(); doc, bb, w, h = extents(p)
        check("unlocked: width 8 + height 5 exact on both axes", near(w, 8.0) and near(h, 5.0), (w, h))
        page.check("#lock"); page.wait_for_timeout(200)

        # ---------- switching 'Set size by' keeps the current size (no jump) and PPI/percent are applied
        page.select_option("#sizeBy", "width"); setf("width", 10); before = page.inner_text("#sizeOut")
        page.select_option("#sizeBy", "percent"); page.wait_for_timeout(300)
        after = page.inner_text("#sizeOut")
        check("switching Width -> Scale% does not change the size", before.split("·")[0] == after.split("·")[0], (before, after))
        pct = float(page.input_value("#pct"))
        setf("pct", pct * 2)
        p = export(); doc, bb, w, h = extents(p)
        check("scale % doubles the DXF width", near(w, 20.0, 5e-3), w)
        setf("width", 10)                    # typing in a derived field takes over (no read-only trap)
        check("typing Width while in Scale% mode switches to Width mode", page.input_value("#sizeBy") == "width")
        p = export(); doc, bb, w, h = extents(p)
        check("... and the DXF is 10 in again", near(w, 10.0), w)
        page.select_option("#sizeBy", "dpi"); page.wait_for_timeout(200); setf("dpi", 100)
        p = export(); doc, bb, w, h = extents(p)
        check("PPI 100 -> DXF width = 451 px / 100 = 4.51 in", near(w, 4.51, 5e-3), w)
        page.select_option("#sizeBy", "width"); page.wait_for_timeout(200); setf("width", 10)

        # ---------- frame reference: old behaviour is still available, and is labelled
        page.select_option("#sizeRef", "image"); page.wait_for_timeout(300)
        setf("width", 10)
        p = export(); doc, bb, w, h = extents(p)
        check("image-frame reference: whole frame = 10 in, shapes 4.51 in", near(w, 4.51, 5e-3), w)
        check("... and the UI warns that shapes are smaller", "⚠" in page.inner_text("#sizeOut") and "smaller" in page.inner_text("#dxfCheck"), page.inner_text("#dxfCheck"))
        page.select_option("#sizeRef", "shapes"); page.wait_for_timeout(300); setf("width", 10)

        # ---------- selection changes: the DXF is still exactly the entered width
        n = page.locator("#list li[data-id]").count()
        check("margins image traced to 2 shapes + 1 hole", n == 3, n)
        # deselect the round shape (contours 1,2) -> only the rectangle remains: it must now be 10 in wide
        page.evaluate("[...document.querySelectorAll('#list li[data-id]')].slice(1).forEach(li=>li.click())")
        page.wait_for_timeout(300)
        p = export(); doc, bb, w, h = extents(p)
        check("subset selection: DXF still exactly 10 in wide", near(w, 10.0), w)
        page.click("#selAll"); page.wait_for_timeout(200)

        # ---------- mm and unit switching without drift
        page.select_option("#unit", "mm"); page.wait_for_timeout(200)
        check("10 in -> 254 mm", near(float(page.input_value("#width")), 254.0, 1e-3), page.input_value("#width"))
        setf("width", 100)
        p = export(); doc, bb, w, h = extents(p)
        check("100 mm -> DXF 100.000 mm, INSUNITS=4", doc.units == 4 and near(w, 100.0, 1e-3), (doc.units, w))
        page.select_option("#unit", "in"); page.wait_for_timeout(200); page.select_option("#unit", "mm"); page.wait_for_timeout(200)
        check("mm -> in -> mm round trip is exact", near(float(page.input_value("#width")), 100.0, 1e-3), page.input_value("#width"))
        page.select_option("#unit", "in"); page.wait_for_timeout(200)

        # ---------- zip / per-file origin: bbox of the union still the entered size
        setf("width", 10); page.select_option("#split", "layers")
        p = export(); doc, bb, w, h = extents(p)
        check("layer-per-contour file: still 10 in wide", near(w, 10.0), w)
        page.select_option("#split", "none")

        # ---------- tabs do not shrink the DXF by more than a tab width (and the check says so)
        page.check("#tabsAll"); page.fill("#tabW", "0.05"); page.dispatch_event("#tabW", "input"); page.wait_for_timeout(400)
        p = export(); doc, bb, w, h = extents(p)
        check("with tabs the DXF is within one tab width of 10 in", 10.0 - 0.06 <= w <= 10.0 + 1e-6, w)
        page.uncheck("#tabsAll"); page.wait_for_timeout(300)

        # ---------- crop: size refers to what is in the DXF; 'full' reference is offered only while cropped
        check("'full original image' option unavailable without a crop", page.eval_on_selector("#sizeRef option[value=full]", "o=>o.disabled"))
        load(IMG)
        page.select_option("#unit", "in"); setf("width", 6)
        page.click("#cropDraw")
        box = page.locator("#svg").bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.05, box["y"] + box["height"] * 0.05); page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] * 0.6, steps=6); page.mouse.up()
        page.click("#cropApply"); page.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=10000); page.wait_for_timeout(300)
        check("'full original image' option is offered after crop", not page.eval_on_selector("#sizeRef option[value=full]", "o=>o.disabled"))
        setf("width", 6)
        p = export(); doc, bb, w, h = extents(p)
        check("cropped: 6 in width -> DXF 6.000 in wide", near(w, 6.0), w)
        page.click("#cropReset"); page.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=10000); page.wait_for_timeout(300)

        # ---------- working-resolution downscale (>2500 px) does not change the physical size
        load(big)
        page.select_option("#unit", "in"); setf("width", 10)
        p = export(); doc, bb, w, h = extents(p)
        check(">2500 px source: DXF still exactly 10 in wide", near(w, 10.0), w)
        check("... height keeps the 2000x1400 aspect", near(h, 10.0 * 1400 / 2000, 5e-3), h)

        # ---------- size entered in a field with no blur/change event applies immediately (input event only)
        page.evaluate("const e=document.getElementById('width'); e.value='12'; e.dispatchEvent(new Event('input',{bubbles:true}))"); page.wait_for_timeout(400)
        p = export(); doc, bb, w, h = extents(p)
        check("input-event-only edit applies to the DXF (12 in)", near(w, 12.0), w)
        page.evaluate("const e=document.getElementById('width'); e.value='7'; e.dispatchEvent(new Event('change',{bubbles:true}))"); page.wait_for_timeout(400)
        p = export(); doc, bb, w, h = extents(p)
        check("change-event-only edit applies to the DXF (7 in)", near(w, 7.0), w)

        # ---------- measureDxf unit test in the page
        m = page.evaluate("""()=>{const t=I2D_DXF.writeEntities([{layer:'CUT',pts:[[1,1],[4,1],[4,3]],closed:true}],'in'); return I2D_DXF.measureDxf(t)}""")
        check("measureDxf parses extents + INSUNITS", near(m["width"], 3) and near(m["height"], 2) and m["unit"] == "in" and m["polylines"] == 1, m)
        check("no JS errors", not errors, errors)
        b.close()
    shutil.rmtree(tmp, ignore_errors=True)
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
