/* Canvas helpers shared by the image tools: open a picture, shrink it well, save it as JPEG/PNG/WebP (also "as small as N KB"), and draw a watermark.
   Runs in the browser only. Other libraries are looked up when used (the shell loads them in any order). Exports window.ImgProc. */
(() => {
  "use strict";
  const M = () => window.ImgMath;
  const MAXMB = 60, MAXIN = 100e6;
  const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }, EXT = { jpeg: "jpg", png: "png", webp: "webp" };
  const kindOf = f => /png$/.test(f.type) || /\.(png|gif|bmp)$/i.test(f.name) ? "png" : /webp$/.test(f.type) || /\.webp$/i.test(f.name) ? "webp" : "jpeg";

  // opens a picture file; the turn stored in its EXIF is applied. Throws an Error with a sentence for the visitor.
  async function load(file) {
    if (file.size > MAXMB * 1048576) throw new Error("This picture is larger than " + MAXMB + " MB.");
    let b; try { b = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error("The browser could not open this file as a picture."); }
    if (b.width * b.height > MAXIN) { if (b.close) b.close(); throw new Error("This picture has more than " + MAXIN / 1e6 + " million pixels, which is too much to edit in a browser."); }
    return b;
  }
  function toCanvas(src, w, h) { const c = document.createElement("canvas"); c.width = w || src.width; c.height = h || src.height; c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return c; }
  // shrink in halves, then the last step: much better than one jump
  function scale(src, w, h) {
    let cur = src;
    for (const [sw, sh] of M().steps(src.width, src.height, w, h)) {
      if (sw === cur.width && sh === cur.height) continue;
      const nx = document.createElement("canvas"); nx.width = sw; nx.height = sh; const g = nx.getContext("2d"); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; g.drawImage(cur, 0, 0, sw, sh); cur = nx;
    }
    return cur;
  }
  // a copy with a solid background (for JPEG, which has no transparency)
  function flatten(c, color) { const o = document.createElement("canvas"); o.width = c.width; o.height = c.height; const g = o.getContext("2d"); g.fillStyle = color || "#ffffff"; g.fillRect(0, 0, o.width, o.height); g.drawImage(c, 0, 0); return o; }
  const toBlob = (c, type, q) => new Promise(res => c.toBlob(res, type, q));
  async function encode(canvas, kind, quality, bg) {
    const src = kind === "jpeg" ? flatten(canvas, bg) : canvas;
    const blob = await toBlob(src, MIME[kind], kind === "png" ? undefined : quality);
    if (!blob) throw new Error("The browser could not create the picture.");
    if (blob.type !== MIME[kind]) throw new Error("This browser cannot save " + kind.toUpperCase() + " pictures. Choose another type.");
    return blob;
  }
  // the best quality (0.2 to 1) whose file is at most maxBytes; { blob, q, fits }. PNG has no quality, so it only reports whether it fits.
  async function fitBytes(canvas, kind, maxBytes, bg) {
    if (kind === "png") { const b = await encode(canvas, kind, 1, bg); return { blob: b, q: 1, fits: b.size <= maxBytes }; }
    let lo = 0.2, hi = 1, best = null, bestQ = lo;
    let top = await encode(canvas, kind, hi, bg); if (top.size <= maxBytes) return { blob: top, q: hi, fits: true };
    const bottom = await encode(canvas, kind, lo, bg); if (bottom.size > maxBytes) return { blob: bottom, q: lo, fits: false };
    best = bottom; bestQ = lo;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2, b = await encode(canvas, kind, mid, bg); if (b.size <= maxBytes) { best = b; bestQ = mid; lo = mid; } else hi = mid; }
    return { blob: best, q: bestQ, fits: true };
  }
  function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }
  const sizeText = n => n < 1024 ? n + " bytes" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(2) + " MB";

  const FONTS = { sans: 'Arial, "Liberation Sans", "Noto Sans", Helvetica, sans-serif', serif: '"Times New Roman", "Liberation Serif", "Noto Serif", Georgia, serif', mono: '"Courier New", "Liberation Mono", "Noto Sans Mono", monospace' };
  /* Draws a text or picture watermark on ctx (a canvas of W x H).
     o = { text, image (canvas or bitmap, optional), pos: "tl".."br" | "tile", sizePct (text height or logo width as % of the shorter / the whole width), opacity 0..1, angle degrees,
           color, outline (bool), font: sans|serif|mono, margin (% of the shorter side), gap (% for tiles) } */
  function watermark(ctx, W, H, o) {
    const short = Math.min(W, H);
    let bw, bh, drawAt;
    const ang = (o.angle || 0) * Math.PI / 180, cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang));
    if (o.image) {
      const w = Math.max(4, W * (o.sizePct || 20) / 100), h = w * o.image.height / o.image.width; bw = w * cs + h * sn; bh = w * sn + h * cs;
      drawAt = (x, y) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = o.opacity; ctx.drawImage(o.image, -w / 2, -h / 2, w, h); ctx.restore(); };
    } else {
      const text = String(o.text || "").slice(0, 200); if (!text.trim()) return 0;
      const fs = Math.max(6, short * (o.sizePct || 6) / 100); ctx.save(); ctx.font = "700 " + fs + "px " + (FONTS[o.font] || FONTS.sans);
      const w = ctx.measureText(text).width, h = fs * 1.2; ctx.restore(); bw = w * cs + h * sn; bh = w * sn + h * cs;
      const light = (() => { const m = /^#([0-9a-f]{6})$/i.exec(o.color || ""); if (!m) return false; const v = parseInt(m[1], 16); return ((v >> 16) * 0.299 + (v >> 8 & 255) * 0.587 + (v & 255) * 0.114) > 140; })();
      drawAt = (x, y) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.globalAlpha = o.opacity; ctx.font = "700 " + fs + "px " + (FONTS[o.font] || FONTS.sans); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        if (o.outline) { ctx.lineJoin = "round"; ctx.lineWidth = Math.max(2, fs / 9); ctx.strokeStyle = light ? "#000000" : "#ffffff"; ctx.strokeText(text, 0, 0); }
        ctx.fillStyle = o.color || "#ffffff"; ctx.fillText(text, 0, 0); ctx.restore(); };
    }
    if (o.pos === "tile") { const g = (o.gap == null ? 40 : o.gap) / 100; const t = M().wmTiles(W, H, bw, bh, bw * g, bh * g); for (const p of t) drawAt(p.x, p.y); return t.length; }
    const p = M().wmPlace(o.pos || "br", W, H, bw, bh, short * (o.margin == null ? 3 : o.margin) / 100); drawAt(p.x, p.y); return 1;
  }
  const api = { MAXMB, MAXIN, MIME, EXT, FONTS, kindOf, load, toCanvas, scale, flatten, encode, fitBytes, download, sizeText, watermark };
  if (typeof window !== "undefined") window.ImgProc = api;
})();
