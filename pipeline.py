"""Image -> contours -> DXF pipeline (OpenCV + ezdxf)."""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, asdict

import cv2
import ezdxf
import numpy as np
from PIL import Image, ImageOps

Image.MAX_IMAGE_PIXELS = 60_000_000
MAX_DIM = 2500  # working resolution cap (longest side)

UNIT_INSUNITS = {"mm": 4, "in": 1}


class ImageError(ValueError):
    pass


# ---------------------------------------------------------------- loading
def _pdf_first_page(data: bytes) -> Image.Image:
    """Render page 1 of a PDF. Tries PyMuPDF (pip install pymupdf; works on Windows), then poppler's pdftoppm."""
    try:  # optional PyMuPDF (new module name, then legacy "fitz")
        try:
            import pymupdf as fitz  # type: ignore
        except ImportError:
            import fitz  # type: ignore
    except ImportError:
        fitz = None
    if fitz is not None:
        try:
            doc = fitz.open(stream=data, filetype="pdf")
            pix = doc[0].get_pixmap(dpi=200)
            img = Image.open(io.BytesIO(pix.tobytes("png")))
            img.load()
            return img
        except Exception as e:
            raise ImageError(f"Could not render PDF: {e}")
    if not shutil.which("pdftoppm"):
        raise ImageError("PDF input is not available on this installation. Save/export the page as PNG or JPG "
                         "and upload that instead, or install the optional PDF support: pip install pymupdf "
                         "(Windows: re-run install.bat and answer Y to the PDF question).")
    with tempfile.TemporaryDirectory() as d:  # note: close files before the dir is removed (Windows)
        src = os.path.join(d, "in.pdf")
        with open(src, "wb") as fh:
            fh.write(data)
        try:
            subprocess.run(["pdftoppm", "-png", "-r", "200", "-f", "1", "-l", "1", "-singlefile", src,
                            os.path.join(d, "out")], check=True, capture_output=True, timeout=60)
        except Exception as e:
            raise ImageError(f"Could not render PDF: {e}")
        with Image.open(os.path.join(d, "out.png")) as im:
            im.load()
            return im.copy()


def load_image(data: bytes) -> np.ndarray:
    """Decode bytes (image or PDF) to an 8-bit grayscale array (alpha composited on white)."""
    try:
        if data[:5] == b"%PDF-":
            img = _pdf_first_page(data)
        else:
            img = Image.open(io.BytesIO(data))
            img.load()
    except ImageError:
        raise
    except Exception as e:
        raise ImageError(f"Unsupported or corrupt image: {e}")
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    gray = np.array(img.convert("L"))
    h, w = gray.shape
    if max(h, w) > MAX_DIM:
        s = MAX_DIM / max(h, w)
        gray = cv2.resize(gray, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA)
    return gray


# ---------------------------------------------------------------- params
@dataclass
class Params:
    threshold: int = 128        # 0-255; ignored if auto
    auto: bool = False          # Otsu
    invert: bool = False        # False: dark = material to cut
    blur: int = 0               # gaussian kernel radius (0 = off)
    speckle: int = 20           # remove blobs/holes smaller than N px area
    tolerance: float = 0.2      # simplification, in output units
    width: float = 100.0        # real-world width of the image
    unit: str = "mm"            # "mm" | "in"
    min_feature: float = 1.0    # drop shapes whose largest dimension is smaller (output units)
    drop_frame: bool = True     # drop contour that is the whole image border
    holes: bool = True          # keep inner contours

    @classmethod
    def from_dict(cls, d: dict) -> "Params":
        p = cls()
        for k, v in (d or {}).items():
            if not hasattr(p, k):
                continue
            t = type(getattr(p, k))
            try:
                setattr(p, k, (bool(v) if t is bool else t(v)))
            except (TypeError, ValueError):
                raise ImageError(f"Bad value for {k}")
        p.threshold = int(min(255, max(0, p.threshold)))
        p.blur = int(min(20, max(0, p.blur)))
        p.speckle = int(min(100000, max(0, p.speckle)))
        if p.unit not in UNIT_INSUNITS:
            raise ImageError("unit must be 'mm' or 'in'")
        if not (0 < p.width <= 100000):
            raise ImageError("width must be > 0")
        p.tolerance = max(0.0, p.tolerance)
        p.min_feature = max(0.0, p.min_feature)
        return p


