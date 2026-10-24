/* Minimal DXF (AutoCAD R2000 / AC1015) writer: closed LWPOLYLINEs on named layers, $INSUNITS set.
   Also: selection/clip/split logic (uses polygon-clipping) and a tiny ZIP writer. No other dependencies. */
(function (root) {
  "use strict";
  const pc = () => (typeof polygonClipping !== "undefined" ? polygonClipping : require("./polygon-clipping.umd.min.js"));

  // ------------------------------------------------------------------ DXF writer
  const num = v => { if (Math.abs(v) < 1e-12) v = 0; let s = v.toFixed(6); if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s === "-0" ? "0" : s; };

  /** Legacy helper: groups [{name, polys:[[ [x,y],.. ]]}] (all closed) -> writeEntities. */
  function writeDxf(groups, unit) {
    return writeEntities(groups.flatMap(g => g.polys.map(q => ({ layer: g.name, pts: q, closed: true }))), unit);
  }

  /** entities: [{layer, pts:[[x,y],..], closed}] in output units (y up), written in the given order. unit 'mm'|'in'. */
  let FMT = "r2000";
  const FORMATS = { r2000: "R2000 (AC1015) LWPOLYLINE", r12: "R12 compatible (AC1009) POLYLINE", torchmate: "TorchMate-friendly (R12, closed POLYLINEs, single CUT layer)" };
  function setFormat(f) { FMT = FORMATS[f] ? f : "r2000"; return FMT; }
  const NONCUT = /^(PARK|TABLE_FRAME|REG|BEND|LABEL)/i;
  /** R12 (AC1009) writer: POLYLINE/VERTEX/SEQEND, no handles. torchmate=true keeps only cut geometry on one layer. */
  function writeR12(entities, unit, torchmate) {
    if (torchmate) entities = entities.filter(e => !NONCUT.test(e.layer) && e.kind !== "point" && e.kind !== "text").map(e => Object.assign({}, e, { layer: "CUT" }));
    const out = []; const add = (c, v) => out.push(String(c), String(v)); const asc = t => String(t).replace(/[^\x20-\x7e]/g, "?");
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    entities.forEach(e => (e.kind === "circle" ? [[e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]] : e.pts).forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    if (!isFinite(x0)) x0 = y0 = x1 = y1 = 0;
    const names = []; entities.forEach(e => { if (names.indexOf(e.layer) < 0 && e.layer !== "0") names.push(e.layer); });
    add(0, "SECTION"); add(2, "HEADER");
    add(9, "$ACADVER"); add(1, "AC1009");
    add(9, "$INSBASE"); add(10, 0); add(20, 0); add(30, 0);
    add(9, "$EXTMIN"); add(10, num(x0)); add(20, num(y0)); add(30, 0);
    add(9, "$EXTMAX"); add(10, num(x1)); add(20, num(y1)); add(30, 0);
    add(9, "$LUNITS"); add(70, 2); add(9, "$LUPREC"); add(70, 4);
    add(9, "$INSUNITS"); add(70, unit === "in" ? 1 : 4);
    add(0, "ENDSEC");
    add(0, "SECTION"); add(2, "TABLES");
    add(0, "TABLE"); add(2, "LTYPE"); add(70, 1);
    add(0, "LTYPE"); add(2, "CONTINUOUS"); add(70, 0); add(3, "Solid line"); add(72, 65); add(73, 0); add(40, 0);
    add(0, "ENDTAB");
    const lay = ["0"].concat(names);
    add(0, "TABLE"); add(2, "LAYER"); add(70, lay.length);
    lay.forEach((n, i) => { add(0, "LAYER"); add(2, n); add(70, 0); add(62, i === 0 ? 7 : 1 + ((i - 1) % 6)); add(6, "CONTINUOUS"); });
    add(0, "ENDTAB");
    add(0, "TABLE"); add(2, "STYLE"); add(70, 1);
    add(0, "STYLE"); add(2, "STANDARD"); add(70, 0); add(40, 0); add(41, 1); add(50, 0); add(71, 0); add(42, 2.5); add(3, "txt"); add(4, "");
    add(0, "ENDTAB");
    add(0, "ENDSEC");
    add(0, "SECTION"); add(2, "BLOCKS"); add(0, "ENDSEC");
    add(0, "SECTION"); add(2, "ENTITIES");
    entities.forEach(e => {
      const q = e.pts, cl = e.closed !== false;
      if (e.kind === "point") { add(0, "POINT"); add(8, e.layer); add(10, num(q[0][0])); add(20, num(q[0][1])); add(30, 0); return; }
      if (e.kind === "circle") { add(0, "CIRCLE"); add(8, e.layer); add(10, num(e.c[0])); add(20, num(e.c[1])); add(30, 0); add(40, num(e.r)); return; }
      if (e.kind === "text") { add(0, "TEXT"); add(8, e.layer); add(10, num(q[0][0])); add(20, num(q[0][1])); add(30, 0); add(40, num(e.h)); add(1, asc(e.text)); return; }
      if (q.length < (cl ? 3 : 2)) return;
      add(0, "POLYLINE"); add(8, e.layer); add(66, 1); add(10, 0); add(20, 0); add(30, 0); add(70, cl ? 1 : 0);
      q.forEach(([x, y]) => { add(0, "VERTEX"); add(8, e.layer); add(10, num(x)); add(20, num(y)); add(30, 0); });
      add(0, "SEQEND"); add(8, e.layer);
    });
    add(0, "ENDSEC"); add(0, "EOF");
    return out.join("\r\n") + "\r\n";
  }
  function writeEntities(entities, unit, fmt) {
    fmt = fmt || FMT;
    if (fmt === "r12" || fmt === "torchmate") return writeR12(entities, unit, fmt === "torchmate");
    const groups = [];
    { const idx = {}; entities.forEach(e => { if (!(e.layer in idx)) { idx[e.layer] = groups.length; groups.push({ name: e.layer, polys: [] }); } groups[idx[e.layer]].polys.push(e.pts); }); }
    let seed = 0x30; const H = () => (seed++).toString(16).toUpperCase();
    const out = []; const add = (c, v) => out.push(String(c), String(v));
    const names = groups.map(g => g.name);
    const asc = t => String(t).replace(/[^\x20-\x7e]/g, "?");
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    entities.forEach(e => e.pts.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    if (!isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 0; }
    // fixed handles for the structural objects
    const hMS = "17", hPS = "1B", hBR = "9", hLT = "2", hLY = "1", hST = "5", hAP = "3", hDICT = "A";
    // HEADER
    add(0, "SECTION"); add(2, "HEADER");
    add(9, "$ACADVER"); add(1, "AC1015");
    add(9, "$DWGCODEPAGE"); add(3, "ANSI_1252");
    add(9, "$INSBASE"); add(10, 0); add(20, 0); add(30, 0);
    add(9, "$EXTMIN"); add(10, num(x0)); add(20, num(y0)); add(30, 0);
    add(9, "$EXTMAX"); add(10, num(x1)); add(20, num(y1)); add(30, 0);
    add(9, "$LIMMIN"); add(10, 0); add(20, 0);
    add(9, "$LIMMAX"); add(10, num(Math.max(x1, 420))); add(20, num(Math.max(y1, 297)));
    add(9, "$LTSCALE"); add(40, 1);
    add(9, "$CLAYER"); add(8, "0");
    add(9, "$LUNITS"); add(70, 2);
    add(9, "$LUPREC"); add(70, 4);
    add(9, "$MEASUREMENT"); add(70, unit === "in" ? 0 : 1);
    add(9, "$INSUNITS"); add(70, unit === "in" ? 1 : 4);
    add(9, "$HANDSEED"); add(5, "FFFFFF");
    add(0, "ENDSEC");
    // TABLES
    add(0, "SECTION"); add(2, "TABLES");
    const table = (name, handle, count, body) => { add(0, "TABLE"); add(2, name); add(5, handle); add(330, 0); add(100, "AcDbSymbolTable"); add(70, count); body && body(); add(0, "ENDTAB"); };
    table("LTYPE", hLT, 3, () => {
      [["ByBlock", "24"], ["ByLayer", "25"], ["Continuous", "26"]].forEach(([n, h]) => {
        add(0, "LTYPE"); add(5, h); add(330, hLT); add(100, "AcDbSymbolTableRecord"); add(100, "AcDbLinetypeTableRecord");
        add(2, n); add(70, 0); add(3, n === "Continuous" ? "Solid line" : ""); add(72, 65); add(73, 0); add(40, 0); });
    });
    const layerNames = ["0"].concat(names.filter(n => n !== "0"));
    table("LAYER", hLY, layerNames.length, () => {
      layerNames.forEach((n, i) => {
        add(0, "LAYER"); add(5, H()); add(330, hLY); add(100, "AcDbSymbolTableRecord"); add(100, "AcDbLayerTableRecord");
        add(2, n); add(70, 0); add(62, n === "0" ? 7 : (names.length > 1 ? 1 + ((i - 1) % 6) : 1)); add(6, "Continuous"); });
    });
    table("STYLE", hST, 1, () => {
      add(0, "STYLE"); add(5, "29"); add(330, hST); add(100, "AcDbSymbolTableRecord"); add(100, "AcDbTextStyleTableRecord");
      add(2, "Standard"); add(70, 0); add(40, 0); add(41, 1); add(50, 0); add(71, 0); add(42, 2.5); add(3, "txt"); add(4, "");
    });
    table("APPID", hAP, 1, () => {
      add(0, "APPID"); add(5, "2A"); add(330, hAP); add(100, "AcDbSymbolTableRecord"); add(100, "AcDbRegAppTableRecord"); add(2, "ACAD"); add(70, 0);
    });
    table("BLOCK_RECORD", hBR, 2, () => {
      add(0, "BLOCK_RECORD"); add(5, hMS); add(330, hBR); add(100, "AcDbSymbolTableRecord"); add(100, "AcDbBlockTableRecord"); add(2, "*Model_Space");
      add(0, "BLOCK_RECORD"); add(5, hPS); add(330, hBR); add(100, "AcDbSymbolTableRecord"); add(100, "AcDbBlockTableRecord"); add(2, "*Paper_Space");
    });
    add(0, "ENDSEC");
    // BLOCKS
    add(0, "SECTION"); add(2, "BLOCKS");
    [["*Model_Space", hMS, "18", "19"], ["*Paper_Space", hPS, "1C", "1D"]].forEach(([n, owner, hb, he]) => {
      add(0, "BLOCK"); add(5, hb); add(330, owner); add(100, "AcDbEntity"); add(8, "0"); add(100, "AcDbBlockBegin"); add(2, n); add(70, 0);
      add(10, 0); add(20, 0); add(30, 0); add(3, n); add(1, "");
      add(0, "ENDBLK"); add(5, he); add(330, owner); add(100, "AcDbEntity"); add(8, "0"); add(100, "AcDbBlockEnd"); });
    add(0, "ENDSEC");
    // ENTITIES
    add(0, "SECTION"); add(2, "ENTITIES");
    entities.forEach(e => {
      const q = e.pts, cl = e.closed !== false;
      if (e.kind === "point") { add(0, "POINT"); add(5, H()); add(330, hMS); add(100, "AcDbEntity"); add(8, e.layer); add(100, "AcDbPoint"); add(10, num(q[0][0])); add(20, num(q[0][1])); add(30, 0); return; }
      if (e.kind === "circle") { add(0, "CIRCLE"); add(5, H()); add(330, hMS); add(100, "AcDbEntity"); add(8, e.layer); add(100, "AcDbCircle"); add(10, num(e.c[0])); add(20, num(e.c[1])); add(30, 0); add(40, num(e.r)); return; }
      if (e.kind === "text") { add(0, "TEXT"); add(5, H()); add(330, hMS); add(100, "AcDbEntity"); add(8, e.layer); add(100, "AcDbText"); add(10, num(q[0][0])); add(20, num(q[0][1])); add(30, 0); add(40, num(e.h)); add(1, asc(e.text)); add(100, "AcDbText"); return; }
      if (q.length < (cl ? 3 : 2)) return;
      add(0, "LWPOLYLINE"); add(5, H()); add(330, hMS); add(100, "AcDbEntity"); add(8, e.layer);
      add(100, "AcDbPolyline"); add(90, q.length); add(70, cl ? 1 : 0); add(43, 0);
      q.forEach(([x, y]) => { add(10, num(x)); add(20, num(y)); });
    });
    add(0, "ENDSEC");
    // OBJECTS
    add(0, "SECTION"); add(2, "OBJECTS");
    add(0, "DICTIONARY"); add(5, hDICT); add(330, 0); add(100, "AcDbDictionary"); add(281, 1); add(3, "ACAD_GROUP"); add(350, "C");
    add(0, "DICTIONARY"); add(5, "C"); add(330, hDICT); add(100, "AcDbDictionary"); add(281, 1);
    add(0, "ENDSEC"); add(0, "EOF");
    return out.join("\r\n") + "\r\n";
  }

  /** DXF check: parse a DXF text back (LWPOLYLINE vertices + $INSUNITS) and measure its real extents, independent of the writer. */
  function measureDxf(text) {
    const L = String(text).split(/\r?\n/); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0, units = null, sec = "", inPoly = false, head = false, lastX = null, hdr = null;
    for (let i = 0; i + 1 < L.length; i += 2) {
      const c = L[i].trim(), v = L[i + 1].trim();
      if (c === "0" && v === "SECTION") { sec = ""; continue; }
      if (c === "2" && sec === "" ) { sec = v; continue; }
      if (sec === "HEADER") { if (c === "9") hdr = v; else if (hdr === "$INSUNITS" && c === "70") units = +v; continue; }
      if (sec !== "ENTITIES") continue;
      if (c === "0") { lastX = null; if (v === "VERTEX") { if (head) { head = false; inPoly = true; } continue; } head = v === "POLYLINE"; inPoly = v === "LWPOLYLINE"; if (inPoly || head) n++; continue; }
      if (!inPoly) continue;
      if (c === "10") lastX = parseFloat(v);
      else if (c === "20" && lastX !== null) { const y = parseFloat(v); if (lastX < x0) x0 = lastX; if (lastX > x1) x1 = lastX; if (y < y0) y0 = y; if (y > y1) y1 = y; lastX = null; }
    }
    if (!isFinite(x0)) return { polylines: n, insunits: units, unit: units === 1 ? "in" : units === 4 ? "mm" : null, minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    return { polylines: n, insunits: units, unit: units === 1 ? "in" : units === 4 ? "mm" : null, minX: x0, minY: y0, maxX: x1, maxY: y1, width: x1 - x0, height: y1 - y0 };
  }
  /** Bounding box [x0,y0,x1,y1] of plan entities (output units). */
  function entitiesBox(ents) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    ents.forEach(e => e.pts.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    return isFinite(x0) ? [x0, y0, x1, y1] : null;
  }

  // ------------------------------------------------------------------ selection / clip / split
  const bboxOf = q => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of q) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; } return [a, b, c, d]; };
  const ringArea = r => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s) / 2; };
  const closed = q => { const r = q.map(p => [p[0], p[1]]); const a = r[0], b = r[r.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) r.push([a[0], a[1]]); return r; };
  const rectPoly = ([x0, y0, x1, y1]) => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
  const safe = s => String(s).replace(/[^A-Za-z0-9_\-]/g, "_").slice(0, 60) || "X";

  /** Clip helper: intersection of polygon q (open ring) with a multipolygon region. Returns exterior rings (open arrays). */
  function intersectRings(q, regionMP) {
    let res;
    try { res = pc().intersection([closed(q)], regionMP); } catch (e) { return []; }
    const out = [];
    for (const poly of res) { const ext = poly[0]; if (ext && ext.length > 3 && ringArea(ext) > 1e-9) out.push(ext.slice(0, -1)); }
    return out;
  }

  // ------------------------------------------------------------------ nesting depth (for "cut inside first")
  const inRing = (x, y, q) => {                       // even-odd ray casting
    let c = false;
    for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
      const xi = q[i][0], yi = q[i][1], xj = q[j][0], yj = q[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  /** Number of other contours that geometrically contain each contour (0 = outermost). polys in px. */
  const depthCache = new WeakMap();
  function nestingDepths(polys) {
    if (depthCache.has(polys)) return depthCache.get(polys);
    const n = polys.length, bb = polys.map(bboxOf), ar = polys.map(q => ringArea(closed(q))), depth = new Array(n).fill(0);
    const order = polys.map((_, i) => i).sort((a, b) => ar[b] - ar[a]);
    for (let a = 0; a < n; a++) {
      const i = order[a], q = polys[i], k = Math.min(7, q.length), samples = [];
      for (let s = 0; s < k; s++) samples.push(q[Math.floor(s * q.length / k)]);
      for (let b = 0; b < a; b++) {                    // only larger contours can contain i
        const j = order[b], B = bb[j], I = bb[i];
        if (ar[j] <= ar[i] || I[0] < B[0] - 1e-9 || I[2] > B[2] + 1e-9 || I[1] < B[1] - 1e-9 || I[3] > B[3] + 1e-9) continue;
        let inside = 0; for (const [x, y] of samples) if (inRing(x, y, polys[j])) inside++;
        if (inside * 2 > k) depth[i]++;
      }
    }
    depthCache.set(polys, depth); return depth;
  }

  // ------------------------------------------------------------------ tabs / bridges
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  /** Split a closed ring (open array of [x,y] in output units) into open polylines leaving n gaps of length w, evenly spaced
      along the perimeter. Gaps are nudged onto a single straight edge when one is close, so each gap is exactly w long as a chord.
      opts: {width, count, spacing}. Returns {segs:[pts], gaps:[pts], n} or null if the contour is too small. */
  function ringTabs(ring, opts) {
    const w = opts.width, m = ring.length;
    if (!(w > 0) || m < 3) return null;
    const v = ring.concat([ring[0]]), L = [], cum = [0];
    for (let i = 0; i < m; i++) { L.push(dist(v[i], v[i + 1])); cum.push(cum[i] + L[i]); }
    const P = cum[m];
    let n = opts.spacing > 0 ? Math.max(1, Math.round(P / opts.spacing)) : Math.max(1, Math.round(opts.count || 1));
    n = Math.min(n, Math.floor(P / (3 * w)));
    if (n < 1) return null;
    const rad = P / (4 * n), gaps = [];
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) * P / n; let best = t, bd = Infinity;
      for (let i = 0; i < m; i++) {
        if (L[i] < w) continue;
        const lo = cum[i] + w / 2, hi = cum[i + 1] - w / 2, c = Math.max(lo, Math.min(hi, t)), d = Math.abs(c - t);
        if (d <= rad && d < bd) { bd = d; best = c; }
      }
      gaps.push([best - w / 2, best + w / 2]);
    }
    const at = s => {
      let i = 0; while (i < m - 1 && cum[i + 1] < s) i++;
      const t = L[i] > 0 ? Math.max(0, Math.min(1, (s - cum[i]) / L[i])) : 0;
      return [v[i][0] + (v[i + 1][0] - v[i][0]) * t, v[i][1] + (v[i + 1][1] - v[i][1]) * t];
    };
    const sub = (a, b) => {
      const out = [at(a)];
      for (let i = 1; i < m; i++) if (cum[i] > a + 1e-12 && cum[i] < b - 1e-12) out.push(v[i]);
      out.push(at(b)); return out;
    };
    const dedupe = q => q.filter((p, i) => i === 0 || dist(p, q[i - 1]) > 1e-9);
    const segs = [];
    for (let k = 0; k < n - 1; k++) segs.push(dedupe(sub(gaps[k][1], gaps[k + 1][0])));
    const last = sub(gaps[n - 1][1], P), first = sub(0, gaps[0][0]);
    segs.push(dedupe(last.concat(first.slice(1))));
    return { segs: segs.filter(q => q.length >= 2), gaps: gaps.map(g => sub(g[0], g[1])), n };
  }

  // ------------------------------------------------------------------ cut ordering
  /** units: [{paths:[{pts,closed}], depth}]. Reorders (and rotates closed rings / cyclic tab segments to start nearest the
      previous end point) according to o.insideFirst (deepest nesting first) and o.nearest (greedy nearest neighbour). */
  function orderUnits(units, o, start) {
    const insideFirst = !!o.insideFirst, nearest = !!o.nearest;
    if (!insideFirst && !nearest) return units;
    const tiers = [];
    if (insideFirst) {
      const by = new Map(); units.forEach(u => { if (!by.has(u.depth)) by.set(u.depth, []); by.get(u.depth).push(u); });
      [...by.keys()].sort((a, b) => b - a).forEach(d => tiers.push(by.get(d)));
    } else tiers.push(units.slice());
    const out = []; let pos = start || [0, 0];
    for (const tier of tiers) {
      if (!nearest || tier.length > 6000) { tier.forEach(u => out.push(u)); if (tier.length) pos = endOf(tier[tier.length - 1]); continue; }
      const rest = tier.slice();
      while (rest.length) {
        let bi = 0, bd = Infinity, bk = 0;
        for (let i = 0; i < rest.length; i++) {
          const u = rest[i], cands = u.paths.length === 1 && u.paths[0].closed ? u.paths[0].pts : u.paths.map(p => p.pts[0]);
          for (let k = 0; k < cands.length; k++) { const d = (cands[k][0] - pos[0]) ** 2 + (cands[k][1] - pos[1]) ** 2; if (d < bd) { bd = d; bi = i; bk = k; } }
        }
        const u = rest.splice(bi, 1)[0];
        if (u.paths.length === 1 && u.paths[0].closed) { const q = u.paths[0].pts; u.paths[0] = Object.assign({}, u.paths[0], { pts: q.slice(bk).concat(q.slice(0, bk)), closed: true }); }
        else u.paths = u.paths.slice(bk).concat(u.paths.slice(0, bk));
        out.push(u); pos = endOf(u);
      }
    }
    return out;
  }
  function endOf(u) { const p = u.paths[u.paths.length - 1]; return p.closed ? p.pts[0] : p.pts[p.pts.length - 1]; }

  // ------------------------------------------------------------------ plan: selection -> clip -> tabs -> order -> entities
  /** polys: px coords (y down). Options (o):
        pxW, pxH, scale (units/px, x), scaleY (defaults to scale), unit, selected (ids), regions [{rect px, label}], clip,
        split none|layers|files, groupBy contour|cell, insideFirst, nearest, innerOuterLayers (CUT_INNER / CUT_OUTER, one-file mode),
        isHole [bool per contour], tabs {width, count, spacing, allOuter, ids, skipHoles}
      Returns {entities:[{layer, pts (output units, y up), closed, cid, depth, seq}], layers, gaps:[{cid, pts}], stats} */
  function buildPlan(polys, o) {
    const { pxW, pxH } = o, sx = o.scale, sy = o.scaleY || o.scale, n = polys.length;
    const clip = !!o.clip, split = o.split || "none", groupBy = o.groupBy || "contour";
    let ids;
    if (o.selected == null) ids = polys.map((_, i) => i);
    else { ids = [...new Set(o.selected.map(Number))].sort((a, b) => a - b); if (ids.some(i => !(i >= 0 && i < n))) throw new Error("selected contains an unknown contour id"); }
    if (!ids.length) throw new Error("No contours selected");
    const cells = []; const seen = new Set();
    (o.regions || []).forEach((r, k) => {
      let [x0, y0, x1, y1] = r.rect.map(Number); [x0, x1] = [Math.max(0, x0), Math.min(pxW, x1)].sort((a, b) => a - b); [y0, y1] = [Math.max(0, y0), Math.min(pxH, y1)].sort((a, b) => a - b);
      if (x1 - x0 <= 0 || y1 - y0 <= 0) return;
      let label = safe(r.label || "AREA" + (k + 1)); while (seen.has(label)) label += "_"; seen.add(label);
      cells.push({ label, rect: [x0, y0, x1, y1], mp: [rectPoly([x0, y0, x1, y1])] });
    });
    if ((o.regions || []).length && !cells.length) throw new Error("Area of interest is empty");
    let area = null;
    if (cells.length) area = { mp: cells.length === 1 ? cells[0].mp : pc().union(...cells.map(c => c.mp)), rects: cells.map(c => c.rect) };
    const bb = {}; ids.forEach(i => bb[i] = bboxOf(polys[i]));
    const rectsTouch = (b, rects) => rects.some(([x0, y0, x1, y1]) => b[0] < x1 && b[2] > x0 && b[1] < y1 && b[3] > y0);
    function pieces(i, region) {                       // px rings of contour i within a region
      if (!region) return [polys[i]];
      if (!rectsTouch(bb[i], region.rects)) return [];
      const rings = intersectRings(polys[i], region.mp);
      if (!rings.length) return [];
      return clip ? rings : [polys[i]];
    }
    const toOut = q => q.map(([x, y]) => [x * sx, (pxH - y) * sy]);
    let groups;                                        // [[name, [{cid, ring}]]]
    const wrap = (i, region) => pieces(i, region).map(ring => ({ cid: i, ring }));
    if (split === "none") groups = [["CUT", ids.flatMap(i => wrap(i, area))]];
    else if (split === "layers" || split === "files") {
      if (groupBy === "cell") {
        if (!cells.length) throw new Error("Group by cell needs grid cells or a drawn region");
        groups = cells.map(c => ["CUT_" + c.label, ids.flatMap(i => wrap(i, { mp: c.mp, rects: [c.rect] }))]);
      } else if (groupBy === "contour") groups = ids.map(i => ["CUT_" + String(i).padStart(3, "0"), wrap(i, area)]);
      else throw new Error("group_by must be 'contour' or 'cell'");
    } else throw new Error("split must be none, layers or files");
    groups = groups.filter(g => g[1].length);
    if (!groups.length) throw new Error("Nothing to export: selection does not overlap the area of interest");

    const needDepth = o.insideFirst || o.innerOuterLayers;
    const depth = needDepth ? nestingDepths(polys) : null;
    const isHole = i => o.isHole ? !!o.isHole[i] : (depth ? depth[i] % 2 === 1 : false);
    const T = o.tabs && o.tabs.width > 0 ? o.tabs : null, flagged = new Set(T ? (T.ids || []).map(Number) : []);
    const gaps = [], stats = { units: 0, tabbed: 0, tabs: 0, tabSkipped: 0, maxDepth: 0 };
    let seqBase = 0;
    const planGroup = (name, items) => {
      let units = items.map(({ cid, ring }) => {
        const pts = toOut(ring), d = depth ? depth[cid] : 0, hole = isHole(cid);
        const layer = split === "none" ? (o.innerOuterLayers ? (d > 0 ? "CUT_INNER" : "CUT_OUTER") : "CUT") : name;
        let paths = [{ pts, closed: true }];
        if (T && ((T.allOuter && !hole) || (flagged.has(cid) && !(T.skipHoles && hole)))) {
          const r = ringTabs(pts, T);
          if (r) { paths = r.segs.map(q => ({ pts: q, closed: false })); r.gaps.forEach(g => gaps.push({ cid, pts: g })); stats.tabbed++; stats.tabs += r.n; }
          else stats.tabSkipped++;
        }
        return { layer, cid, depth: d, paths };
      });
      return units;
    };
    let ordered;
    if (split === "files") ordered = groups.flatMap(([name, items]) => orderUnits(planGroup(name, items), o));
    else ordered = orderUnits(groups.flatMap(([name, items]) => planGroup(name, items)), o);
    (o.extra || []).forEach((x, k) => { if (!x.pts || x.pts.length < 2) return;
      ordered.push({ layer: split === "none" ? (x.layerNone || "CUT") : (x.layer || "CUT_EXTRA"), cid: "e" + k, depth: 0, extra: x.kind || "line", paths: [{ pts: toOut(x.pts), closed: x.closed !== false }] }); });
    const entities = [];
    ordered.forEach((u, k) => { stats.units++; stats.maxDepth = Math.max(stats.maxDepth, u.depth); u.paths.forEach(p => entities.push({ layer: u.layer, pts: p.pts, closed: p.closed, cid: u.cid, depth: u.depth, seq: k + 1, extra: u.extra })); });
    const layers = []; entities.forEach(e => { if (layers.indexOf(e.layer) < 0) layers.push(e.layer); });
    return { entities, layers, gaps, stats };
  }

  /** Compatibility wrapper: plan grouped by layer -> [{name, polys}] (output units). */
  function buildGroups(polys, o) {
    const plan = buildPlan(polys, o), g = new Map();
    plan.entities.forEach(e => { if (!g.has(e.layer)) g.set(e.layer, []); g.get(e.layer).push(e.pts); });
    return [...g.entries()].map(([name, ps]) => ({ name, polys: ps }));
  }

  function shiftToOrigin(entities, ref) {
    let ox = Infinity, oy = Infinity; entities.forEach(e => e.pts.forEach(([x, y]) => { if (x < ox) ox = x; if (y < oy) oy = y; }));
    return entities.map(e => Object.assign({}, e, { pts: e.pts.map(([x, y]) => [x - ox, y - oy]) }));
  }

  // ------------------------------------------------------------------ nesting tree / merge touching contours
  /** parent[i] = index of the smallest contour that contains contour i (or -1). polys in px (any order). */
  function nestParents(polys) {
    const n = polys.length, bb = polys.map(bboxOf), ar = polys.map(q => ringArea(closed(q))), parent = new Array(n).fill(-1);
    const order = polys.map((_, i) => i).sort((a, b) => ar[b] - ar[a]);
    for (let a = 1; a < n; a++) {
      const i = order[a], q = polys[i], k = Math.min(7, q.length), I = bb[i], samples = [];
      for (let s = 0; s < k; s++) samples.push(q[Math.floor(s * q.length / k)]);
      for (let b = a - 1; b >= 0; b--) {                 // nearest larger first = smallest container
        const j = order[b], B = bb[j];
        if (ar[j] <= ar[i] || I[0] < B[0] - 1e-9 || I[2] > B[2] + 1e-9 || I[1] < B[1] - 1e-9 || I[3] > B[3] + 1e-9) continue;
        let inside = 0; for (const [x, y] of samples) if (inRing(x, y, polys[j])) inside++;
        if (inside * 2 > k) { parent[i] = j; break; }
      }
    }
    return parent;
  }
  /** root[i] = outermost contour containing (or equal to) contour i. */
  function nestRoots(polys) {
    const parent = nestParents(polys), root = new Array(polys.length);
    const find = i => { while (parent[i] >= 0) i = parent[i]; return i; };
    for (let i = 0; i < polys.length; i++) root[i] = find(i);
    return root;
  }
  const segDist2 = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy; return [(px - cx) ** 2 + (py - cy) ** 2, cx, cy];
  };
  const segsCross = (a, b, c, d) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
  };
  /** true when the two rings (open arrays) come within tol of each other or cross. */
  function ringsNear(A, B, tol) {
    const bA = bboxOf(A), bB = bboxOf(B), t = tol + 1e-9;
    if (bA[0] > bB[2] + t || bB[0] > bA[2] + t || bA[1] > bB[3] + t || bB[1] > bA[3] + t) return false;
    const t2 = t * t, na = A.length, nb = B.length;
    for (let i = 0; i < na; i++) {
      const a0 = A[i], a1 = A[(i + 1) % na], sx0 = Math.min(a0[0], a1[0]) - t, sx1 = Math.max(a0[0], a1[0]) + t, sy0 = Math.min(a0[1], a1[1]) - t, sy1 = Math.max(a0[1], a1[1]) + t;
      for (let j = 0; j < nb; j++) {
        const b0 = B[j], b1 = B[(j + 1) % nb];
        if (Math.max(b0[0], b1[0]) < sx0 || Math.min(b0[0], b1[0]) > sx1 || Math.max(b0[1], b1[1]) < sy0 || Math.min(b0[1], b1[1]) > sy1) continue;
        if (segsCross(a0, a1, b0, b1)) return true;
        if (segDist2(a0[0], a0[1], b0[0], b0[1], b1[0], b1[1])[0] <= t2 || segDist2(a1[0], a1[1], b0[0], b0[1], b1[0], b1[1])[0] <= t2 ||
            segDist2(b0[0], b0[1], a0[0], a0[1], a1[0], a1[1])[0] <= t2 || segDist2(b1[0], b1[1], a0[0], a0[1], a1[0], a1[1])[0] <= t2) return true;
      }
    }
    return false;
  }
  /** Snap vertices of ring A that lie within tol of ring B onto B's outline (inserting the point into B), so shared edges coincide exactly. Mutates arrays. */
  function snapRings(A, B, tol) {
    const t2 = tol * tol;
    for (let i = 0; i < A.length; i++) {
      let best = Infinity, bj = -1, bq = null;
      for (let j = 0; j < B.length; j++) {
        const b0 = B[j], b1 = B[(j + 1) % B.length], [d, cx, cy] = segDist2(A[i][0], A[i][1], b0[0], b0[1], b1[0], b1[1]);
        if (d < best) { best = d; bj = j; bq = [cx, cy]; }
      }
      if (bj < 0 || best > t2 || best === 0) continue;
      A[i] = [bq[0], bq[1]];
      const b0 = B[bj], b1 = B[(bj + 1) % B.length];
      if (Math.hypot(bq[0] - b0[0], bq[1] - b0[1]) > 1e-9 && Math.hypot(bq[0] - b1[0], bq[1] - b1[1]) > 1e-9) B.splice(bj + 1, 0, [bq[0], bq[1]]);
    }
  }
  /** Merge touching / overlapping / within-tol contours. polys px; scope = ids allowed to merge (default all); tol in px.
      Returns {removed:[ids], added:[{pts,hole,from:[ids]}], before, after, clusters}. Holes stay holes (nesting respected); unaffected contours are untouched. */
  function mergeContours(polys, scope, tol) {
    const n = polys.length, parent = nestParents(polys), depth = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let d = 0, j = parent[i]; while (j >= 0) { d++; j = parent[j]; } depth[i] = d; }
    const inScope = new Set(scope == null ? polys.map((_, i) => i) : scope);
    const kids = new Map(); for (let i = 0; i < n; i++) if (depth[i] % 2 === 1 && parent[i] >= 0) { if (!kids.has(parent[i])) kids.set(parent[i], []); kids.get(parent[i]).push(i); }
    const regs = []; for (let i = 0; i < n; i++) if (depth[i] % 2 === 0 && inScope.has(i)) regs.push({ ext: i, holes: kids.get(i) || [] });
    const uf = regs.map((_, i) => i), find = i => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
    const rings = r => [r.ext].concat(r.holes), bbR = regs.map(r => bboxOf(polys[r.ext])), t = tol + 1e-9;
    for (let a = 0; a < regs.length; a++) for (let b = a + 1; b < regs.length; b++) {
      if (find(a) === find(b)) continue;
      const A = bbR[a], B = bbR[b]; if (A[0] > B[2] + t || B[0] > A[2] + t || A[1] > B[3] + t || B[1] > A[3] + t) continue;
      let hit = false;
      for (const i of rings(regs[a])) { for (const j of rings(regs[b])) if (ringsNear(polys[i], polys[j], tol)) { hit = true; break; } if (hit) break; }
      if (hit) uf[find(a)] = find(b);
    }
    const groups = new Map(); regs.forEach((r, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); });
    const removed = [], added = []; let before = 0, after = 0, clusters = 0;
    for (const g of groups.values()) {
      if (g.length < 2) continue;
      clusters++;
      const ids = g.flatMap(rings), cp = new Map(ids.map(i => [i, polys[i].map(p => [p[0], p[1]])]));
      if (tol > 1e-9) for (const x of ids) for (const y of ids) if (x !== y) { const rx = g.find(r => rings(r).includes(x)), ry = g.find(r => rings(r).includes(y)); if (rx !== ry && ringsNear(cp.get(x), cp.get(y), tol)) snapRings(cp.get(x), cp.get(y), tol); }
      const mp = g.map(r => rings(r).map(i => closed(cp.get(i))));
      let res; try { res = pc().union(...mp.map(m => [m])); } catch (e) { continue; }
      const out = [];
      for (const poly of res) poly.forEach((ring, k) => { const q = ring.slice(0, -1); if (q.length >= 3 && ringArea(ring) > 1e-6) out.push({ pts: q, hole: k > 0, from: ids }); });
      removed.push(...ids); before += ids.length; after += out.length; added.push(...out);
    }
    return { removed, added, before, after, clusters };
  }

  // ------------------------------------------------------------------ table sections (material-move stopping points)
  /** One axis of the job: sections along min..max for a table of length L with overlap ov. Returns [{lo,hi,off}] in pass order (off = window origin). */
  function axisPlan(min, max, L, ov, fromMax) {
    const step = L - ov; if (!(L > 0) || !(step > 0)) throw new Error("Table size must be larger than the overlap");
    const ext = max - min, n = ext <= L + 1e-9 ? 1 : Math.ceil((ext - L) / step - 1e-9) + 1, out = [];
    for (let i = 0; i < n; i++) {
      if (n === 1) { out.push(fromMax ? { lo: min, hi: max, off: max - L } : { lo: min, hi: max, off: min }); continue; }
      if (!fromMax) { const lo = min + i * step; out.push({ lo, hi: i === n - 1 ? max : lo + step, off: lo }); }
      else { const hi = max - i * step; out.push({ lo: i === n - 1 ? min : hi - step, hi, off: hi - L }); }
    }
    return out;
  }
  /** Liang-Barsky clip of an open/closed polyline to a rectangle -> [{pts, closed}] runs. dropLines [{axis:'x'|'y', v}] remove collinear stretches (break lines owned by the other pass). */
  function clipPolyline(pts, isClosed, rect, dropLines, eps) {
    const [x0, y0, x1, y1] = rect, n = pts.length, m = isClosed ? n : n - 1, segs = [];
    for (let i = 0; i < m; i++) {
      const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1]; let t0 = 0, t1 = 1, ok = true;
      for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
        if (Math.abs(p) < 1e-15) { if (q < -eps) { ok = false; break; } }
        else { const r = q / p; if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; } }
      }
      if (!ok || t1 - t0 < 1e-12) { segs.push(null); continue; }
      const p = [a[0] + dx * t0, a[1] + dy * t0], q = [a[0] + dx * t1, a[1] + dy * t1];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < eps) { segs.push(null); continue; }
      if ((dropLines || []).some(d => { const k = d.axis === "x" ? 0 : 1; return Math.abs(p[k] - d.v) < eps && Math.abs(q[k] - d.v) < eps; })) { segs.push(null); continue; }
      segs.push({ p, q, full: t0 === 0 && t1 === 1 });
    }
    if (isClosed && segs.every(s => s && s.full)) return [{ pts: pts, closed: true }];
    const runs = [];
    segs.forEach(sg => {
      if (!sg) { runs.push(null); return; }
      const last = runs.length ? runs[runs.length - 1] : null;
      if (last && Math.hypot(last[last.length - 1][0] - sg.p[0], last[last.length - 1][1] - sg.p[1]) < eps) last.push(sg.q);
      else runs.push([sg.p, sg.q]);
    });
    let rr = runs.filter(Boolean);
    if (isClosed && segs[0] && segs[m - 1] && rr.length >= 2 && runs[0] && runs[runs.length - 1]) {          // ring start lies inside the region: join last+first
      const f = rr[0], l = rr[rr.length - 1];
      if (Math.hypot(l[l.length - 1][0] - f[0][0], l[l.length - 1][1] - f[0][1]) < eps) { rr = rr.slice(1, -1).concat([l.concat(f.slice(1))]); }
    }
    return rr.map(q => ({ pts: q, closed: false })).filter(r => { let L = 0; for (let i = 1; i < r.pts.length; i++) L += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]); return L > eps; });
  }
  /** Split plan entities (output units, y up) into table passes.
      T: {L,H,overlap,corner:'bl|br|tl|tr',mode:'clip'|'whole',park:'bl|br|tl|tr|custom',parkX,parkY,marks,unit}  roots: contour id -> root contour id (whole mode).
      Returns {passes:[{n,label,c,r,region,ox,oy,ents,park,move}], cols, rows, warnings, box}. Entity coordinates are in JOB space; use translatePass() for table space. */
  function sectionize(ents, T, roots) {
    const box = entitiesBox(ents), warnings = [];
    if (!box) return { passes: [], cols: [], rows: [], warnings, box: null };
    const ov = Math.max(0, T.overlap || 0), eps = 1e-7 * Math.max(1, T.L, T.H);
    const cols = axisPlan(box[0], box[2], T.L, ov, T.corner[1] === "r"), rows = axisPlan(box[1], box[3], T.H, ov, T.corner[0] === "t");
    const passes = []; let n = 0;
    rows.forEach((R, r) => cols.forEach((C, c) => passes.push({ n: ++n, label: "Pass " + n, c, r, region: [C.lo, R.lo, C.hi, R.hi], ox: C.off, oy: R.off, ents: [] })));
    const fx = T.corner[1] === "r", fy = T.corner[0] === "t";
    if (T.mode === "whole") {
      const ctr = new Map(), grp = new Map();
      ents.forEach(e => { const k = roots ? (roots[e.cid] != null ? roots[e.cid] : e.cid) : e.cid; if (!grp.has(k)) grp.set(k, []); grp.get(k).push(e); });
      const mine = new Map(); ents.forEach(e => { if (!mine.has(e.cid)) mine.set(e.cid, []); mine.get(e.cid).push(e); });
      const pick = (arr, v) => { for (let i = 0; i < arr.length; i++) if (v >= arr[i].lo - eps && v <= arr[i].hi + eps) return i; return arr.length - 1; };
      grp.forEach((list, k) => {
        const base = (mine.get(k) || list), b = entitiesBox(base), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        const c = pick(cols, cx), r = pick(rows, cy), P = passes[r * cols.length + c], gb = entitiesBox(list);
        list.forEach(e => P.ents.push(e));
        if (gb[2] - gb[0] > T.L + eps || gb[3] - gb[1] > T.H + eps) warnings.push(`Contour #${k} (${(gb[2] - gb[0]).toFixed(3)} x ${(gb[3] - gb[1]).toFixed(3)} ${T.unit}) is larger than the table (${T.L} x ${T.H} ${T.unit}): use "cut across the break" instead`);
        else if (gb[0] < P.ox - eps || gb[2] > P.ox + T.L + eps || gb[1] < P.oy - eps || gb[3] > P.oy + T.H + eps) warnings.push(`Contour #${k} sits across a break and does not fit inside ${P.label}'s table window`);
      });
      const idx = new Map(ents.map((e, i) => [e, i])); passes.forEach(P => P.ents.sort((a, b) => idx.get(a) - idx.get(b)));
    } else {
      passes.forEach(P => {
        const [x0, y0, x1, y1] = P.region, drop = [];
        if (P.c > 0) drop.push({ axis: "x", v: fx ? x1 : x0 }); if (P.r > 0) drop.push({ axis: "y", v: fy ? y1 : y0 });
        ents.forEach(e => {
          let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of e.pts) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
          if (c < x0 - eps || a > x1 + eps || d < y0 - eps || b > y1 + eps) return;
          if (a >= x0 - eps && c <= x1 + eps && b >= y0 - eps && d <= y1 + eps && !drop.some(q => { const k = q.axis === "x" ? 0 : 1; return e.pts.every(p => Math.abs(p[k] - q.v) < eps); })) { P.ents.push(e); return; }
          clipPolyline(e.pts, e.closed !== false, P.region, drop, eps).forEach(pc2 => P.ents.push(Object.assign({}, e, { pts: pc2.pts, closed: pc2.closed })));
        });
      });
    }
    // cut order is per pass: Pass 1 is cut first, and inside each pass the order restarts at 1
    // (inside-first / nearest-next applied within the pass, starting from the table origin of that pass)
    passes.forEach(P => { P.ents = orderPass(P.ents, T, [P.ox, P.oy]); });
    // park + material move + registration marks
    const parkAt = P => T.park === "custom" ? [T.parkX || 0, T.parkY || 0] : [T.park[1] === "r" ? T.L : 0, T.park[0] === "t" ? T.H : 0];
    const mk = 0.25 * (T.unit === "in" ? 1 : 25.4), marks = [];
    if (T.marks && ov <= 0 && passes.length > 1) warnings.push("Registration marks need an overlap greater than 0");
    if (T.marks && ov > 0) {
      const cross = (x, y) => [{ pts: [[x - mk, y], [x + mk, y]], closed: false }, { pts: [[x, y - mk], [x, y + mk]], closed: false }];
      for (let r = 0; r < rows.length; r++) for (let c = 0; c + 1 < cols.length; c++) {
        const xb = fx ? cols[c].lo - ov / 2 : cols[c].hi + ov / 2, R = rows[r], ys = [R.lo + 0.25 * (R.hi - R.lo), R.lo + 0.75 * (R.hi - R.lo)];
        ys.forEach(y => marks.push({ x: xb, y, a: r * cols.length + c, b: r * cols.length + c + 1 }));
      }
      for (let c = 0; c < cols.length; c++) for (let r = 0; r + 1 < rows.length; r++) {
        const yb = fy ? rows[r].lo - ov / 2 : rows[r].hi + ov / 2, C = cols[c], xs = [C.lo + 0.25 * (C.hi - C.lo), C.lo + 0.75 * (C.hi - C.lo)];
        xs.forEach(x => marks.push({ x, y: yb, a: r * cols.length + c, b: (r + 1) * cols.length + c }));
      }
      marks.forEach(m => { passes[m.a].ents.push(...cross(m.x, m.y).map(q => ({ layer: "REG_MARK", pts: q.pts, closed: false, cid: -1 })));
        passes[m.b].ents.push(...cross(m.x, m.y).map(q => ({ layer: "REG_ALIGN", pts: q.pts, closed: false, cid: -1 }))); });
    }
    passes.forEach((P, i) => {
      P.park = parkAt(P); const N = passes[i + 1];
      P.move = N ? [-(N.ox - P.ox), -(N.oy - P.oy)] : null;       // material slide for the next pass
    });
    return { passes, cols, rows, warnings, box };
  }
  /** Re-order one pass' entities by unit (all pieces of one planned cut share e.seq) and number them 1..n (e.pseq). */
  function orderPass(ents, T, start) {
    const units = [], by = new Map();
    ents.forEach((e, i) => { const k = e.seq != null ? "s" + e.seq : "x" + i; let u = by.get(k);
      if (!u) { u = { depth: e.depth || 0, cid: e.cid, paths: [] }; by.set(k, u); units.push(u); } u.paths.push(Object.assign({}, e, { closed: e.closed !== false })); });
    const fr = units.filter(u => u.paths.some(p => p.extra === "frame")), rest = units.filter(u => fr.indexOf(u) < 0);
    const ord = orderUnits(rest, { insideFirst: !!T.insideFirst, nearest: !!T.nearest }, start).concat(fr), out = [];
    ord.forEach((u, k) => u.paths.forEach(p => out.push(Object.assign({}, p, { pseq: k + 1 }))));
    return out;
  }
  /** Translate a pass' entities into table coordinates ((0,0) = table lower-left of that pass). */
  const translateEnts = (ents, ox, oy) => ents.map(e => Object.assign({}, e, { pts: e.pts.map(([x, y]) => [x - ox, y - oy]) }));
  /** Park marker entities (POINT + CIRCLE + TEXT on layer PARK) at table position pos. */
  function parkEntities(P, N, T, pos) {
    const u = T.unit, k = u === "in" ? 1 : 25.4, f = v => (+v.toFixed(3)).toString();
    const label = N ? `PASS ${P.n}/${N} PARK - move material X ${f(P.move[0])} Y ${f(P.move[1])} ${u}` : `PASS ${P.n}/${N || P.n} PARK - job complete`;
    return [{ layer: "PARK", kind: "point", pts: [pos], closed: false, cid: -1 }, { layer: "PARK", kind: "circle", c: pos, r: 0.125 * k, pts: [[pos[0] - 0.125 * k, pos[1] - 0.125 * k], [pos[0] + 0.125 * k, pos[1] + 0.125 * k]], closed: false, cid: -1 },
      { layer: "PARK", kind: "text", pts: [[pos[0] + 0.2 * k, pos[1] + 0.2 * k]], h: 0.15 * k, text: label, closed: false, cid: -1 }];
  }
  /** Build output files for a table job. Returns [{name, text, ents}] (one per pass, or one combined file). */
  function tableFiles(plan, T, roots, unit) {
    const S = sectionize(plan.entities, Object.assign({ unit }, T), roots), N = S.passes.length, files = [];
    if (!N) throw new Error("Nothing to export");
    if (T.single) {
      let es = [];
      S.passes.forEach(P => {
        es.push(...P.ents.map(e => /^REG_/.test(e.layer) || e.layer === "PARK" ? e : Object.assign({}, e, { layer: "SECTION_" + P.n })));
        const frame = [[P.ox, P.oy], [P.ox + T.L, P.oy], [P.ox + T.L, P.oy + T.H], [P.ox, P.oy + T.H]];
        es.push({ layer: "TABLE_FRAME", pts: frame, closed: true, cid: -1 });
        es.push(...parkEntities(P, N > P.n ? N : 0, Object.assign({ unit }, T), [P.ox + P.park[0], P.oy + P.park[1]]).map(e => e));
      });
      files.push({ name: "cut_sections.dxf", ents: es, text: writeEntities(es, unit) });
    } else S.passes.forEach(P => {
      const es = translateEnts(P.ents, P.ox, P.oy).concat(parkEntities(P, P.n < N ? N : 0, Object.assign({ unit }, T), P.park));
      files.push({ name: `pass_${String(P.n).padStart(2, "0")}.dxf`, ents: es, text: writeEntities(es, unit), pass: P });
    });
    return { files, sections: S };
  }

  // ------------------------------------------------------------------ ZIP (store or deflate-raw via CompressionStream)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const cs = new CompressionStream("deflate-raw"); const w = cs.writable.getWriter(); w.write(bytes); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch (e) { return null; }
  }
  /** files: [{name, data:Uint8Array}] -> Uint8Array zip */
  async function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data); let comp = await deflateRaw(f.data), method = 8;
      if (!comp || comp.length >= f.data.length) { comp = f.data; method = 0; }
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, dosT, true); lh.setUint16(12, dosD, true); lh.setUint32(14, crc, true); lh.setUint32(18, comp.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, comp);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
      ch.setUint16(12, dosT, true); ch.setUint16(14, dosD, true); ch.setUint32(16, crc, true); ch.setUint32(20, comp.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + comp.length;
    }
    const csize = central.reduce((a, b) => a + b.length, 0);
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]); const total = all.reduce((a, b) => a + b.length, 0), res = new Uint8Array(total); let p = 0;
    for (const a of all) { res.set(a, p); p += a.length; }
    return res;
  }

  function planText(S, T, unit) {
    const f = v => (+v.toFixed(3)).toString(), L = ["CUT PLAN - " + S.passes.length + " passes, table " + T.L + " x " + T.H + " " + unit + ", overlap " + (T.overlap || 0) + " " + unit + ", start corner " + T.corner, ""];
    S.passes.forEach(P => L.push(`${P.label}: file pass_${String(P.n).padStart(2, "0")}.dxf  region X ${f(P.region[0])}..${f(P.region[2])}  Y ${f(P.region[1])}..${f(P.region[3])} (job coordinates)  park ${f(P.park[0])},${f(P.park[1])}` + (P.move ? `  then slide material X ${f(P.move[0])} Y ${f(P.move[1])} ${unit}` : "  (last pass)")));
    if (S.warnings.length) { L.push("", "WARNINGS:"); S.warnings.forEach(w => L.push(" - " + w)); }
    return L.join("\r\n") + "\r\n";
  }

  /** High level export: returns {bytes:Uint8Array|string, mime, filename, paths, groups, plan} */
  async function exportDxf(polys, o) {
    const prev = FMT; setFormat(o.format || "r2000");
    try { return await exportDxf0(polys, o); } finally { FMT = prev; }
  }
  async function exportDxf0(polys, o) {
    const plan = buildPlan(polys, o); let ents = plan.entities;
    const enc = new TextEncoder(), paths = ents.length;
    if (o.table && o.table.on) {
      const tf = tableFiles(plan, Object.assign({}, o.table, { insideFirst: o.insideFirst, nearest: o.nearest }), nestRoots(polys), o.unit), ms = tf.files.map(f => measureDxf(f.text));
      const check = { polylines: ms.reduce((a, m) => a + m.polylines, 0), insunits: ms[0].insunits, unit: ms[0].unit, width: Math.max(...ms.map(m => m.width)), height: Math.max(...ms.map(m => m.height)),
        files: ms.length, perFile: ms.map((m, i) => ({ name: tf.files[i].name, width: m.width, height: m.height })), table: true, warnings: tf.sections.warnings };
      if (tf.files.length === 1) return { bytes: enc.encode(tf.files[0].text), mime: "application/dxf", filename: tf.files[0].name, paths, groups: plan.layers.length, plan, check, sections: tf.sections };
      return { bytes: await makeZip(tf.files.map(f => ({ name: f.name, data: enc.encode(f.text) })).concat([{ name: "cut_plan.txt", data: enc.encode(planText(tf.sections, o.table, o.unit)) }])),
        mime: "application/zip", filename: "cut_passes.zip", paths, groups: tf.files.length, plan, check, sections: tf.sections };
    }
    if (o.split === "files") {
      const texts = [];
      const files = plan.layers.map(l => { let es = ents.filter(e => e.layer === l); if (o.zeroOrigin) es = shiftToOrigin(es); const t = writeEntities(es, o.unit); texts.push(t); return { name: l + ".dxf", data: enc.encode(t) }; });
      const ms = texts.map(measureDxf), u = o.zeroOrigin ? null : { x0: Math.min(...ms.map(m => m.minX)), y0: Math.min(...ms.map(m => m.minY)), x1: Math.max(...ms.map(m => m.maxX)), y1: Math.max(...ms.map(m => m.maxY)) };
      const check = { polylines: ms.reduce((a, m) => a + m.polylines, 0), insunits: ms[0] ? ms[0].insunits : null, unit: ms[0] ? ms[0].unit : null, files: ms.length,
        width: u ? u.x1 - u.x0 : Math.max(...ms.map(m => m.width)), height: u ? u.y1 - u.y0 : Math.max(...ms.map(m => m.height)), perFile: ms.map((m, i) => ({ name: files[i].name, width: m.width, height: m.height })) };
      return { bytes: await makeZip(files), mime: "application/zip", filename: "cut_files.zip", paths, groups: plan.layers.length, plan, check };
    }
    if (o.zeroOrigin) ents = shiftToOrigin(ents);
    const text = writeEntities(ents, o.unit);
    return { bytes: enc.encode(text), mime: "application/dxf", filename: "cut.dxf", paths, groups: plan.layers.length, plan, check: measureDxf(text) };
  }

  const api = { nestParents, nestRoots, mergeContours, axisPlan, clipPolyline, sectionize, tableFiles, planText, measureDxf, entitiesBox, bboxOf, writeDxf, writeEntities, buildPlan, buildGroups, exportDxf, makeZip, crc32, nestingDepths, ringTabs, orderUnits, setFormat, FORMATS, writeR12, inRing };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.I2D_DXF = api;
})(typeof self !== "undefined" ? self : this);
