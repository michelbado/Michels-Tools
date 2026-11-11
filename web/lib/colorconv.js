/* Colour converter: reads a colour written as a name, hex, rgb(), hsl() or hwb() and shows it in every form, with the nearest CSS name,
   contrast against white and black, and the readable text colour. Pure arithmetic on what is typed. Exports window.ColorConv. */
(() => {
  "use strict";
  const NAMES = "aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32".split(" ");
  const NAME2HEX = {}, LIST = [];
  for (let i = 0; i < NAMES.length; i += 2) { NAME2HEX[NAMES[i]] = NAMES[i + 1]; LIST.push({ name: NAMES[i], r: parseInt(NAMES[i + 1].slice(0, 2), 16), g: parseInt(NAMES[i + 1].slice(2, 4), 16), b: parseInt(NAMES[i + 1].slice(4, 6), 16) }); }
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const hex2 = n => Math.round(n).toString(16).padStart(2, "0");
  const trim = (x, d) => { const s = x.toFixed(d); return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s; };

  // ---------- conversions (floating point, no rounding) ----------
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255; const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
    let h = 0, s = 0;
    if (d) { s = l > 0.5 ? d / (2 - max - min) : d / (max + min); h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return { h, s: s * 100, l: l * 100 };
  }
  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
    const f = n => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 };
  }
  function rgbToHwb(r, g, b) { const h = rgbToHsl(r, g, b).h; return { h, w: Math.min(r, g, b) / 255 * 100, b: (1 - Math.max(r, g, b) / 255) * 100 }; }
  function hwbToRgb(h, w, bl) {
    w = clamp(w, 0, 100) / 100; bl = clamp(bl, 0, 100) / 100;
    if (w + bl >= 1) { const g = w / (w + bl) * 255; return { r: g, g, b: g }; }
    const c = hslToRgb(h, 100, 50); return { r: (c.r / 255 * (1 - w - bl) + w) * 255, g: (c.g / 255 * (1 - w - bl) + w) * 255, b: (c.b / 255 * (1 - w - bl) + w) * 255 };
  }
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const luminance = c => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function lab(c) {
    const r = lin(c.r), g = lin(c.g), b = lin(c.b), X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b, Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    const f = t => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  }
  function nearest(c) {
    const L = lab(c); let best = null, bd = 1e9;
    for (const n of LIST) { const m = lab(n), d = Math.hypot(L[0] - m[0], L[1] - m[1], L[2] - m[2]); if (d < bd - 1e-9) { bd = d; best = n; } }
    return { name: best.name, delta: bd };
  }

  // ---------- reading ----------
  const num = (s, pct100) => { s = s.trim(); if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%$/i.test(s)) return parseFloat(s) / 100 * pct100; if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return parseFloat(s); return NaN; };
  const alphaOf = s => { if (s == null) return 1; const v = num(s, 1); return Number.isNaN(v) ? NaN : clamp(v, 0, 1); };
  const hueOf = s => { s = s.trim(); const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)?$/i.exec(s); if (!m) return NaN; const v = parseFloat(m[1]), u = (m[2] || "deg").toLowerCase(); return u === "deg" ? v : u === "grad" ? v * 0.9 : u === "rad" ? v * 180 / Math.PI : v * 360; };
  function parse(text) {
    let t = String(text == null ? "" : text).trim().toLowerCase();
    if (!t) return { empty: true };
    let how = "";
    if (t === "transparent") return { c: { r: 0, g: 0, b: 0, a: 0 }, how: "keyword" };
    if (Object.prototype.hasOwnProperty.call(NAME2HEX, t)) { const h = NAME2HEX[t]; return { c: { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }, how: "colour name" }; }
    let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
    if (m && (t.startsWith("#") || /[a-f]/.test(t) || /^\d{6}$|^\d{3}$/.test(t))) {
      let h = m[1]; if (h.length <= 4) h = h.split("").map(x => x + x).join("");
      return { c: { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }, how: "hex" + (t.startsWith("#") ? "" : " (without #)") };
    }
    m = /^(rgba?|hsla?|hwb)\(\s*([^)]*)\)$/.exec(t);
    if (m) {
      const fn = m[1], body = m[2].replace(/\//g, " / ").replace(/,/g, " , ").trim(), parts = body.split(/\s*[,\s]\s*/).filter(x => x !== "" && x !== ",");
      let slash = parts.indexOf("/"), args = parts.filter(x => x !== "/"), al;
      if (slash >= 0) { if (args.length !== slash + 1) return { error: "Only the alpha value may follow the /." }; al = args.pop(); } else if (args.length === 4) al = args.pop();
      if (args.length !== 3) return { error: fn + "() needs three values" + (fn === "hwb" ? " (hue, whiteness, blackness)" : fn.startsWith("hsl") ? " (hue, saturation, lightness)" : " (red, green, blue)") + "." };
      const a = alphaOf(al); if (Number.isNaN(a)) return { error: "The alpha (transparency) must be a number from 0 to 1 or a percentage." };
      if (fn.startsWith("rgb")) { const v = args.map(x => num(x, 255)); if (v.some(Number.isNaN)) return { error: "rgb() values must be numbers (0 to 255) or percentages." }; return { c: { r: clamp(v[0], 0, 255), g: clamp(v[1], 0, 255), b: clamp(v[2], 0, 255), a }, how: "rgb()" }; }
      const h = hueOf(args[0]); if (Number.isNaN(h)) return { error: "The hue must be a number of degrees (0 to 360)." };
      const s = num(args[1], 100), l = num(args[2], 100); if (Number.isNaN(s) || Number.isNaN(l)) return { error: "Saturation, lightness, whiteness and blackness must be numbers or percentages." };
      const rgb = fn === "hwb" ? hwbToRgb(h, s, l) : hslToRgb(h, s, l); return { c: { r: rgb.r, g: rgb.g, b: rgb.b, a }, how: fn.startsWith("hsl") ? "hsl()" : "hwb()" };
    }
    m = /^(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)[\s,]+(\d{1,3}(?:\.\d+)?)$/.exec(t);
    if (m) { const v = [m[1], m[2], m[3]].map(Number); if (v.some(x => x > 255)) return { error: "Red, green and blue go from 0 to 255." }; return { c: { r: v[0], g: v[1], b: v[2], a: 1 }, how: "three numbers (red, green, blue)" }; }
    return { error: "I cannot read this as a colour. Try a name (tomato), hex (#ff6347), rgb(255 99 71), hsl(9 100% 64%) or hwb(9 28% 0%)." };
  }

  // ---------- showing ----------
  function show(c) {
    const r = clamp(c.r, 0, 255), g = clamp(c.g, 0, 255), b = clamp(c.b, 0, 255), a = clamp(c.a == null ? 1 : c.a, 0, 1), R = Math.round(r), G = Math.round(g), B = Math.round(b);
    const hsl = rgbToHsl(r, g, b), hwb = rgbToHwb(r, g, b), A = a < 1;
    const hex = "#" + hex2(R) + hex2(G) + hex2(B) + (A ? hex2(a * 255) : "");
    const k = 1 - Math.max(r, g, b) / 255, cm = k >= 1 ? [0, 0, 0] : [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k)];
    const exact = LIST.find(n => n.r === R && n.g === G && n.b === B), near = nearest({ r: R, g: G, b: B });
    const white = contrast({ r: R, g: G, b: B }, { r: 255, g: 255, b: 255 }), black = contrast({ r: R, g: G, b: B }, { r: 0, g: 0, b: 0 });
    const hs = trim(hsl.h, 1), ss = trim(hsl.s, 1), ls = trim(hsl.l, 1), hw = trim(hwb.w, 1), bl = trim(hwb.b, 1);
    const al = trim(a, 3);
    const rows = [
      ["Hex", hex], ["RGB", A ? "rgba(" + R + ", " + G + ", " + B + ", " + al + ")" : "rgb(" + R + ", " + G + ", " + B + ")"],
      ["RGB (modern syntax)", "rgb(" + R + " " + G + " " + B + (A ? " / " + trim(a * 100, 1) + "%" : "") + ")"],
      ["HSL", A ? "hsla(" + hs + ", " + ss + "%, " + ls + "%, " + al + ")" : "hsl(" + hs + ", " + ss + "%, " + ls + "%)"],
      ["HWB", "hwb(" + hs + " " + hw + "% " + bl + "%" + (A ? " / " + trim(a * 100, 1) + "%" : "") + ")"],
      ["CMYK (simple, for screens)", "cmyk(" + cm.map(x => trim(x * 100, 1) + "%").join(", ") + ")"],
      ["CSS name", exact ? exact.name : "no exact name", exact ? "" : "nearest: " + near.name],
    ];
    const grade = x => (x >= 7 ? "AAA" : x >= 4.5 ? "AA" : x >= 3 ? "AA for large text only" : "fails");
    const useBlack = black >= white;
    return { rows, hex, r: R, g: G, b: B, a, hsl, hwb, name: exact ? exact.name : "", nearest: near.name, white, black, grade: { white: grade(white), black: grade(black) }, text: useBlack ? "#000000" : "#ffffff", textName: useBlack ? "black" : "white", contrastRows: [
      ["White text on this colour", trim(white, 2) + " : 1", grade(white)], ["Black text on this colour", trim(black, 2) + " : 1", grade(black)] ] };
  }
  const api = { parse, show, rgbToHsl, hslToRgb, rgbToHwb, hwbToRgb, luminance, contrast, nearest, NAME2HEX, names: () => LIST.map(n => n.name) };
  if (typeof window !== "undefined") window.ColorConv = api;
  if (typeof module !== "undefined") module.exports = api;
})();
