import io, sys, os, zipfile, socket
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import ezdxf, pytest
import pipeline as pl, selection, urlfetch
from app import app
from make_test_image import make


@pytest.fixture(scope="module")
def png():
    b = io.BytesIO(); make().save(b, "PNG"); return b.getvalue()


@pytest.fixture(scope="module")
def client(png):
    return app.test_client()


@pytest.fixture(scope="module")
def img_id(client, png):
    r = client.post("/api/upload", data={"file": (io.BytesIO(png), "t.png")})
    assert r.status_code == 200
    return r.get_json()["id"]


P = {"width": 200, "unit": "mm", "tolerance": 0.3, "min_feature": 2, "speckle": 20}


def read(data):
    return ezdxf.read(io.StringIO(data.decode()))


def trace(client, img_id, **kw):
    return client.post("/api/trace", json={"id": img_id, "params": {**P, **kw}}).get_json()


def test_pipeline_dxf(png):
    gray = pl.load_image(png)
    p = pl.Params.from_dict(P)
    mask, polys, info = pl.trace(gray, p)
    # rect, circle, triangle, ring outer, ring hole, C, U, T letters (U maybe w/ hole none) => >= 8, speckles gone
    assert 8 <= info["paths"] <= 12, info
    assert sum(m["hole"] for m in info["items"]) >= 1
    doc = read(pl.to_dxf(polys, p))
    ents = list(doc.modelspace())
    assert len(ents) == len(polys)
    assert all(e.dxftype() == "LWPOLYLINE" and e.closed and e.dxf.layer == "CUT" for e in ents)
    assert doc.units == ezdxf.units.MM
    xs = [x for e in ents for x, y in e.get_points("xy")]
    assert 0 <= min(xs) and max(xs) <= 200.0 + 1e-6      # fits requested width
    assert "CUT" in doc.layers


def test_inches_and_invert(png):
    gray = pl.load_image(png)
    p = pl.Params.from_dict({**P, "unit": "in", "width": 8, "tolerance": 0.01, "min_feature": 0.05})
    doc = read(pl.to_dxf(pl.trace(gray, p)[1], p))
    assert doc.units == ezdxf.units.IN
    p2 = pl.Params.from_dict({**P, "invert": True})
    m_inv, m = pl.trace(gray, p2)[0], pl.trace(gray, pl.Params.from_dict(P))[0]
    assert ((m_inv > 0) != (m > 0)).mean() > 0.9 or (m_inv != m).mean() > 0.5  # masks are (near) complements


def test_speckle_and_min_feature(png):
    gray = pl.load_image(png)
    noisy = pl.trace(gray, pl.Params.from_dict({**P, "speckle": 0, "min_feature": 0}))[2]["paths"]
    clean = pl.trace(gray, pl.Params.from_dict(P))[2]["paths"]
    assert noisy > clean + 20


def test_endpoints(client, img_id):
    assert client.get("/api/health").get_json()["ok"]
    assert client.get("/").status_code == 200
    assert client.get(f"/api/image/{img_id}").mimetype == "image/png"
    t = trace(client, img_id)
    assert len(t["paths"]) == t["info"]["paths"] and t["mask"].startswith("data:image/png")
    r = client.post("/api/dxf", json={"id": img_id, "params": P})
    assert r.status_code == 200 and len(list(read(r.data).modelspace())) == t["info"]["paths"]
    assert client.post("/api/dxf", json={"id": "nope", "params": P}).status_code == 400
    assert client.post("/api/upload", data={"file": (io.BytesIO(b"garbage"), "x.png")}).status_code == 400


def test_pdf_first_page(client, png):
    import shutil
    if not shutil.which("pdftoppm"):
        pytest.skip("no pdftoppm")
    from PIL import Image
    b = io.BytesIO(); Image.open(io.BytesIO(png)).save(b, "PDF")
    r = client.post("/api/upload", data={"file": (b.getvalue() and io.BytesIO(b.getvalue()), "s.pdf")})
    assert r.status_code == 200
    assert r.get_json()["width"] > 500


# ------------------------------------------------ selection-limited export
def test_selected_only(client, img_id):
    t = trace(client, img_id)
    n = t["info"]["paths"]
    ids = [0, 1, 2]
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "selected": ids})
    ents = list(read(r.data).modelspace())
    assert len(ents) == 3 < n
    # geometry equals the traced polygons for those ids (px coords -> units)
    scale = 200 / t["info"]["px_w"]; H = t["info"]["px_h"]
    want = sorted(round(min(p[0] for p in t["paths"][i]) * scale, 1) for i in ids)
    got = sorted(round(min(x for x, y in e.get_points("xy")), 1) for e in ents)
    assert want == got
    # invert selection
    rest = [i for i in range(n) if i not in ids]
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "selected": rest})
    assert len(list(read(r.data).modelspace())) == n - 3
    # empty / invalid
    assert client.post("/api/dxf", json={"id": img_id, "params": P, "selected": []}).status_code == 400
    assert client.post("/api/dxf", json={"id": img_id, "params": P, "selected": [9999]}).status_code == 400


