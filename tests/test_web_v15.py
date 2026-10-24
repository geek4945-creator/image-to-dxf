"""Hard Version 1.5 browser tests: version/tabs/help/reset, frame, edit draw, layers, R12/TorchMate, fold math, 3D, history."""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _webctx import *

IMG = os.path.join(HERE, "test_image.png")
VER = json.load(open(os.path.join(HERE, "..", "docs", "version.json")))


def lines(doc, layer):
    return [e for e in doc.modelspace() if e.dxf.layer == layer]


def main(c):
    p = c.page
    p.on("dialog", lambda d: d.accept()); p.set_default_timeout(10000)
    p.goto(URL)
    c.ok("version label", p.text_content("#verName").strip() == "Hard Version 1.5" and VER["build"] in p.text_content("#verBuild"))
    c.ok("link back to Hard Version 1", p.locator("a[href*='v1/']").count() >= 1)
    c.ok("help bubbles on settings", p.locator("button.hlp").count() >= 60, p.locator("button.hlp").count())
    c.click_btn("button.hlp[data-help=threshold]"); c.settle(150)
    c.ok("help bubble opens", p.locator(".bubble:visible").count() == 1)
    p.keyboard.press("Escape"); p.mouse.click(5, 300); c.settle(100)
    p.set_input_files("#fileIn", IMG)
    p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=20000); c.settle(400)
    c.ok("trace tab default hides fold", p.locator("#s-fold").is_hidden() and p.locator("#s-proc").is_visible())
    n0 = c.count()
    # --- reset keeps image
    c.click_btn("#tab_trace"); p.evaluate("(()=>{const e=document.getElementById('threshold');e.value=90;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()"); c.settle(900)
    c.click_btn("#resetDefaults"); c.settle(900)
    c.ok("reset restores threshold, keeps image", p.input_value("#threshold") == "128" and c.st("!!S.gray") and c.count() == n0, (p.input_value("#threshold"), c.count(), n0))
    # --- DXF formats
    p.locator("#dxfFmt").select_option("r12"); c.settle(100)
    d = c.export_doc(); c.ok("R12 is AC1009", d.dxfversion == "AC1009" and any(e.dxftype() == "POLYLINE" for e in d.modelspace()), d.dxfversion)
    p.locator("#dxfFmt").select_option("torchmate"); c.settle(100)
    d = c.export_doc(); c.ok("TorchMate: AC1009, one CUT layer", d.dxfversion == "AC1009" and {e.dxf.layer for e in d.modelspace()} == {"CUT"}, {e.dxf.layer for e in d.modelspace()})
    p.locator("#dxfFmt").select_option("r2000"); c.settle(100)
    # --- frame
    c.click_btn("#tab_frame"); c.ok("frame tab shows frame panel", p.locator("#s-frame").is_visible() and p.locator("#s-proc").is_hidden())
    d0 = c.export_doc(); base = polys(d0); bb0 = bbox(base)
    p.locator("#frOn").check(); c.settle(500)
    c.ok("frame drawn in preview", p.locator("#svg .frame").count() >= 1)
    d = c.export_doc(); fr = polys(d); fb = bbox(fr)
    c.ok("frame in DXF: 2 rings, offset 0.5 + width 0.5 each side", len(fr) == len(base) + 2 and abs((fb[2] - fb[0]) - (bb0[2] - bb0[0]) - 2.0) < 0.05, (fb, bb0, len(fr), len(base)))
    p.locator("#frBr").check(); c.settle(600)
    d = c.export_doc()
    c.ok("bridged frame merges into cut set", not polys(d, "CUT_FRAME") and len(polys(d)) >= 1)
    p.locator("#frBr").uncheck(); p.locator("#frOn").uncheck(); c.settle(400)
    # --- edit: draw a line
    c.click_btn("#tab_edit"); c.ok("edit tab selects edit tool", c.st("S.tool") == "e-select")
    p.locator("input[name=tool][value=e-draw]").check(); c.settle(100)
    W, H = c.st("[S.W,S.H]")
    for pt in [(W * 0.1, H * 0.95), (W * 0.9, H * 0.95)]:
        x, y = c.c(*pt)
        if c.mobile: p.touchscreen.tap(x, y)
        else: p.mouse.click(x, y)
        c.settle(120)
    c.click_btn("#drawFinish"); c.settle(300)
    c.ok("drawn line stored", c.st("S.lines.length") == 1, c.st("S.lines.length"))
    d = c.export_doc(); c.ok("drawn line exported as an open polyline", sum(1 for q in polys(d) if not q[1]) == 1)
    p.locator("#split").select_option("layers"); c.settle(200)
    d = c.export_doc(); c.ok("split by layer puts drawn line on CUT_EDIT", len(lines(d, "CUT_EDIT")) == 1, {e.dxf.layer for e in d.modelspace()})
    p.locator("#split").select_option("none"); c.settle(200)
    c.click_btn("#undo2"); c.settle(200); c.ok("undo removes line", c.st("S.lines.length") == 0)
    c.click_btn("#redo2"); c.settle(200); c.ok("redo restores line", c.st("S.lines.length") == 1)
    # --- layers
    c.click_btn("#tab_layers"); c.num("#lyN", 3)
    p.locator("#lyOut").select_option("single"); c.settle(300)
    d = read_dxf(c.download("#lyDl"))
    lays = {e.dxf.layer for e in d.modelspace()}
    c.ok("layers single DXF has LAYER_1..3", {"LAYER_1", "LAYER_2", "LAYER_3"} <= lays, lays)
    p.locator("#lyOut").select_option("zip"); c.settle(200)
    pz = c.download("#lyDl"); names = zipfile.ZipFile(pz).namelist()
    c.ok("layers zip has one DXF per layer", len([n for n in names if n.startswith("layer_")]) == 3, names)
    # --- fold
    c.click_btn("#tab_fold"); c.settle(300)
    bm = p.evaluate("I2D_FOLD.bendMath(0.125,0.125,0.44,90)")
    c.ok("BA 0.125 steel R0.125 K0.44 90deg = 0.283", abs(bm["BA"] - 0.2827) < 0.001 and abs(bm["BD"] - 0.2173) < 0.001, bm)
    c.ok("plain-English breakdown", "0.2827" in p.text_content("#fdMath"))
    d = read_dxf(c.download("#fdDl"))
    ext = bbox([(q, 0, 0) for q, _, l in polys(d) if l.startswith("CUT")])
    c.ok("flat pattern 9.565 x 7.565 with BEND lines", abs(ext[2] - ext[0] - 9.565) < 0.02 and abs(ext[3] - ext[1] - 7.565) < 0.02 and len(lines(d, "BEND")) == 4, ext)
    c.num("#fdT", 0.25); fl = p.evaluate("window.I2D_FOLD.current().flatX")
    c.ok("live recompute on thickness change", fl and abs(fl - 9.565) > 0.01, fl)
    # --- 3D
    c.click_btn("#tab_3d"); p.wait_for_function("window.I2D_3D", timeout=8000); c.settle(500)
    ink = p.evaluate("(()=>{const cv=document.getElementById('c3d'),x=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;let n=0;for(let i=3;i<x.length;i+=4)if(x[i])n++;return n})()")
    c.ok("3D preview renders", ink > 2000, ink)
    # --- history
    c.click_btn("#tab_history"); c.settle(600)
    c.ok("image auto-saved to history", p.locator("#histList .hitem").count() >= 1)
    p.locator("#histList button[data-act=open]").first.click()
    p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=20000)
    c.ok("history reopen traces", c.count() == n0)
    c.click_btn("#tab_all"); c.ok("all tab shows everything", p.locator("#s-fold").is_visible() and p.locator("#s-proc").is_visible())


if __name__ == "__main__":
    run(main, "Hard 1.5")
