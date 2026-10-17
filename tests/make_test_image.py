"""Generate a 800x600 test image: rectangle, circle, triangle, ring (with hole), text, speckle noise."""
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def make(path=None, seed=0):
    im = Image.new("RGB", (800, 600), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([50, 50, 250, 200], fill="black")                 # top-left
    d.ellipse([350, 50, 550, 250], fill="black")                  # top-middle
    d.polygon([(620, 220), (750, 220), (685, 60)], fill="black")  # top-right
    d.ellipse([60, 330, 260, 530], fill="black"); d.ellipse([110, 380, 210, 480], fill="white")  # ring (outer+hole)
    try:
        f = ImageFont.load_default(size=90)
    except TypeError:
        f = ImageFont.load_default()
    d.text((330, 400), "CUT", fill="black", font=f)
    a = np.array(im)
    rng = np.random.default_rng(seed)
    for _ in range(40):  # 1-3px speckles
        x, y = rng.integers(0, 790), rng.integers(260, 320)
        a[y:y + 2, x:x + 2] = 0
    out = Image.fromarray(a)
    if path:
        out.save(path)
    return out


def make_nested(path=None):
    """800x600 image for nesting / tab / zone / crop tests:
    A: square ring with an island inside the hole and a hole in the island (depths 0,1,2,3);
    B: ellipse ring (outer + hole); C: plain rectangle; D: big plain rectangle (tab target); E: text '80' (letters with holes)."""
    im = Image.new("RGB", (800, 600), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([40, 40, 340, 300], fill="black"); d.rectangle([90, 90, 290, 250], fill="white")      # A outer + hole
    d.rectangle([140, 130, 240, 210], fill="black"); d.rectangle([170, 150, 210, 190], fill="white")  # island + island hole
    d.ellipse([400, 60, 600, 260], fill="black"); d.ellipse([450, 110, 550, 210], fill="white")       # B
    d.rectangle([640, 60, 760, 160], fill="black")                                                    # C
    d.rectangle([60, 360, 300, 560], fill="black")                                                    # D
    try:
        f = ImageFont.load_default(size=150)
    except TypeError:
        f = ImageFont.load_default()
    d.text((380, 360), "80", fill="black", font=f)                                                    # E
    if path:
        im.save(path)
    return im


if __name__ == "__main__":
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    make(os.path.join(here, "test_image.png"))
    make_nested(os.path.join(here, "test_nested.png"))