def test_region_limit_and_clip(client, img_id):
    t = trace(client, img_id)
    n = t["info"]["paths"]
    top_left = {"rect": [0, 0, 300, 250], "label": "TL"}      # contains only the rectangle (+ nothing else)
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "regions": [top_left]})
    assert len(list(read(r.data).modelspace())) == 1
    # clip: region cuts the circle (x 350-550) in half at x=450
    cut = {"rect": [0, 0, 450, 300], "label": "L"}
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "regions": [cut], "clip": True})
    doc = read(r.data); sc = 200 / 800
    xs = [x for e in doc.modelspace() for x, y in e.get_points("xy")]
    assert max(xs) <= 450 * sc + 1e-6 and all(e.closed for e in doc.modelspace())
    assert len(list(doc.modelspace())) == 2   # rect + half circle
    # without clip the whole circle is kept
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "regions": [cut]})
    xs = [x for e in read(r.data).modelspace() for x, y in e.get_points("xy")]
    assert max(xs) > 450 * sc + 1
    # selection + region combine: deselect everything but the circle
    circle = [i for i, q in enumerate(t["paths"]) if 340 < min(p[0] for p in q) < 360 and min(p[1] for p in q) < 70][0]
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "regions": [cut], "selected": [circle]})
    assert len(list(read(r.data).modelspace())) == 1
    # non-overlapping selection -> error
    assert client.post("/api/dxf", json={"id": img_id, "params": P, "regions": [top_left], "selected": [circle]}).status_code == 400


def test_split_layers_and_files(client, img_id):
    t = trace(client, img_id)
    # per-contour layers for 3 selected contours
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "selected": [0, 2, 4], "split": "layers", "group_by": "contour"})
    doc = read(r.data)
    layers = {e.dxf.layer for e in doc.modelspace()}
    assert layers == {"CUT_000", "CUT_002", "CUT_004"}
    # per-cell layers (2x2 grid cells, whole contours)
    cells = [{"rect": [0, 0, 400, 300], "label": "R1C1"}, {"rect": [400, 0, 800, 300], "label": "R1C2"}]
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "regions": cells, "split": "layers", "group_by": "cell", "clip": True})
    doc = read(r.data)
    assert {e.dxf.layer for e in doc.modelspace()} == {"CUT_R1C1", "CUT_R1C2"}
    # separate files per cell -> zip, each re-opens, origin zeroed
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "regions": cells, "split": "files", "group_by": "cell", "clip": True, "zero_origin": True})
    assert r.mimetype == "application/zip"
    z = zipfile.ZipFile(io.BytesIO(r.data))
    assert sorted(z.namelist()) == ["CUT_R1C1.dxf", "CUT_R1C2.dxf"]
    for nm in z.namelist():
        d = ezdxf.read(io.StringIO(z.read(nm).decode()))
        pts = [pt for e in d.modelspace() for pt in e.get_points("xy")]
        assert pts and abs(min(x for x, _ in pts)) < 1e-6 and abs(min(y for _, y in pts)) < 1e-6
    # separate files per contour
    r = client.post("/api/dxf", json={"id": img_id, "params": P, "selected": [1, 3], "split": "files", "group_by": "contour"})
    assert sorted(zipfile.ZipFile(io.BytesIO(r.data)).namelist()) == ["CUT_001.dxf", "CUT_003.dxf"]
    # group_by cell without regions -> 400
    assert client.post("/api/dxf", json={"id": img_id, "params": P, "split": "layers", "group_by": "cell"}).status_code == 400


# ------------------------------------------------ SSRF
@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.com/x.png", "http://127.0.0.1/x.png", "http://localhost:5000/",
    "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/a.png", "http://192.168.1.1/",
    "http://[::1]/", "http://0.0.0.0/", "http://user:pw@example.com/", "http://2130706433/",
])
def test_ssrf_blocked(client, url):
    r = client.post("/api/fetch", json={"url": url})
    assert r.status_code == 400, url


def test_redirect_to_private_blocked(monkeypatch):
    # public-looking host that redirects to loopback: must be re-validated per hop
    class R:
        status_code = 302; headers = {"Location": "http://127.0.0.1/secret"}
        def __enter__(self): return self
        def __exit__(self, *a): pass
    def fake_check(u):
        if "127.0.0.1" in u:
            raise urlfetch.FetchError("blocked")
        return u
    monkeypatch.setattr(urlfetch, "check_url", fake_check)
    import requests
    monkeypatch.setattr(requests.Session, "get", lambda self, *a, **k: R())
    with pytest.raises(urlfetch.FetchError):
        urlfetch.fetch("http://example.com/x")


def test_fetch_happy_path_and_size_limit(client, png, monkeypatch):
    """Positive path against a local server (guard relaxed only for this test) + size cap."""
    import threading, http.server, functools, tempfile
    d = tempfile.mkdtemp()
    open(d + "/a.png", "wb").write(png)
    open(d + "/big.png", "wb").write(b"0" * (urlfetch.MAX_BYTES + 10))
    h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=d)
    h.log_message = lambda *a: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(urlfetch, "_ip_ok", lambda ip: True)
    try:
        r = client.post("/api/fetch", json={"url": f"http://127.0.0.1:{srv.server_port}/a.png"})
        assert r.status_code == 200 and r.get_json()["width"] == 800
        r = client.post("/api/fetch", json={"url": f"http://127.0.0.1:{srv.server_port}/big.png"})
        assert r.status_code == 400 and "too large" in r.get_json()["error"]
    finally:
        srv.shutdown()
