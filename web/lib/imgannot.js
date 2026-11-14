/* Screenshot annotator: the objects you draw on a picture (arrows, boxes, ellipses, lines, pen, text, numbered steps, highlights, hidden areas), their geometry
   (hit tests, moving, resizing handles) and how they are drawn on a canvas. Coordinates are in picture pixels. Pure code apart from draw(), which only calls
   the canvas drawing methods it is given. Needs lib/imgmath.js for hidden areas (looked up when used). Exports window.ImgAnnot. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const FONT = 'Arial, "Liberation Sans", "Noto Sans", Helvetica, sans-serif';
  const COLORS = ["#E5202E", "#F28C00", "#F7D200", "#2FA84F", "#1C7FE0", "#7A3FC4", "#111111", "#FFFFFF"];
  const SIZES = { s: 1, m: 1.8, l: 3 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lineWidth = (size, W, H) => Math.max(2, Math.round(Math.max(2, Math.round(Math.min(W, H) / 260)) * (SIZES[size] || 1.8)));
  const fontPx = (size, W, H) => Math.round(Math.max(14, Math.min(W, H) / 28) * ({ s: 0.75, m: 1, l: 1.6 }[size] || 1));
  const rectOf = o => { const x = Math.min(o.x, o.x + o.w), y = Math.min(o.y, o.y + o.h); return { x, y, w: Math.abs(o.w), h: Math.abs(o.h) }; };
  const lum = hex => { const m = /^#([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return 0; const v = parseInt(m[1], 16); return (v >> 16) * 0.299 + (v >> 8 & 255) * 0.587 + (v & 255) * 0.114; };
  const textSize = o => { const lines = String(o.s || "").split("\n"); const w = o._w || Math.max(...lines.map(l => l.length)) * o.size * 0.58, h = o._h || lines.length * o.size * 1.25; return { w, h }; };

  function distSeg(px, py, x1, y1, x2, y2) { const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy; let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = clamp(t, 0, 1); return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)); }

  function bounds(o) {
    const pad = (o.lw || 0) / 2;
    switch (o.t) {
      case "rect": case "ellipse": case "hl": case "hide": { const r = rectOf(o); return { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }; }
      case "line": case "arrow": { const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), p = pad + (o.t === "arrow" ? o.lw * 3 : 0); return { x: x - p, y: y - p, w: Math.abs(o.x2 - o.x1) + 2 * p, h: Math.abs(o.y2 - o.y1) + 2 * p }; }
      case "pen": { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of o.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }; }
      case "text": { const s = textSize(o), m = o.style === "label" ? o.size * 0.3 : 0; return { x: o.x - m, y: o.y - m, w: s.w + 2 * m, h: s.h + 2 * m }; }
      case "step": return { x: o.x - o.r, y: o.y - o.r, w: 2 * o.r, h: 2 * o.r };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  function hit(o, x, y, tol) {
    tol = tol || 6;
    switch (o.t) {
      case "rect": { const r = rectOf(o), t = tol + o.lw / 2; if (o.fill) return x >= r.x - t && x <= r.x + r.w + t && y >= r.y - t && y <= r.y + r.h + t; const inO = x >= r.x - t && x <= r.x + r.w + t && y >= r.y - t && y <= r.y + r.h + t, inI = x > r.x + t && x < r.x + r.w - t && y > r.y + t && y < r.y + r.h - t; return inO && !inI; }
      case "hl": case "hide": { const r = rectOf(o); return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
      case "ellipse": { const r = rectOf(o), rx = r.w / 2 + tol, ry = r.h / 2 + tol; if (rx <= 0 || ry <= 0) return false; const cx = r.x + r.w / 2, cy = r.y + r.h / 2, d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; if (o.fill) return d <= 1; const irx = Math.max(0.0001, r.w / 2 - tol), iry = Math.max(0.0001, r.h / 2 - tol); return d <= 1 && (((x - cx) / irx) ** 2 + ((y - cy) / iry) ** 2 >= 1 || r.w / 2 <= tol || r.h / 2 <= tol); }
      case "line": case "arrow": return distSeg(x, y, o.x1, o.y1, o.x2, o.y2) <= tol + o.lw / 2;
      case "pen": { for (let i = 1; i < o.pts.length; i++) if (distSeg(x, y, o.pts[i - 1][0], o.pts[i - 1][1], o.pts[i][0], o.pts[i][1]) <= tol + o.lw / 2) return true; return o.pts.length === 1 && Math.hypot(x - o.pts[0][0], y - o.pts[0][1]) <= tol + o.lw / 2; }
      case "text": { const b = bounds(o); return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol; }
      case "step": return Math.hypot(x - o.x, y - o.y) <= o.r + tol;
    }
    return false;
  }
  function move(o, dx, dy) {
    if (o.t === "line" || o.t === "arrow") { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    else if (o.t === "pen") for (const p of o.pts) { p[0] += dx; p[1] += dy; }
    else { o.x += dx; o.y += dy; }
  }
  // the little squares shown on the selected object
  function handles(o) {
    if (o.t === "line" || o.t === "arrow") return [{ id: "p1", x: o.x1, y: o.y1 }, { id: "p2", x: o.x2, y: o.y2 }];
    if (o.t === "rect" || o.t === "ellipse" || o.t === "hl" || o.t === "hide") { const r = rectOf(o); return [{ id: "nw", x: r.x, y: r.y }, { id: "ne", x: r.x + r.w, y: r.y }, { id: "sw", x: r.x, y: r.y + r.h }, { id: "se", x: r.x + r.w, y: r.y + r.h }]; }
    if (o.t === "step") return [{ id: "r", x: o.x + o.r, y: o.y }];
    return [];
  }
  function dragHandle(o, id, x, y) {
    if (id === "p1") { o.x1 = x; o.y1 = y; } else if (id === "p2") { o.x2 = x; o.y2 = y; }
    else if (id === "r") o.r = Math.max(6, Math.abs(x - o.x));
    else { const r = rectOf(o); let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h; if (id[0] === "n") y0 = y; else y1 = y; if (id[1] === "w") x0 = x; else x1 = x; o.x = x0; o.y = y0; o.w = x1 - x0; o.h = y1 - y0; }
  }
  // arrow head: tip and the two back corners
  function arrowHead(x1, y1, x2, y2, lw) {
    const a = Math.atan2(y2 - y1, x2 - x1), len = Math.max(10, lw * 4.5), wd = Math.max(7, lw * 3), bx = x2 - Math.cos(a) * len, by = y2 - Math.sin(a) * len;
    return { tip: [x2, y2], l: [bx + Math.cos(a - Math.PI / 2) * wd / 2 * 1.0, by + Math.sin(a - Math.PI / 2) * wd / 2], r: [bx + Math.cos(a + Math.PI / 2) * wd / 2, by + Math.sin(a + Math.PI / 2) * wd / 2], base: [bx, by], len };
  }
  const nextStep = objs => objs.reduce((m, o) => (o.t === "step" ? Math.max(m, o.n) : m), 0) + 1;
  const clone = objs => JSON.parse(JSON.stringify(objs));
  // thin out a freehand stroke: keep a point only when it is at least `d` away from the last one kept
  function thin(pts, d) { if (pts.length < 3) return pts.slice(); const out = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) { const l = out[out.length - 1]; if (Math.hypot(pts[i][0] - l[0], pts[i][1] - l[1]) >= d) out.push(pts[i]); } out.push(pts[pts.length - 1]); return out; }

  // draws every object except "hide" (those change the picture's pixels first: see applyHide)
  function draw(ctx, objs, W, H) {
    for (const o of objs) {
      if (o.t === "hide") continue;
      ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = o.c; ctx.fillStyle = o.c; ctx.lineWidth = o.lw || 1;
      if (o.t === "rect") { const r = rectOf(o); if (o.fill) ctx.fillRect(r.x, r.y, r.w, r.h); else ctx.strokeRect(r.x, r.y, r.w, r.h); }
      else if (o.t === "ellipse") { const r = rectOf(o); ctx.beginPath(); ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.5, r.w / 2), Math.max(0.5, r.h / 2), 0, 0, Math.PI * 2); if (o.fill) ctx.fill(); else ctx.stroke(); }
      else if (o.t === "hl") { const r = rectOf(o); ctx.globalAlpha = 0.38; ctx.fillRect(r.x, r.y, r.w, r.h); }
      else if (o.t === "line") { ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); }
      else if (o.t === "arrow") { const h = arrowHead(o.x1, o.y1, o.x2, o.y2, o.lw), len = Math.hypot(o.x2 - o.x1, o.y2 - o.y1); ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(len > h.len ? h.base[0] : o.x2, len > h.len ? h.base[1] : o.y2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(h.tip[0], h.tip[1]); ctx.lineTo(h.l[0], h.l[1]); ctx.lineTo(h.r[0], h.r[1]); ctx.closePath(); ctx.fill(); }
      else if (o.t === "pen") { ctx.beginPath(); ctx.moveTo(o.pts[0][0], o.pts[0][1]); if (o.pts.length === 1) ctx.lineTo(o.pts[0][0] + 0.01, o.pts[0][1]); for (let i = 1; i < o.pts.length; i++) { const p = o.pts[i], q = o.pts[i - 1]; ctx.quadraticCurveTo(q[0], q[1], (q[0] + p[0]) / 2, (q[1] + p[1]) / 2); } ctx.stroke(); }
      else if (o.t === "step") { ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = Math.max(1.5, o.r / 9); ctx.strokeStyle = lum(o.c) > 140 ? "#000000" : "#ffffff"; ctx.stroke(); ctx.fillStyle = lum(o.c) > 140 ? "#000000" : "#ffffff"; ctx.font = "700 " + Math.round(o.r * 1.15) + "px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(o.n), o.x, o.y + o.r * 0.06); }
      else if (o.t === "text") {
        ctx.font = "700 " + o.size + "px " + FONT; ctx.textBaseline = "top"; ctx.textAlign = "left";
        const lines = String(o.s || "").split("\n"), lh = o.size * 1.25; let w = 0; for (const l of lines) w = Math.max(w, ctx.measureText(l).width); o._w = w; o._h = lines.length * lh;
        const dark = lum(o.c) <= 140;
        if (o.style === "label") { const m = o.size * 0.3; ctx.fillStyle = o.c; ctx.fillRect(o.x - m, o.y - m, w + 2 * m, o._h + 2 * m); ctx.fillStyle = dark ? "#ffffff" : "#000000"; lines.forEach((l, i) => ctx.fillText(l, o.x, o.y + i * lh)); }
        else { ctx.lineWidth = Math.max(2, o.size / 7); ctx.strokeStyle = dark ? "#ffffff" : "#000000"; ctx.globalAlpha = 0.9; lines.forEach((l, i) => ctx.strokeText(l, o.x, o.y + i * lh)); ctx.globalAlpha = 1; ctx.fillStyle = o.c; lines.forEach((l, i) => ctx.fillText(l, o.x, o.y + i * lh)); }
      }
      ctx.restore();
    }
  }
  // changes the pixels of a "hide" area on ctx (the picture), really and not by covering; returns false when the check of the result fails
  function applyHide(ctx, W, H, o) {
    const M = g.ImgMath, r = rectOf(o), x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y)), x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h)), w = x1 - x0, h = y1 - y0;
    if (w < 1 || h < 1) return true;
    const id = ctx.getImageData(x0, y0, w, h), mode = o.mode === "blur" && w * h > 12e6 ? "pixelate" : o.mode, info = M.hide(id.data, w, h, { x: 0, y: 0, w, h }, mode, o.strength || 6, 1);
    const ok = !info || M.checkHidden(id.data, w, h, { x: 0, y: 0, w, h }, info);
    ctx.putImageData(id, x0, y0); return ok;
  }
  const api = { COLORS, SIZES, FONT, lineWidth, fontPx, rectOf, bounds, hit, move, handles, dragHandle, arrowHead, nextStep, clone, thin, draw, applyHide, textSize };
  if (typeof window !== "undefined") window.ImgAnnot = api;
  if (typeof module !== "undefined") module.exports = api;
})();
