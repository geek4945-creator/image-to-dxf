"""Hard 1.5 Windows/desktop API: UI routes, history on disk, settings, version, update apply (offline, fake zip)."""
import io, json, os, sys, tempfile, zipfile, shutil
os.environ["I2D_DATA_DIR"] = tempfile.mkdtemp()
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app
import desktop_api as da

c = app.test_client()


def test_ui_routes():
    assert c.get("/").status_code == 200
    assert c.get("/classic/").status_code == 200 and c.get("/classic/app.js").status_code == 200
    assert c.get("/api/health").get_json()["ok"]
    assert c.get("/api/nope").status_code in (404, 405)
    r = c.get("/v1/"); assert r.status_code == 200 and b"<html" in r.data.lower()
    assert c.get("/v1").status_code in (301, 302, 308)


def test_version_and_settings():
    v = c.get("/api/version").get_json()
    assert v["backend"] and v["build"] and v["history_dir"].endswith("history")
    assert c.post("/api/settings", json={"auto_update": True}).get_json()["auto_update"] is True
    assert c.get("/api/version").get_json()["auto_update"] is True
    c.post("/api/settings", json={"auto_update": False})


def test_history_roundtrip():
    r = c.post("/api/history", data={"image": (io.BytesIO(b"PNGDATA"), "a.png"), "meta": json.dumps({"name": "a.png", "thumb": "data:x"})})
    iid = r.get_json()["id"]
    assert [i["id"] for i in c.get("/api/history").get_json()["items"]] == [iid]
    assert c.get(f"/api/history/{iid}/image").data == b"PNGDATA"
    c.put(f"/api/history/{iid}/settings", json={"x": 1})
    assert c.get(f"/api/history/{iid}").get_json()["settings"] == {"x": 1}
    assert c.get("/api/history/..%2F..%2Fx").status_code == 404
    c.delete(f"/api/history/{iid}")
    assert c.get("/api/history").get_json()["items"] == []


def test_build_compare():
    assert da.build_key("1.5.0-b12") > da.build_key("1.5.0-b9") > da.build_key("1.4.9-b99")


def test_apply_update_keeps_venv(monkeypatch, tmp_path):
    (tmp_path / "venv").mkdir(); (tmp_path / "venv" / "keep").write_text("k"); (tmp_path / "settings.json").write_text("{}")
    (tmp_path / "web").mkdir(); (tmp_path / "web" / "old.txt").write_text("x")
    b = io.BytesIO(); z = zipfile.ZipFile(b, "w")
    for n, d in {"app.py": "# new", "web/index.html": "new", "web/version.json": json.dumps({"build": "1.5.0-b99"}), "venv/x": "bad"}.items():
        z.writestr("image-to-dxf-windows/" + n, d)
    z.close()
    monkeypatch.setattr(da, "HERE", str(tmp_path)); monkeypatch.setattr(da, "WEB", str(tmp_path / "web"))
    monkeypatch.setattr(da, "_get", lambda u, timeout=0: da._Resp(b.getvalue()))
    r = da.apply_update({"available": True, "asset": "x", "current": "1.5.0-b1", "latest": "1.5.0-b99"})
    assert r["updated"] and da.version_info()["build"] == "1.5.0-b99"
    assert sorted(os.listdir(tmp_path / "venv")) == ["keep"] and not (tmp_path / "web" / "old.txt").exists()
