"""Selection-limited / region-clipped / split export logic."""
from __future__ import annotations

import io
import re
import zipfile

import numpy as np
from shapely.geometry import Polygon, box, MultiPolygon, GeometryCollection
from shapely.ops import unary_union
from shapely.validation import make_valid

import pipeline as pl


def _poly(q) -> Polygon:
    g = Polygon(q)
    if not g.is_valid:
        g = make_valid(g)
    return g


def _rings(geom):
    """Exterior rings (as Nx2 arrays) of every polygon inside a shapely geometry."""
    if geom.is_empty:
        return []
    if isinstance(geom, Polygon):
        return [np.array(geom.exterior.coords)[:-1]] if geom.area > 1e-9 else []
    if isinstance(geom, (MultiPolygon, GeometryCollection)):
        out = []
        for g in geom.geoms:
            out += _rings(g)
        return out
    return []  # lines / points from degenerate intersections


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9_\-]", "_", name)[:60] or "X"


def build_groups(polys, p: pl.Params, px_w: int, px_h: int, selected=None, regions=None,
                 clip=False, split="none", group_by="contour"):
    """Return list of (name, [arrays]).

    selected : list of contour ids (None = all).  regions : [{rect:[x0,y0,x1,y1] (image px, Y-down), label}]
    Contours must be selected AND (if regions given) intersect the area of interest. With clip=True the
    geometry is cut at the region boundary.  split: 'none' (one CUT layer) | 'layers' | 'files' with
    group_by 'contour' or 'cell' (one group per region).
    """
    n = len(polys)
    if selected is None:
        ids = list(range(n))
    else:
        try:
            ids = sorted({int(i) for i in selected})
        except (TypeError, ValueError):
            raise pl.ImageError("selected must be a list of contour ids")
        if any(i < 0 or i >= n for i in ids):
            raise pl.ImageError("selected contains an unknown contour id")
    if not ids:
        raise pl.ImageError("No contours selected")

    scale = p.width / px_w
    cells = []  # (label, shapely box in output units)
    seen = set()
    for k, r in enumerate(regions or []):
        try:
            x0, y0, x1, y1 = [float(v) for v in r["rect"]]
        except (KeyError, TypeError, ValueError):
            raise pl.ImageError("bad region rect")
        x0, x1 = sorted((max(0, x0), min(px_w, x1)))
        y0, y1 = sorted((max(0, y0), min(px_h, y1)))
        if x1 - x0 <= 0 or y1 - y0 <= 0:
            continue
        label = _safe(str(r.get("label") or f"AREA{k + 1}"))
        while label in seen:
            label += "_"
        seen.add(label)
        cells.append((label, box(x0 * scale, (px_h - y1) * scale, x1 * scale, (px_h - y0) * scale)))
    if regions and not cells:
        raise pl.ImageError("Area of interest is empty")
    area = unary_union([c[1] for c in cells]) if cells else None

    geoms = {i: _poly(polys[i]) for i in ids}

    def pieces(i, region):
        g = geoms[i]
        if region is None:
            return [polys[i]]
        if not g.intersects(region) or g.intersection(region).area <= 1e-9:
            return []
        return _rings(g.intersection(region)) if clip else [polys[i]]

    if split == "none":
        out = [q for i in ids for q in pieces(i, area)]
        groups = [("CUT", out)]
    elif split in ("layers", "files"):
        if group_by == "cell":
            if not cells:
                raise pl.ImageError("Group by cell needs grid cells or a drawn region")
            groups = [("CUT_" + lab, [q for i in ids for q in pieces(i, reg)]) for lab, reg in cells]
        elif group_by == "contour":
            groups = [("CUT_%03d" % i, pieces(i, area)) for i in ids]
        else:
            raise pl.ImageError("group_by must be 'contour' or 'cell'")
    else:
        raise pl.ImageError("split must be none, layers or files")
    groups = [(nm, ps) for nm, ps in groups if ps]
    if not groups:
        raise pl.ImageError("Nothing to export: selection does not overlap the area of interest")
    return groups


def export(groups, p: pl.Params, split: str, zero_origin: bool = False):
    """-> (bytes, mimetype, filename)"""
    if split == "files":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, polys in groups:
                z.writestr(name + ".dxf", pl.to_dxf_groups([(name, polys)], p, zero_origin))
        return buf.getvalue(), "application/zip", "cut_files.zip"
    return pl.to_dxf_groups(groups, p), "application/dxf", "cut.dxf"
