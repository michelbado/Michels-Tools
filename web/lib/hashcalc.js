/* Hash and checksum calculator: MD5, SHA-1, SHA-256, SHA-384, SHA-512, CRC-32, CRC-32C, Adler-32 and HMAC, plus "does this match the hash I was given?".
   MD5 and the checksums are written here; the SHA family uses crypto.subtle when the browser offers it (secure pages) and lib/softcrypto.js otherwise.
   Looked up when used, never at load time (the shell loads libraries in any order). Exports window.HashCalc. */
(() => {
  "use strict";
  const SOFT = () => (typeof window !== "undefined" ? window.SoftCrypto : globalThis.SoftCrypto);
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  const hex32 = n => (n >>> 0).toString(16).padStart(8, "0");

  // ---------- MD5 (RFC 1321) ----------
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  function md5(data) {
    const n = data.length, total = ((n + 8) >> 6) * 64 + 64, buf = new Uint8Array(total); buf.set(data); buf[n] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(total - 8, (n * 8) >>> 0, true); dv.setUint32(total - 4, Math.floor(n / 536870912) >>> 0, true);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476; const M = new Uint32Array(16);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
      let A = a0, B = b0, C = c0, D = d0;
      for (let i = 0; i < 64; i++) {
        let F, g;
        if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; } else { F = C ^ (B | ~D); g = (7 * i) & 15; }
        F = (F + A + K[i] + M[g]) >>> 0; A = D; D = C; C = B; B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
      }
      a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
    }
    const out = new Uint8Array(16), o = new DataView(out.buffer); o.setUint32(0, a0, true); o.setUint32(4, b0, true); o.setUint32(8, c0, true); o.setUint32(12, d0, true); return out;
  }

  // ---------- checksums ----------
  const crcTable = poly => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? (poly ^ (c >>> 1)) : c >>> 1; t[n] = c >>> 0; } return t; };
  let T32, T32C;
  const crc = (data, t) => { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const crc32 = d => crc(d, T32 || (T32 = crcTable(0xEDB88320)));
  const crc32c = d => crc(d, T32C || (T32C = crcTable(0x82F63B78)));
  function adler32(d) { let a = 1, b = 0; for (let i = 0; i < d.length; i++) { a = (a + d[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }

  // ---------- the algorithm list ----------
  const ALGOS = [
    { id: "MD5", bits: 128, weak: "broken for security (collisions are easy); fine for spotting accidental changes" },
    { id: "SHA-1", bits: 160, weak: "broken for security (collisions have been made); do not use for signatures" },
    { id: "SHA-256", bits: 256 }, { id: "SHA-384", bits: 384 }, { id: "SHA-512", bits: 512 },
    { id: "CRC-32", bits: 32, check: true }, { id: "CRC-32C", bits: 32, check: true }, { id: "Adler-32", bits: 32, check: true },
  ];
  const BLOCK = { "MD5": 64, "SHA-1": 64, "SHA-256": 64, "SHA-384": 128, "SHA-512": 128 };

  // synchronous digest (used for HMAC and for small inputs)
  function digestSync(name, bytes) {
    if (name === "MD5") return md5(bytes);
    const s = SOFT(); if (!s) throw new Error("The SHA code (softcrypto.js) is not loaded.");
    return new Uint8Array(s.digest(name, bytes));
  }
  async function digest(name, bytes) {
    if (name === "MD5") return md5(bytes);
    const sub = typeof crypto !== "undefined" && crypto.subtle;
    if (sub) { try { return new Uint8Array(await sub.digest(name, bytes)); } catch { /* fall back */ } }
    return digestSync(name, bytes);
  }
  // names: array of ALGOS ids -> { id: hex }
  async function hashAll(bytes, names, onStep) {
    const out = {};
    for (const n of names) {
      if (onStep) await onStep(n);
      if (n === "CRC-32") out[n] = hex32(crc32(bytes)); else if (n === "CRC-32C") out[n] = hex32(crc32c(bytes)); else if (n === "Adler-32") out[n] = hex32(adler32(bytes));
      else out[n] = hex(await digest(n, bytes));
    }
    return out;
  }
  function hmac(name, key, msg) {
    const bs = BLOCK[name]; if (!bs) throw new Error("HMAC needs one of: " + Object.keys(BLOCK).join(", "));
    if (key.length > bs) key = digestSync(name, key);
    const k = new Uint8Array(bs); k.set(key);
    const ipad = new Uint8Array(bs + msg.length), opad = new Uint8Array(bs);
    for (let i = 0; i < bs; i++) { ipad[i] = k[i] ^ 0x36; opad[i] = k[i] ^ 0x5c; }
    ipad.set(msg, bs); const inner = digestSync(name, ipad), outer = new Uint8Array(bs + inner.length); outer.set(opad); outer.set(inner, bs);
    return digestSync(name, outer);
  }
  // does `expected` (hex, with spaces/colons/prefix, or base64) equal any computed digest? -> { match: id | null, shown, guess }
  function compare(expected, computed) {
    let e = String(expected).trim(); if (!e) return { empty: true };
    const pre = /^\s*(md5|sha-?1|sha-?256|sha-?384|sha-?512|crc-?32c?|adler-?32)\s*[:=]\s*/i.exec(e); let said = null; if (pre) { said = pre[1].toUpperCase().replace(/^SHA(\d)/, "SHA-$1").replace(/^CRC(\d)/, "CRC-$1").replace(/^ADLER(\d)/, "ADLER-$1"); e = e.slice(pre[0].length); }
    const h = e.replace(/^0x/i, "").replace(/[\s:\-]/g, "").toLowerCase(); let asHex = /^[0-9a-f]+$/.test(h) ? h : null;
    if (!asHex && /^[A-Za-z0-9+/_-]+=*$/.test(e.replace(/\s/g, ""))) { try { const bin = atob(e.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/")); asHex = hex(Uint8Array.from(bin, c => c.charCodeAt(0))); } catch { asHex = null; } }
    if (!asHex) return { invalid: true };
    for (const [id, v] of Object.entries(computed)) if (v.toLowerCase() === asHex) return { match: id, said };
    const bitsGuess = ({ 8: "CRC-32 / Adler-32", 32: "MD5", 40: "SHA-1", 64: "SHA-256", 96: "SHA-384", 128: "SHA-512" })[asHex.length];
    return { match: null, guess: bitsGuess || null, length: asHex.length, said, close: Object.entries(computed).find(([id, v]) => v.length === asHex.length && [...v].filter((c, i) => c !== asHex[i]).length <= 2) };
  }
  const api = { ALGOS, BLOCK, md5, crc32, crc32c, adler32, digest, digestSync, hashAll, hmac, compare, hex };
  if (typeof window !== "undefined") window.HashCalc = api;
  if (typeof module !== "undefined") module.exports = api;
})();
