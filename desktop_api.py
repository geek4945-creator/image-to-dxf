"""Hard Version 1.5 desktop (Windows) API: serves the browser UI from web/, keeps image history on disk, and checks
GitHub releases for updates.

  GET  /api/version                    -> build info of the installed web UI + backend flag
  GET/POST/DELETE /api/history         -> list / add (multipart: image, meta) / clear
  GET/DELETE /api/history/<id>         -> one item's metadata / delete it
  GET  /api/history/<id>/image         -> the original image bytes
  PUT  /api/history/<id>/settings      -> save the settings used for that image
  GET/POST /api/settings               -> {"auto_update": bool}
  GET  /api/update/check               -> {current, latest, available, url}
  POST /api/update/apply               -> download the release zip and replace program files (keeps venv, history, settings)
History lives in %APPDATA%\\ImageToDXF\\history (or ~/.imagetodxf/history elsewhere; override with I2D_DATA_DIR).
"""
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile

from flask import Blueprint, Response, abort, jsonify, request, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, "web")
REPO = os.environ.get("I2D_REPO", "geek4945-creator/image-to-dxf")
ASSET = "image-to-dxf-windows.zip"
KEEP = {"venv", ".venv", "setup.log", "server.log", "update.log", "settings.json"}   # never overwritten by an update
MAX_ITEMS = 200

bp = Blueprint("desktop", __name__)
_lock = threading.Lock()


def data_dir():
    d = os.environ.get("I2D_DATA_DIR")
    if not d:
        base = os.environ.get("APPDATA")
        d = os.path.join(base, "ImageToDXF") if base else os.path.join(os.path.expanduser("~"), ".imagetodxf")
    os.makedirs(os.path.join(d, "history"), exist_ok=True)
    return d


def hist_dir():
    return os.path.join(data_dir(), "history")


def _settings_path():
    return os.path.join(data_dir(), "settings.json")


def load_settings():
    try:
        with open(_settings_path(), encoding="utf-8") as f:
            return {"auto_update": False, **json.load(f)}
    except (OSError, ValueError):
        return {"auto_update": False}


def save_settings(s):
    with open(_settings_path(), "w", encoding="utf-8") as f:
        json.dump(s, f, indent=1)


