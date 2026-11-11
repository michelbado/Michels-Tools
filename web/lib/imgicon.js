/* Favicon files: the sizes, the .ico container (PNG pictures inside), the web manifest and the HTML lines to paste. Pure code. Exports window.ImgIcon. */
(() => {
  "use strict";
  // name, size, what it is for
  const SIZES = [
    { name: "favicon-16x16.png", size: 16, use: "browser tab" },
    { name: "favicon-32x32.png", size: 32, use: "browser tab, high resolution" },
    { name: "favicon-48x48.png", size: 48, use: "Windows shortcuts and search results" },
    { name: "apple-touch-icon.png", size: 180, use: "iPhone and iPad home screen" },
    { name: "android-chrome-192x192.png", size: 192, use: "Android home screen" },
    { name: "android-chrome-512x512.png", size: 512, use: "Android splash screen and installable web apps" },
  ];
  const ICO_SIZES = [16, 32, 48];
  const u32 = (a, o, v) => { a[o] = v & 255; a[o + 1] = v >>> 8 & 255; a[o + 2] = v >>> 16 & 255; a[o + 3] = v >>> 24 & 255; };
  // list: [{ size, png: Uint8Array }]; every picture is a PNG (allowed since Windows Vista and by every browser)
  function buildIco(list) {
    const n = list.length; let off = 6 + 16 * n, total = off; for (const p of list) total += p.png.length;
    const out = new Uint8Array(total); out[2] = 1; out[4] = n;
    list.forEach((p, i) => { const e = 6 + 16 * i; out[e] = p.size >= 256 ? 0 : p.size; out[e + 1] = p.size >= 256 ? 0 : p.size; out[e + 4] = 1; out[e + 6] = 32; u32(out, e + 8, p.png.length); u32(out, e + 12, off); out.set(p.png, off); off += p.png.length; });
    return out;
  }
  // for tests and checks: [{ w, h, len, offset }]
  function readIco(b) {
    if (b.length < 6 || b[0] || b[1] || b[2] !== 1 || b[3]) return null;
    const n = b[4] | b[5] << 8, out = [];
    for (let i = 0; i < n; i++) { const e = 6 + 16 * i; if (e + 16 > b.length) return null; out.push({ w: b[e] || 256, h: b[e + 1] || 256, len: (b[e + 8] | b[e + 9] << 8 | b[e + 10] << 16 | b[e + 11] << 24) >>> 0, offset: (b[e + 12] | b[e + 13] << 8 | b[e + 14] << 16 | b[e + 15] << 24) >>> 0 }); }
    return out;
  }
  const hex = (c, d) => /^#[0-9a-fA-F]{6}$/.test(c || "") ? c.toLowerCase() : d;
  function manifest(name, shortName, theme, bg) {
    return JSON.stringify({ name: name || "My site", short_name: shortName || name || "My site", icons: [{ src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" }, { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" }], theme_color: hex(theme, "#ffffff"), background_color: hex(bg, "#ffffff"), display: "standalone" }, null, 2) + "\n";
  }
  function htmlSnippet(theme) {
    return [
      '<link rel="icon" href="/favicon.ico" sizes="48x48">',
      '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
      '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
      '<link rel="manifest" href="/site.webmanifest">',
      '<meta name="theme-color" content="' + hex(theme, "#ffffff") + '">',
    ].join("\n") + "\n";
  }
  // where the picture goes inside the square: "crop" fills it (cutting the long sides), "fit" shows the whole picture with space around.
  // Returns the source rectangle and the destination rectangle for drawImage on a canvas of size x size.
  function place(sw, sh, size, mode, padPct) {
    if (mode === "crop") { const s = Math.min(sw, sh); return { sx: (sw - s) / 2, sy: (sh - s) / 2, sw: s, sh: s, dx: 0, dy: 0, dw: size, dh: size }; }
    const pad = size * (Math.max(0, Math.min(40, padPct || 0)) / 100), box = size - 2 * pad, k = Math.min(box / sw, box / sh), w = sw * k, h = sh * k;
    return { sx: 0, sy: 0, sw, sh, dx: (size - w) / 2, dy: (size - h) / 2, dw: w, dh: h };
  }
  const api = { SIZES, ICO_SIZES, buildIco, readIco, manifest, htmlSnippet, place };
  if (typeof window !== "undefined") window.ImgIcon = api;
  if (typeof module !== "undefined") module.exports = api;
})();
