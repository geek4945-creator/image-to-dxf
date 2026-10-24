"""Browser tests: table size / material-move passes (sections, park marker, registration marks, overlay, persistence).
4 contexts (desktop/iPhone x light/dark); every DXF/zip is re-read with ezdxf (audit clean).
  python tests/test_web_table.py       (WEB_URL=https://... runs against the live site)"""
import os, sys
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _webctx import *

IMG = os.path.join(TMP, "table.png")
SC = 100 / 1101.0                      # in per px: job = 1101 px wide -> 100 in


def make_images():
    im = Image.new("RGB", (1200, 400), "white"); d = ImageDraw.Draw(im)
    d.rectangle([50, 100, 350, 300], fill="black"); d.rectangle([120, 150, 280, 250], fill="white")   # S1: ring, lies inside pass 1
    d.rectangle([500, 120, 640, 280], fill="black")                                                   # S2: crosses break 1 (47 in)
    d.rectangle([700, 100, 900, 300], fill="black")                                                   # S3: inside pass 2
    d.rectangle([1030, 150, 1150, 250], fill="black")                                                 # S4: crosses break 2 (94 in), right edge = job max
    im.save(IMG)


def lay(doc, name):
    return [e for e in doc.modelspace() if e.dxf.layer == name]


def park_text(doc):
    return [e.dxf.text for e in lay(doc, "PARK") if e.dxftype() == "TEXT"]


