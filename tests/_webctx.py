"""Shared helpers for the browser tests: 4 contexts (desktop / iPhone 390x844 touch) x (light / dark), DXF readers, touch drags."""
import os, tempfile, zipfile
import ezdxf
from ezdxf import recover
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get("WEB_URL") or "file://" + os.path.abspath(os.path.join(HERE, "..", "docs", "index.html"))
CHROME = next((p for p in ("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser") if os.path.exists(p)), None)
results = []
TMP = tempfile.mkdtemp()
CONFIGS = [("desktop-light", False, "light"), ("desktop-dark", False, "dark"), ("iphone-light", True, "light"), ("iphone-dark", True, "dark")]


def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + (" -- " + str(extra) if (extra != "" and not cond) else ""), flush=True)


def read_dxf(path):
    doc = ezdxf.readfile(path)
    aud = doc.audit()
    assert not aud.errors, aud.errors
    recover.readfile(path)
    return doc


def polys(doc, layer=None):
    out = []
    for e in doc.modelspace():
        if e.dxftype() == "LWPOLYLINE" and (layer is None or e.dxf.layer == layer):
            out.append(([(float(x), float(y)) for x, y in e.get_points("xy")], bool(e.closed), e.dxf.layer))
    return out


def bbox(pl):
    xs = [x for p, _, _ in pl for x, _ in p]; ys = [y for p, _, _ in pl for _, y in p]
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


class Ctx:
    def __init__(self, browser, tag, mobile, scheme):
        self.tag, self.mobile = tag, mobile
        opts = dict(accept_downloads=True, color_scheme=scheme)
        if mobile:
            opts.update(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mobile/15E148 Safari/604.1")
        else:
            opts.update(viewport={"width": 1400, "height": 900})
        self.ctx = browser.new_context(**opts)
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("console", lambda m: self.errors.append(m.text) if m.type == "error" and "Failed to load resource" not in m.text else None)
        self.cdp = self.ctx.new_cdp_session(self.page) if mobile else None
        self.n = 0

    def ok(self, name, cond, extra=""):
        check(f"[{self.tag}] {name}", cond, extra)

    def st(self, js):
        return self.page.evaluate(f"(()=>{{const S=__i2d.S;return {js}}})()")

    def settle(self, ms=450):
        self.page.wait_for_timeout(ms)

    def load(self, img, wait_list=True):
        p = self.page
        p.goto(URL)
        p.evaluate("__i2d.tab('all')")       # Hard 1.5: show every section (classic layout) for the older tests
        p.set_input_files("#fileIn", img)
        p.wait_for_function("document.getElementById('status').textContent.startsWith('Traced')", timeout=20000)
        self.settle(300)

    def num(self, sel, v):
        self.page.fill(sel, str(v)); self.settle(350)

    def count(self):
        return self.page.locator("#list li[data-id]").count()

    def download(self, click="#download"):
        with self.page.expect_download() as d:
            self.page.click(click)
        p = os.path.join(TMP, f"{self.tag}-{self.n}-" + d.value.suggested_filename); self.n += 1
        d.value.save_as(p)
        return p

    def export_doc(self):
        return read_dxf(self.download())

    def export_zip(self):
        p = self.download(); z = zipfile.ZipFile(p); out = {}
        for nme in z.namelist():
            f = os.path.join(TMP, f"{self.tag}-{self.n}-" + nme); self.n += 1
            open(f, "wb").write(z.read(nme)); out[nme] = f
        return out

    def view(self):
        self.page.evaluate("document.getElementById('stage').scrollIntoView({block:'center'})")
        self.page.wait_for_timeout(150)
        return self.page.locator("#svg").bounding_box()

    def c(self, x, y):
        b = self.view(); W, H = self.st("[S.W,S.H]")
        return b["x"] + x / W * b["width"], b["y"] + y / H * b["height"]

    def drag_img(self, a, b, steps=8):
        p0, p1 = self.c(*a), self.c(*b)
        if not self.mobile:
            m = self.page.mouse; m.move(*p0); m.down(); m.move(*p1, steps=steps); m.up(); return
        send = lambda t, pts: self.cdp.send("Input.dispatchTouchEvent", {"type": t, "touchPoints": pts})
        send("touchStart", [{"x": p0[0], "y": p0[1]}])
        for k in range(1, steps + 1):
            send("touchMove", [{"x": p0[0] + (p1[0] - p0[0]) * k / steps, "y": p0[1] + (p1[1] - p0[1]) * k / steps}])
        send("touchEnd", [])
        self.page.wait_for_timeout(120)

    def click_btn(self, sel):                 # scroll into view first (sidebar is long on phones)
        self.page.locator(sel).scroll_into_view_if_needed(); self.page.click(sel)


def run(main_for_ctx, label):
    import sys, shutil
    with sync_playwright() as pw:
        b = pw.chromium.launch(executable_path=CHROME, headless=True)
        for tag, mobile, scheme in CONFIGS:
            c = Ctx(b, tag, mobile, scheme)
            print(f"=== {tag} {URL}", flush=True)
            try:
                main_for_ctx(c)
            except Exception as e:                 # a crash is a failure, but keep running the other contexts
                import traceback; traceback.print_exc(); check(f"[{tag}] test run finished without exception", False, repr(e)[:300])
            c.ok("no JS errors", not c.errors, c.errors)
            c.ctx.close()
        b.close()
    shutil.rmtree(TMP, ignore_errors=True)
    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} passed ({label})")
    sys.exit(1 if bad else 0)
