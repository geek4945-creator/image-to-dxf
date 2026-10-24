"""Headless-Chrome feature tests for the browser edition (clear image, cut-inside-first, tabs, zones, crop, inches).
Runs every feature in 4 contexts: desktop 1400x900 and iPhone 390x844 (touch), each in light and dark colour scheme.
DXF output is re-opened with ezdxf (audit clean) and checked geometrically.

  python tests/test_features.py                      # local files (docs/index.html via file://)
  WEB_URL=https://geek4945-creator.github.io/image-to-dxf/ python tests/test_features.py     # against the live site
  SHOTS=/workspace/shots/v3 ...                      # also save screenshots there
"""
import math, os, shutil, sys, tempfile, zipfile
import ezdxf
from ezdxf import recover
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get("WEB_URL") or "file://" + os.path.abspath(os.path.join(HERE, "..", "docs", "index.html"))
NESTED = os.path.join(HERE, "test_nested.png")
SHOTS = os.environ.get("SHOTS")
CHROME = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser") if os.path.exists(p)), None)
results = []
TMP = tempfile.mkdtemp()
SCALE_MM = 100 / 800                                   # default: 100 mm wide, 800 px image

INIT = """
window.__created=[];window.__revoked=[];window.__streams=[];
(()=>{const c=URL.createObjectURL.bind(URL),r=URL.revokeObjectURL.bind(URL);
URL.createObjectURL=o=>{const u=c(o);window.__created.push(u);return u};URL.revokeObjectURL=u=>{window.__revoked.push(u);return r(u)};
const md=navigator.mediaDevices;if(md&&md.getUserMedia){const g=md.getUserMedia.bind(md);md.getUserMedia=async x=>{const s=await g(x);window.__streams.push(s);return s}}})();
"""


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (" -- " + str(extra) if (extra != "" and not cond) else ""))


# ----------------------------------------------------------------------------- DXF helpers
def read_dxf(path):
    doc = ezdxf.readfile(path)
    aud = doc.audit()
    assert not aud.errors, aud.errors
    _, aud2 = recover.readfile(path)
    assert not aud2.errors, aud2.errors
    return doc


def ents(doc):
    out = []
    for e in doc.modelspace():
        assert e.dxftype() == "LWPOLYLINE", e.dxftype()
        out.append({"layer": e.dxf.layer, "closed": bool(e.closed), "pts": [(float(x), float(y)) for x, y in e.get_points("xy")]})
    return out


