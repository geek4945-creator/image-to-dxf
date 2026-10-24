"""Flask backend for image-to-dxf."""
import base64
import os
import threading
import uuid
from collections import OrderedDict

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_from_directory, Response

import pipeline as pl
import selection
import urlfetch
import desktop_api

app = Flask(__name__, static_folder=None)   # UI files are served by desktop_api (web/ at /, the older server UI at /classic/)
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024

_store: "OrderedDict[str, np.ndarray]" = OrderedDict()
_lock = threading.Lock()
MAX_ITEMS = 30


def _put(gray) -> str:
    iid = uuid.uuid4().hex
    with _lock:
        _store[iid] = gray
        while len(_store) > MAX_ITEMS:
            _store.popitem(last=False)
    return iid


def _get(iid):
    with _lock:
        g = _store.get(iid)
        if g is not None:
            _store.move_to_end(iid)
    if g is None:
        raise pl.ImageError("Image expired or not found; please load it again")
    return g


@app.errorhandler(pl.ImageError)
@app.errorhandler(urlfetch.FetchError)
def _bad(e):
    return jsonify(error=str(e)), 400


@app.errorhandler(413)
def _big(e):
    return jsonify(error="File too large (limit 25 MB)"), 413


def _loaded(gray):
    h, w = gray.shape
    return jsonify(id=_put(gray), width=w, height=h)


@app.post("/api/upload")
def upload():
    f = request.files.get("file")
    if not f:
        raise pl.ImageError("No file provided")
    return _loaded(pl.load_image(f.read()))


@app.post("/api/fetch")
def fetch_url():
    url = (request.get_json(silent=True) or {}).get("url", "")
    if not url:
        raise pl.ImageError("No URL provided")
    return _loaded(pl.load_image(urlfetch.fetch(url)))


@app.get("/api/image/<iid>")
def image(iid):
    ok, png = cv2.imencode(".png", _get(iid))
    return Response(png.tobytes(), mimetype="image/png")


@app.post("/api/trace")
def trace():
    body = request.get_json(silent=True) or {}
    gray = _get(body.get("id", ""))
    p = pl.Params.from_dict(body.get("params"))
    mask, polys, info = pl.trace(gray, p)
    h = gray.shape[0]
    scale = p.width / gray.shape[1]
    # pixel-space (Y-down) coords for the overlay
    paths = [[[round(x / scale, 2), round(h - y / scale, 2)] for x, y in q] for q in polys]
    out = {"paths": paths, "info": info}
    if body.get("mask", True):
        ok, png = cv2.imencode(".png", mask)
        out["mask"] = "data:image/png;base64," + base64.b64encode(png.tobytes()).decode()
    return jsonify(out)


@app.post("/api/dxf")
def dxf():
    """Body: {id, params, selected?:[ids], regions?:[{rect:[x0,y0,x1,y1],label}], clip?:bool,
              split?:'none'|'layers'|'files', group_by?:'contour'|'cell', zero_origin?:bool}"""
    body = request.get_json(silent=True) or {}
    gray = _get(body.get("id", ""))
    p = pl.Params.from_dict(body.get("params"))
    _, polys, info = pl.trace(gray, p)
    if not polys:
        raise pl.ImageError("Nothing to export: no shapes found with these settings")
    split = body.get("split", "none")
    groups = selection.build_groups(
        polys, p, info["px_w"], info["px_h"], selected=body.get("selected"),
        regions=body.get("regions"), clip=bool(body.get("clip")), split=split,
        group_by=body.get("group_by", "contour"))
    data, mime, name = selection.export(groups, p, split, bool(body.get("zero_origin")))
    return Response(data, mimetype=mime,
                    headers={"Content-Disposition": f'attachment; filename="{name}"',
                             "X-Paths": str(sum(len(g[1]) for g in groups)),
                             "X-Groups": str(len(groups))})


@app.get("/api/health")
def health():
    return jsonify(ok=True)


app.register_blueprint(desktop_api.bp)   # registered last: its /<path> catch-all must not shadow the API routes


if __name__ == "__main__":
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 5000)))