# ---------------------------------------------------------------- processing
def binarize(gray: np.ndarray, p: Params) -> np.ndarray:
    """Return uint8 mask (255 = material/foreground)."""
    g = gray
    if p.blur:
        k = 2 * p.blur + 1
        g = cv2.GaussianBlur(g, (k, k), 0)
    if p.auto:
        _, m = cv2.threshold(g, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    else:
        _, m = cv2.threshold(g, p.threshold, 255, cv2.THRESH_BINARY_INV)
    if p.invert:
        m = 255 - m
    if p.speckle > 0:
        m = _remove_small(m, p.speckle)            # specks of foreground
        m = 255 - _remove_small(255 - m, p.speckle)  # pinholes in foreground
    return m


def _remove_small(mask: np.ndarray, min_area: int) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(n, dtype=np.uint8)
    keep[1:] = (stats[1:, cv2.CC_STAT_AREA] >= min_area).astype(np.uint8) * 255
    return keep[labels]


def trace(gray: np.ndarray, p: Params):
    """Returns (mask, polys, info). polys are Nx2 float arrays in output units, Y-up, origin bottom-left."""
    mask = binarize(gray, p)
    h, w = mask.shape
    scale = p.width / w  # output units per pixel
    padded = cv2.copyMakeBorder(mask, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    mode = cv2.RETR_CCOMP if p.holes else cv2.RETR_EXTERNAL
    contours, hier = cv2.findContours(padded, mode, cv2.CHAIN_APPROX_NONE)
    hier = hier[0] if hier is not None else []
    eps_px = p.tolerance / scale
    polys, meta, dropped = [], [], 0
    for ci, c in enumerate(contours):
        is_hole = bool(len(hier) and hier[ci][3] != -1)
        c = c - 1  # undo padding
        if len(c) < 3:
            dropped += 1
            continue
        x, y, bw, bh = cv2.boundingRect(c)
        if p.drop_frame and bw >= w - 1 and bh >= h - 1:
            dropped += 1
            continue
        if max(bw, bh) * scale < p.min_feature:
            dropped += 1
            continue
        if eps_px > 0:
            simp = cv2.approxPolyDP(c, eps_px, True)
            if len(simp) >= 3:  # tiny shapes that would collapse keep their raw outline
                c = simp
        pts = c.reshape(-1, 2).astype(float) + 0.5  # pixel centre -> pixel-grid coords
        pts[:, 0] = np.clip(pts[:, 0], 0, w) * scale
        pts[:, 1] = (h - np.clip(pts[:, 1], 0, h)) * scale
        polys.append(pts)
        area = abs(cv2.contourArea(pts.astype(np.float32)))
        meta.append({"id": len(polys) - 1, "hole": is_hole, "area": round(float(area), 4),
                     "w": round(bw * scale, 3), "h": round(bh * scale, 3)})
    info = {
        "paths": len(polys),
        "vertices": int(sum(len(q) for q in polys)),
        "dropped": dropped,
        "width": p.width,
        "height": round(h * scale, 4),
        "unit": p.unit,
        "px_w": w, "px_h": h,
        "items": meta,
    }
    return mask, polys, info


def to_dxf(polys, p: Params) -> bytes:
    return to_dxf_groups([("CUT", polys)], p)


def to_dxf_groups(groups, p: Params, zero_origin: bool = False) -> bytes:
    """groups: list of (layer_name, [Nx2 arrays]); each group goes on its own layer (all closed LWPOLYLINEs)."""
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM if p.unit == "mm" else ezdxf.units.IN
    doc.header["$MEASUREMENT"] = 1 if p.unit == "mm" else 0
    msp = doc.modelspace()
    ox = oy = 0.0
    if zero_origin:
        allp = np.vstack([q for _, polys in groups for q in polys])
        ox, oy = allp.min(axis=0)
    for i, (name, polys) in enumerate(groups):
        if name not in doc.layers:
            doc.layers.add(name, color=1 + (i % 6) if len(groups) > 1 else 1)
        for q in polys:
            msp.add_lwpolyline([(float(x - ox), float(y - oy)) for x, y in q], close=True,
                               dxfattribs={"layer": name})
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue().encode("utf-8")




def params_dict(p: Params):
    return asdict(p)
