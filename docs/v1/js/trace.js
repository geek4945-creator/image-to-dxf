/* Image -> contours pipeline in pure JS (no dependencies). Mirrors the Python/OpenCV pipeline:
   gray -> blur -> threshold (manual/Otsu) -> invert -> speckle/pinhole removal -> crack-edge contour tracing
   (outer boundaries of 8-connected shapes + holes) -> Douglas-Peucker -> min-size filter.
   Coordinates returned are image pixel-grid coordinates (x right, y down, vertices on pixel corners). */
(function (root) {
  "use strict";
  const MAX_DIM = 2500;

  /** RGBA ImageData-like {data,width,height} -> Uint8Array gray, alpha composited on white (BT.601 like PIL "L"). */
  function toGray(rgba, w, h) {
    const g = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < g.length; i++, j += 4) {
      const a = rgba[j + 3] / 255;
      const r = rgba[j] * a + 255 * (1 - a), gg = rgba[j + 1] * a + 255 * (1 - a), b = rgba[j + 2] * a + 255 * (1 - a);
      g[i] = Math.round(0.299 * r + 0.587 * gg + 0.114 * b);
    }
    return g;
  }

  /** Separable Gaussian, kernel (2r+1), sigma as OpenCV derives it, reflect-101 borders. */
  function gaussian(src, w, h, radius) {
    if (!radius) return src;
    const k = 2 * radius + 1, sigma = 0.3 * ((k - 1) * 0.5 - 1) + 0.8;
    const ker = new Float32Array(k); let s = 0;
    for (let i = 0; i < k; i++) { const x = i - radius; ker[i] = Math.exp(-x * x / (2 * sigma * sigma)); s += ker[i]; }
    for (let i = 0; i < k; i++) ker[i] /= s;
    const refl = (i, n) => { if (n === 1) return 0; while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * (n - 1) - i; } return i; };
    const tmp = new Float32Array(w * h), out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0; for (let i = 0; i < k; i++) a += ker[i] * src[y * w + refl(x + i - radius, w)];
      tmp[y * w + x] = a;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let a = 0; for (let i = 0; i < k; i++) a += ker[i] * tmp[refl(y + i - radius, h) * w + x];
      out[y * w + x] = Math.max(0, Math.min(255, Math.round(a)));
    }
    return out;
  }

  /** Otsu threshold t: foreground = value <= t (dark). */
  function otsu(g) {
    const hist = new Float64Array(256); for (let i = 0; i < g.length; i++) hist[g[i]]++;
    const total = g.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let wB = 0, sumB = 0, best = -1, thr = 0;
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t; }
    }
    return thr;
  }

  /** Remove 8-connected components of value 1 with area < minArea (in place). */
  function removeSmall(m, w, h, minArea) {
    if (minArea <= 1) return m;
    const seen = new Uint8Array(m.length), q = new Int32Array(m.length);
    for (let s = 0; s < m.length; s++) {
      if (!m[s] || seen[s]) continue;
      let qh = 0, qt = 0; q[qt++] = s; seen[s] = 1;
      while (qh < qt) {
        const p = q[qh++], x = p % w, y = (p / w) | 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue;
            const n = yy * w + xx; if (m[n] && !seen[n]) { seen[n] = 1; q[qt++] = n; } } }
      }
      if (qt < minArea) for (let i = 0; i < qt; i++) m[q[i]] = 0;
    }
    return m;
  }

  /** Binary mask, 1 = material. */
  function binarize(gray, w, h, p) {
    const g = gaussian(gray, w, h, p.blur | 0);
    const t = p.auto ? otsu(g) : p.threshold;
    const m = new Uint8Array(w * h);
    for (let i = 0; i < m.length; i++) m[i] = (g[i] > t ? 0 : 1) ^ (p.invert ? 1 : 0);
    if (p.speckle > 0) {
      removeSmall(m, w, h, p.speckle);                        // specks of foreground
      for (let i = 0; i < m.length; i++) m[i] ^= 1;
      removeSmall(m, w, h, p.speckle);                        // pinholes in foreground
      for (let i = 0; i < m.length; i++) m[i] ^= 1;
    }
    return m;
  }

  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];             // E, S, W, N (screen coords, y down)

  /** Crack-edge border following. Returns rings [{pts:Float64Array [x0,y0,x1,y1..], hole:bool, area}]
      Foreground stays on the left of travel. Foreground is 8-connected, background 4-connected. */
  function traceRings(m, w, h) {
    const W = w + 2, H = h + 2;                                // pad with background
    const P = new Uint8Array(W * H);
    for (let y = 0; y < h; y++) P.set(m.subarray(y * w, y * w + w), (y + 1) * W + 1);
    const px = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : P[y * W + x];
    // pixels left/right of the edge leaving vertex (x,y) in direction d
    const left = (x, y, d) => d === 0 ? px(x, y - 1) : d === 1 ? px(x, y) : d === 2 ? px(x - 1, y) : px(x - 1, y - 1);
    const right = (x, y, d) => d === 0 ? px(x, y) : d === 1 ? px(x - 1, y) : d === 2 ? px(x - 1, y - 1) : px(x, y - 1);
    const VW = W + 1;
    const visited = new Uint8Array(VW * (H + 1) * 4);
    const rings = [];
    for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) for (let d0 = 0; d0 < 4; d0++) {
      if (visited[(y * VW + x) * 4 + d0] || !left(x, y, d0) || right(x, y, d0)) continue;
      const pts = []; let cx = x, cy = y, d = d0, prev = -1, area2 = 0;
      for (;;) {
        visited[(cy * VW + cx) * 4 + d] = 1;
        if (d !== prev) pts.push(cx - 1, cy - 1);               // record corners only; undo padding
        prev = d;
        const nx = cx + DX[d], ny = cy + DY[d];
        area2 += cx * ny - nx * cy;
        cx = nx; cy = ny;
        let nd;
        if (right(cx, cy, d)) nd = (d + 1) & 3;                 // turn right (keeps 8-connectivity)
        else if (left(cx, cy, d)) nd = d;
        else nd = (d + 3) & 3;                                  // turn left
        d = nd;
        if (cx === x && cy === y && d === d0) break;
      }
      rings.push({ pts: dropCollinear(Float64Array.from(pts)), area2 });
    }
    // fg on left in y-down coords: outer boundaries have negative shoelace sum, holes positive
    for (const r of rings) { r.hole = r.area2 > 0; r.area = Math.abs(r.area2) / 2; }
    return rings;
  }

  function dropCollinear(pts) {
    const n = pts.length / 2; if (n < 4) return pts;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i + n - 1) % n, b = (i + 1) % n;
      const cr = (pts[2 * i] - pts[2 * a]) * (pts[2 * b + 1] - pts[2 * i + 1]) - (pts[2 * i + 1] - pts[2 * a + 1]) * (pts[2 * b] - pts[2 * i]);
      if (cr !== 0) out.push(pts[2 * i], pts[2 * i + 1]);
    }
    return out.length >= 6 ? Float64Array.from(out) : pts;
  }

  /** Douglas-Peucker on a closed ring (flat array). eps in px. Returns flat array. */
  function simplifyRing(pts, eps) {
    const n = pts.length / 2; if (n <= 3 || eps <= 0) return pts;
    // split ring at point 0 and the point farthest from it
    let far = 0, fd = -1;
    for (let i = 1; i < n; i++) { const d = (pts[2 * i] - pts[0]) ** 2 + (pts[2 * i + 1] - pts[1]) ** 2; if (d > fd) { fd = d; far = i; } }
    const keep = new Uint8Array(n); keep[0] = 1; keep[far] = 1;
    const e2 = eps * eps, stack = [[0, far], [far, n]];       // second span wraps to index 0 (== n)
    while (stack.length) {
      const [a, b] = stack.pop(); if (b - a < 2) continue;
      const ax = pts[2 * a], ay = pts[2 * a + 1], bi = b % n, bx = pts[2 * bi], by = pts[2 * bi + 1];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let md = -1, mi = -1;
      for (let i = a + 1; i < b; i++) {
        const x = pts[2 * i], y = pts[2 * i + 1]; let d;
        if (L2 === 0) d = (x - ax) ** 2 + (y - ay) ** 2;
        else { let t = ((x - ax) * dx + (y - ay) * dy) / L2; t = Math.max(0, Math.min(1, t)); d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2; }
        if (d > md) { md = d; mi = i; }
      }
      if (md > e2) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    const out = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out.length >= 6 ? Float64Array.from(out) : pts;
  }

  /** Full trace. gray: Uint8Array w*h. p: params. Output scale (units per px): p.scale (x) / p.scaleY (y, defaults to x),
      or derived from p.width (output width of the whole w-px-wide image). Returns {mask, polys:[[ [x,y],..]], items, info}
      (px coords, y down). items also carry centroid (cx,cy) and bbox centre (bcx,bcy) in px, used by zones. */
  function trace(gray, w, h, p) {
    const mask = binarize(gray, w, h, p);
    const sx = p.scale > 0 ? p.scale : p.width / w, sy = p.scaleY > 0 ? p.scaleY : sx;
    const scale = Math.sqrt(sx * sy);                         // mean output units per px (tolerance / min feature)
    const rings = traceRings(mask, w, h);
    const epsPx = p.tolerance / scale;
    const polys = [], items = []; let dropped = 0, verts = 0;
    for (const r of rings) {
      if (r.hole && !p.holes) { dropped++; continue; }
      let pts = r.pts, n = pts.length / 2;
      if (n < 3) { dropped++; continue; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) { const x = pts[2 * i], y = pts[2 * i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const bw = x1 - x0, bh = y1 - y0;
      if (p.drop_frame && bw >= w - 1 && bh >= h - 1) { dropped++; continue; }
      if (Math.max(bw * sx, bh * sy) < p.min_feature) { dropped++; continue; }
      pts = simplifyRing(pts, epsPx);
      const out = new Array(pts.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = [pts[2 * i], pts[2 * i + 1]];
      const c = centroid(out, (x0 + x1) / 2, (y0 + y1) / 2);
      verts += out.length; polys.push(out);
      items.push({ id: items.length, hole: r.hole, area: +(r.area * sx * sy).toFixed(4), w: +(bw * sx).toFixed(3), h: +(bh * sy).toFixed(3), bbox: [x0, y0, x1, y1],
        cx: c[0], cy: c[1], bcx: (x0 + x1) / 2, bcy: (y0 + y1) / 2 });
    }
    const info = { paths: polys.length, vertices: verts, dropped, width: +(w * sx).toFixed(4), height: +(h * sy).toFixed(4), unit: p.unit, px_w: w, px_h: h };
    return { mask, polys, items, info };
  }

  /** Contour record (same shape as trace() items) from a px polygon [[x,y]..]; sx/sy = output units per px. */
  function makeItem(out, hole, id, sx, sy) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, a2 = 0;
    for (let i = 0, n = out.length; i < n; i++) {
      const [x, y] = out[i], [u, v] = out[(i + 1) % n];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; a2 += x * v - u * y;
    }
    const c = centroid(out, (x0 + x1) / 2, (y0 + y1) / 2);
    return { id, hole: !!hole, area: +(Math.abs(a2) / 2 * sx * sy).toFixed(4), w: +((x1 - x0) * sx).toFixed(3), h: +((y1 - y0) * sy).toFixed(3), bbox: [x0, y0, x1, y1],
      cx: c[0], cy: c[1], bcx: (x0 + x1) / 2, bcy: (y0 + y1) / 2 };
  }

  /** Contrast stretch (percentile lo..hi -> 0..255), for dim / low-contrast crops. */
  function stretch(gray, lo = 0.01, hi = 0.99) {
    const hist = new Float64Array(256); for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    let c = 0, a = 0, b = 255; const n = gray.length;
    for (let t = 0; t < 256; t++) { c += hist[t]; if (c >= n * lo) { a = t; break; } }
    c = 0; for (let t = 0; t < 256; t++) { c += hist[t]; if (c >= n * hi) { b = t; break; } }
    if (b - a < 8) return gray;
    const out = new Uint8Array(n), k = 255 / (b - a);
    for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, Math.round((gray[i] - a) * k)));
    return out;
  }

  /** Area centroid of a closed polygon [[x,y]..]; falls back to (fx,fy) when degenerate. */
  function centroid(q, fx, fy) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = q.length; i < n; i++) { const [x0, y0] = q[i], [x1, y1] = q[(i + 1) % n], c = x0 * y1 - x1 * y0; a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c; }
    return Math.abs(a) < 1e-9 ? [fx, fy] : [cx / (3 * a), cy / (3 * a)];
  }

  /** Crop gray (w*h) to rect [x0,y0,x1,y1] (integers, px). Returns {gray,w,h}. */
  function cropGray(gray, w, h, rect) {
    const x0 = Math.max(0, Math.min(w - 1, Math.round(rect[0]))), y0 = Math.max(0, Math.min(h - 1, Math.round(rect[1])));
    const x1 = Math.max(x0 + 1, Math.min(w, Math.round(rect[2]))), y1 = Math.max(y0 + 1, Math.min(h, Math.round(rect[3])));
    const cw = x1 - x0, ch = y1 - y0, out = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) out.set(gray.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + cw), y * cw);
    return { gray: out, w: cw, h: ch, rect: [x0, y0, x1, y1] };
  }

  /** Downscale gray (box filter) so longest side <= MAX_DIM. */
  function limitSize(gray, w, h) {
    if (Math.max(w, h) <= MAX_DIM) return { gray, w, h };
    const s = MAX_DIM / Math.max(w, h), nw = Math.max(1, Math.floor(w * s)), nh = Math.max(1, Math.floor(h * s));
    const out = new Uint8Array(nw * nh);
    for (let y = 0; y < nh; y++) { const ya = Math.floor(y / s), yb = Math.min(h, Math.max(ya + 1, Math.ceil((y + 1) / s)));
      for (let x = 0; x < nw; x++) { const xa = Math.floor(x / s), xb = Math.min(w, Math.max(xa + 1, Math.ceil((x + 1) / s)));
        let a = 0, c = 0; for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) { a += gray[yy * w + xx]; c++; }
        out[y * nw + x] = Math.round(a / c); } }
    return { gray: out, w: nw, h: nh };
  }

  const api = { MAX_DIM, toGray, gaussian, otsu, binarize, traceRings, simplifyRing, dropCollinear, trace, limitSize, cropGray, centroid, makeItem, stretch };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.I2D_TRACE = api;
})(typeof self !== "undefined" ? self : this);
