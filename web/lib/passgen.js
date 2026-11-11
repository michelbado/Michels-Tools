/* Random passwords, tokens and identifiers (UUID v4 and v7, ULID) from the browser's secure random generator. Numbers are drawn without bias (values that would
   favour some choices are thrown away and drawn again). Nothing is stored or sent. Pure code except for the random source, which can be replaced in tests.
   Exports window.PassGen. */
(() => {
  "use strict";
  let source = n => { const a = new Uint32Array(n); (typeof crypto !== "undefined" ? crypto : globalThis.crypto).getRandomValues(a); return a; };
  const setSource = f => { source = f; };
  const SETS = {
    lower: "abcdefghijklmnopqrstuvwxyz", upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", digits: "0123456789", symbols: "!@#$%^&*()-_=+[]{};:,.<>/?~",
  };
  const AMBIGUOUS = "O0oIl1|`'\"";
  // uniform integer 0..max-1
  function randInt(max) {
    if (!(max >= 1) || max > 4294967296) throw new Error("range must be 1 to 4294967296");
    if (max === 1) return 0;
    const limit = Math.floor(4294967296 / max) * max;      // values at or above this would make small numbers slightly more likely
    for (;;) { const v = source(16); for (let i = 0; i < v.length; i++) if (v[i] < limit) return v[i] % max; }
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  const pick = s => s[randInt(s.length)];

  /* options: { length, lower, upper, digits, symbols (booleans), custom (extra characters to add), noAmbiguous, exclude (characters never to use), eachSet (at least one of each chosen kind) }
     -> { text, poolSize, bits } or { error } */
  function password(o) {
    o = o || {}; const len = Math.floor(o.length);
    if (!(len >= 1 && len <= 512)) return { error: "The length must be between 1 and 512." };
    const strip = s => [...new Set(s)].filter(c => !(o.noAmbiguous && AMBIGUOUS.includes(c)) && !(o.exclude || "").includes(c)).join("");
    const groups = [];
    for (const k of ["lower", "upper", "digits", "symbols"]) if (o[k]) { const g = strip(SETS[k]); if (g) groups.push(g); }
    if (o.custom) { const g = strip(o.custom.replace(/\s/g, "")); if (g) groups.push(g); }
    if (!groups.length) return { error: "Choose at least one kind of character." };
    const pool = [...new Set(groups.join(""))].join("");
    if (o.eachSet !== false && len < groups.length) return { error: "The length is too short to include one character of every chosen kind (" + groups.length + " kinds)." };
    const out = [];
    if (o.eachSet !== false) for (const g of groups) out.push(pick(g));
    while (out.length < len) out.push(pick(pool));
    shuffle(out);
    return { text: out.join(""), poolSize: pool.length, bits: len * Math.log2(pool.length) };
  }
  // ---------- strength wording ----------
  function rate(bits) {
    const label = bits < 28 ? "very weak" : bits < 40 ? "weak" : bits < 60 ? "fair" : bits < 80 ? "good" : bits < 110 ? "strong" : "very strong";
    const secs = Math.pow(2, bits - 1) / 1e10, units = [["years", 31557600], ["days", 86400], ["hours", 3600], ["minutes", 60], ["seconds", 1]];
    let t = "less than a second"; if (secs >= 1) { for (const [n, v] of units) if (secs >= v) { const q = secs / v; t = q >= 1e15 ? "more than a quadrillion " + n : q >= 1e12 ? "about " + (q / 1e12).toFixed(0) + " trillion " + n : q >= 1e9 ? "about " + (q / 1e9).toFixed(0) + " billion " + n : q >= 1e6 ? "about " + (q / 1e6).toFixed(0) + " million " + n : "about " + (q >= 100 ? Math.round(q).toLocaleString("en-US") : q.toFixed(q < 10 ? 1 : 0)) + " " + n; break; } }
    return { label, crack: t };
  }
  // ---------- identifiers ----------
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  function bytes(n) { const out = new Uint8Array(n); for (let i = 0; i < n; i += 4) { const v = source(1)[0]; for (let k = 0; k < 4 && i + k < n; k++) out[i + k] = (v >>> (8 * k)) & 255; } return out; }
  function uuid4() { const b = bytes(16); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; const h = hex(b); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20); }
  // UUID v7 (RFC 9562): 48-bit millisecond time, then random; sorts by creation time
  function uuid7(ms) { ms = ms === undefined ? Date.now() : ms; const b = bytes(16); let t = BigInt(ms); for (let i = 5; i >= 0; i--) { b[i] = Number(t & 255n); t >>= 8n; } b[6] = (b[6] & 0x0f) | 0x70; b[8] = (b[8] & 0x3f) | 0x80; const h = hex(b); return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20); }
  const CROCK = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  function ulid(ms) { ms = ms === undefined ? Date.now() : ms; let t = ms, ts = ""; for (let i = 0; i < 10; i++) { ts = CROCK[t % 32] + ts; t = Math.floor(t / 32); } let r = ""; for (let i = 0; i < 16; i++) r += CROCK[randInt(32)]; return ts + r; }
  const token = (nBytes, kind) => { const b = bytes(nBytes); if (kind === "hex") return hex(b); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  // decode the time out of a v7 UUID or ULID (for the screen to show)
  const uuid7Time = u => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u) ? parseInt(u.replace(/-/g, "").slice(0, 12), 16) : null;
  const ulidTime = u => { if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(u)) return null; let t = 0; for (const c of u.slice(0, 10)) t = t * 32 + CROCK.indexOf(c); return t; };
  const api = { setSource, randInt, shuffle, password, rate, uuid4, uuid7, ulid, token, bytes, uuid7Time, ulidTime, SETS, AMBIGUOUS };
  if (typeof window !== "undefined") window.PassGen = api;
  if (typeof module !== "undefined") module.exports = api;
})();
