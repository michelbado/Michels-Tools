/* Encoders and decoders for text and bytes: Base64 (standard and URL-safe), percent-encoding (URLs), hexadecimal, HTML entities and \uXXXX escapes.
   Decoding is forgiving about layout (spaces, line breaks, missing padding, "data:" prefixes) and says what it found. Pure code. Exports window.EncodeTool. */
(() => {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true });
  const toBytes = s => enc.encode(s);
  const utf8 = b => { try { return dec.decode(b); } catch { return null; } };
  const hexOf = b => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // ---------- Base64 ----------
  function b64encode(bytes, o) {
    o = o || {}; let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2], n = (a << 16) | ((b || 0) << 8) | (c || 0);
      out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (b === undefined ? "=" : B64[n >> 6 & 63]) + (c === undefined ? "=" : B64[n & 63]);
    }
    if (o.url) out = out.replace(/\+/g, "-").replace(/\//g, "_");
    if (o.url && !o.pad) out = out.replace(/=+$/, "");
    if (!o.url && o.pad === false) out = out.replace(/=+$/, "");
    if (o.wrap) out = out.replace(new RegExp("(.{" + o.wrap + "})", "g"), "$1\n").replace(/\n$/, "");
    return out;
  }
  // -> { bytes, notes[], variant, error }
  function b64decode(text) {
    const notes = []; let t = String(text);
    const m = /^\s*data:([^,;]*)((?:;[^,;]*)*),/i.exec(t); let mime = null;
    if (m) { mime = m[1] || "text/plain"; if (!/;base64/i.test(m[2])) return { error: "This is a data: URL that is not Base64 (it has no ;base64 part). Use the URL (percent) decoder instead." }; t = t.slice(m[0].length); notes.push('Removed the data: URL prefix (type ' + mime + ').'); }
    if (/\s/.test(t.trim())) notes.push("Ignored white space and line breaks inside the text.");
    t = t.replace(/\s+/g, "");
    if (t === "") return { error: "There is nothing to decode." };
    let variant = null;
    const hasStd = /[+/]/.test(t), hasUrl = /[-_]/.test(t);
    if (hasStd && hasUrl) return { error: "The text mixes both alphabets (+ and / from standard Base64, - and _ from the URL-safe kind). It is not one valid Base64 text." };
    variant = hasUrl ? "URL-safe (RFC 4648 §5)" : "standard";
    t = t.replace(/-/g, "+").replace(/_/g, "/");
    const bad = /[^A-Za-z0-9+/=]/.exec(t); if (bad) return { error: "The character " + JSON.stringify(bad[0]) + " at position " + (bad.index + 1) + " is not part of the Base64 alphabet (A-Z a-z 0-9 + / =)." };
    const pad = /=*$/.exec(t)[0].length; let body = t.replace(/=+$/, "");
    if (body.includes("=")) return { error: "The padding character = appears in the middle of the text; it may only be at the end." };
    if (pad > 2) return { error: "More than two = padding characters at the end." };
    if (body.length % 4 === 1) return { error: "The length is impossible for Base64 (a leftover of one character): the text is cut short or has an extra character." };
    if (pad === 0 && body.length % 4 !== 0) notes.push("The padding (=) was missing; it was added for you.");
    else if (pad && (body.length + pad) % 4 !== 0) notes.push("The padding (=) did not match the length; ignored.");
    const out = []; let acc = 0, bits = 0;
    for (const ch of body) { acc = (acc << 6) | B64.indexOf(ch); bits += 6; if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); acc &= (1 << bits) - 1; } }
    if (acc !== 0) notes.push("The last character carries extra bits that are not zero (non-canonical Base64). Some decoders reject this.");
    return { bytes: Uint8Array.from(out), notes, variant, mime };
  }

  // ---------- percent-encoding ----------
  const SAFE = { component: /[A-Za-z0-9\-_.!~*'()]/, full: /[A-Za-z0-9\-_.!~*'();/?:@&=+$,#]/, form: /[A-Za-z0-9\-_.*]/, strict: /[A-Za-z0-9\-_.~]/ };
  function pctEncode(text, mode) {
    if (mode === "all") return Array.from(toBytes(text), b => "%" + b.toString(16).toUpperCase().padStart(2, "0")).join("");
    const re = SAFE[mode] || SAFE.component; let out = "";
    for (const ch of text) { if (re.test(ch)) out += ch; else if (mode === "form" && ch === " ") out += "+"; else out += Array.from(toBytes(ch), b => "%" + b.toString(16).toUpperCase().padStart(2, "0")).join(""); }
    return out;
  }
  // -> { bytes, text, notes[] }
  function pctDecode(text, o) {
    o = o || {}; const notes = [], bytes = []; let t = String(text);
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (c === "%") { if (/^[0-9a-fA-F]{2}$/.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; } else { notes.push("A % at position " + (i + 1) + " is not followed by two hex digits; kept as it is."); bytes.push(37); } }
      else if (c === "+" && o.plus) bytes.push(32);
      else bytes.push(...toBytes(c));
    }
    const b = Uint8Array.from(bytes), s = utf8(b); if (s === null) notes.push("The decoded bytes are not valid UTF-8 text (maybe another character set such as ISO-8859-1). Shown as bytes.");
    if (/%25[0-9a-fA-F]{2}/.test(t)) notes.push("The text contains %25..., which means it was percent-encoded twice. Decode it once more to get the original.");
    if (!o.plus && /\+/.test(t) && !/%20/.test(t)) notes.push('The text contains + signs. In a web form (query string) + means a space: tick "+ means space" if this came from a form.');
    return { bytes: b, text: s, notes };
  }

  // ---------- hexadecimal ----------
  function hexEncode(bytes, o) { o = o || {}; const parts = Array.from(bytes, b => (o.upper ? b.toString(16).toUpperCase() : b.toString(16)).padStart(2, "0")); return parts.join(o.sep === undefined ? " " : o.sep); }
  function hexDecode(text) {
    const notes = []; let t = String(text).replace(/0x/gi, " ").replace(/\\x/gi, " ").replace(/[,;:\-\s]+/g, " ").trim();
    if (!t) return { error: "There is nothing to decode." };
    let digits = t.replace(/ /g, "");
    const bad = /[^0-9a-fA-F]/.exec(digits); if (bad) return { error: "The character " + JSON.stringify(bad[0]) + " is not a hexadecimal digit (0-9, a-f)." };
    if (digits.length % 2) { if (t.includes(" ")) { digits = t.split(" ").map(x => x.length % 2 ? "0" + x : x).join(""); notes.push("A group with an odd number of digits got a leading 0."); } else return { error: "An odd number of hex digits (" + digits.length + "): one digit is missing." }; }
    const out = new Uint8Array(digits.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(digits.substr(i * 2, 2), 16);
    return { bytes: out, notes };
  }

  // ---------- HTML entities ----------
  const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©", reg: "®", trade: "™", euro: "€", pound: "£", yen: "¥", cent: "¢", sect: "§", deg: "°", plusmn: "±", micro: "µ", para: "¶", middot: "·", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", times: "×", divide: "÷", larr: "←", rarr: "→", uarr: "↑", darr: "↓", hearts: "♥", eacute: "é", egrave: "è", agrave: "à", aacute: "á", ouml: "ö", uuml: "ü", auml: "ä", szlig: "ß", ccedil: "ç", ntilde: "ñ" };
  function htmlEncode(text, o) { o = o || {}; let out = ""; for (const ch of text) { const cp = ch.codePointAt(0); if (ch === "&") out += "&amp;"; else if (ch === "<") out += "&lt;"; else if (ch === ">") out += "&gt;"; else if (ch === '"') out += "&quot;"; else if (ch === "'") out += "&#39;"; else if (o.ascii && cp > 126) out += "&#" + cp + ";"; else out += ch; } return out; }
  function htmlDecode(text) {
    const notes = [], unknown = new Set();
    const out = String(text).replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (m, g) => {
      if (g[0] === "#") { const cp = g[1] === "x" || g[1] === "X" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); if (!(cp > 0 && cp <= 0x10FFFF) || (cp >= 0xD800 && cp <= 0xDFFF)) { notes.push("The reference " + m + " is not a valid character; kept."); return m; } return String.fromCodePoint(cp); }
      if (Object.prototype.hasOwnProperty.call(NAMED, g)) return NAMED[g]; unknown.add(m); return m;
    });
    if (unknown.size) notes.push("Names not in this tool's list were left as they are: " + [...unknown].slice(0, 8).join(" ") + ".");
    return { text: out, notes };
  }

  // ---------- \uXXXX escapes ----------
  function uniEncode(text, o) { o = o || {}; let out = ""; for (const ch of text) { const cp = ch.codePointAt(0); if (cp < 128 && !(o.all)) { out += ch; continue; } if (cp > 0xFFFF && !o.braces) { const v = cp - 0x10000; out += "\\u" + (0xD800 + (v >> 10)).toString(16).padStart(4, "0") + "\\u" + (0xDC00 + (v & 1023)).toString(16).padStart(4, "0"); } else if (cp > 0xFFFF) out += "\\u{" + cp.toString(16) + "}"; else out += "\\u" + cp.toString(16).padStart(4, "0"); } return out; }
  function uniDecode(text) {
    const notes = []; let n = 0;
    const out = String(text).replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})|\\U([0-9a-fA-F]{8})/g, (m, a, b, c) => { const cp = parseInt(a || b || c, 16); n++; if (cp > 0x10FFFF) { notes.push(m + " is beyond the last Unicode character; kept."); return m; } if (b && cp >= 0xD800 && cp <= 0xDFFF) return m; return String.fromCodePoint(cp); });
    // join surrogate pairs written as two separate 😀 escapes
    const joined = String(text).replace(/\\u(d[89ab][0-9a-f]{2})\\u(d[c-f][0-9a-f]{2})/gi, (m, h, l) => String.fromCodePoint(((parseInt(h, 16) - 0xD800) << 10) + (parseInt(l, 16) - 0xDC00) + 0x10000));
    const res = out.includes("\\u") || /[\ud800-\udfff]/.test(out) ? joined.replace(/\\u\{([0-9a-fA-F]{1,6})\}|\\u([0-9a-fA-F]{4})/g, (m, a, b) => { const cp = parseInt(a || b, 16); return cp <= 0x10FFFF && !(cp >= 0xD800 && cp <= 0xDFFF) ? String.fromCodePoint(cp) : m; }) : out;
    if (n === 0 && !/\\u/.test(res)) notes.push("No \\uXXXX escapes were found.");
    return { text: res, notes };
  }

  // classic hexdump of bytes for binary results
  function hexdump(bytes, max) {
    max = max || 512; const rows = [];
    for (let i = 0; i < Math.min(bytes.length, max); i += 16) { const ch = bytes.slice(i, i + 16); rows.push(i.toString(16).padStart(6, "0") + "  " + Array.from(ch, b => b.toString(16).padStart(2, "0")).join(" ").padEnd(47) + "  " + Array.from(ch, b => b >= 32 && b < 127 ? String.fromCharCode(b) : ".").join("")); }
    if (bytes.length > max) rows.push("… " + (bytes.length - max) + " more bytes");
    return rows.join("\n");
  }
  // a short description of what the bytes look like (by their first bytes)
  function sniff(b) {
    const h = hexOf(b.slice(0, 12)); const s = String.fromCharCode(...b.slice(0, 8));
    if (h.startsWith("89504e47")) return "a PNG picture"; if (h.startsWith("ffd8ff")) return "a JPEG picture"; if (s.startsWith("GIF8")) return "a GIF picture"; if (s.startsWith("%PDF")) return "a PDF document"; if (h.startsWith("504b0304")) return "a ZIP archive (or a Word/Excel/Office file)"; if (h.startsWith("1f8b")) return "gzip-compressed data"; if (s.startsWith("RIFF") && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "a WebP picture"; if (h.startsWith("7f454c46")) return "an executable (ELF)"; if (h.startsWith("4d5a")) return "a Windows executable";
    return null;
  }
  const api = { toBytes, utf8, b64encode, b64decode, pctEncode, pctDecode, hexEncode, hexDecode, htmlEncode, htmlDecode, uniEncode, uniDecode, hexdump, sniff, hexOf };
  if (typeof window !== "undefined") window.EncodeTool = api;
  if (typeof module !== "undefined") module.exports = api;
})();
