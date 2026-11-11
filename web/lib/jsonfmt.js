/* JSON formatter and checker. A strict JSON parser (RFC 8259) written for this tool: it keeps numbers and strings exactly as written (so a 20-digit number is not
   rounded), keeps key order, reports the exact line and column of a mistake in plain words, warns about duplicate keys and numbers that lose precision, and can
   repair the usual mistakes (comments, trailing commas, single quotes, unquoted keys, True/None). Pure code on text. Exports window.JsonFmt. */
(() => {
  "use strict";
  const MAXDEPTH = 500;
  class Err extends Error { constructor(msg, pos) { super(msg); this.pos = pos; } }
  const WS = new Set([" ", "\t", "\n", "\r"]);
  const where = (text, pos) => { let line = 1, col = 1; for (let i = 0; i < pos && i < text.length; i++) { if (text[i] === "\n") { line++; col = 1; } else col++; } return { line, col }; };
  const show = c => c === undefined ? "the end of the text" : c === "\n" ? "a line break" : c === "\t" ? "a tab" : '"' + c + '"';
  const HINTS = { "'": "JSON strings use double quotes \", not single quotes '.", "/": "JSON has no comments.", "#": "JSON has no comments.", "+": "A number cannot start with +.", ".": "A number needs a digit before the decimal point (write 0.5, not .5)." };

  function parse(text) {
    text = String(text);
    const warnings = []; let i = 0, bom = false;
    if (text.charCodeAt(0) === 0xFEFF) { i = 1; bom = true; warnings.push("The text starts with an invisible byte-order mark (BOM). Many parsers reject it."); }
    const dupPaths = [];
    function ws() { while (i < text.length && WS.has(text[i])) i++; }
    function fail(msg, pos) { throw new Err(msg, pos === undefined ? i : pos); }
    function unexpected(expect) {
      const c = text[i]; let m = "Unexpected " + show(c) + (expect ? ". Expected " + expect + "." : ".");
      if (c !== undefined && HINTS[c]) m += " " + HINTS[c];
      else if (/[A-Za-z_]/.test(c || "")) { const w = /^[A-Za-z_$][\w$]*/.exec(text.slice(i)); if (w) { const lw = w[0]; if (/^(True|False|None|NaN|Infinity|undefined|nil)$/.test(lw)) m += " " + lw + " is not valid JSON (use true, false or null; NaN and Infinity do not exist in JSON)."; else if (expect && /key/.test(expect)) m += " Keys must be in double quotes."; else m += " Text must be in double quotes."; } }
      fail(m);
    }
    function string() {
      const start = i; i++; // opening quote
      while (true) {
        if (i >= text.length) fail("The string that starts here is never closed (missing a closing \").", start);
        const c = text[i];
        if (c === '"') { i++; return text.slice(start, i); }
        if (c === "\\") {
          const n = text[i + 1];
          if (n === "u") { if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail('A \\u escape needs exactly four hex digits (like \\u00e9).', i); i += 6; }
          else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2;
          else fail("Invalid escape \\" + (n === undefined ? "" : n) + " in a string. Valid escapes: \\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX.", i);
        } else if (c < " ") fail("A " + (c === "\n" ? "line break" : c === "\t" ? "tab" : "control character") + " inside a string must be written as an escape (" + (c === "\n" ? "\\n" : c === "\t" ? "\\t" : "\\u00XX") + ").", i);
        else i++;
      }
    }
    function number() {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 1100));
      if (!m) { if (text[i] === "-" ) fail("A minus sign must be followed by a digit.", i); unexpected("a value"); }
      const raw = m[0]; const after = text[i + raw.length];
      if (/^0\d/.test(text.slice(i + (raw[0] === "-" ? 1 : 0), i + 2 + (raw[0] === "-" ? 1 : 0)))) fail("Numbers cannot have leading zeros (write 7, not 07).", i);
      if (after !== undefined && /[\w.]/.test(after)) { if (after === ".") fail("A decimal point must be followed by a digit.", i + raw.length); if (/[eE]/.test(after)) fail("An exponent needs digits (like e5 or E-3).", i + raw.length); }
      i += raw.length; return raw;
    }
    function value(depth, path) {
      if (depth > MAXDEPTH) fail("Nested deeper than " + MAXDEPTH + " levels.");
      ws(); const c = text[i];
      if (c === "{") return object(depth, path);
      if (c === "[") return array(depth, path);
      if (c === '"') return { t: "str", raw: string() };
      if (c === "-" || (c >= "0" && c <= "9")) { const raw = number(); const n = Number(raw); if (!/^-?0(\.0+)?([eE][+-]?\d+)?$/.test(raw) && (n === 0 || !isFinite(n))) warnings.push((path || "$") + ": the number " + raw.slice(0, 40) + " is " + (isFinite(n) ? "too small and becomes 0" : "too large and becomes Infinity") + " in JavaScript."); else if (/^-?\d+$/.test(raw) && raw.replace("-", "").length > 15 && !Number.isSafeInteger(n)) warnings.push((path || "$") + ": the integer " + raw.slice(0, 40) + " is larger than 9,007,199,254,740,991: JavaScript and many other programs will round it. It is kept exactly as written here."); else if (/\.\d{16,}/.test(raw) && String(n) !== raw.replace(/^-0+(?=\.)/, "-0")) warnings.push((path || "$") + ": the number " + raw.slice(0, 40) + " has more digits than a double-precision number holds."); return { t: "num", raw }; }
      for (const w of ["true", "false", "null"]) if (text.startsWith(w, i) && !/[\w$]/.test(text[i + w.length] || "")) { i += w.length; return { t: "lit", raw: w }; }
      unexpected("a value (an object, array, string, number, true, false or null)");
    }
    function object(depth, path) {
      const open = i; i++; const items = [], seen = new Map(); ws();
      if (text[i] === "}") { i++; return { t: "obj", items }; }
      while (true) {
        ws(); if (text[i] !== '"') { if (text[i] === "}" && items.length) fail("A comma was followed by } : JSON does not allow a trailing comma.", i); unexpected("a key in double quotes"); }
        const kpos = i, keyRaw = string(); ws();
        if (text[i] !== ":") { unexpected("a colon : after the key " + keyRaw.slice(0, 30)); }
        i++; const key = (() => { try { return JSON.parse(keyRaw); } catch { return keyRaw; } })();
        const v = value(depth + 1, (path || "$") + "." + key);
        if (seen.has(key)) dupPaths.push((path || "$") + "." + key); seen.set(key, true);
        items.push({ keyRaw, key, v }); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return { t: "obj", items }; }
        if (i >= text.length) fail("The object that starts at line " + where(text, open).line + ", column " + where(text, open).col + " is never closed (missing }).", open);
        unexpected("a comma or } after the value");
      }
    }
    function array(depth, path) {
      const open = i; i++; const items = []; ws();
      if (text[i] === "]") { i++; return { t: "arr", items }; }
      while (true) {
        ws(); if (text[i] === "]" && items.length) fail("A comma was followed by ] : JSON does not allow a trailing comma.", i);
        items.push(value(depth + 1, (path || "$") + "[" + items.length + "]")); ws();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return { t: "arr", items }; }
        if (i >= text.length) fail("The array that starts at line " + where(text, open).line + ", column " + where(text, open).col + " is never closed (missing ]).", open);
        unexpected("a comma or ] after the value");
      }
    }
    try {
      ws(); if (i >= text.length) return { ok: false, empty: true, error: { msg: "There is nothing to read.", pos: 0, line: 1, col: 1 }, warnings };
      const v = value(0, ""); ws();
      if (i < text.length) { const w = where(text, i); let m = "Extra text after the end of the value: " + show(text[i]) + "."; if (text[i] === "{" || text[i] === "[") m += " Several JSON values in a row are not valid JSON (unless it is one per line: JSON Lines)."; else if (text[i] === ",") m += " A top-level value cannot be followed by a comma."; throw new Err(m, i); }
      if (dupPaths.length) warnings.push("Duplicate keys (JSON parsers keep only the last one): " + [...new Set(dupPaths)].slice(0, 8).join(", ") + (dupPaths.length > 8 ? " and more" : "") + ".");
      return { ok: true, value: v, warnings, bom };
    } catch (e) {
      if (!(e instanceof Err)) { if (e instanceof RangeError) return { ok: false, error: { msg: "Nested too deeply to read.", pos: 0, line: 1, col: 1 }, warnings }; throw e; }
      const w = where(text, e.pos); return { ok: false, error: { msg: e.message, pos: e.pos, line: w.line, col: w.col }, warnings };
    }
  }

  // ---------- output ----------
  const cmpKeys = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  function format(node, o) {
    o = o || {}; const ind = o.indent === "tab" ? "\t" : " ".repeat(o.indent === undefined ? 2 : o.indent), min = o.indent === 0;
    const rec = (n, lvl) => {
      if (n.t === "str" || n.t === "num" || n.t === "lit") return n.raw;
      const items = n.t === "obj" && o.sort ? n.items.slice().sort(cmpKeys) : n.items;
      if (!items.length) return n.t === "obj" ? "{}" : "[]";
      const pad = min ? "" : "\n" + ind.repeat(lvl + 1), end = min ? "" : "\n" + ind.repeat(lvl), sep = min ? "," : ",";
      const parts = items.map(it => n.t === "obj" ? pad + it.keyRaw + (min ? ":" : ": ") + rec(it.v, lvl + 1) : pad + rec(it, lvl + 1));
      return (n.t === "obj" ? "{" : "[") + parts.join(sep) + end + (n.t === "obj" ? "}" : "]");
    };
    return rec(node, 0);
  }
  function stats(node) {
    const s = { objects: 0, arrays: 0, strings: 0, numbers: 0, booleans: 0, nulls: 0, keys: 0, depth: 0 };
    const rec = (n, d) => { if (d > s.depth) s.depth = d;
      if (n.t === "obj") { s.objects++; s.keys += n.items.length; for (const it of n.items) rec(it.v, d + 1); } else if (n.t === "arr") { s.arrays++; for (const it of n.items) rec(it, d + 1); }
      else if (n.t === "str") s.strings++; else if (n.t === "num") s.numbers++; else if (n.raw === "null") s.nulls++; else s.booleans++; };
    rec(node, 1); return s;
  }
  // path like  $.a.b[0]["odd key"]  ->  { found, node }
  function get(node, path) {
    path = String(path).trim(); if (path === "" || path === "$") return { found: true, node };
    let p = path.replace(/^\$/, ""), cur = node, m;
    while (p.length) {
      if ((m = /^\.([^.\[\]]+)/.exec(p))) { if (cur.t !== "obj") return { found: false }; const it = cur.items.filter(x => x.key === m[1]).pop(); if (!it) return { found: false }; cur = it.v; p = p.slice(m[0].length); }
      else if ((m = /^\[(\d+)\]/.exec(p))) { if (cur.t !== "arr" || +m[1] >= cur.items.length) return { found: false }; cur = cur.items[+m[1]]; p = p.slice(m[0].length); }
      else if ((m = /^\[("(?:[^"\\]|\\.)*")\]/.exec(p))) { let k; try { k = JSON.parse(m[1]); } catch { return { found: false }; } if (cur.t !== "obj") return { found: false }; const it = cur.items.filter(x => x.key === k).pop(); if (!it) return { found: false }; cur = it.v; p = p.slice(m[0].length); }
      else if (cur === node && (m = /^([^.\[\]]+)/.exec(p))) { if (cur.t !== "obj") return { found: false }; const it = cur.items.filter(x => x.key === m[1]).pop(); if (!it) return { found: false }; cur = it.v; p = p.slice(m[0].length); }
      else return { found: false, bad: true };
    }
    return { found: true, node: cur };
  }

  // ---------- repair: fix the usual mistakes by rewriting the text token by token ----------
  function repair(text) {
    const fixes = new Set(); let out = "", i = 0; text = String(text).replace(/^﻿/, "");
    const n = text.length, isId = c => /[A-Za-z0-9_$]/.test(c || "");
    const lastSig = () => { for (let k = out.length - 1; k >= 0; k--) if (!/\s/.test(out[k])) return k; return -1; };
    while (i < n) {
      const c = text[i];
      if (c === "/" && text[i + 1] === "/") { fixes.add("removed // comments"); while (i < n && text[i] !== "\n") i++; continue; }
      if (c === "#") { fixes.add("removed # comments"); while (i < n && text[i] !== "\n") i++; continue; }
      if (c === "/" && text[i + 1] === "*") { fixes.add("removed /* */ comments"); const e = text.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
      if (c === '"' || c === "'") {
        const q = c; let s = ""; i++;
        while (i < n && text[i] !== q) { if (text[i] === "\\" && i + 1 < n) { const d = text[i + 1]; if (d === "'" ) { s += "'"; } else if (d === '"') s += '\\"'; else s += "\\" + d; i += 2; continue; } if (text[i] === '"') s += '\\"'; else if (text[i] === "\n") s += "\\n"; else if (text[i] === "\t") s += "\\t"; else s += text[i]; i++; }
        i++; if (q === "'") fixes.add("single quotes to double quotes"); out += '"' + s + '"'; continue;
      }
      if (c === "," ) { let j = i + 1; while (j < n && /\s/.test(text[j])) j++; if (text[j] === "}" || text[j] === "]") { fixes.add("removed trailing commas"); i++; continue; } }
      if (/[A-Za-z_$]/.test(c)) {
        let j = i; while (j < n && isId(text[j])) j++; const w = text.slice(i, j); let k = j; while (k < n && /\s/.test(text[k])) k++;
        const map = { True: "true", False: "false", None: "null", nil: "null", undefined: "null", NaN: "null", Infinity: "null" };
        if (text[k] === ":" && !["true", "false", "null"].includes(w)) { fixes.add("quoted keys"); out += '"' + w + '"'; }
        else if (w in map) { fixes.add("replaced " + w + " with " + map[w]); out += map[w]; }
        else out += w;
        i = j; continue;
      }
      out += c; i++;
    }
    return { text: out, fixes: [...fixes] };
  }

  const api = { parse, format, stats, get, repair, where };
  if (typeof window !== "undefined") window.JsonFmt = api;
  if (typeof module !== "undefined") module.exports = api;
})();
