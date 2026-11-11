/* QR codes (ISO/IEC 18004, model 2): makes a code from text (versions 1 to 40, four error-correction levels, numeric / alphanumeric / byte modes, automatic
   mask choice) and reads one back from a module matrix or from a picture's pixels (finders found by their 1:1:3:1:1 pattern, errors repaired with
   Reed-Solomon). Pure code. Exports window.QR. */
(() => {
  "use strict";
  // ---------- tables (ISO 18004 tables 7-9, as used by every implementation) ----------
  const ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  };
  const NUM_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  };
  const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const LEVELS = ["L", "M", "Q", "H"];

  const size = v => v * 4 + 17;
  function rawModules(v) { let r = (16 * v + 128) * v + 64; if (v >= 2) { const na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; } return r; }
  const rawCodewords = v => Math.floor(rawModules(v) / 8);
  const dataCodewords = (v, ecc) => rawCodewords(v) - ECC_PER_BLOCK[ecc][v] * NUM_BLOCKS[ecc][v];
  const alignPositions = v => { if (v === 1) return []; const n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, r = [6]; for (let p = size(v) - 7; r.length < n; p -= step) r.splice(1, 0, p); return r; };
  const ccBits = (mode, v) => { const i = v <= 9 ? 0 : v <= 26 ? 1 : 2; return ({ numeric: [10, 12, 14], alnum: [9, 11, 13], byte: [8, 16, 16] })[mode][i]; };
  const MODE_IND = { numeric: 1, alnum: 2, byte: 4 };

  // ---------- Reed-Solomon over GF(256), x^8+x^4+x^3+x^2+1 ----------
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11D; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; }
  const gmul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  const gdiv = (a, b) => { if (b === 0) throw new Error("div0"); return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; };
  const gpow = (a, n) => a === 0 ? 0 : EXP[((LOG[a] * n) % 255 + 255) % 255];
  const ginv = a => EXP[255 - LOG[a]];
  const genCache = {};
  function rsGenerator(n) { if (genCache[n]) return genCache[n]; let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); } g = next; } return genCache[n] = g; }   // highest degree first
  function rsEncode(data, n) { const g = rsGenerator(n), res = new Array(n).fill(0); for (const b of data) { const f = b ^ res[0]; res.shift(); res.push(0); if (f) for (let i = 0; i < n; i++) res[i] ^= gmul(g[i + 1], f); } return res; }
  // polynomials: arrays, highest degree first
  const pEval = (p, x) => { let y = p[0]; for (let i = 1; i < p.length; i++) y = gmul(y, x) ^ p[i]; return y; };
  const pAdd = (a, b) => { const r = new Array(Math.max(a.length, b.length)).fill(0); for (let i = 0; i < a.length; i++) r[i + r.length - a.length] = a[i]; for (let i = 0; i < b.length; i++) r[i + r.length - b.length] ^= b[i]; return r; };
  const pScale = (p, x) => p.map(c => gmul(c, x));
  const pMul = (a, b) => { const r = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) r[i + j] ^= gmul(a[i], b[j]); return r; };
  // repairs a received block (data then check bytes) in place; returns the number of corrected bytes or -1 when it cannot be repaired
  function rsCorrect(msg, nsym) {
    const synd = [0]; for (let i = 0; i < nsym; i++) synd.push(pEval(msg, EXP[i]));
    if (synd.every(x => x === 0)) return 0;
    let loc = [1], old = [1];
    for (let i = 0; i < nsym; i++) {
      const K = i + 1; let delta = synd[K];
      for (let j = 1; j < loc.length; j++) delta ^= gmul(loc[loc.length - 1 - j], synd[K - j]);
      old = old.concat([0]);
      if (delta !== 0) { if (old.length > loc.length) { const nl = pScale(old, delta); old = pScale(loc, ginv(delta)); loc = nl; } loc = pAdd(loc, pScale(old, delta)); }
    }
    while (loc.length && loc[0] === 0) loc.shift();
    const errs = loc.length - 1; if (errs * 2 > nsym) return -1;
    const rev = loc.slice().reverse(), pos = [];
    for (let i = 0; i < msg.length; i++) if (pEval(rev, EXP[i]) === 0) pos.push(msg.length - 1 - i);
    if (pos.length !== errs) return -1;
    // Forney: error values from the syndromes and the error locator
    const coefPos = pos.map(p => msg.length - 1 - p);
    let eloc = [1]; for (const c of coefPos) eloc = pMul(eloc, pAdd([1], [gpow(2, c), 0]));
    const prod = pMul(synd.slice().reverse(), eloc), want = eloc.length, rem = prod.length >= want ? prod.slice(prod.length - want) : new Array(want - prod.length).fill(0).concat(prod);
    const Xs = coefPos.map(c => gpow(2, -(255 - c))), E = new Array(msg.length).fill(0);
    for (let i = 0; i < Xs.length; i++) {
      const Xi = Xs[i], Xinv = ginv(Xi); let lp = 1;
      for (let j = 0; j < Xs.length; j++) if (j !== i) lp = gmul(lp, 1 ^ gmul(Xinv, Xs[j]));
      if (lp === 0) return -1;
      E[pos[i]] = gdiv(gmul(Xi, pEval(rem, Xinv)), lp);
    }
    for (let i = 0; i < msg.length; i++) msg[i] ^= E[i];
    for (let i = 1; i <= nsym; i++) if (pEval(msg, EXP[i - 1]) !== 0) return -1;
    return errs;
  }

  // ---------- bit helpers ----------
  const bit = (x, i) => ((x >>> i) & 1) !== 0;
  function bchBits(data, gen, deg) { let r = data; for (let i = 0; i < deg; i++) r = (r << 1) ^ ((r >>> (deg - 1)) * gen); return r; }
  const formatWord = (ecc, mask) => { const d = (FORMAT_BITS[ecc] << 3) | mask; return ((d << 10) | bchBits(d, 0x537, 10)) ^ 0x5412; };
  const versionWord = v => (v << 12) | bchBits(v, 0x1F25, 12);

  // ---------- the grid ----------
  function newGrid(v) { const n = size(v), mod = [], fn = []; for (let y = 0; y < n; y++) { mod.push(new Array(n).fill(false)); fn.push(new Array(n).fill(false)); } return { n, mod, fn, v }; }
  function drawFormat(g, ecc, mask) {
    const bits = formatWord(ecc, mask), n = g.n, set = (x, y, c) => { g.mod[y][x] = c; g.fn[y][x] = true; };
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits, i)); set(8, 7, bit(bits, 6)); set(8, 8, bit(bits, 7)); set(7, 8, bit(bits, 8)); for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) set(n - 1 - i, 8, bit(bits, i)); for (let i = 8; i < 15; i++) set(8, n - 15 + i, bit(bits, i)); set(8, n - 8, true);
  }
  function drawFunction(g, ecc) {
    const n = g.n, v = g.v, set = (x, y, c) => { g.mod[y][x] = c; g.fn[y][x] = true; };
    for (let i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < n && y >= 0 && y < n) set(x, y, d !== 2 && d !== 4); }
    const ap = alignPositions(v), last = ap.length - 1;
    for (let i = 0; i < ap.length; i++) for (let j = 0; j < ap.length; j++) { if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
    drawFormat(g, ecc || "L", 0);
    if (v >= 7) { const bits = versionWord(v); for (let i = 0; i < 18; i++) { const c = bit(bits, i), a = n - 11 + i % 3, b = Math.floor(i / 3); set(a, b, c); set(b, a, c); } }
  }
  // the coordinates of the data modules, in reading order (zigzag from the bottom right)
  function dataOrder(g) {
    const n = g.n, out = [];
    for (let right = n - 1; right >= 1; right -= 2) { if (right === 6) right = 5; for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? n - 1 - vert : vert; if (!g.fn[y][x]) out.push([x, y]); } }
    return out;
  }
  const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x, y) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
  function applyMask(g, m) { for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) if (!g.fn[y][x] && MASKS[m](x, y)) g.mod[y][x] = !g.mod[y][x]; }
  function penalty(g) {
    const n = g.n, m = g.mod; let p = 0;
    for (let a = 0; a < n; a++) for (const rowMode of [true, false]) {
      let run = 1, prev = rowMode ? m[a][0] : m[0][a];
      for (let b = 1; b < n; b++) { const c = rowMode ? m[a][b] : m[b][a]; if (c === prev) run++; else { if (run >= 5) p += 3 + (run - 5); run = 1; prev = c; } } if (run >= 5) p += 3 + (run - 5);
    }
    for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    const A = [true, false, true, true, true, false, true, false, false, false, false], B = A.slice().reverse();
    for (let a = 0; a < n; a++) for (let b = 0; b + 11 <= n; b++) for (const rowMode of [true, false]) { let ha = true, hb = true; for (let k = 0; k < 11 && (ha || hb); k++) { const c = rowMode ? m[a][b + k] : m[b + k][a]; if (c !== A[k]) ha = false; if (c !== B[k]) hb = false; } if (ha) p += 40; if (hb) p += 40; }
    let dark = 0; for (const r of m) for (const c of r) if (c) dark++;
    const total = n * n; p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return p;
  }

  // ---------- encoding ----------
  const utf8 = s => Array.from(new TextEncoder().encode(s));
  function modeOf(text) { if (/^[0-9]*$/.test(text)) return "numeric"; if (/^[0-9A-Z $%*+\-./:]*$/.test(text)) return "alnum"; return "byte"; }
  function dataBits(text, mode, v) {
    const bits = [], put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(MODE_IND[mode], 4);
    if (mode === "numeric") { put(text.length, ccBits(mode, v)); for (let i = 0; i < text.length; i += 3) { const ch = text.substr(i, 3); put(parseInt(ch, 10), ch.length * 3 + 1); } }
    else if (mode === "alnum") { put(text.length, ccBits(mode, v)); for (let i = 0; i < text.length; i += 2) { if (i + 1 < text.length) put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11); else put(ALNUM.indexOf(text[i]), 6); } }
    else { const b = utf8(text); put(b.length, ccBits(mode, v)); for (const x of b) put(x, 8); }
    return bits;
  }
  const maxChars = (v, ecc, mode) => { const cap = dataCodewords(v, ecc) * 8 - 4 - ccBits(mode, v); if (cap < 0) return 0; if (mode === "numeric") { const g = Math.floor(cap / 10); return g * 3 + (cap - g * 10 >= 7 ? 2 : cap - g * 10 >= 4 ? 1 : 0); } if (mode === "alnum") return Math.floor(cap / 11) * 2 + (cap % 11 >= 6 ? 1 : 0); return Math.floor(cap / 8); };
  function addPadding(bits, v, ecc) {
    const cap = dataCodewords(v, ecc) * 8; for (let i = 0; i < 4 && bits.length < cap; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) for (let i = 7; i >= 0; i--) bits.push((pad >>> i) & 1);
    const out = []; for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; out.push(b); } return out;
  }
  // codewords (data) -> interleaved data + check bytes
  function addEcc(data, v, ecc) {
    const nb = NUM_BLOCKS[ecc][v], eb = ECC_PER_BLOCK[ecc][v], raw = rawCodewords(v), shortCount = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const blocks = [], eccs = []; let k = 0;
    for (let i = 0; i < nb; i++) { const len = shortLen - eb + (i < shortCount ? 0 : 1), d = data.slice(k, k + len); k += len; blocks.push(d); eccs.push(rsEncode(d, eb)); }
    const out = []; for (let i = 0; i < shortLen - eb + 1; i++) for (let j = 0; j < nb; j++) if (i !== shortLen - eb || j >= shortCount) out.push(blocks[j][i]);
    for (let i = 0; i < eb; i++) for (let j = 0; j < nb; j++) out.push(eccs[j][i]);
    return out;
  }
  /* encode(text, { ecc: "L"|"M"|"Q"|"H", minVersion, mask: 0-7 or -1 }) -> { ok, modules (rows of booleans), size, version, ecc, mask, mode, text } or { ok: false, error } */
  function encode(text, o) {
    o = o || {}; const ecc = LEVELS.includes(o.ecc) ? o.ecc : "M"; text = String(text);
    if (text === "") return { ok: false, error: "Type something to put in the code." };
    const mode = modeOf(text); let v = Math.max(1, o.minVersion || 1), len = mode === "byte" ? utf8(text).length : text.length;
    for (; v <= 40; v++) if (len <= maxChars(v, ecc, mode)) break;
    if (v > 40) return { ok: false, error: "Too much text for a QR code at this error-correction level (the most is " + maxChars(40, ecc, mode).toLocaleString("en-US") + " " + (mode === "byte" ? "bytes" : "characters") + "). Use a lower level or shorter text.", max: maxChars(40, ecc, mode) };
    const bits = dataBits(text, mode, v), data = addPadding(bits, v, ecc), all = addEcc(data, v, ecc);
    const g = newGrid(v); drawFunction(g, ecc);
    const order = dataOrder(g); for (let i = 0; i < all.length * 8; i++) { const [x, y] = order[i]; g.mod[y][x] = bit(all[i >> 3], 7 - (i & 7)); }
    let best = o.mask >= 0 && o.mask <= 7 ? o.mask : -1, bestP = Infinity;
    if (best < 0) for (let m = 0; m < 8; m++) { applyMask(g, m); drawFormat(g, ecc, m); const p = penalty(g); if (p < bestP) { bestP = p; best = m; } applyMask(g, m); }
    applyMask(g, best); drawFormat(g, ecc, best);
    return { ok: true, modules: g.mod, size: g.n, version: v, ecc, mask: best, mode, text, codewords: all, dataCodewords: data };
  }

  // ---------- decoding ----------
  const FORMAT_WORDS = []; for (const e of LEVELS) for (let m = 0; m < 8; m++) FORMAT_WORDS.push({ ecc: e, mask: m, word: formatWord(e, m) });
  const pop = x => { let c = 0; while (x) { c += x & 1; x >>>= 1; } return c; };
  function readFormat(mod, n) {
    const a = []; for (let i = 0; i <= 5; i++) a.push(mod[i][8]); a.push(mod[7][8], mod[8][8], mod[8][7]); for (let i = 9; i < 15; i++) a.push(mod[8][14 - i]);
    const b = []; for (let i = 0; i < 8; i++) b.push(mod[8][n - 1 - i]); for (let i = 8; i < 15; i++) b.push(mod[n - 15 + i][8]);
    const toInt = bits => bits.reduce((acc, c, i) => acc | ((c ? 1 : 0) << i), 0);
    let best = null; for (const w of [toInt(a), toInt(b)]) for (const f of FORMAT_WORDS) { const d = pop(w ^ f.word); if (d <= 3 && (!best || d < best.d)) best = { ecc: f.ecc, mask: f.mask, d }; }
    return best;
  }
  function readVersionInfo(mod, n) { if (n < 45) return null; const a = [], b = []; for (let i = 0; i < 18; i++) { a.push(mod[Math.floor(i / 3)][n - 11 + i % 3]); b.push(mod[n - 11 + i % 3][Math.floor(i / 3)]); } const toInt = bits => bits.reduce((acc, c, i) => acc | ((c ? 1 : 0) << i), 0); let best = null; for (const w of [toInt(a), toInt(b)]) for (let v = 7; v <= 40; v++) { const d = pop(w ^ versionWord(v)); if (d <= 3 && (!best || d < best.d)) best = { v, d }; } return best; }
  function parseStream(cw, v) {
    let pos = 0; const total = cw.length * 8, get = len => { let r = 0; for (let i = 0; i < len; i++) { const p = pos + i; r = (r << 1) | (p < total ? (cw[p >> 3] >>> (7 - (p & 7))) & 1 : 0); } pos += len; return r; };
    let out = "", bytes = [], eci = null; const notes = [], modes = [];
    const flush = () => { if (bytes.length) { let s; const u = (() => { try { return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes)); } catch { return null; } })(); if (eci === 3 || (eci === null && u === null)) s = String.fromCharCode(...bytes); else if (eci === 20) { try { s = new TextDecoder("shift_jis").decode(Uint8Array.from(bytes)); } catch { s = String.fromCharCode(...bytes); } } else s = u === null ? String.fromCharCode(...bytes) : u; if (eci === null && u === null) notes.push("The text is not valid UTF-8; it was read as ISO-8859-1."); out += s; bytes = []; } };
    while (pos + 4 <= total) {
      const m = get(4); if (m === 0) break;
      if (m === 1) { let n = get(ccBits("numeric", v)); modes.push("numeric"); flush(); while (n >= 3) { const x = get(10); if (x > 999) return { error: "Invalid numeric data." }; out += String(x).padStart(3, "0"); n -= 3; } if (n === 2) { const x = get(7); if (x > 99) return { error: "Invalid numeric data." }; out += String(x).padStart(2, "0"); } else if (n === 1) { const x = get(4); if (x > 9) return { error: "Invalid numeric data." }; out += String(x); } }
      else if (m === 2) { let n = get(ccBits("alnum", v)); modes.push("alphanumeric"); flush(); while (n >= 2) { const x = get(11); if (x >= 45 * 45) return { error: "Invalid alphanumeric data." }; out += ALNUM[Math.floor(x / 45)] + ALNUM[x % 45]; n -= 2; } if (n === 1) { const x = get(6); if (x >= 45) return { error: "Invalid alphanumeric data." }; out += ALNUM[x]; } }
      else if (m === 4) { const n = get(ccBits("byte", v)); modes.push("byte"); for (let i = 0; i < n; i++) bytes.push(get(8)); flush(); }
      else if (m === 8) { const n = get(ccBits("numeric", v) - 2); modes.push("kanji"); flush(); const kb = []; for (let i = 0; i < n; i++) { const x = get(13); let a = Math.floor(x / 0xC0) << 8 | x % 0xC0; a += a < 0x1F00 ? 0x8140 : 0xC140; kb.push(a >> 8, a & 255); } try { out += new TextDecoder("shift_jis").decode(Uint8Array.from(kb)); } catch { notes.push("Kanji characters could not be decoded by this browser."); } }
      else if (m === 7) { flush(); let b = get(8); if ((b & 0x80) === 0) eci = b; else if ((b & 0xC0) === 0x80) eci = ((b & 0x3F) << 8) | get(8); else eci = ((b & 0x1F) << 16) | get(16); notes.push("Character set declared: ECI " + eci + (eci === 26 ? " (UTF-8)" : eci === 3 ? " (ISO-8859-1)" : "") + "."); }
      else if (m === 3) { get(16); notes.push("This is one part of a structured-append series of codes (several codes make up one message); only this part was read."); }
      else if (m === 5 || m === 9) { notes.push("FNC1 mode marker (a data-formatting convention such as GS1) was present."); if (m === 9) get(8); }
      else return { error: "Unknown data type (" + m.toString(2).padStart(4, "0") + ") in the code." };
    }
    flush(); return { text: out, notes, modes };
  }
  /* decodeMatrix(rows of booleans) -> { ok, text, version, ecc, mask, corrected, notes } or { ok: false, error } */
  function decodeMatrix(mod) {
    const n = mod.length; if (n < 21 || n > 177 || (n - 17) % 4 !== 0) return { ok: false, error: "The size of the grid (" + n + ") is not a valid QR code size." };
    let v = (n - 17) / 4; const vi = readVersionInfo(mod, n); if (vi && vi.v !== v) v = vi.v === (n - 17) / 4 ? v : v;
    const f = readFormat(mod, n); if (!f) return { ok: false, error: "The format information of the code is damaged." };
    const g = newGrid(v); drawFunction(g, f.ecc);
    const m2 = mod.map(r => r.slice()); const gg = { n, mod: m2, fn: g.fn, v }; applyMask(gg, f.mask);
    const order = dataOrder(g), raw = rawCodewords(v), bytes = new Array(raw).fill(0);
    for (let i = 0; i < raw * 8; i++) { const [x, y] = order[i]; if (m2[y][x]) bytes[i >> 3] |= 1 << (7 - (i & 7)); }
    const nb = NUM_BLOCKS[f.ecc][v], eb = ECC_PER_BLOCK[f.ecc][v], shortCount = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const blocks = Array.from({ length: nb }, (_, i) => new Array(shortLen + (i < shortCount ? 0 : 1)).fill(0)); let k = 0;
    for (let i = 0; i < shortLen - eb + 1; i++) for (let j = 0; j < nb; j++) if (i !== shortLen - eb || j >= shortCount) blocks[j][i] = bytes[k++];
    for (let i = 0; i < eb; i++) for (let j = 0; j < nb; j++) blocks[j][blocks[j].length - eb + i] = bytes[k++];
    let corrected = 0; const data = [];
    for (const b of blocks) { const c = rsCorrect(b, eb); if (c < 0) return { ok: false, error: "The code is too damaged to repair (more errors than its error-correction level can fix)." }; corrected += c; for (let i = 0; i < b.length - eb; i++) data.push(b[i]); }
    const r = parseStream(data, v); if (r.error) return { ok: false, error: r.error };
    return { ok: true, text: r.text, version: v, ecc: f.ecc, mask: f.mask, corrected, notes: r.notes, modes: r.modes };
  }

  // ---------- reading from pixels ----------
  function otsu(gray) { const h = new Array(256).fill(0); for (const x of gray) h[x]++; const total = gray.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i]; let sb = 0, wb = 0, best = 0, th = 128; for (let t = 0; t < 256; t++) { wb += h[t]; if (!wb) continue; const wf = total - wb; if (!wf) break; sb += t * h[t]; const mb = sb / wb, mf = (sum - sb) / wf, between = wb * wf * (mb - mf) * (mb - mf); if (between > best) { best = between; th = t; } } return th; }
  function runsOf(line) { const r = []; let cur = line[0], len = 1; for (let i = 1; i < line.length; i++) { if (line[i] === cur) len++; else { r.push([cur, len]); cur = line[i]; len = 1; } } r.push([cur, len]); return r; }
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  function ratioOk(w, m) { return near(w[0], m, m * 0.7) && near(w[1], m, m * 0.7) && near(w[2], 3 * m, 3 * m * 0.6) && near(w[3], m, m * 0.7) && near(w[4], m, m * 0.7); }
  function findFinders(bin, W, H) {
    const cands = [];
    const scan = (get, len, other, vertical) => {
      for (let a = 0; a < other; a++) {
        const line = new Array(len); for (let i = 0; i < len; i++) line[i] = get(a, i);
        const runs = runsOf(line); let pos = 0; const starts = runs.map(r => { const s = pos; pos += r[1]; return s; });
        for (let i = 0; i + 4 < runs.length; i++) { if (!runs[i][0]) continue; const w = [runs[i][1], runs[i + 1][1], runs[i + 2][1], runs[i + 3][1], runs[i + 4][1]], tot = w[0] + w[1] + w[2] + w[3] + w[4], m = tot / 7; if (m < 1.5 || !ratioOk(w, m)) continue; const c = starts[i] + tot / 2; cands.push(vertical ? { x: a, y: c, m, v: true } : { x: c, y: a, m, v: false }); }
      }
    };
    scan((y, x) => bin[y * W + x], W, H, false);
    const rows = cands.filter(c => !c.v); const out = [];
    // cross-check each horizontal hit vertically through its centre
    for (const c of rows) {
      const cx = Math.round(c.x); if (cx < 0 || cx >= W) continue; const col = []; for (let y = 0; y < H; y++) col.push(bin[y * W + cx]);
      const runs = runsOf(col); let pos = 0; for (let i = 0; i + 4 < runs.length; i++) { const s = pos; pos += runs[i][1]; if (!runs[i][0]) continue; const w = [runs[i][1], runs[i + 1][1], runs[i + 2][1], runs[i + 3][1], runs[i + 4][1]], tot = w[0] + w[1] + w[2] + w[3] + w[4], m = tot / 7; if (!ratioOk(w, m)) continue; const cy = s + tot / 2; if (Math.abs(cy - c.y) <= tot / 2 && near(m, c.m, c.m * 0.5)) { out.push({ x: c.x, y: cy, m: (m + c.m) / 2 }); break; } }
    }
    // merge nearby hits into centres
    const merged = []; for (const p of out) { const q = merged.find(z => Math.hypot(z.x - p.x, z.y - p.y) < Math.max(z.m, p.m) * 3.5); if (q) { q.x = (q.x * q.n + p.x) / (q.n + 1); q.y = (q.y * q.n + p.y) / (q.n + 1); q.m = (q.m * q.n + p.m) / (q.n + 1); q.n++; } else merged.push({ x: p.x, y: p.y, m: p.m, n: 1 }); }
    return merged.filter(c => c.n >= 2).sort((a, b) => b.n - a.n).slice(0, 12);
  }
  function chooseTriple(c) {
    let best = null;
    for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++) for (let k = j + 1; k < c.length; k++) {
      const P = [c[i], c[j], c[k]], ms = P.map(p => p.m); if (Math.max(...ms) / Math.min(...ms) > 1.6) continue;
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y); const ds = [[d(P[1], P[2]), 0], [d(P[0], P[2]), 1], [d(P[0], P[1]), 2]].sort((a, b) => a[0] - b[0]); const tl = P[ds[2][1]], a = P[ds[0][1] === ds[2][1] ? 1 : [0, 1, 2].filter(x => x !== ds[2][1])[0]], b = P[[0, 1, 2].filter(x => x !== ds[2][1])[1]];
      const l1 = d(tl, a), l2 = d(tl, b), hyp = d(a, b); const err = Math.abs(l1 - l2) / Math.max(l1, l2) + Math.abs(hyp - Math.hypot(l1, l2)) / hyp; if (err > 0.35) continue;
      const score = err - 0.01 * (P[0].n + P[1].n + P[2].n); if (!best || score < best.score) best = { score, tl, a, b };
    }
    if (!best) return null; let { tl, a, b } = best; const cross = (a.x - tl.x) * (b.y - tl.y) - (a.y - tl.y) * (b.x - tl.x); if (cross < 0) { const t = a; a = b; b = t; } return { tl, tr: a, bl: b };
  }
  function sampleGrid(bin, W, H, t) {
    const m = (t.tl.m + t.tr.m + t.bl.m) / 3, dTR = Math.hypot(t.tr.x - t.tl.x, t.tr.y - t.tl.y), dBL = Math.hypot(t.bl.x - t.tl.x, t.bl.y - t.tl.y);
    const est = (Math.max(dTR, dBL) + Math.min(dTR, dBL)) / 2 / m + 7, v = Math.max(1, Math.min(40, Math.round((est - 17) / 4))), n = size(v);
    const ex = [(t.tr.x - t.tl.x) / (n - 7), (t.tr.y - t.tl.y) / (n - 7)], ey = [(t.bl.x - t.tl.x) / (n - 7), (t.bl.y - t.tl.y) / (n - 7)];
    const at = (u, w) => { const x = t.tl.x + (u - 3.5) * ex[0] + (w - 3.5) * ey[0], y = t.tl.y + (u - 3.5) * ex[1] + (w - 3.5) * ey[1]; return [x, y]; };
    const mod = []; for (let j = 0; j < n; j++) { const row = []; for (let i = 0; i < n; i++) { let dark = 0, cnt = 0; for (const [du, dv] of [[0, 0], [-0.25, 0], [0.25, 0], [0, -0.25], [0, 0.25]]) { const [x, y] = at(i + 0.5 + du, j + 0.5 + dv), xi = Math.floor(x), yi = Math.floor(y); if (xi < 0 || yi < 0 || xi >= W || yi >= H) continue; cnt++; if (bin[yi * W + xi]) dark++; } row.push(cnt > 0 && dark * 2 > cnt); } mod.push(row); }
    return mod;
  }
  /* decodeImage(data (RGBA bytes), width, height) -> same as decodeMatrix, or { ok: false, error, found } */
  function decodeImage(rgba, W, H) {
    const gray = new Uint8Array(W * H); for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000 | 0;
    const th = otsu(gray); let lastErr = "No QR code was found in the picture.";
    for (const invert of [false, true]) {
      const bin = new Uint8Array(W * H); for (let i = 0; i < bin.length; i++) bin[i] = (gray[i] > th) !== invert ? 0 : 1;   // 1 = dark
      const f = findFinders(bin, W, H); if (f.length < 3) continue;
      const tri = chooseTriple(f); if (!tri) { lastErr = "Finder squares were seen but they do not form a code."; continue; }
      const r = decodeMatrix(sampleGrid(bin, W, H, tri)); if (r.ok) { r.inverted = invert; return r; } lastErr = r.error;
    }
    return { ok: false, error: lastErr };
  }
  // ---------- what goes inside: the text formats phones understand ----------
  const wifiEsc = t => String(t).replace(/([\\;,:"])/g, "\\$1");
  const vEsc = t => String(t).replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
  /* payload(kind, fields) -> text for the code. kinds: text, wifi {ssid, password, security: WPA|WEP|nopass, hidden}, email {to, subject, body}, tel {number},
     sms {number, message}, vcard {first, last, org, title, phone, email, url} */
  function payload(kind, f) {
    f = f || {};
    if (kind === "wifi") { if (!f.ssid) return { error: "Type the network name (SSID)." }; const sec = ["WPA", "WEP", "nopass"].includes(f.security) ? f.security : "WPA"; if (sec !== "nopass" && !f.password) return { error: "Type the Wi-Fi password, or choose 'No password'." }; return { text: "WIFI:T:" + sec + ";S:" + wifiEsc(f.ssid) + ";" + (sec === "nopass" ? "" : "P:" + wifiEsc(f.password) + ";") + (f.hidden ? "H:true;" : "") + ";" }; }
    if (kind === "email") { if (!/^[^\s@]+@[^\s@]+$/.test(f.to || "")) return { error: "Type a valid e-mail address." }; const q = []; if (f.subject) q.push("subject=" + encodeURIComponent(f.subject)); if (f.body) q.push("body=" + encodeURIComponent(f.body)); return { text: "mailto:" + f.to + (q.length ? "?" + q.join("&") : "") }; }
    if (kind === "tel") { if (!/^[+0-9 ()\-.]{3,30}$/.test(f.number || "")) return { error: "Type a phone number (digits, +, spaces, brackets and dashes)." }; return { text: "tel:" + f.number.replace(/[ ()\-.]/g, "") }; }
    if (kind === "sms") { if (!/^[+0-9 ()\-.]{3,30}$/.test(f.number || "")) return { error: "Type a phone number." }; return { text: "SMSTO:" + f.number.replace(/[ ()\-.]/g, "") + ":" + (f.message || "") }; }
    if (kind === "vcard") { if (!f.first && !f.last && !f.org) return { error: "Type at least a name or an organisation." }; const L = ["BEGIN:VCARD", "VERSION:3.0", "N:" + vEsc(f.last || "") + ";" + vEsc(f.first || "") + ";;;", "FN:" + vEsc(((f.first || "") + " " + (f.last || "")).trim() || f.org)]; if (f.org) L.push("ORG:" + vEsc(f.org)); if (f.title) L.push("TITLE:" + vEsc(f.title)); if (f.phone) L.push("TEL:" + vEsc(f.phone)); if (f.email) L.push("EMAIL:" + vEsc(f.email)); if (f.url) L.push("URL:" + String(f.url).replace(/[\r\n]/g, "")); L.push("END:VCARD"); return { text: L.join("\n") }; }
    return { text: String(f.text === undefined ? "" : f.text) };
  }
  // what a decoded text looks like, so the reader can say it in words (never opens or follows anything)
  function describeText(t) {
    if (/^https?:\/\//i.test(t)) { let host = ""; try { host = new URL(t).hostname; } catch { /* leave empty */ } return { kind: "a web address", warn: "Check the address before you open it. Codes are sometimes stuck over real ones to lead to look-alike sites." + (host && /xn--/.test(host) ? " This address uses an international (xn--) name that can imitate another site." : "") }; }
    if (/^WIFI:/i.test(t)) return { kind: "Wi-Fi network details", warn: "It contains the network password in plain text." };
    if (/^mailto:/i.test(t)) return { kind: "an e-mail address" }; if (/^tel:/i.test(t)) return { kind: "a phone number" }; if (/^smsto?:/i.test(t)) return { kind: "a text message" };
    if (/^BEGIN:VCARD/i.test(t)) return { kind: "a contact card (vCard)" }; if (/^BEGIN:VEVENT|^BEGIN:VCALENDAR/i.test(t)) return { kind: "a calendar event" };
    if (/^geo:/i.test(t)) return { kind: "a map location" }; if (/^otpauth:/i.test(t)) return { kind: "a two-factor authentication secret", warn: "This is a secret key for logging in. Anyone who has it can generate your codes; do not share it." };
    if (/^(bitcoin|ethereum|litecoin|monero):/i.test(t)) return { kind: "a cryptocurrency payment request", warn: "Check the address and amount carefully before paying." };
    return { kind: "plain text" };
  }
  // ---------- output ----------
  function toSvg(modules, o) {
    o = o || {}; const n = modules.length, b = o.border === undefined ? 4 : o.border, dark = o.dark || "#000000", light = o.light === null ? null : (o.light || "#ffffff"); let d = "";
    for (let y = 0; y < n; y++) { let x = 0; while (x < n) { if (!modules[y][x]) { x++; continue; } let s = x; while (x < n && modules[y][x]) x++; d += "M" + (s + b) + "," + (y + b) + "h" + (x - s) + "v1h-" + (x - s) + "z"; } }
    const t = n + 2 * b; return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + t + " " + t + '" shape-rendering="crispEdges">' + (light ? '<rect width="100%" height="100%" fill="' + light + '"/>' : "") + '<path d="' + d + '" fill="' + dark + '"/></svg>\n';
  }
  const api = { payload, describeText, encode, decodeMatrix, decodeImage, toSvg, maxChars, modeOf, dataCodewords, rawCodewords, alignPositions, formatWord, versionWord, rsEncode, rsCorrect, size, LEVELS, ECC_PER_BLOCK, NUM_BLOCKS, penalty, _grid: { newGrid, drawFunction, dataOrder } };
  if (typeof window !== "undefined") window.QR = api;
  if (typeof module !== "undefined") module.exports = api;
})();
