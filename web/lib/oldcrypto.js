/* Older and plain ciphers, written out here so the certificate tools work on every browser (plain http too) and read the files that Windows, Java and old
   OpenSSL still produce: DES / Triple-DES (CBC), RC2 (CBC), RC4, AES (CBC), HMAC, PBKDF2, the PKCS#12 key derivation (RFC 7292 appendix B) and the old OpenSSL
   key derivation. No third-party code. Pure functions on Uint8Array. The hashes come from lib/softcrypto.js (looked up when used, never at load time).
   Everything here is tested against openssl (oldcrypto-test.js). Exports window.OldCrypto. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const hashFn = name => { const S = g.SoftCrypto || (typeof require !== "undefined" ? require("./softcrypto.js") : null); if (!S) throw new Error("SoftCrypto is not loaded"); return b => S.digest(name, b); };
  const md5 = b => { const H = g.HashCalc || (typeof require !== "undefined" ? require("./hashcalc.js") : null); return H.md5 ? H.md5(b) : H._internals.md5(b); };
  const concat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
  const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
  const utf8 = s => new TextEncoder().encode(s);

  /* ---------- padding (PKCS#7) ---------- */
  function unpad(b, size) {
    const n = b.length, p = n ? b[n - 1] : 0;
    if (!n || n % size || p < 1 || p > size) return null;
    for (let i = n - p; i < n; i++) if (b[i] !== p) return null;
    return b.subarray(0, n - p);
  }
  const pad = (b, size) => { const p = size - (b.length % size), o = new Uint8Array(b.length + p); o.set(b); o.fill(p, b.length); return o; };

  /* ---------- DES and Triple-DES ---------- */
  const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
  const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
  const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
  const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
  const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
  const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
  const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
  const SBOX = [
    [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
    [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
    [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
    [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
    [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
    [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
    [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
    [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
  ];
  const bitsOf = b => { const o = new Uint8Array(b.length * 8); for (let i = 0; i < b.length; i++) for (let j = 0; j < 8; j++) o[i * 8 + j] = (b[i] >> (7 - j)) & 1; return o; };
  const bytesOf = bits => { const o = new Uint8Array(bits.length / 8); for (let i = 0; i < o.length; i++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j]; o[i] = v; } return o; };
  const perm = (bits, table) => { const o = new Uint8Array(table.length); for (let i = 0; i < table.length; i++) o[i] = bits[table[i] - 1]; return o; };
  function desKeys(key8) {
    const k = perm(bitsOf(key8), PC1); let C = k.slice(0, 28), D = k.slice(28);
    const out = [];
    for (let r = 0; r < 16; r++) {
      const s = SHIFTS[r];
      C = concat(C.slice(s), C.slice(0, s)); D = concat(D.slice(s), D.slice(0, s));
      out.push(perm(concat(C, D), PC2));
    }
    return out;
  }
  function desBlock(bits, keys, decrypt) {
    const t = perm(bits, IP); let L = t.slice(0, 32), R = t.slice(32);
    for (let r = 0; r < 16; r++) {
      const k = keys[decrypt ? 15 - r : r], er = perm(R, E), x = new Uint8Array(48);
      for (let i = 0; i < 48; i++) x[i] = er[i] ^ k[i];
      const f = new Uint8Array(32);
      for (let s = 0; s < 8; s++) {
        const o = s * 6, row = (x[o] << 1) | x[o + 5], col = (x[o + 1] << 3) | (x[o + 2] << 2) | (x[o + 3] << 1) | x[o + 4], v = SBOX[s][row * 16 + col];
        for (let j = 0; j < 4; j++) f[s * 4 + j] = (v >> (3 - j)) & 1;
      }
      const pf = perm(f, P), nR = new Uint8Array(32);
      for (let i = 0; i < 32; i++) nR[i] = L[i] ^ pf[i];
      L = R; R = nR;
    }
    return perm(concat(R, L), FP);
  }
  // Triple-DES with two or three keys (16 or 24 bytes) or single DES (8 bytes), CBC, no padding handling
  function desCbc(key, iv, data, decrypt) {
    if (![8, 16, 24].includes(key.length)) throw new Error("bad DES key length");
    if (data.length % 8) throw new Error("DES data is not a multiple of 8 bytes");
    const k1 = desKeys(key.subarray(0, 8)), k2 = key.length > 8 ? desKeys(key.subarray(8, 16)) : null, k3 = key.length === 24 ? desKeys(key.subarray(16, 24)) : k1;
    const one = (bits, dec) => !k2 ? desBlock(bits, k1, dec) : dec ? desBlock(desBlock(desBlock(bits, k3, true), k2, false), k1, true) : desBlock(desBlock(desBlock(bits, k1, false), k2, true), k3, false);
    const out = new Uint8Array(data.length); let prev = bitsOf(iv);
    for (let o = 0; o < data.length; o += 8) {
      const blk = bitsOf(data.subarray(o, o + 8));
      if (decrypt) { const d = one(blk, true); for (let i = 0; i < 64; i++) d[i] ^= prev[i]; out.set(bytesOf(d), o); prev = blk; }
      else { const x = new Uint8Array(64); for (let i = 0; i < 64; i++) x[i] = blk[i] ^ prev[i]; const e = one(x, false); out.set(bytesOf(e), o); prev = e; }
    }
    return out;
  }

  /* ---------- RC2 (RFC 2268) and RC4 ---------- */
  const PITABLE = new Uint8Array([
    0xd9,0x78,0xf9,0xc4,0x19,0xdd,0xb5,0xed,0x28,0xe9,0xfd,0x79,0x4a,0xa0,0xd8,0x9d,
    0xc6,0x7e,0x37,0x83,0x2b,0x76,0x53,0x8e,0x62,0x4c,0x64,0x88,0x44,0x8b,0xfb,0xa2,
    0x17,0x9a,0x59,0xf5,0x87,0xb3,0x4f,0x13,0x61,0x45,0x6d,0x8d,0x09,0x81,0x7d,0x32,
    0xbd,0x8f,0x40,0xeb,0x86,0xb7,0x7b,0x0b,0xf0,0x95,0x21,0x22,0x5c,0x6b,0x4e,0x82,
    0x54,0xd6,0x65,0x93,0xce,0x60,0xb2,0x1c,0x73,0x56,0xc0,0x14,0xa7,0x8c,0xf1,0xdc,
    0x12,0x75,0xca,0x1f,0x3b,0xbe,0xe4,0xd1,0x42,0x3d,0xd4,0x30,0xa3,0x3c,0xb6,0x26,
    0x6f,0xbf,0x0e,0xda,0x46,0x69,0x07,0x57,0x27,0xf2,0x1d,0x9b,0xbc,0x94,0x43,0x03,
    0xf8,0x11,0xc7,0xf6,0x90,0xef,0x3e,0xe7,0x06,0xc3,0xd5,0x2f,0xc8,0x66,0x1e,0xd7,
    0x08,0xe8,0xea,0xde,0x80,0x52,0xee,0xf7,0x84,0xaa,0x72,0xac,0x35,0x4d,0x6a,0x2a,
    0x96,0x1a,0xd2,0x71,0x5a,0x15,0x49,0x74,0x4b,0x9f,0xd0,0x5e,0x04,0x18,0xa4,0xec,
    0xc2,0xe0,0x41,0x6e,0x0f,0x51,0xcb,0xcc,0x24,0x91,0xaf,0x50,0xa1,0xf4,0x70,0x39,
    0x99,0x7c,0x3a,0x85,0x23,0xb8,0xb4,0x7a,0xfc,0x02,0x36,0x5b,0x25,0x55,0x97,0x31,
    0x2d,0x5d,0xfa,0x98,0xe3,0x8a,0x92,0xae,0x05,0xdf,0x29,0x10,0x67,0x6c,0xba,0xc9,
    0xd3,0x00,0xe6,0xcf,0xe1,0x9e,0xa8,0x2c,0x63,0x16,0x01,0x3f,0x58,0xe2,0x89,0xa9,
    0x0d,0x38,0x34,0x1b,0xab,0x33,0xff,0xb0,0xbb,0x48,0x0c,0x5f,0xb9,0xb1,0xcd,0x2e,
    0xc5,0xf3,0xdb,0x47,0xe5,0xa5,0x9c,0x77,0x0a,0xa6,0x20,0x68,0xfe,0x7f,0xc1,0xad
  ]);
  function rc2Schedule(key, effBits) {
    const T = key.length, T8 = (effBits + 7) >> 3, TM = 0xff >> (8 * T8 - effBits), L = new Uint8Array(128);
    L.set(key);
    for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 255];
    L[128 - T8] = PITABLE[L[128 - T8] & TM];
    for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
    const K = new Uint16Array(64); for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
    return K;
  }
  const rol16 = (x, n) => ((x << n) | (x >>> (16 - n))) & 0xffff, ror16 = (x, n) => ((x >>> n) | (x << (16 - n))) & 0xffff;
  const rc2Dec = (K, R) => {
    let [r0, r1, r2, r3] = R;
    for (let i = 15; i >= 0; i--) {
      r3 = ror16(r3, 5); r3 = (r3 - K[4 * i + 3] - (r2 & r1) - (~r2 & r0)) & 0xffff;
      r2 = ror16(r2, 3); r2 = (r2 - K[4 * i + 2] - (r1 & r0) - (~r1 & r3)) & 0xffff;
      r1 = ror16(r1, 2); r1 = (r1 - K[4 * i + 1] - (r0 & r3) - (~r0 & r2)) & 0xffff;
      r0 = ror16(r0, 1); r0 = (r0 - K[4 * i] - (r3 & r2) - (~r3 & r1)) & 0xffff;
      if (i === 5 || i === 11) { r3 = (r3 - K[r2 & 63]) & 0xffff; r2 = (r2 - K[r1 & 63]) & 0xffff; r1 = (r1 - K[r0 & 63]) & 0xffff; r0 = (r0 - K[r3 & 63]) & 0xffff; }
    }
    return [r0, r1, r2, r3];
  };
  const rc2Enc = (K, R) => {
    let [r0, r1, r2, r3] = R;
    for (let i = 0; i < 16; i++) {
      r0 = (r0 + K[4 * i] + (r3 & r2) + (~r3 & r1)) & 0xffff; r0 = rol16(r0, 1);
      r1 = (r1 + K[4 * i + 1] + (r0 & r3) + (~r0 & r2)) & 0xffff; r1 = rol16(r1, 2);
      r2 = (r2 + K[4 * i + 2] + (r1 & r0) + (~r1 & r3)) & 0xffff; r2 = rol16(r2, 3);
      r3 = (r3 + K[4 * i + 3] + (r2 & r1) + (~r2 & r0)) & 0xffff; r3 = rol16(r3, 5);
      if (i === 4 || i === 10) { r0 = (r0 + K[r3 & 63]) & 0xffff; r1 = (r1 + K[r0 & 63]) & 0xffff; r2 = (r2 + K[r1 & 63]) & 0xffff; r3 = (r3 + K[r2 & 63]) & 0xffff; }
    }
    return [r0, r1, r2, r3];
  };
  function rc2Cbc(key, effBits, iv, data, decrypt) {
    if (data.length % 8) throw new Error("RC2 data is not a multiple of 8 bytes");
    const K = rc2Schedule(key, effBits), out = new Uint8Array(data.length); let prev = Array.from(iv);
    for (let o = 0; o < data.length; o += 8) {
      const blk = Array.from(data.subarray(o, o + 8));
      const words = b => [b[0] | (b[1] << 8), b[2] | (b[3] << 8), b[4] | (b[5] << 8), b[6] | (b[7] << 8)];
      const bytes = w => w.flatMap(x => [x & 255, x >> 8]);
      if (decrypt) { const d = bytes(rc2Dec(K, words(blk))); for (let i = 0; i < 8; i++) out[o + i] = d[i] ^ prev[i]; prev = blk; }
      else { const e = bytes(rc2Enc(K, words(blk.map((v, i) => v ^ prev[i])))); out.set(e, o); prev = e; }
    }
    return out;
  }
  function rc4(key, data) {
    const S = new Uint8Array(256); for (let i = 0; i < 256; i++) S[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; [S[i], S[j]] = [S[j], S[i]]; }
    const out = new Uint8Array(data.length);
    for (let n = 0, i = 0, j = 0; n < data.length; n++) { i = (i + 1) & 255; j = (j + S[i]) & 255; [S[i], S[j]] = [S[j], S[i]]; out[n] = data[n] ^ S[(S[i] + S[j]) & 255]; }
    return out;
  }

  /* ---------- AES (CBC) ---------- */
  const SB = new Uint8Array(256), SBI = new Uint8Array(256);
  (() => {
    let p = 1, q = 1;
    do { p = p ^ ((p << 1) & 255) ^ (p & 0x80 ? 0x1b : 0); q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 255; if (q & 0x80) q ^= 0x09;
      const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4)); SB[p] = (x ^ 0x63) & 255; SBI[SB[p]] = p; } while (p !== 1);
    SB[0] = 0x63; SBI[0x63] = 0;
  })();
  const xt = x => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 255;
  const mul = (a, b) => { let r = 0; while (b) { if (b & 1) r ^= a; a = xt(a); b >>= 1; } return r; };
  function aesKey(key) {
    const nk = key.length / 4, nr = nk + 6, w = new Uint8Array(16 * (nr + 1)); w.set(key);
    for (let i = nk; i < 4 * (nr + 1); i++) {
      let t = w.slice(4 * (i - 1), 4 * i);
      if (i % nk === 0) { t = new Uint8Array([SB[t[1]] ^ (RCON(i / nk)), SB[t[2]], SB[t[3]], SB[t[0]]]); }
      else if (nk > 6 && i % nk === 4) t = t.map(x => SB[x]);
      for (let j = 0; j < 4; j++) w[4 * i + j] = w[4 * (i - nk) + j] ^ t[j];
    }
    return { w, nr };
  }
  const RCON = n => { let r = 1; for (let i = 1; i < n; i++) r = xt(r); return r; };
  function aesBlock(k, b, decrypt) {
    const s = Uint8Array.from(b), { w, nr } = k;
    const add = r => { for (let i = 0; i < 16; i++) s[i] ^= w[16 * r + i]; };
    const T = new Uint8Array(16);
    if (!decrypt) {
      add(0);
      for (let r = 1; r <= nr; r++) {
        for (let i = 0; i < 16; i++) s[i] = SB[s[i]];
        for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) T[4 * c + rr] = s[4 * ((c + rr) % 4) + rr];
        s.set(T);
        if (r < nr) for (let c = 0; c < 4; c++) { const a = s.subarray(4 * c, 4 * c + 4), a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
          a[0] = xt(a0) ^ (xt(a1) ^ a1) ^ a2 ^ a3; a[1] = a0 ^ xt(a1) ^ (xt(a2) ^ a2) ^ a3; a[2] = a0 ^ a1 ^ xt(a2) ^ (xt(a3) ^ a3); a[3] = (xt(a0) ^ a0) ^ a1 ^ a2 ^ xt(a3); }
        add(r);
      }
    } else {
      add(nr);
      for (let r = nr - 1; r >= 0; r--) {
        for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) T[4 * ((c + rr) % 4) + rr] = s[4 * c + rr];
        s.set(T);
        for (let i = 0; i < 16; i++) s[i] = SBI[s[i]];
        add(r);
        if (r > 0) for (let c = 0; c < 4; c++) { const a = s.subarray(4 * c, 4 * c + 4), a0 = a[0], a1 = a[1], a2 = a[2], a3 = a[3];
          a[0] = mul(a0, 14) ^ mul(a1, 11) ^ mul(a2, 13) ^ mul(a3, 9); a[1] = mul(a0, 9) ^ mul(a1, 14) ^ mul(a2, 11) ^ mul(a3, 13); a[2] = mul(a0, 13) ^ mul(a1, 9) ^ mul(a2, 14) ^ mul(a3, 11); a[3] = mul(a0, 11) ^ mul(a1, 13) ^ mul(a2, 9) ^ mul(a3, 14); }
      }
    }
    return s;
  }
  function aesCbc(key, iv, data, decrypt) {
    if (![16, 24, 32].includes(key.length)) throw new Error("bad AES key length");
    if (data.length % 16) throw new Error("AES data is not a multiple of 16 bytes");
    const k = aesKey(key), out = new Uint8Array(data.length); let prev = iv;
    for (let o = 0; o < data.length; o += 16) {
      const blk = data.subarray(o, o + 16);
      if (decrypt) { const d = aesBlock(k, blk, true); for (let i = 0; i < 16; i++) out[o + i] = d[i] ^ prev[i]; prev = blk; }
      else { const x = new Uint8Array(16); for (let i = 0; i < 16; i++) x[i] = blk[i] ^ prev[i]; const e = aesBlock(k, x, false); out.set(e, o); prev = e; }
    }
    return out;
  }

  /* ---------- HMAC, PBKDF2, key derivations ---------- */
  const BLOCK = { "SHA-1": 64, "SHA-256": 64, "SHA-384": 128, "SHA-512": 128, "SHA-224": 64 };
  const OUT = { "SHA-1": 20, "SHA-256": 32, "SHA-384": 48, "SHA-512": 64, "SHA-224": 28 };
  function hmac(hash, key, data) {
    const h = hashFn(hash), bs = BLOCK[hash];
    if (key.length > bs) key = h(key);
    const k = new Uint8Array(bs); k.set(key);
    const ip = k.map(x => x ^ 0x36), op = k.map(x => x ^ 0x5c);
    return h(concat(op, h(concat(ip, data))));
  }
  // PBKDF2: the browser's crypto when it has it (fast, even for 600,000 rounds), otherwise the slow pure version
  async function pbkdf2(hash, password, salt, iterations, length) {
    const sub = g.crypto && g.crypto.subtle;
    if (sub && hash !== "SHA-224") {
      try {
        const k = await sub.importKey("raw", password, "PBKDF2", false, ["deriveBits"]);
        return new Uint8Array(await sub.deriveBits({ name: "PBKDF2", hash, salt, iterations }, k, length * 8));
      } catch { /* fall through to the pure version */ }
    }
    const out = new Uint8Array(Math.ceil(length / OUT[hash]) * OUT[hash]);
    for (let b = 1, o = 0; o < length; b++, o += OUT[hash]) {
      let u = hmac(hash, password, concat(salt, new Uint8Array([b >>> 24, b >>> 16, b >>> 8, b])));
      const t = Uint8Array.from(u);
      for (let i = 1; i < iterations; i++) { u = hmac(hash, password, u); for (let j = 0; j < t.length; j++) t[j] ^= u[j]; }
      out.set(t, o);
    }
    return out.subarray(0, length);
  }
  // the password as PKCS#12 wants it: UTF-16 big endian with a 00 00 end mark ("" gives just the end mark; null gives nothing)
  function bmp(pw) {
    if (pw == null) return new Uint8Array(0);
    const o = new Uint8Array(pw.length * 2 + 2); for (let i = 0; i < pw.length; i++) { const c = pw.charCodeAt(i); o[2 * i] = c >> 8; o[2 * i + 1] = c & 255; }
    return o;
  }
  // RFC 7292 appendix B.2; id 1 = key, 2 = iv, 3 = mac key
  function pkcs12Kdf(hash, pw, salt, iterations, id, length) {
    const h = hashFn(hash), u = OUT[hash], v = BLOCK[hash];
    const D = new Uint8Array(v).fill(id);
    const fill = (x) => { if (!x.length) return new Uint8Array(0); const n = v * Math.ceil(x.length / v), o = new Uint8Array(n); for (let i = 0; i < n; i++) o[i] = x[i % x.length]; return o; };
    let I = concat(fill(salt), fill(pw));
    const out = new Uint8Array(Math.ceil(length / u) * u);
    for (let c = 0; c < Math.ceil(length / u); c++) {
      let A = h(concat(D, I));
      for (let i = 1; i < iterations; i++) A = h(A);
      out.set(A, c * u);
      if (c + 1 < Math.ceil(length / u)) {
        const B = new Uint8Array(v); for (let i = 0; i < v; i++) B[i] = A[i % u];
        for (let j = 0; j < I.length / v; j++) {   // I_j = (I_j + B + 1) mod 2^(8v)
          let carry = 1;
          for (let i = v - 1; i >= 0; i--) { const x = I[j * v + i] + B[i] + carry; I[j * v + i] = x & 255; carry = x >> 8; }
        }
      }
    }
    return out.subarray(0, length);
  }
  // OpenSSL's old EVP_BytesToKey (MD5, one round) as used by "Proc-Type: 4,ENCRYPTED" PEM files
  function evpBytesToKey(password, salt, keyLen, ivLen) {
    let out = new Uint8Array(0), prev = new Uint8Array(0);
    while (out.length < keyLen + ivLen) { prev = md5(concat(prev, password, salt)); out = concat(out, prev); }
    return { key: out.subarray(0, keyLen), iv: out.subarray(keyLen, keyLen + ivLen) };
  }

  const api = { concat, eq, utf8, pad, unpad, desCbc, rc2Cbc, rc4, aesCbc, hmac, pbkdf2, bmp, pkcs12Kdf, evpBytesToKey, OUT, BLOCK };
  g.OldCrypto = api;
  if (typeof module !== "undefined") module.exports = api;
})();
