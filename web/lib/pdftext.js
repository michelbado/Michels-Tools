/* Text and layout helpers for stamping text on PDF pages: watermarks, page numbers, headers and footers.
   Pure functions (numbers, templates, page choices, layout maths) plus one canvas routine that draws any
   language as a picture: the browser's own text engine joins Arabic letters, runs right to left and finds a font. */
window.PDFText = (() => {
  // PDFCommon is looked up when needed: the shell loads a tool's libraries in parallel, in any order
  const common = () => window.PDFCommon;

  const FONTS = {
    sans: { pdf: "Helvetica", pdfBold: "HelveticaBold", css: 'Arial,"Liberation Sans","Noto Sans",Helvetica,sans-serif' },
    serif: { pdf: "TimesRoman", pdfBold: "TimesRomanBold", css: '"Times New Roman","Liberation Serif","Noto Serif",Georgia,serif' },
    mono: { pdf: "Courier", pdfBold: "CourierBold", css: '"Courier New","Liberation Mono","Noto Sans Mono",monospace' },
  };

  /* ---------- numbers and templates ---------- */

  const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩", PERSIAN = "۰۱۲۳۴۵۶۷۸۹";
  const mapDigits = (s, table) => String(s).replace(/\d/g, d => table[Number(d)]);

  function roman(n, upper) {
    if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
    const t = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
    let out = "";
    for (const [v, s] of t) while (n >= v) { out += s; n -= v; }
    return upper ? out.toUpperCase() : out;
  }

  // style: western | arabic (Arabic-Indic) | persian (Eastern Arabic-Indic) | roman-lower | roman-upper
  function numberText(n, style) {
    switch (style) {
      case "arabic": return mapDigits(n, ARABIC_INDIC);
      case "persian": return mapDigits(n, PERSIAN);
      case "roman-lower": return roman(n, false);
      case "roman-upper": return roman(n, true);
      default: return String(n);
    }
  }

  // "Page {n} of {total}" -> text. Unknown {words} are left as they are.
  function expand(template, vars, style) {
    return String(template).replace(/\{(n|total|date|filename)\}/g, (m, k) => {
      if (k === "n" || k === "total") return numberText(vars[k], style);
      return vars[k] == null ? "" : String(vars[k]);
    });
  }

  // the first letter that has a direction decides: Hebrew, Arabic, Syriac, Thaana, N'Ko ... = right to left
  function isRtl(text) {
    for (const ch of String(text)) {
      if (/[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(ch)) return true;
      if (/\p{L}/u.test(ch)) return false;
    }
    return false;
  }

  /* ---------- which pages ---------- */

  // mode: all | odd | even | first | last | custom -> { pages } or { error }
  function selectPages(mode, text, total) {
    switch (mode) {
      case "all": return { pages: Array.from({ length: total }, (_, i) => i + 1) };
      case "odd": return { pages: Array.from({ length: total }, (_, i) => i + 1).filter(n => n % 2 === 1) };
      case "even": return { pages: Array.from({ length: total }, (_, i) => i + 1).filter(n => n % 2 === 0) };
      case "first": return { pages: [1] };
      case "last": return { pages: [total] };
      default: {
        if (!String(text).trim()) return { error: "Enter the page numbers, for example 1,3,5-8." };
        const r = common().parseRanges(text, total);
        if (r.error) return r;
        return { pages: r.pages.slice().sort((a, b) => a - b) };
      }
    }
  }

  // the number printed on page p: counting starts at `start` on the first chosen page
  const numberOn = (p, firstChosen, start) => start + (p - firstChosen);

  /* ---------- layout maths: everything in page points, from the top-left of the page as displayed ---------- */

  const rad = deg => deg * Math.PI / 180;

  // the centre of a w x h box placed at one of six edge spots, `margin` away from the page edge
  function edgeCentre(pos, w, h, W, H, margin) {
    const [v, hz] = String(pos).split("-");
    const cx = hz === "left" ? margin + w / 2 : hz === "right" ? W - margin - w / 2 : W / 2;
    const cy = v === "top" ? margin + h / 2 : H - margin - h / 2;
    return { cx, cy };
  }

  // a box turned visually counter-clockwise by `angle` degrees about its centre: where is its bottom-left corner?
  // (y points down on screen, so counter-clockwise is x' = x cos + y sin, y' = -x sin + y cos)
  function turned(cx, cy, lx, ly, angle) {
    const a = rad(angle), c = Math.cos(a), s = Math.sin(a);
    return { x: cx + lx * c + ly * s, y: cy - lx * s + ly * c };
  }
  const bottomLeft = (cx, cy, w, h, angle) => turned(cx, cy, -w / 2, h / 2, angle);

  const MAX_TILES = 600;

  // where copies of a w x h watermark go -> [{ cx, cy, angle }] or { error }
  //   layout: "straight" (centre, turned by `angle`) | "diagonal" (corner to corner) | "tile" (repeated, turned by `angle`)
  function watermarkPlacements({ layout, angle = 0, gap = 40 }, w, h, W, H) {
    if (layout === "diagonal") return [{ cx: W / 2, cy: H / 2, angle: Math.atan2(H, W) * 180 / Math.PI }];
    if (layout !== "tile") return [{ cx: W / 2, cy: H / 2, angle }];
    const dx = w + gap, dy = h + gap;
    const reach = Math.hypot(W, H) / 2 + Math.max(w, h);
    const nx = Math.ceil(reach / dx), ny = Math.ceil(reach / dy);
    const out = [];
    for (let j = -ny; j <= ny; j++) {
      for (let i = -nx; i <= nx; i++) {
        const lx = i * dx + (j % 2 ? dx / 2 : 0), ly = j * dy;
        const p = turned(W / 2, H / 2, lx, ly, angle);
        // keep the copies that touch the page
        const r = Math.hypot(w, h) / 2;
        if (p.x > -r && p.x < W + r && p.y > -r && p.y < H + r) out.push({ cx: p.x, cy: p.y, angle });
      }
    }
    if (out.length > MAX_TILES) return { error: `That would repeat the watermark ${out.length} times on each page. Make it bigger or increase the spacing.` };
    return out;
  }

  /* ---------- drawing text as a picture (any language) ---------- */

  // returns { canvas, w, h }: w and h in points. `scale` = pixels per point.
  function renderTextCanvas(text, { family = "sans", bold = false, size = 24, color = "#000000", scale = 4 } = {}) {
    const fam = (FONTS[family] || FONTS.sans).css;
    const maxPx = 8000;
    const px0 = size * scale;
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `${bold ? "700 " : ""}${px0}px ${fam}`;
    let width = probe.measureText(text).width;
    let k = 1;
    if (width + px0 > maxPx) k = maxPx / (width + px0);              // keep the picture a sane size
    const px = px0 * k;
    const font = `${bold ? "700 " : ""}${px}px ${fam}`;
    probe.font = font;
    width = probe.measureText(text).width;
    const m = probe.measureText("Hg");
    const asc = m.fontBoundingBoxAscent || px * 0.92, desc = m.fontBoundingBoxDescent || px * 0.24;
    const padX = Math.ceil(px * 0.08);
    const cv = document.createElement("canvas");
    cv.width = Math.max(2, Math.ceil(width) + padX * 2); cv.height = Math.max(2, Math.ceil(asc + desc));
    const ctx = cv.getContext("2d");
    ctx.font = font; ctx.fillStyle = color; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.direction = isRtl(text) ? "rtl" : "ltr";
    ctx.fillText(text, padX, asc);
    const s = scale * k;
    return { canvas: cv, w: cv.width / s, h: cv.height / s };
  }

  // can the built-in PDF fonts print this text? (they cover Western European languages only)
  function vectorOk(font, text) {
    try { font.widthOfTextAtSize(text, 12); return true; } catch { return false; }
  }

  // "#RRGGBB" -> [r, g, b] in 0..1
  function rgb01(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return [0, 0, 0];
    const n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  return {
    FONTS, roman, numberText, expand, isRtl, selectPages, numberOn,
    edgeCentre, turned, bottomLeft, watermarkPlacements, renderTextCanvas, vectorOk, rgb01, MAX_TILES,
  };
})();
