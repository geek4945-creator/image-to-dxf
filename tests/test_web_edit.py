"""Browser tests: merge touching cuts, re-scan area, assess whole crop. 4 contexts (desktop/iPhone x light/dark), DXF re-read with ezdxf.
  python tests/test_web_edit.py        (WEB_URL=https://... runs against the live site)"""
import os, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _webctx import *

IMG = os.path.join(TMP, "edit.png")


def make_images():
    im = Image.new("RGB", (1000, 800), "white"); d = ImageDraw.Draw(im)
    d.rectangle([100, 100, 250, 200], fill="black"); d.rectangle([254, 100, 400, 200], fill="black")      # A1 + A2: 3 px gap
    d.rectangle([100, 400, 200, 500], fill="black")                                                      # R3: far away
    d.rectangle([500, 100, 620, 220], fill="black"); d.rectangle([530, 130, 590, 190], fill="white")     # ring with a hole ...
    d.rectangle([624, 100, 700, 220], fill="black")                                                      # ... + neighbour N (3 px gap)
    d.rectangle([800, 100, 900, 200], fill=(215, 215, 215))                                              # faint rectangle (global threshold 128 misses it)
    d.rectangle([150, 620, 250, 700], fill=(225, 225, 225)); d.rectangle([300, 620, 400, 700], fill=(225, 225, 225))   # very faint pair for the crop test
    im.save(IMG)


def segs(pl):
    out = []
    for p, cl, _ in pl:
        n = len(p)
        for i in range(n if cl else n - 1):
            a, b = p[i], p[(i + 1) % n]
            if abs(a[0] - b[0]) + abs(a[1] - b[1]) < 1e-9: continue
            k = tuple(sorted([(round(a[0], 3), round(a[1], 3)), (round(b[0], 3), round(b[1], 3))]))
            out.append(k)
    return out


def ids_at(c, x0, y0, x1, y1):
    return c.st(f"S.items.filter(i=>i.bcx>={x0}&&i.bcx<={x1}&&i.bcy>={y0}&&i.bcy<={y1}).map(i=>i.id)")