def version_info():
    try:
        with open(os.path.join(WEB, "version.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"name": "Hard Version 1.5", "version": "1.5.0", "build": "1.5.0-b0"}


def build_key(s):
    """'1.5.0-b12' -> (1, 5, 0, 12); anything unparsable sorts first."""
    nums = [int(x) for x in re.findall(r"\d+", str(s or ""))]
    return tuple(nums) if nums else (0,)


# ------------------------------------------------------------------ UI files
@bp.get("/")
def index():
    return send_from_directory(WEB, "index.html", max_age=0)


@bp.get("/classic/")
def classic():
    return send_from_directory(os.path.join(HERE, "static"), "index.html", max_age=0)


@bp.get("/classic/<path:p>")
def classic_file(p):
    return send_from_directory(os.path.join(HERE, "static"), p, max_age=0)


@bp.get("/<path:p>")
def web_file(p):
    if p.startswith("api/"):
        abort(404)
    if os.path.isfile(os.path.join(WEB, p)):
        return send_from_directory(WEB, p, max_age=0)
    return send_from_directory(os.path.join(HERE, "static"), p, max_age=0)   # older server UI assets


# ------------------------------------------------------------------ version / settings
@bp.get("/api/version")
def api_version():
    v = dict(version_info())
    v.update(backend=True, history_dir=hist_dir(), auto_update=load_settings().get("auto_update", False))
    return jsonify(v)


@bp.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    s = load_settings()
    if request.method == "POST":
        body = request.get_json(silent=True) or {}
        if "auto_update" in body:
            s["auto_update"] = bool(body["auto_update"])
        save_settings(s)
    return jsonify(s)


# ------------------------------------------------------------------ history
def _safe(iid):
    if not re.fullmatch(r"[0-9a-f]{32}", iid or ""):
        abort(404)
    return os.path.join(hist_dir(), iid)


def _meta(iid):
    try:
        with open(os.path.join(_safe(iid), "meta.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        abort(404)


def _all():
    out = []
    for iid in os.listdir(hist_dir()):
        p = os.path.join(hist_dir(), iid, "meta.json")
        if re.fullmatch(r"[0-9a-f]{32}", iid) and os.path.isfile(p):
            try:
                with open(p, encoding="utf-8") as f:
                    out.append(json.load(f))
            except (OSError, ValueError):
                pass
    out.sort(key=lambda m: str(m.get("date", "")), reverse=True)
    return out


@bp.route("/api/history", methods=["GET", "POST", "DELETE"])
def api_history():
    if request.method == "GET":
        return jsonify(items=[{k: m.get(k) for k in ("id", "date", "name", "size", "thumb")} for m in _all()])
    if request.method == "DELETE":
        with _lock:
            for iid in os.listdir(hist_dir()):
                shutil.rmtree(os.path.join(hist_dir(), iid), ignore_errors=True)
        return jsonify(ok=True)
    f = request.files.get("image")
    if not f:
        return jsonify(error="No image"), 400
    try:
        meta = json.loads(request.form.get("meta") or "{}")
    except ValueError:
        meta = {}
    data = f.read()
    iid = uuid.uuid4().hex
    with _lock:
        d = os.path.join(hist_dir(), iid)
        os.makedirs(d)
        with open(os.path.join(d, "image.bin"), "wb") as out:
            out.write(data)
        m = {"id": iid, "name": str(meta.get("name") or f.filename or "image")[:200], "date": meta.get("date") or time.strftime("%Y-%m-%dT%H:%M:%S"),
             "size": len(data), "type": f.mimetype or "application/octet-stream", "thumb": meta.get("thumb"), "settings": meta.get("settings")}
        with open(os.path.join(d, "meta.json"), "w", encoding="utf-8") as out:
            json.dump(m, out)
        for old in _all()[MAX_ITEMS:]:
            shutil.rmtree(os.path.join(hist_dir(), old["id"]), ignore_errors=True)
    return jsonify(id=iid)


@bp.route("/api/history/<iid>", methods=["GET", "DELETE"])
def api_history_item(iid):
    if request.method == "DELETE":
        shutil.rmtree(_safe(iid), ignore_errors=True)
        return jsonify(ok=True)
    return jsonify(_meta(iid))


@bp.get("/api/history/<iid>/image")
def api_history_image(iid):
    m = _meta(iid)
    with open(os.path.join(_safe(iid), "image.bin"), "rb") as f:
        return Response(f.read(), mimetype=m.get("type") or "application/octet-stream")


@bp.put("/api/history/<iid>/settings")
def api_history_settings(iid):
    m = _meta(iid)
    m["settings"] = request.get_json(silent=True)
    with open(os.path.join(_safe(iid), "meta.json"), "w", encoding="utf-8") as out:
        json.dump(m, out)
    return jsonify(ok=True)


# ------------------------------------------------------------------ updates
class _Resp:
    def __init__(self, data):
        self.content = data

    def json(self):
        return json.loads(self.content.decode("utf-8"))


def _get(url, timeout=20):
    """Plain urllib (not requests/urllib3: urlfetch.py guards urllib3 against private addresses, which would also
    block a company proxy). Honours the system proxy settings."""
    import urllib.request
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "ImageToDXF-updater"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return _Resp(r.read())


def check_update():
    cur = version_info().get("build")
    rel = _get(f"https://api.github.com/repos/{REPO}/releases/latest").json()
    m = re.search(r"\(([^()]+)\)\s*$", rel.get("name") or "")
    latest = m.group(1) if m else (rel.get("tag_name") or "")
    asset = next((a for a in rel.get("assets", []) if a.get("name") == ASSET), None)
    return {"current": cur, "latest": latest, "latest_name": rel.get("name"), "url": rel.get("html_url"),
            "asset": asset and asset.get("browser_download_url"),
            "available": bool(asset) and bool(re.fullmatch(r"\d+\.\d+\.\d+-b\d+", latest)) and build_key(latest) > build_key(cur)}


def apply_update(info=None, log=print):
    """Download the release zip and copy its files over this install. venv, history (in APPDATA) and settings stay."""
    import sys
    if getattr(sys, "frozen", False):
        raise RuntimeError("the stand-alone .exe cannot update itself; download the new zip from the Releases page and rebuild")
    info = info or check_update()
    if not info.get("available"):
        return {"ok": True, "updated": False, "message": f"Already up to date ({info.get('current')})."}
    data = _get(info["asset"], timeout=120).content
    z = zipfile.ZipFile(io.BytesIO(data))
    tmp = tempfile.mkdtemp(prefix="i2d-upd-")
    try:
        z.extractall(tmp)
        roots = os.listdir(tmp)
        src = os.path.join(tmp, roots[0]) if len(roots) == 1 and os.path.isdir(os.path.join(tmp, roots[0])) else tmp
        if not os.path.isfile(os.path.join(src, "app.py")) or not os.path.isfile(os.path.join(src, "web", "index.html")):
            raise RuntimeError("the downloaded zip does not look like an Image to DXF package")
        for name in os.listdir(src):
            if name in KEEP:
                continue
            s, d = os.path.join(src, name), os.path.join(HERE, name)
            if os.path.isdir(s):
                if name == "web":                       # replace the UI folder in one go (old files may be removed)
                    shutil.rmtree(d + ".old", ignore_errors=True)
                    try:
                        if os.path.isdir(d):
                            os.replace(d, d + ".old")
                        shutil.copytree(s, d)
                    except OSError:                     # Windows: a file is busy -> overwrite in place instead
                        if not os.path.isdir(d) and os.path.isdir(d + ".old"):
                            os.replace(d + ".old", d)
                        shutil.copytree(s, d, dirs_exist_ok=True)
                    shutil.rmtree(d + ".old", ignore_errors=True)
                else:
                    shutil.copytree(s, d, dirs_exist_ok=True)
            else:
                shutil.copy2(s, d)
        log(f"updated {info.get('current')} -> {info.get('latest')}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"ok": True, "updated": True, "latest": info.get("latest"),
            "message": f"Updated to {info.get('latest')}. The page reloads now; restart Image to DXF to finish updating the Python parts."}


@bp.get("/api/update/check")
def api_update_check():
    try:
        return jsonify(check_update())
    except Exception as e:                                   # offline, rate limited, no release yet ...
        return jsonify(error=f"{type(e).__name__}: {e}", current=version_info().get("build")), 200


@bp.post("/api/update/apply")
def api_update_apply():
    try:
        return jsonify(apply_update())
    except Exception as e:
        return jsonify(ok=False, error=f"{type(e).__name__}: {e}"), 200