def pip(x, y, q):
    c = False
    j = len(q) - 1
    for i in range(len(q)):
        xi, yi = q[i]; xj, yj = q[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def area(q):
    return abs(sum(q[i][0] * q[(i + 1) % len(q)][1] - q[(i + 1) % len(q)][0] * q[i][1] for i in range(len(q)))) / 2


def contains(a, b):
    return area(a) > area(b) and sum(pip(x, y, a) for x, y in b) * 2 > len(b)


def depths(rings):
    return [sum(1 for j, r in enumerate(rings) if j != i and contains(r, q)) for i, q in enumerate(rings)]


def plen(q, closed=False):
    pts = q + [q[0]] if closed else q
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def travel(es):
    pos = (0.0, 0.0); t = 0.0
    for e in es:
        t += math.dist(pos, e["pts"][0]); pos = e["pts"][0] if e["closed"] else e["pts"][-1]
    return t


def extents(es):
    xs = [x for e in es for x, y in e["pts"]]; ys = [y for e in es for x, y in e["pts"]]
    return min(xs), max(xs), min(ys), max(ys)


# ----------------------------------------------------------------------------- page helpers
class Ctx:
    def __init__(self, browser, vp, scheme):
        self.vp, self.scheme, self.mobile = vp, scheme, vp == "iphone"
        self.tag = f"{vp}-{scheme}"
        opts = dict(accept_downloads=True, permissions=["camera"], color_scheme=scheme)
        if self.mobile:
            opts.update(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mobile/15E148 Safari/604.1")
        else:
            opts.update(viewport={"width": 1400, "height": 900})
        self.ctx = browser.new_context(**opts)
        self.ctx.add_init_script("try{localStorage.setItem('i2d.unit','mm')}catch(e){}")   # legacy checks start in mm (default is inches: tests/test_web_size.py)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        self.ctx.add_init_script(INIT)
        self.cdp = self.ctx.new_cdp_session(self.page) if self.mobile else None
        self.n = 0

    def ok(self, name, cond, extra=""):
        check(f"[{self.tag}] {name}", cond, extra)

    def fresh(self, img=NESTED):
        p = self.page
        p.goto(URL); p.evaluate("__i2d.tab('all')")
        p.set_input_files("#fileIn", img)
        p.wait_for_function("document.querySelectorAll('#list li[data-id]').length>0", timeout=15000)
        # legacy feature checks assume frame-based sizing (100 mm = whole image width); shape-based sizing is tested in test_web_size.py
        p.select_option("#sizeRef", "image"); p.fill("#width", "100"); p.wait_for_timeout(500)

    def st(self, js):
        return self.page.evaluate(f"(()=>{{const S=__i2d.S;return {js}}})()")

    def settle(self, ms=550):
        self.page.wait_for_timeout(ms)

    def num(self, sel, v):
        self.page.fill(sel, str(v)); self.settle(300)

    def download(self, click="#download"):
        with self.page.expect_download() as d:
            self.page.click(click)
        p = os.path.join(TMP, f"{self.tag}-{self.n}-" + d.value.suggested_filename); self.n += 1
        d.value.save_as(p)
        return p

    def export(self):
        return ents(read_dxf(self.download()))

    def export_doc(self):
        return read_dxf(self.download())

    def view(self):                    # bring the preview into view, return svg bbox
        self.page.evaluate("document.getElementById('stage').scrollIntoView({block:'center'})")
        self.page.wait_for_timeout(150)
        return self.page.locator("#svg").bounding_box()

    def c(self, x, y):                  # image px -> client coordinates
        b = self.view(); W, H = self.st("[S.W,S.H]")
        return b["x"] + x / W * b["width"], b["y"] + y / H * b["height"]

    def drag(self, p0, p1, steps=8):
        if not self.mobile:
            m = self.page.mouse; m.move(*p0); m.down(); m.move(*p1, steps=steps); m.up(); return
        send = lambda t, pts: self.cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": pts})
        send("touchStart", [{"x": p0[0], "y": p0[1]}])
        for k in range(1, steps + 1):
            send("touchMove", [{"x": p0[0] + (p1[0] - p0[0]) * k / steps, "y": p0[1] + (p1[1] - p0[1]) * k / steps}])
        send("touchEnd", [])
        self.page.wait_for_timeout(80)

    def drag_img(self, a, b):
        self.drag(self.c(*a), self.c(*b))

    def tool(self, t):
        self.page.check(f"input[name=tool][value={t}]")

    def shot(self, name, section=None, full=False):
        if not SHOTS:
            return
        os.makedirs(SHOTS, exist_ok=True)
        if section:
            self.page.evaluate(f"document.getElementById('{section}').scrollIntoView({{block:'start'}})")
        else:
            self.view()
        self.page.wait_for_timeout(200)
        self.page.screenshot(path=os.path.join(SHOTS, f"{self.tag}-{name}.png"), full_page=full)

    def shot_stage(self, name):        # preview + panel context
        self.shot(name)


def item_id(c, x0, y0):
    return c.st(f"S.items.find(i=>Math.abs(i.bbox[0]-{x0})<2&&Math.abs(i.bbox[1]-{y0})<2).id")


# ----------------------------------------------------------------------------- features
def t_clear(c):
    p = c.page
    c.fresh()
    c.ok("nested image traces 13 contours", p.locator("#list li[data-id]").count() == 13, p.locator("#list li[data-id]").count())
    c.shot("1-loaded")
    # build up state in every area that Clear must reset
    p.click("#zoneAdd"); p.check("#gridOn"); p.click("#allCells"); p.click("#selNone"); p.click("#selAll")
    p.click("#list li[data-id='0'] button.tabbtn")
    p.click("#cropDraw"); c.drag_img((30, 330), (330, 590)); p.click("#cropApply"); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')")
    c.ok("crop applied before clear", c.st("!!S.crop"))
    p.click("#zoneAdd"); p.click("#allCells")
    c.download()                                       # creates a download object URL
    p.click("#srcTabs button[data-tab=cam]"); p.click("#camStart"); p.wait_for_function("!document.getElementById('camShot').disabled", timeout=8000)
    c.ok("camera running", p.evaluate("window.__streams.length>0 && window.__streams[0].getTracks().every(t=>t.readyState==='live')"))
    created_before = p.evaluate("window.__created.length")
    p.click("#clearImg")
    s = c.st("({paths:S.paths.length,items:S.items.length,sel:S.selected.size,cells:S.cells.size,areas:S.areas.length,zones:S.zones.length,crop:S.crop,cropSel:S.cropSel,"
             "tabbed:S.tabbed.size,gray:!!S.gray,full:!!S.fullGray,img:S.imgURL,id:S.id,W:S.W,H:S.H,grid:document.getElementById('gridOn').checked,mask:!!S.mask})")
    c.ok("Clear resets contours/selection/cells/areas/zones/crop/tabs/image", s["paths"] == 0 and s["items"] == 0 and s["sel"] == 0 and s["cells"] == 0 and s["areas"] == 0
         and s["zones"] == 0 and s["crop"] is None and s["cropSel"] is None and s["tabbed"] == 0 and not s["gray"] and not s["full"] and s["img"] is None and s["W"] == 0 and not s["mask"], s)
    c.ok("Clear switches the grid off", not s["grid"])
    c.ok("list empty, svg hidden, placeholder shown", p.locator("#list li").count() == 0 and not p.is_visible("#svg") and p.is_visible("#empty"))
    c.ok("Clear/Download disabled again, zone list reset", p.is_disabled("#clearImg") and p.is_disabled("#download") and "No zones" in p.inner_text("#zoneList"))
    c.ok("size readout cleared", "load an image" in p.inner_text("#sizeOut").lower())
    unrevoked = p.evaluate("window.__created.filter(u=>!window.__revoked.includes(u))")
    c.ok("all object URLs (image, crop, download) revoked", created_before >= 3 and not unrevoked, unrevoked)
    c.ok("camera stopped on Clear", p.evaluate("window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended')) && document.getElementById('video').srcObject===null") and p.is_disabled("#camShot"))
    p.click("#srcTabs button[data-tab=file]")
    c.shot("2-cleared")
    p.set_input_files("#fileIn", NESTED); p.wait_for_function("document.querySelectorAll('#list li[data-id]').length>0")
    c.ok("same file can be loaded again after Clear", p.locator("#list li[data-id]").count() == 13)


def t_order(c):
    p = c.page
    c.fresh()
    base = c.export()
    rings = [e["pts"] for e in base]
    dep = depths(rings)
    c.ok("baseline: 13 closed LWPOLYLINEs, max nesting depth 3", len(base) == 13 and all(e["closed"] for e in base) and max(dep) == 3, (len(base), max(dep)))
    # violations: an outer entity written BEFORE an entity it contains
    def bad(es):
        n = 0
        for i, a in enumerate(es):
            for j, b in enumerate(es):
                if i < j and contains(a["pts"], b["pts"]):
                    n += 1
        return n
    c.ok("baseline order is not inside-first (outer before inner exists)", bad(base) > 0, bad(base))
    p.check("#insideFirst"); c.settle(200)
    c.ok("UI mentions inside-first order", "inner contours first" in p.inner_text("#orderNote") and "entity order" in p.inner_text("#orderNote"), p.inner_text("#orderNote"))
    es = c.export(); dd = depths([e["pts"] for e in es])
    c.ok("inside first: no outer contour precedes a contour it contains", bad(es) == 0, bad(es))
    c.ok("inside first: nesting depth non-increasing (3,2,1,0) in entity order", all(dd[i] >= dd[i + 1] for i in range(len(dd) - 1)) and dd[0] == 3 and dd[-1] == 0, dd)
    c.ok("inside first: audit clean, 13 closed on CUT", len(es) == 13 and all(e["closed"] and e["layer"] == "CUT" for e in es))
    t0 = travel(es)
    p.check("#nearest"); c.settle(200)
    es2 = c.export(); dd2 = depths([e["pts"] for e in es2])
    c.ok("nearest-neighbour keeps inner-before-outer (depth non-increasing)", bad(es2) == 0 and all(dd2[i] >= dd2[i + 1] for i in range(len(dd2) - 1)), dd2)
    c.ok("nearest-neighbour does not increase travel", travel(es2) <= t0 + 1e-6, (travel(es2), t0))
    p.check("#ioLayers"); c.settle(200)
    es3 = c.export(); dd3 = depths([e["pts"] for e in es3])
    c.ok("layers CUT_INNER / CUT_OUTER: inner iff nested, inner entities all first",
         {e["layer"] for e in es3} == {"CUT_INNER", "CUT_OUTER"} and all((e["layer"] == "CUT_INNER") == (d > 0) for e, d in zip(es3, dd3))
         and [e["layer"] for e in es3] == sorted([e["layer"] for e in es3], key=lambda l: l != "CUT_INNER"))
    p.uncheck("#ioLayers"); p.check("#showOrder"); c.settle(200)
    c.ok("cut order numbers shown in preview (13)", p.locator("svg text.ord").count() == 13, p.locator("svg text.ord").count())
    c.shot("3-cut-inside-first-order")
    p.select_option("#split", "layers"); p.select_option("#groupBy", "contour"); c.settle(150)
    es4 = c.export(); dd4 = depths([e["pts"] for e in es4])
    c.ok("order kept with layer-per-contour split", len(es4) == 13 and all(dd4[i] >= dd4[i + 1] for i in range(len(dd4) - 1)), dd4)
    p.select_option("#split", "files"); c.settle(150)
    z = zipfile.ZipFile(c.download()); c.ok("order option compatible with zip split", len(z.namelist()) == 13 and z.testzip() is None)
    p.select_option("#split", "none")


def t_tabs(c):
    p = c.page
    c.fresh()
    p.select_option("#unit", "in"); c.num("#width", 8)               # 8 in wide -> 0.01 in/px
    c.ok("8 in x 6 in readout", "8.000 × 6.000 in" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    D = item_id(c, 60, 360)                                           # big plain rectangle 240x200 px = 2.4 x 2.0 in
    p.click("#selNone"); p.click(f"#list li[data-id='{D}']")
    ref = c.export()
    P = plen(ref[0]["pts"], True)
    c.ok("reference rectangle perimeter 8.84 in (2.41 x 2.01)", len(ref) == 1 and abs(P - 8.84) < 0.01, P)
    c.num("#tabW", 0.05); c.num("#tabN", 4)
    p.click(f"#list li[data-id='{D}'] button.tabbtn"); c.settle(150)
    c.ok("tab mark shown on list button and tab note", p.get_attribute(f"#list li[data-id='{D}'] button.tabbtn", "aria-pressed") == "true" and "4 tab" in p.inner_text("#tabNote"), p.inner_text("#tabNote"))
    c.ok("preview shows 4 tab gaps", p.locator("svg polyline.tabgap").count() == 4, p.locator("svg polyline.tabgap").count())
    c.shot("4-tabs-preview")
    es = c.export(); opn = [e for e in es if not e["closed"]]
    c.ok("per-contour tabs: 4 open polylines, no closed entity", len(opn) == 4 and len(es) == 4, (len(opn), len(es)))
    tot = sum(plen(e["pts"]) for e in opn)
    c.ok("open polylines are the perimeter minus 4 gaps of 0.05 in", abs(tot - (P - 4 * 0.05)) < 1e-3, (tot, P - 0.2))
    starts = [e["pts"][0] for e in opn]; ends = [e["pts"][-1] for e in opn]
    gaps = sorted(min(math.dist(en, s) for s in starts if s != en) for en in ends)
    c.ok("gap lengths = 0.05 in (chord between consecutive polyline ends)", len(gaps) == 4 and all(abs(g - 0.05) < 1e-3 for g in gaps), gaps)
    c.ok("coordinates in inches (rectangle spans 0.6..3.01 in x)", abs(min(x for e in es for x, y in e["pts"]) - 0.6) < 1e-3 and abs(max(x for e in es for x, y in e["pts"]) - 3.01) < 1e-3)
    # spacing mode
    p.select_option("#tabMode", "spacing"); c.num("#tabS", 1.5)
    es = c.export(); c.ok("tabs by spacing 1.5 in -> round(8.8/1.5)=6 open polylines", len(es) == 6 and all(not e["closed"] for e in es), len(es))
    p.select_option("#tabMode", "count"); c.num("#tabN", 3)
    es = c.export(); c.ok("3 tabs per contour", len(es) == 3, len(es))
    c.num("#tabN", 4)
    # tabs on selected button, then clear marks
    p.click("#tabsClear"); c.settle(100)
    c.ok("Clear tab marks removes tabs", len(c.export()) == 1 and p.locator("svg polyline.tabgap").count() == 0)
    p.click("#selAll"); p.click("#tabsSel"); c.settle(150)
    c.ok("'Add tabs to selected' marks all selected", c.st("S.tabbed.size") == 13)
    es = c.export(); st = p.evaluate("window.__lastExport.stats")
    holes = c.st("S.items.filter(i=>i.hole).length")
    closed = [e for e in es if e["closed"]]; opn = [e for e in es if not e["closed"]]
    c.ok("tabs on selected, holes skipped: holes stay closed, outers are split", len(closed) == holes - 0 and len(opn) == st["tabs"] and st["tabbed"] == 13 - holes, (len(closed), holes, len(opn), st))
    p.click("#tabsClear")
    # global: all outer cuts
    p.check("#tabsAll"); p.check("#insideFirst"); p.check("#ioLayers"); c.settle(200)
    es = c.export(); st = p.evaluate("window.__lastExport.stats")
    closed = [e for e in es if e["closed"]]; opn = [e for e in es if not e["closed"]]
    c.ok("tabs on all outer cuts: only the 6 hole contours stay closed", len(closed) == holes and len(opn) == st["tabs"] > 0 and st["tabSkipped"] + st["tabbed"] == 13 - holes, (len(closed), len(opn), st))
    c.ok("preview tab gaps == tabs written", p.locator("svg polyline.tabgap").count() == st["tabs"], (p.locator("svg polyline.tabgap").count(), st["tabs"]))
    lay = [e["layer"] for e in es]
    c.ok("tabs + inside-first + layers: all CUT_INNER entities precede CUT_OUTER", lay == sorted(lay, key=lambda l: l != "CUT_INNER") and "CUT_INNER" in lay and "CUT_OUTER" in lay, lay)
    p.uncheck("#ioLayers")
    # no tabs on tiny contours: width bigger than contour/3
    c.num("#tabW", 5); es = c.export(); st = p.evaluate("window.__lastExport.stats")
    c.ok("tab wider than contour/3 -> contour left closed (reported)", st["tabSkipped"] == 7 and all(e["closed"] for e in es), st)
    c.num("#tabW", 0.05)
    # clip compatibility: grid cell R2C1 (x 0..400px, y 300..600px)
    p.check("#gridOn"); p.fill("#rows", "2"); p.fill("#cols", "2"); p.dispatch_event("#cols", "input")
    p.check("input[name=tool][value=cell]"); x, y = c.c(200, 450)
    if c.mobile:
        c.drag((x, y), (x, y), steps=1)
    else:
        p.mouse.click(x, y)
    p.check("#clip"); c.settle(200)
    es = c.export(); mx = max(x for e in es for x, _ in e["pts"])
    c.ok("tabs applied after clipping (clip to cell, x<=4 in, open polylines present)", mx <= 4.0001 and any(not e["closed"] for e in es) and len(es) > 0, (mx, len(es)))
    c.ok("preview tab gaps follow the clipped contours", p.locator("svg polyline.tabgap").count() == p.evaluate("window.__lastExport.stats.tabs"))
    p.uncheck("#clip"); p.click("#clearAreas"); p.uncheck("#gridOn"); p.check("input[name=tool][value=contour]")
    # split files compatibility
    p.select_option("#split", "files"); p.select_option("#groupBy", "contour"); c.settle(150)
    zp = c.download(); z = zipfile.ZipFile(zp); opens = 0
    for nme in z.namelist():
        f = os.path.join(TMP, f"{c.tag}-z-" + nme); open(f, "wb").write(z.read(nme)); opens += sum(1 for e in ents(read_dxf(f)) if not e["closed"])
    c.ok("tabs compatible with zip split (each file audit-clean; open polylines inside)", len(z.namelist()) == 13 and opens == p.evaluate("window.__lastExport.stats.tabs"), (len(z.namelist()), opens))
    p.select_option("#split", "none")


def t_zones(c):
    p = c.page
    c.fresh()
    C = item_id(c, 640, 60)
    c.ok("zone tool draw: nothing before", c.st("S.zones.length") == 0)
    c.tool("zone")
    c.drag_img((610, 30), (790, 190)); c.settle(100)
    c.ok("drag on canvas creates a listed zone", c.st("S.zones.length") == 1 and p.locator("#zoneList .zone-item").count() == 1)
    z = c.st("S.zones[0].rect"); c.ok("zone rect ~ dragged rect", abs(z[0] - 610) < 8 and abs(z[1] - 30) < 8 and abs(z[2] - 790) < 8 and abs(z[3] - 190) < 8, z)
    c.ok("zone lists its contour count (1)", "1 contour" in p.inner_text("#zoneList"), p.inner_text("#zoneList"))
    c.shot("5-zone-drawn")
    # move by drag and drop of the zone body
    a = c.c((z[0] + z[2]) / 2, (z[1] + z[3]) / 2); W = c.st("S.W"); bw = c.view()["width"]
    dx_img = -60; dy_img = 40
    c.drag(a, (a[0] + dx_img / W * bw, a[1] + dy_img / W * bw))
    z2 = c.st("S.zones[0].rect")
    c.ok("drag and drop moves the zone (size unchanged)", abs((z2[0] - z[0]) - dx_img) < 6 and abs((z2[1] - z[1]) - dy_img) < 6 and abs((z2[2] - z2[0]) - (z[2] - z[0])) < 1.5, (z, z2))
    # back
    a = c.c((z2[0] + z2[2]) / 2, (z2[1] + z2[3]) / 2); c.drag(a, (a[0] - dx_img / W * bw, a[1] - dy_img / W * bw))
    z3 = c.st("S.zones[0].rect")
    # resize via the SE handle
    h = c.view() and p.locator("svg rect.zh[data-h=se]").bounding_box()
    hx, hy = h["x"] + h["width"] / 2, h["y"] + h["height"] / 2
    c.drag((hx, hy), (hx - 30 / W * bw, hy - 20 / W * bw))
    z4 = c.st("S.zones[0].rect")
    c.ok("dragging the SE handle resizes the zone", abs((z4[2] - z3[2]) + 30) < 8 and abs((z4[3] - z3[3]) + 20) < 8 and abs(z4[0] - z3[0]) < 2, (z3, z4))
    # restore a rect around C again
    c.drag(c.c(z4[2], z4[3]), c.c(790, 190))
    z5 = c.st("S.zones[0].rect")
    c.ok("zone covers rectangle C again", z5[0] <= 640 and z5[2] >= 760 and z5[1] <= 60 and z5[3] >= 160, z5)
    # zone off -> excluded from export
    p.click("#zoneList input[data-act=toggle]"); c.settle(100)
    c.ok("zone off: note says excluded, list marks contour", "excluded by zones" in p.inner_text("#exportNote") and "zone off" in p.inner_text(f"#list li[data-id='{C}']"), p.inner_text("#exportNote"))
    c.shot("6-zone-off-excluded")
    es = c.export()
    cx0, cx1 = 640 * SCALE_MM, 760 * SCALE_MM
    c.ok("export excludes the contour inside a disabled zone (12 of 13, none at C)", len(es) == 12 and not any(min(x for x, _ in e["pts"]) > cx0 - 0.5 and max(x for x, _ in e["pts"]) < cx1 + 0.5 and min(y for _, y in e["pts"]) > (600 - 160) * SCALE_MM - 0.5 and max(y for _, y in e["pts"]) < (600 - 60) * SCALE_MM + 0.5 for e in es), len(es))
    p.click("#zoneList input[data-act=toggle]"); c.settle(100)
    c.ok("zone on again: 13 exported", len(c.export()) == 13)
    # bulk buttons
    p.click("#zoneList button[data-act=off]"); c.settle(100)
    c.ok("Disable all: contour deselected", C not in c.st("[...S.selected]") and c.st("S.selected.size") == 12)
    p.click("#zoneList button[data-act=inv]"); c.settle(100)
    c.ok("Invert: contour selected again", C in c.st("[...S.selected]"))
    p.click("#zoneList button[data-act=inv]"); c.settle(100)
    p.click("#zoneList input[data-act=toggle]")                      # zone off + contour deselected
    p.click("#zoneList button[data-act=on]"); c.settle(100)
    c.ok("Enable all: contour selected and zone switched on", C in c.st("[...S.selected]") and c.st("S.zones[0].on") is True)
    p.click("#zoneList button[data-act=del]"); c.settle(100)
    c.ok("Delete removes the zone", c.st("S.zones.length") == 0)
    # centre bulk selection: zone around ring B's centre (inside the hole), contains the centroid/bbox-centre of ring contours only
    c.drag_img((455, 115), (545, 205)); c.settle(100)
    exp = c.st("S.items.filter(i=>{const r=S.zones[0].rect,f=(x,y)=>x>=r[0]&&x<=r[2]&&y>=r[1]&&y<=r[3];return f(i.cx,i.cy)||f(i.bcx,i.bcy)}).map(i=>i.id)")
    c.ok("centre-in-zone rule: ring + its hole count as inside a zone that only covers the hole's interior", len(exp) == 2 and f"{len(exp)} contour" in p.inner_text("#zoneList"), (exp, p.inner_text("#zoneList")))
    p.click("#zoneList button[data-act=off]"); c.settle(100)
    es = c.export(); c.ok("Disable all (centre bulk) -> 11 contours exported", len(es) == 11, len(es))
    p.click("#zoneAdd"); c.ok("Add zone button adds a second zone", c.st("S.zones.length") == 2)
    p.click("#zoneClear"); c.settle(100)
    c.ok("Clear all zones", c.st("S.zones.length") == 0 and "No zones" in p.inner_text("#zoneList"))
    # keyboard delete
    c.drag_img((600, 300), (700, 400)); c.ok("zone drawn for key-delete", c.st("S.zones.length") == 1)
    if not c.mobile:
        p.keyboard.press("Delete"); c.ok("Delete key removes selected zone", c.st("S.zones.length") == 0)
    else:
        p.click("#zoneClear")


def t_crop(c):
    p = c.page
    c.fresh()
    c.ok("Focus disabled before drawing, Reset disabled", p.is_disabled("#cropApply") and p.is_disabled("#cropReset"))
    p.click("#cropDraw")
    c.drag_img((40, 340), (320, 580)); c.settle(100)
    c.ok("crop rectangle drawn (pending), Focus enabled", c.st("!!S.cropSel") and not p.is_disabled("#cropApply") and p.locator("svg rect.cropsel").count() == 1)
    c.shot("7-crop-selection")
    p.click("#cropApply"); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')")
    cr = c.st("S.crop"); W, H = c.st("[S.W,S.H]")
    c.ok("source pixels cropped before tracing (size == crop rect)", cr and W == cr[2] - cr[0] and H == cr[3] - cr[1] and W < 800 and abs(cr[0] - 40) < 8, (cr, W, H))
    c.ok("only the shape inside the crop is traced (1 contour)", p.locator("#list li[data-id]").count() == 1 and not p.is_disabled("#cropReset"), p.locator("#list li[data-id]").count())
    c.ok("crop resets zones/areas/cells; preview shows the cropped image", c.st("S.zones.length+S.areas.length+S.cells.size") == 0)
    c.shot("8-crop-focused")
    c.ok("'full original image' reference becomes available after crop", p.is_visible("#rowRef") and not p.eval_on_selector("#sizeRef option[value=full]", "o=>o.disabled"))
    p.select_option("#sizeRef", "full"); c.num("#width", 100)
    # scale preserved: width 100 mm refers to the 800 px image -> 0.125 mm/px
    es = c.export(); x0, x1, y0, y1 = extents(es)
    ex = ((60 - cr[0]) * SCALE_MM, (301 - cr[0]) * SCALE_MM, (H - (561 - cr[1])) * SCALE_MM, (H - (360 - cr[1])) * SCALE_MM)
    c.ok("DXF: origin at crop corner, scale preserved (rect 30 x 25 mm at crop offset)", all(abs(a - b) < 1e-3 for a, b in zip((x0, x1, y0, y1), ex)), ((x0, x1, y0, y1), ex))
    c.ok("output size readout is the crop (not the full image)", abs(float(p.get_attribute("#sizeOut", "data-fw")) - W * SCALE_MM) < 1e-3, p.inner_text("#sizeOut"))
    # width refers to the crop
    p.select_option("#sizeRef", "image"); c.num("#width", 100); c.settle(300)
    es = c.export(); x0, x1, y0, y1 = extents(es); k = 100 / W
    c.ok("width setting refers to the crop: crop is 100 mm wide", abs(float(p.get_attribute("#sizeOut", "data-fw")) - 100) < 1e-3 and abs(x1 - (301 - cr[0]) * k) < 1e-3 and abs(x0 - (60 - cr[0]) * k) < 1e-3, (x0, x1))
    p.select_option("#sizeRef", "full"); c.num("#width", 100)
    # crop again (nested) inside the focused view, then reset
    p.click("#cropDraw"); c.drag_img((20, 20), (W * 0.6, H * 0.6)); p.click("#cropApply"); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')")
    cr2 = c.st("S.crop"); c.ok("second crop narrows further (full-image coordinates kept)", cr2[0] >= cr[0] and cr2[2] < cr[2] and cr2[1] >= cr[1], (cr, cr2))
    p.click("#cropReset"); p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')")
    c.ok("Reset crop restores the full image and its 13 contours", c.st("S.crop") is None and c.st("S.W") == 800 and p.locator("#list li[data-id]").count() == 13 and p.is_disabled("#cropReset") and p.eval_on_selector("#sizeRef option[value=full]", "o=>o.disabled"))
    p.select_option("#sizeRef", "image"); c.num("#width", 100)
    es = c.export(); x0, x1, y0, y1 = extents(es)
    c.ok("after reset the DXF origin is the image corner again", abs(x0 - 40 * SCALE_MM) < 1e-3 and abs(x1 - 761 * SCALE_MM) < 1e-3)


def t_inches(c):
    p = c.page
    c.fresh()
    ext = c.st("(()=>{let a=1e9,b=-1e9,y0=1e9,y1=-1e9;S.paths.forEach(q=>q.forEach(([x,y])=>{a=Math.min(a,x);b=Math.max(b,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}));return [a,b,y0,y1]})()")
    px0, px1, py0, py1 = ext
    c.ok("percent / PPI rows hidden while size is set by width", not p.is_visible("#rowPct") and not p.is_visible("#rowDpi"))
    p.select_option("#unit", "in")
    c.ok("units selector converts 100 mm to 3.937 in", abs(float(p.input_value("#width")) - 3.937) < 0.002, p.input_value("#width"))
    c.num("#width", 8)
    c.ok("live readout 8.000 × 6.000 in (203.20 × 152.40 mm)", "8.000 × 6.000 in" in p.inner_text("#sizeOut") and "203.20 × 152.40 mm" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    c.ok("height field follows (lock aspect), editable", abs(float(p.input_value("#height")) - 6) < 1e-6 and p.get_attribute("#height", "readonly") is None)   # no read-only trap: typing in Height takes over
    c.shot("9-size-inches")
    doc = c.export_doc(); es = ents(doc); x0, x1, y0, y1 = extents(es)
    k = 8 / 800
    c.ok("DXF $INSUNITS=1 (inches), coordinates are inches", doc.units == 1 and abs(x0 - px0 * k) < 1e-3 and abs(x1 - px1 * k) < 1e-3 and abs(y0 - (600 - py1) * k) < 1e-3 and abs(y1 - (600 - py0) * k) < 1e-3, (doc.units, (x0, x1, y0, y1)))
    # by height
    p.select_option("#sizeBy", "height"); c.num("#height", 3)
    c.ok("size by height 3 in -> width 4 in (locked)", abs(float(p.input_value("#width")) - 4) < 1e-6 and "4.000 × 3.000 in" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    es = c.export(); c.ok("height-driven DXF: x max matches 4 in scale", abs(extents(es)[1] - px1 * 4 / 800) < 1e-3)
    # unlock aspect: width 4, height 6 (non uniform)
    p.uncheck("#lock"); p.select_option("#sizeBy", "width"); c.num("#width", 4); c.num("#height", 6)
    c.ok("unlocked: independent width/height (4 x 6 in)", "4.000 × 6.000 in" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    es = c.export(); x0, x1, y0, y1 = extents(es)
    c.ok("unlocked DXF: x scale 4/800, y scale 6/600", abs(x1 - px1 * 4 / 800) < 1e-3 and abs((y1 - y0) - (py1 - py0) * 6 / 600) < 1e-3, (x1, y1 - y0))
    p.check("#lock"); c.num("#width", 4)
    # percent
    p.select_option("#sizeBy", "percent"); c.num("#pct", 50)
    c.ok("scale 50 % = 800px/96*0.5 = 4.167 in wide", "4.167 × 3.125 in" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    es = c.export(); c.ok("percent DXF extents in inches", abs(extents(es)[1] - px1 * 0.5 / 96) < 1e-3)
    # PPI
    p.select_option("#sizeBy", "dpi"); c.num("#dpi", 200)
    c.ok("200 PPI -> 4.000 × 3.000 in", "4.000 × 3.000 in" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    doc = c.export_doc(); es = ents(doc)
    c.ok("PPI DXF: inches, x max = px/200", doc.units == 1 and abs(extents(es)[1] - px1 / 200) < 1e-3)
    # back to mm keeps the physical size; INSUNITS 4
    p.select_option("#unit", "mm"); c.settle(500)
    c.ok("switch to mm keeps 200 PPI -> 101.60 × 76.20 mm", "101.60 × 76.20 mm" in p.inner_text("#sizeOut"), p.inner_text("#sizeOut"))
    doc = c.export_doc(); es = ents(doc)
    c.ok("mm DXF: $INSUNITS=4, coordinates in mm", doc.units == 4 and abs(extents(es)[1] - px1 * 25.4 / 200) < 1e-3, (doc.units, extents(es)))
    p.select_option("#sizeBy", "width"); c.num("#width", 100)
    c.ok("readout in mm mode shows both units", "3.937 × 2.953 in" in p.inner_text("#sizeOut"))


def touch_audit(c):
    p = c.page
    c.fresh()
    p.evaluate("document.querySelector('#s-zones').scrollIntoView()")
    bad = p.evaluate("""()=>{const out=[];document.querySelectorAll('button,select,input:not([hidden]):not([type=hidden]),label.drop,label.row').forEach(e=>{const r=e.getBoundingClientRect(); if(!r.width||!r.height||e.closest('[hidden]'))return; const cs=getComputedStyle(e); if(cs.visibility==='hidden')return;
      const tgt=(e.type==='checkbox'||e.type==='radio')?(e.closest('label')||e.closest('li')||e):e; const t=tgt.getBoundingClientRect();
      if(t.height<43.5||t.width<43.5&&!(e.type==='checkbox'||e.type==='radio')) out.push([e.tagName,e.id||e.textContent.trim().slice(0,20),Math.round(t.width),Math.round(t.height)]);
      if(/INPUT|SELECT/.test(e.tagName)&&!['checkbox','radio','range'].includes(e.type)&&parseFloat(cs.fontSize)<16) out.push(['font',e.id,cs.fontSize]);}); return out;}""")
    c.ok("iPhone: touch targets >= 44px and inputs >= 16px (incl. new controls)", not bad, bad)
    c.ok("iPhone: no horizontal overflow", p.evaluate("document.documentElement.scrollWidth<=window.innerWidth"), p.evaluate("document.documentElement.scrollWidth"))
    p.click("#zoneAdd")
    c.ok("iPhone: zone buttons visible", p.is_visible("#zoneList button[data-act=off]"))
    c.shot("10-iphone-zones-panel", section="s-zones")
    c.shot("11-iphone-cut-panel", section="s-cut")
    c.shot("12-iphone-size-panel", section="s-size")


def scheme_check(c):
    p = c.page
    bg = p.evaluate("getComputedStyle(document.body).backgroundColor")
    c.ok("colour scheme honoured", bg == ("rgb(11, 15, 23)" if c.scheme == "dark" else "rgb(243, 244, 246)"), bg)


def main():
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True, args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--no-sandbox"])
        only = os.environ.get("ONLY")
        for vp in ("desktop", "iphone"):
            for scheme in ("light", "dark"):
                c = Ctx(b, vp, scheme)
                print(f"=== {c.tag} {URL}")
                c.fresh(); scheme_check(c)
                for fn in (t_clear, t_order, t_tabs, t_zones, t_crop, t_inches) + ((touch_audit,) if c.mobile else ()):
                    if only and only not in fn.__name__:
                        continue
                    try:
                        fn(c)
                    except Exception as e:                              # report, keep going
                        import traceback; traceback.print_exc()
                        check(f"[{c.tag}] {fn.__name__} completed", False, repr(e)[:300])
                check(f"[{c.tag}] no JS errors", not c.errors, c.errors[:3])
                c.ctx.close()
        b.close()
    shutil.rmtree(TMP, ignore_errors=True)
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