def main(c):
    p = c.page
    c.load(IMG); c.num("#width", 100)
    c.ok("unit is inches by default", p.input_value("#unit") == "in")
    c.ok("table section present, off by default", not p.is_checked("#tblOn") and not p.is_visible("#tblBox"))
    doc = c.export_doc(); pl = polys(doc)
    c.ok("table off: normal single DXF (5 closed polylines, 100 in wide)", len(pl) == 5 and abs(bbox(pl)[2] - bbox(pl)[0] - 100) < 1e-3, (len(pl), bbox(pl)))
    c.click_btn("#tblOn") if False else p.check("#tblOn"); c.settle(500)
    c.ok("table box opens with 48 x 48 in", p.is_visible("#tblBox") and p.input_value("#tblW") == "48" and p.input_value("#tblH") == "48", (p.input_value("#tblW"), p.input_value("#tblH")))
    note = p.inner_text("#tblNote")
    c.ok("note: 3 passes (3 x 1)", "3 passes (3 × 1)" in note, note)
    c.ok("overlay: 3 table frames, 3 pass labels, 2 break lines, 3 park markers",
         p.locator("svg rect.tblwin").count() == 3 and p.locator("svg text.tbllbl").count() == 3 and p.locator("svg path.tblbrk").count() == 2 and p.locator("svg circle.tblpark").count() == 3,
         [p.locator(f"svg {s}").count() for s in ("rect.tblwin", "text.tbllbl", "path.tblbrk", "circle.tblpark")])
    c.ok("pass labels read Pass 1..3", p.eval_on_selector_all("svg text.tbllbl", "els=>els.map(e=>e.textContent)") == ["Pass 1", "Pass 2", "Pass 3"])

    # ---- zip: one DXF per pass
    z = c.export_zip()
    c.ok("zip has pass_01..03.dxf + cut_plan.txt", sorted(z) == ["cut_plan.txt", "pass_01.dxf", "pass_02.dxf", "pass_03.dxf"], sorted(z))
    docs = [read_dxf(z[f"pass_0{i}.dxf"]) for i in (1, 2, 3)]
    cut = [polys(d, "CUT") for d in docs]
    c.ok("every pass: INSUNITS=1 and cuts fit the 48 x 48 in table", all(d.units == 1 for d in docs) and all(bbox(q)[0] >= -1e-6 and bbox(q)[2] <= 48 + 1e-6 and bbox(q)[3] <= 48 for q in cut), [bbox(q) for q in cut])
    c.ok("pass 1: ring (+hole) closed, break-crossing S2 continues as an OPEN run ending at the break (x = 47)",
         sum(1 for _, cl, _ in cut[0] if cl) == 2 and any(not cl for _, cl, _ in cut[0]) and abs(bbox(cut[0])[2] - 47.0) < 1e-3, [(len(a), b) for a, b, _ in cut[0]])
    y1 = sorted({round(y, 3) for q, cl, _ in cut[0] if not cl for x, y in q if abs(x - 47) < 1e-3}); y2 = sorted({round(y, 3) for q, cl, _ in cut[1] if not cl for x, y in q if abs(x) < 1e-3})
    c.ok("pass 2 starts exactly where pass 1 stopped (same Y at the break, X restarts at 0)", y1 and y1 == y2, (y1, y2))
    c.ok("pass 2: S3 closed + continuing runs; pass 3 ends at x = 6 in (job 100 in - 94)", any(cl for _, cl, _ in cut[1]) and abs(bbox(cut[2])[2] - 6.0) < 1e-3, (bbox(cut[1]), bbox(cut[2])))
    tx = [park_text(d) for d in docs]
    c.ok("PARK markers: POINT + CIRCLE + TEXT in every pass; texts say how to move the material",
         all({e.dxftype() for e in lay(d, "PARK")} == {"POINT", "CIRCLE", "TEXT"} for d in docs) and "PASS 1/3 PARK" in tx[0][0] and "X -47" in tx[0][0] and "job complete" in tx[2][0], tx)
    c.ok("park marker is the LAST thing in each file", all(list(d.modelspace())[-1].dxf.layer == "PARK" for d in docs))
    pt = [(e.dxf.location.x, e.dxf.location.y) for e in lay(docs[0], "PARK") if e.dxftype() == "POINT"][0]
    c.ok("default park = table lower-left (0,0)", abs(pt[0]) < 1e-6 and abs(pt[1]) < 1e-6, pt)
    plan = open(z["cut_plan.txt"]).read()
    c.ok("cut_plan.txt lists the passes and material moves", "Pass 1" in plan and "slide material X -47" in plan and "last pass" in plan, plan[:200])
    c.ok("DXF check line lists the pass files", "pass_01.dxf" in p.inner_text("#dxfCheck") and "pass_03.dxf" in p.inner_text("#dxfCheck") and "✓" in p.inner_text("#dxfCheck"), p.inner_text("#dxfCheck"))

    # ---- registration marks
    p.check("#tblMarks"); c.settle(400)
    z = c.export_zip(); docs = [read_dxf(z[f"pass_0{i}.dxf"]) for i in (1, 2, 3)]
    n = lambda d, l: len(polys(d, l))
    c.ok("registration marks: REG_MARK on the earlier pass, REG_ALIGN on the next one (2 crosses per break)",
         n(docs[0], "REG_MARK") == 4 and n(docs[0], "REG_ALIGN") == 0 and n(docs[1], "REG_ALIGN") == 4 and n(docs[1], "REG_MARK") == 4 and n(docs[2], "REG_ALIGN") == 4 and n(docs[2], "REG_MARK") == 0,
         [(n(d, "REG_MARK"), n(d, "REG_ALIGN")) for d in docs])
    m1, a2 = bbox(polys(docs[0], "REG_MARK")), bbox(polys(docs[1], "REG_ALIGN"))
    c.ok("the same physical marks: x = 47.5 on pass 1, x = 0.5 on pass 2 (1 in overlap), same Y", abs((m1[0] + m1[2]) / 2 - 47.5) < 1e-3 and abs((a2[0] + a2[2]) / 2 - 0.5) < 1e-3 and abs(m1[1] - a2[1]) < 1e-6 and abs(m1[3] - a2[3]) < 1e-6, (m1, a2))
    p.uncheck("#tblMarks")

    # ---- single DXF with SECTION_n layers
    p.select_option("#tblOut", "single"); c.settle(300)
    d1 = c.export_doc()
    names = {e.dxf.layer for e in d1.modelspace()}
    c.ok("single DXF: layers SECTION_1..3, PARK, TABLE_FRAME (3 frames) in job coordinates",
         {"SECTION_1", "SECTION_2", "SECTION_3", "PARK", "TABLE_FRAME"} <= names and len(polys(d1, "TABLE_FRAME")) == 3 and bbox(polys(d1, "SECTION_3"))[2] > 100, names)
    c.ok("single DXF: three PARK markers", len([e for e in lay(d1, "PARK") if e.dxftype() == "POINT"]) == 3)
    p.select_option("#tblOut", "files")

    # ---- keep whole contours (assign by centre) + warnings
    p.select_option("#tblMode", "whole"); c.settle(400)
    note = p.inner_text("#tblNote")
    c.ok("whole mode: contours that cannot fit the window across a break give warnings", "does not fit" in note and "#" in note, note)
    z = c.export_zip(); docs = [read_dxf(z[f"pass_0{i}.dxf"]) for i in (1, 2, 3)]
    allc = [x for d in docs for x in polys(d, "CUT")]
    c.ok("whole mode: nothing is cut in two - all 5 contours closed, each in exactly one pass", len(allc) == 5 and all(cl for _, cl, _ in allc), [(len(a), b) for a, b, _ in allc])
    c.ok("DXF check shows the warnings", "⚠" in p.inner_text("#dxfCheck"), p.inner_text("#dxfCheck"))
    p.fill("#tblW", "24"); p.fill("#tblH", "24"); c.settle(400)
    note = p.inner_text("#tblNote")
    c.ok("contour larger than the table (27 in ring on a 24 in table): explicit warning", "larger than the table" in note, note)
    p.select_option("#tblMode", "clip"); c.settle(400)
    c.ok("clip mode needs no such warning", "larger than the table" not in p.inner_text("#tblNote"), p.inner_text("#tblNote"))
    p.select_option("#tblPreset", "48x48"); c.settle(300)

    # ---- start corner, park position, ordering, tabs
    p.select_option("#tblCorner", "br"); c.settle(400)
    z = c.export_zip(); docs = [read_dxf(z[f"pass_0{i}.dxf"]) for i in (1, 2, 3)]
    b1 = bbox(polys(docs[0], "CUT"))
    c.ok("start corner lower-right: pass 1 is the right-hand end of the job, pushed to the table's right edge (x max = 48)", abs(b1[2] - 48.0) < 1e-3, b1)
    p.select_option("#tblCorner", "bl")
    p.select_option("#tblPark", "custom"); p.fill("#tblParkX", "2"); p.fill("#tblParkY", "3"); c.settle(400)
    z = c.export_zip(); docs = [read_dxf(z[f"pass_0{i}.dxf"]) for i in (1, 2, 3)]
    pts = [[(round(e.dxf.location.x, 4), round(e.dxf.location.y, 4)) for e in lay(d, "PARK") if e.dxftype() == "POINT"][0] for d in docs]
    c.ok("custom park position (2, 3) emitted in every pass", all(q == (2, 3) for q in pts), pts)
    p.select_option("#tblPark", "tr"); c.settle(300)
    z = c.export_zip(); d = read_dxf(z["pass_01.dxf"])
    q = [(e.dxf.location.x, e.dxf.location.y) for e in lay(d, "PARK") if e.dxftype() == "POINT"][0]
    c.ok("park at table upper-right = (48, 48)", abs(q[0] - 48) < 1e-6 and abs(q[1] - 48) < 1e-6, q)
    p.select_option("#tblPark", "bl")
    p.check("#insideFirst"); c.settle(300)
    z = c.export_zip(); d = read_dxf(z["pass_01.dxf"]); pc = polys(d, "CUT")
    hole = [i for i, x in enumerate(pc) if abs((bbox([x])[2] - bbox([x])[0]) - 161 * SC) < 0.2]; outer = [i for i, x in enumerate(pc) if abs((bbox([x])[2] - bbox([x])[0]) - 301 * SC) < 0.2]
    c.ok("cut-inside-first respected within the pass: ring's hole before its outline", hole and outer and hole[0] < outer[0], (hole, outer))
    p.check("#nearest"); p.check("#showOrder"); c.settle(400)
    lbl = p.eval_on_selector_all("svg text.ord", "els=>els.map(e=>[+e.dataset.pass,e.textContent])")
    pas = [a for a, _ in lbl]
    c.ok("cut order numbers: Pass 1 labels come first, numbering restarts at 1 in each pass (P1·1 .. P2·1 ..)",
         lbl and pas == sorted(pas) and all(any(t == f"P{n}·1" for a, t in lbl if a == n) for n in set(pas)) and set(pas) == {1, 2, 3}, lbl)
    z = c.export_zip(); d = read_dxf(z["pass_02.dxf"]); pc = polys(d, "CUT")
    c.ok("inside-first + nearest still valid within pass 2 (closed S3 present, file audit clean)", any(cl for _, cl, _ in pc), len(pc))
    p.uncheck("#nearest"); p.uncheck("#showOrder")
    p.uncheck("#insideFirst")
    p.check("#tabsAll"); p.fill("#tabW", "0.5"); p.dispatch_event("#tabW", "input"); c.settle(400)
    z = c.export_zip(); d = read_dxf(z["pass_01.dxf"]); pc = polys(d, "CUT")
    c.ok("tabs work with table passes (tabbed outlines are open segments)", sum(1 for _, cl, _ in pc if not cl) >= 3, len(pc))
    p.uncheck("#tabsAll"); c.settle(300)

    # ---- job fits on the table
    p.fill("#tblW", "120"); p.fill("#tblH", "60"); c.settle(400)
    c.ok("job smaller than the table: 1 pass", "fits on the table" in p.inner_text("#tblNote"), p.inner_text("#tblNote"))
    f = c.download(); d = read_dxf(f)
    c.ok("... exports one DXF (not a zip) with the park marker", f.endswith(".dxf") and len(lay(d, "PARK")) == 3 and len(polys(d, "CUT")) == 5, f)

    # ---- persistence + unit conversion
    p.select_option("#tblPreset", "48x96"); p.fill("#tblOv", "2"); p.select_option("#tblPark", "custom"); p.fill("#tblParkX", "5"); p.fill("#tblParkY", "6"); p.check("#tblMarks"); p.select_option("#tblCorner", "tr"); c.settle(300)
    p.reload(); c.settle(600)
    vals = [p.input_value(i) for i in ("#tblPreset", "#tblW", "#tblH", "#tblOv", "#tblPark", "#tblParkX", "#tblParkY", "#tblCorner")]
    c.ok("table settings remembered across reload (localStorage)", vals == ["48x96", "48", "96", "2", "custom", "5", "6", "tr"] and p.is_checked("#tblMarks") and not p.is_checked("#tblOn"), vals)
    p.select_option("#unit", "mm"); c.settle(300)
    c.ok("unit toggle converts table fields (48 in -> 1219.2 mm), labels switch", abs(float(p.input_value("#tblW")) - 1219.2) < 1e-3 and p.eval_on_selector_all("#s-table .u", "els=>els.every(e=>e.textContent==='mm')"), (p.input_value("#tblW")))
    p.reload(); c.settle(600)
    c.ok("... and the inch values survive a reload in mm", p.input_value("#unit") == "mm" and abs(float(p.input_value("#tblW")) - 1219.2) < 1e-3 and abs(float(p.input_value("#tblOv")) - 50.8) < 1e-3, (p.input_value("#tblW"), p.input_value("#tblOv")))
    # mm job end-to-end
    p.check("#tblOn"); c.settle(200)
    p.select_option("#tblCorner", "bl"); p.select_option("#tblPark", "bl"); p.uncheck("#tblMarks")
    p.set_input_files("#fileIn", IMG); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=20000); c.settle(300)
    c.num("#width", 2540); p.fill("#tblOv", "25.4"); c.settle(500)
    z = c.export_zip(); docs = [read_dxf(z[f"pass_0{i}.dxf"]) for i in (1, 2, 3)] if "pass_03.dxf" in z else []
    c.ok("mm: 2540 mm job on a 1219.2 mm table -> 3 passes, INSUNITS=4, texts in mm", len(docs) == 3 and all(d.units == 4 for d in docs) and "mm" in park_text(docs[0])[0], sorted(z))


if __name__ == "__main__":
    make_images()
    run(main, "table passes")
