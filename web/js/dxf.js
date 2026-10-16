/* Minimal DXF (AutoCAD R2000 / AC1015) writer: closed LWPOLYLINEs on named layers, $INSUNITS set.
   Also: selection/clip/split logic (uses polygon-clipping) and a tiny ZIP writer. No other dependencies. */
(function (root) {
  "use strict";
  const pc = () => (typeof polygonClipping !== "undefined" ? polygonClipping : require("./polygon-clipping.umd.min.js"));

  // ------------------------------------------------------------------ DXF writer
  const num = v => { if (Math.abs(v) < 1e-12) v = 0; let s = v.toFixed(6); if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s === "-0" ? "0" : s; };

  /** groups: [{name, polys:[[ [x,y],.. ]]}] in output units (y up). unit 'mm'|'in'. */
  function writeDxf(groups, unit) {
    let seed = 0x30; const H = () => (seed++).toString(16).toUpperCase();
    const out = []; const add = (c, v) => out.push(String(c), String(v));
    const names = []; groups.forEach(g => { if (names.indexOf(g.name) < 0) names.push(g.name); });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    groups.forEach(g => g.polys.forEach(q => q.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; })));
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
    groups.forEach(g => g.polys.forEach(q => {
      if (q.length < 3) return;
      add(0, "LWPOLYLINE"); add(5, H()); add(330, hMS); add(100, "AcDbEntity"); add(8, g.name);
      add(100, "AcDbPolyline"); add(90, q.length); add(70, 1); add(43, 0);
      q.forEach(([x, y]) => { add(10, num(x)); add(20, num(y)); });
    }));
    add(0, "ENDSEC");
    // OBJECTS
    add(0, "SECTION"); add(2, "OBJECTS");
    add(0, "DICTIONARY"); add(5, hDICT); add(330, 0); add(100, "AcDbDictionary"); add(281, 1); add(3, "ACAD_GROUP"); add(350, "C");
    add(0, "DICTIONARY"); add(5, "C"); add(330, hDICT); add(100, "AcDbDictionary"); add(281, 1);
    add(0, "ENDSEC"); add(0, "EOF");
    return out.join("\r\n") + "\r\n";
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

  /** Mirrors selection.build_groups. polys: px coords (y down). scale: units/px. regions: [{rect:[x0,y0,x1,y1] px, label}].
      Returns {groups:[{name, polys}] in OUTPUT units (y up)} */
  function buildGroups(polys, o) {
    const { pxW, pxH, scale } = o; const n = polys.length;
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
    // contour i within a region {mp,rects}: returns list of px rings
    function pieces(i, region) {
      if (!region) return [polys[i]];
      if (!rectsTouch(bb[i], region.rects)) return [];
      const rings = intersectRings(polys[i], region.mp);
      if (!rings.length) return [];
      return clip ? rings : [polys[i]];
    }
    const toOut = q => q.map(([x, y]) => [x * scale, (pxH - y) * scale]);
    let groups;
    if (split === "none") groups = [["CUT", ids.flatMap(i => pieces(i, area))]];
    else if (split === "layers" || split === "files") {
      if (groupBy === "cell") {
        if (!cells.length) throw new Error("Group by cell needs grid cells or a drawn region");
        groups = cells.map(c => ["CUT_" + c.label, ids.flatMap(i => pieces(i, { mp: c.mp, rects: [c.rect] }))]);
      } else if (groupBy === "contour") groups = ids.map(i => ["CUT_" + String(i).padStart(3, "0"), pieces(i, area)]);
      else throw new Error("group_by must be 'contour' or 'cell'");
    } else throw new Error("split must be none, layers or files");
    groups = groups.filter(g => g[1].length).map(([name, ps]) => ({ name, polys: ps.map(toOut) }));
    if (!groups.length) throw new Error("Nothing to export: selection does not overlap the area of interest");
    return groups;
  }

  function shiftToOrigin(groups) {
    let ox = Infinity, oy = Infinity; groups.forEach(g => g.polys.forEach(q => q.forEach(([x, y]) => { if (x < ox) ox = x; if (y < oy) oy = y; })));
    return groups.map(g => ({ name: g.name, polys: g.polys.map(q => q.map(([x, y]) => [x - ox, y - oy])) }));
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

  /** High level export: returns {bytes:Uint8Array|string, mime, filename, paths, groups} */
  async function exportDxf(polys, o) {
    let groups = buildGroups(polys, o);
    const enc = new TextEncoder(); const paths = groups.reduce((a, g) => a + g.polys.length, 0);
    if (o.split === "files") {
      const files = groups.map(g => { const gs = o.zeroOrigin ? shiftToOrigin([g]) : [g]; return { name: g.name + ".dxf", data: enc.encode(writeDxf(gs, o.unit)) }; });
      return { bytes: await makeZip(files), mime: "application/zip", filename: "cut_files.zip", paths, groups: groups.length };
    }
    if (o.zeroOrigin) groups = shiftToOrigin(groups);
    return { bytes: enc.encode(writeDxf(groups, o.unit)), mime: "application/dxf", filename: "cut.dxf", paths, groups: groups.length };
  }

  const api = { writeDxf, buildGroups, exportDxf, makeZip, crc32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.I2D_DXF = api;
})(typeof self !== "undefined" ? self : this);
