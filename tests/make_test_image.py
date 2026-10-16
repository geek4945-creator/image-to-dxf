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