def main(c):
    p = c.page
    # ---------------------------------------------------------------- merge touching cuts
    c.load(IMG)
    n0 = c.count()
    c.ok("test image traces to 6 contours (faint shapes missed by the global threshold)", n0 == 6, n0)
    c.ok("merge button enabled, undo disabled", not p.is_disabled("#mergeGo") and p.is_disabled("#undoEdit"))
    p.fill("#mergeTol", "0.001"); c.click_btn("#mergeGo"); c.settle(200)
    c.ok("tiny tolerance: nothing merges (shows pixel-size hint)", c.count() == n0 and "Nothing to merge" in p.inner_text("#mergeNote") and "1 image pixel" in p.inner_text("#mergeNote"), p.inner_text("#mergeNote"))
    p.fill("#mergeTol", "0.07"); c.click_btn("#mergeGo"); c.settle(300)
    note = p.inner_text("#mergeNote")
    c.ok("merge: count before/after shown (5 touching contours -> 3, 6 -> 4 overall)", "Merged 5" in note and "into 3" in note and "6 → 4" in note and c.count() == 4, note)
    c.ok("undo enabled after merge", not p.is_disabled("#undoEdit"))
    doc = c.export_doc(); pl = polys(doc)
    c.ok("DXF: 4 closed polylines (merged A, R3, merged ring outline, its hole)", len(pl) == 4 and all(cl for _, cl, _ in pl), [(len(a), b) for a, b, _ in pl])
    sg = segs(pl)
    c.ok("DXF: no duplicated / shared internal edges", len(sg) == len(set(sg)), len(sg) - len(set(sg)))
    sc = c.st("(()=>{const e=__i2d.exportBox();return 10/e.w})()")          # in/px (10 in wide shapes bbox)
    A = [x for x in pl if abs(bbox([x])[0] - 100 * sc) < 0.02 and bbox([x])[3] - bbox([x])[1] > 90 * sc and bbox([x])[1] > 0.5]
    wA = max((bbox([x])[2] - bbox([x])[0]) for x in pl)
    c.ok("merged A is ONE outline spanning both rectangles (~301 px wide)", abs(wA - 301 * sc) < 0.06 or abs(wA - 302 * sc) < 0.06, (wA, 301 * sc))
    holes = [x for x in pl if abs((bbox([x])[2] - bbox([x])[0]) - 60 * sc) < 0.05]
    c.ok("merged ring keeps its hole (60 px wide inner contour)", len(holes) == 1, len(holes))
    # in-page geometry: shared edge, tol 0 -> union removes the internal edge
    r = p.evaluate("""()=>{const sq=(x,y,w,h)=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];const m=I2D_DXF.mergeContours([sq(0,0,10,10),sq(10,0,10,10),sq(20,0,10,10)],null,0);
      return {c:m.clusters,b:m.before,a:m.after,pts:m.added[0].pts.length,xs:[Math.min(...m.added[0].pts.map(q=>q[0])),Math.max(...m.added[0].pts.map(q=>q[0]))]}}""")
    c.ok("tol 0: 3 squares sharing edges -> 1 outline (no internal edges)", r["c"] == 1 and r["b"] == 3 and r["a"] == 1 and r["xs"] == [0, 30] and r["pts"] <= 8, r)
    # undo
    c.click_btn("#undoEdit"); c.settle(300)
    c.ok("Undo restores the 6 original contours", c.count() == 6 and p.is_disabled("#undoEdit"), c.count())
    # scope: selected only
    c.click_btn("#selNone")
    a1, a2 = ids_at(c, 100, 100, 200, 200), ids_at(c, 255, 100, 400, 200)
    for i in a1 + a2:
        p.click(f"#list li[data-id='{i}']")
    p.select_option("#mergeScope", "selected"); p.fill("#mergeTol", "0.15"); c.click_btn("#mergeGo"); c.settle(300)
    c.ok("scope 'only selected': merges just the 2 selected (6 -> 5)", c.count() == 5 and "Merged 2" in p.inner_text("#mergeNote"), p.inner_text("#mergeNote"))
    c.click_btn("#undoEdit"); c.settle(200)
    # scope: zone
    c.click_btn("#zoneAdd"); c.settle(200)
    p.evaluate("__i2d.S.zones[0].rect=[470,80,720,240]; __i2d.refresh()"); c.settle(200)
    c.ok("zone scope option offered", p.eval_on_selector("#mergeScope", "s=>[...s.options].some(o=>o.value==='z1')"))
    p.select_option("#mergeScope", "z1"); p.fill("#mergeTol", "0.15"); c.click_btn("#mergeGo"); c.settle(300)
    c.ok("scope 'inside zone': only ring + neighbour merge (6 -> 5, A1/A2 untouched)", c.count() == 5 and "Merged 3" in p.inner_text("#mergeNote"), p.inner_text("#mergeNote"))
    c.click_btn("#undoEdit"); c.settle(200)
    c.click_btn("#zoneClear"); p.select_option("#mergeScope", "all")
    c.click_btn("#selAll"); c.settle(200)
    # works with cut inside first, tabs, split, clip
    c.click_btn("#mergeGo"); c.settle(300)
    p.check("#insideFirst"); c.settle(300)
    doc = c.export_doc(); pl = polys(doc)
    hole_idx = [i for i, x in enumerate(pl) if abs((bbox([x])[2] - bbox([x])[0]) - 60 * sc) < 0.05][0]
    outer_idx = [i for i, x in enumerate(pl) if abs((bbox([x])[2] - bbox([x])[0]) - 201 * sc) < 0.08 or (bbox([x])[2] - bbox([x])[0]) > 150 * sc and (bbox([x])[3] - bbox([x])[1]) > 115 * sc][0]
    c.ok("merged + cut-inside-first: hole written before its outline", hole_idx < outer_idx, (hole_idx, outer_idx))
    p.check("#tabsAll"); p.fill("#tabW", "0.05"); p.dispatch_event("#tabW", "input"); c.settle(300)
    doc = c.export_doc(); pl = polys(doc)
    c.ok("merged + tabs: outer contours get open (tabbed) segments", any(not cl for _, cl, _ in pl), len(pl))
    p.uncheck("#tabsAll"); p.select_option("#split", "layers"); doc = c.export_doc()
    c.ok("merged + split layers: one layer per contour", len({e.dxf.layer for e in doc.modelspace()}) == 4)
    p.select_option("#split", "none"); p.uncheck("#insideFirst")
    c.click_btn("#undoEdit"); c.settle(200)
    # a later slider change re-traces and drops edits, with a message
    c.click_btn("#mergeGo"); c.settle(200)
    p.evaluate("const e=document.getElementById('blur'); e.value=1; e.dispatchEvent(new Event('input'))"); c.settle(700)
    c.ok("processing change re-traces: edits discarded with a notice, undo cleared", "discarded" in p.inner_text("#status") and p.is_disabled("#undoEdit"), p.inner_text("#status"))
    p.evaluate("const e=document.getElementById('blur'); e.value=0; e.dispatchEvent(new Event('input'))"); c.settle(500)

    # ---------------------------------------------------------------- re-scan area
    c.load(IMG)
    n0 = c.count()
    c.click_btn("#rsDraw"); c.settle(150)
    c.ok("re-scan tool selected", p.is_checked("input[name=tool][value=rescan]"))
    c.drag_img((770, 70), (930, 230)); c.settle(400)
    note = p.inner_text("#rsNote")
    c.ok("live preview: finds the faint shape in the area (local Otsu)", "Found 1 contour" in note and "1 new" in note and not p.is_disabled("#rsAdd"), note)
    c.ok("preview polygon drawn on the image", p.locator("svg polygon.rspoly").count() == 1 and p.locator("svg rect.rsarea").count() >= 1)
    p.uncheck("#rsAuto"); c.settle(300)
    c.ok("global-like fixed threshold 128 finds nothing there (preview updates live)", "Nothing found" in p.inner_text("#rsNote") and p.is_disabled("#rsAdd"), p.inner_text("#rsNote"))
    p.evaluate("const e=document.getElementById('rsThr'); e.value=230; e.dispatchEvent(new Event('input'))"); c.settle(300)
    c.ok("raising the local threshold to 230 finds it again", "Found 1 contour" in p.inner_text("#rsNote"), p.inner_text("#rsNote"))
    p.check("#rsAuto"); c.settle(200)
    c.click_btn("#rsAdd"); c.settle(400)
    c.ok("Add to cuts: contour count 6 -> 7, selected", c.count() == n0 + 1 and c.st("S.selected.size") == n0 + 1 and "Added 1" in p.inner_text("#rsNote"), p.inner_text("#rsNote"))
    doc = c.export_doc(); pl = polys(doc); sc = c.st("(()=>{const e=__i2d.exportBox();return 1})()")
    bb = bbox(pl); xs = sorted(set(round(x, 3) for pp, _, _ in pl for x, _ in pp))
    c.ok("DXF now contains the missed faint shape as a 7th closed polyline", len(pl) == n0 + 1 and all(cl for _, cl, _ in pl), len(pl))
    wtot = bb[2] - bb[0]; faint_w = [(max(x for x, _ in pp) - min(x for x, _ in pp)) for pp, _, _ in pl]
    ratio = wtot / 801.0                                                       # in per px: shapes now span 100..900 (+1)
    c.ok("... at the right place/size (100 px wide, right-most)", any(abs(w - 101 * ratio) < 0.05 for w in faint_w) and abs(bb[2] - bb[0] - 10.0) < 1e-3, (faint_w, wtot))
    c.click_btn("#undoEdit"); c.settle(300)
    c.ok("Undo removes the added contour", c.count() == n0, c.count())
    # duplicates are skipped; replace option
    c.click_btn("#rsDraw"); c.drag_img((60, 380), (230, 520)); c.settle(400)
    c.ok("area over an existing cut: found, but reported as already in the cuts", "1 already" in p.inner_text("#rsNote") and "0 new" in p.inner_text("#rsNote"), p.inner_text("#rsNote"))
    c.click_btn("#rsAdd"); c.settle(300)
    c.ok("adding duplicates changes nothing", c.count() == n0 and "already in the cuts" in p.inner_text("#rsNote"), p.inner_text("#rsNote"))
    c.click_btn("#rsDraw"); c.drag_img((60, 380), (230, 520)); c.settle(300); p.check("#rsReplace"); c.click_btn("#rsAdd"); c.settle(300)
    c.ok("'replace existing contours inside the area': same count, contour re-traced", c.count() == n0 and "replaced 1" in p.inner_text("#rsNote"), p.inner_text("#rsNote"))
    c.click_btn("#undoEdit"); c.settle(200); p.uncheck("#rsReplace")
    c.click_btn("#rsClear"); c.settle(200)
    c.ok("Clear area removes the preview", p.locator("svg polygon.rspoly").count() == 0 and p.is_disabled("#rsAdd"))

    # ---------------------------------------------------------------- assess whole crop
    c.load(IMG)
    c.ok("global threshold: crop region would have no contours (faint pair missed)", c.st("S.items.filter(i=>i.bcy>580&&i.bcy<760).length") == 0)
    c.click_btn("#cropDraw"); c.drag_img((100, 580), (450, 760)); c.settle(200)
    c.click_btn("#cropApply"); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=10000); c.settle(300)
    c.ok("crop applied; global settings find nothing in the crop", c.count() == 0 and c.st("S.crop") is not None, c.count())
    c.ok("crop-assess controls appear only after cropping", p.is_visible("#asRow") and not p.is_visible("#asBox"))
    p.locator("#asGo").scroll_into_view_if_needed(); p.click("#asGo"); p.wait_for_function("document.getElementById('status').textContent.includes('Re-assessed')", timeout=10000); c.settle(300)
    c.ok("Re-assess entire cropped section: local Otsu finds both faint shapes", c.count() == 2 and p.is_checked("#asOn") and p.is_visible("#asBox"), c.count())
    c.num("#width", 4); c.settle(300)
    doc = c.export_doc(); pl = polys(doc); bb = bbox(pl)
    c.ok("DXF has the 2 faint shapes; size reference (shapes) still gives exactly 4 in", len(pl) == 2 and abs((bb[2] - bb[0]) - 4.0) < 1e-3 and doc.units == 1, (len(pl), bb))
    p.uncheck("#asOn"); c.settle(700)
    c.ok("local settings off -> global settings again (0 contours)", c.count() == 0, c.count())
    p.check("#asOn"); c.settle(500)
    p.uncheck("#asAuto"); p.evaluate("const e=document.getElementById('asThr'); e.value=240; e.dispatchEvent(new Event('input'))"); c.settle(700)
    c.ok("local manual threshold 240 also finds them; global slider untouched (128)", c.count() == 2 and p.input_value("#threshold") == "128", (c.count(), p.input_value("#threshold")))
    p.evaluate("const e=document.getElementById('asThr'); e.value=100; e.dispatchEvent(new Event('input'))"); c.settle(700)
    c.ok("local threshold 100 misses them (slider is live)", c.count() == 0)
    p.check("#asAuto"); p.check("#asNorm"); c.settle(700)
    c.ok("stretch contrast + local Otsu finds them as well", c.count() == 2, c.count())
    p.check("#invert") if False else None
    c.click_btn("#cropReset"); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=10000); c.settle(300)
    c.ok("Reset crop returns to global settings on the full image (6 contours)", c.count() == 6 and not p.is_visible("#asRow"), c.count())


if __name__ == "__main__":
    make_images()
    run(main, "merge / re-scan / crop assess")
