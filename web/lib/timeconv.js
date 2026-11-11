/* Timestamp and date converter: Unix time in seconds, milliseconds, microseconds or nanoseconds (kept exact with BigInt), ISO 8601 and everyday date text,
   any time zone the browser knows (with daylight-saving gaps and repeats explained), and the epochs other systems use (Windows FILETIME, .NET ticks, Excel,
   Apple/Cocoa, Chrome/WebKit, Julian date). Pure code (uses Intl for zones). Exports window.TimeConv. */
(() => {
  "use strict";
  const NS = 1000000n, MAXMS = 8.64e15;
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, "0");
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---------- a moment is { ns: BigInt nanoseconds since 1970-01-01T00:00:00Z } ----------
  const msOf = ns => Number(ns / NS) - (ns < 0n && ns % NS !== 0n ? 1 : 0);   // floor to a millisecond
  const valid = ns => { const ms = msOf(ns); return Math.abs(ms) <= MAXMS; };
  const UNITS = { s: 1000000000n, ms: 1000000n, us: 1000n, ns: 1n };
  // decimal text ("1700000000.123456789") times a unit -> BigInt ns; null when not a plain number
  function numToNs(text, unit) {
    const m = /^\s*([+-]?)(\d+)(?:[.,](\d+))?\s*$/.exec(text); if (!m) return null;
    const mult = UNITS[unit], frac = (m[3] || "");
    let ns = BigInt(m[2]) * mult;
    if (frac) { const scale = 10n ** BigInt(frac.length); ns += (BigInt(frac) * mult) / scale; }
    return m[1] === "-" ? -ns : ns;
  }
  // which unit a bare integer most likely is, from its size (so that it lands between 1970 and ~2100 .. year 5138 for seconds)
  function guessUnit(text) {
    const m = /^\s*[+-]?(\d+)/.exec(text); if (!m) return "s"; const n = m[1].length;
    return n <= 11 ? "s" : n <= 14 ? "ms" : n <= 17 ? "us" : "ns";
  }

  // ---------- time zones ----------
  const fmtCache = new Map();
  const dtf = (zone) => { let f = fmtCache.get(zone); if (!f) { f = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(zone, f); } return f; };
  // wall-clock parts of a moment in a zone
  function parts(ms, zone) {
    const o = {}; for (const p of dtf(zone).formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
  }
  // offset from UTC in minutes at that moment (positive east)
  function offsetMin(ms, zone) {
    if (zone === "UTC") return 0; const p = parts(Math.floor(ms / 1000) * 1000, zone);
    return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000);
  }
  const offText = m => (m < 0 ? "-" : "+") + pad(Math.floor(Math.abs(m) / 60)) + ":" + pad(Math.abs(m) % 60);
  function abbr(ms, zone) { try { const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date(ms)).find(x => x.type === "timeZoneName"); return p ? p.value : ""; } catch { return ""; } }
  function zones() { let z = []; try { z = Intl.supportedValuesOf("timeZone"); } catch { z = ["Africa/Cairo", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Europe/London", "Europe/Paris", "Europe/Moscow", "Pacific/Auckland"]; } return ["UTC"].concat(z.filter(x => x !== "UTC")); }
  const validZone = z => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };
  // wall clock in `zone` -> moment. Reports gaps (the clock jumps over that time) and repeats (it happens twice).
  function zonedToNs(y, mo, d, h, mi, s, zone, frac) {
    const wall = Date.UTC(y, mo - 1, d, h, mi, s);
    if (zone === "UTC") return { ns: BigInt(wall) * NS + (frac || 0n) };
    // candidates: every offset seen within a day either side
    const offs = new Set([offsetMin(wall - 86400000, zone), offsetMin(wall, zone), offsetMin(wall + 86400000, zone)]), hits = [];
    for (const o of offs) { const t = wall - o * 60000; if (offsetMin(t, zone) === o) hits.push(t); }
    hits.sort((a, b) => a - b);
    if (hits.length === 0) { const before = wall - offsetMin(wall - 86400000, zone) * 60000, after = wall - offsetMin(wall + 86400000, zone) * 60000; return { ns: BigInt(Math.max(before, after)) * NS + (frac || 0n), note: "This clock time does not exist in " + zone + " (the clocks skip it when daylight saving time starts). The later reading is used." }; }
    if (hits.length === 2) return { ns: BigInt(hits[0]) * NS + (frac || 0n), note: "This clock time happens twice in " + zone + " (the clocks are turned back). The first one is used; the second is " + (hits[1] - hits[0]) / 60000 + " minutes later in real time." };
    return { ns: BigInt(hits[0]) * NS + (frac || 0n) };
  }

  // ---------- parse date text ----------
  // ISO 8601 / RFC 3339 and common "2024-05-06 07:08:09" forms; zone is used when the text carries none
  function parseDateText(text, zone) {
    const t = String(text).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(t);
    if (m) {
      const [y, mo, d, h, mi, s] = [+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)], frac = m[7] ? BigInt(m[7].padEnd(9, "0")) : 0n;
      if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || s > 60) return { error: "That is not a real date or time (month 1-12, day, hour 0-23, minute 0-59)." };
      if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return { error: "There is no " + y + "-" + pad(mo) + "-" + pad(d) + ": that month has only " + new Date(Date.UTC(y, mo, 0)).getUTCDate() + " days." };
      if (m[8]) { const z = m[8].toUpperCase(); let off = 0; if (z !== "Z") { const q = /^([+-])(\d{2}):?(\d{2})?$/.exec(z); off = (q[1] === "-" ? -1 : 1) * (+q[2] * 60 + +(q[3] || 0)); } return { ns: BigInt(Date.UTC(y, mo - 1, d, h, mi, s) - off * 60000) * NS + frac, how: "ISO 8601 with an offset of " + (z === "Z" ? "Z (UTC)" : offText(off)) }; }
      const r = zonedToNs(y, mo, d, h, mi, s, zone || "UTC", frac); return { ns: r.ns, note: r.note, how: "ISO 8601 date, read as " + (zone || "UTC") + " time" };
    }
    m = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(GMT|UT|UTC|Z|[+-]\d{4})?$/.exec(t);   // RFC 2822 / HTTP date
    if (m) { const mo = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase()); if (mo < 0) return { error: "Unknown month name " + m[2] + "." }; let off = 0; const zz = m[7]; if (zz && /^[+-]\d{4}$/.test(zz)) off = (zz[0] === "-" ? -1 : 1) * (+zz.slice(1, 3) * 60 + +zz.slice(3)); const hasZone = !!zz;
      if (hasZone) return { ns: BigInt(Date.UTC(+m[3], mo, +m[1], +m[4], +m[5], +(m[6] || 0)) - off * 60000) * NS, how: "email / HTTP date (RFC 2822)" };
      const r = zonedToNs(+m[3], mo + 1, +m[1], +m[4], +m[5], +(m[6] || 0), zone || "UTC", 0n); return { ns: r.ns, note: r.note, how: "email / HTTP date, read as " + (zone || "UTC") + " time" }; }
    return null;
  }

  /* interpret(text, { unit: "auto"|"s"|"ms"|"us"|"ns", zone }) -> { ns, how, note } or { error } */
  function interpret(text, o) {
    o = o || {}; const t = String(text).trim(); if (!t) return { empty: true };
    const num = /^[+-]?\d+(?:[.,]\d+)?$/.test(t);
    if (num) {
      const unit = !o.unit || o.unit === "auto" ? guessUnit(t) : o.unit, ns = numToNs(t, unit);
      if (!valid(ns)) return { error: "That number is outside the dates a browser can represent (about the years -271821 to 275760). Try another unit." };
      return { ns, how: "number read as " + { s: "seconds", ms: "milliseconds", us: "microseconds", ns: "nanoseconds" }[unit] + (o.unit === "auto" || !o.unit ? " (guessed from its length)" : ""), unit };
    }
    const d = parseDateText(t, o.zone); if (d) return d.error ? d : (valid(d.ns) ? d : { error: "That date is outside the range a browser can represent." });
    if (/^now$/i.test(t)) return { ns: BigInt(Date.now()) * NS, how: "the current time" };
    // last resort: the browser's own parser (many informal forms); only trust it when the text names a time zone
    const ms = Date.parse(t); if (!isNaN(ms) && /(Z|GMT|UTC|[+-]\d{2}:?\d{2}|[A-Z]{3,4})\s*$/.test(t)) return { ns: BigInt(ms) * NS, how: "date text read by the browser" };
    return { error: "Not recognised. Try a Unix timestamp (1700000000), an ISO date (2024-05-06T07:08:09Z or 2024-05-06 07:08:09), or an email/HTTP date (Mon, 06 May 2024 07:08:09 GMT)." };
  }

  // ---------- description ----------
  const jdn = (y, m, d) => { const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045; };
  function isoWeek(y, mo, d) { const dt = new Date(Date.UTC(y, mo - 1, d)), day = dt.getUTCDay() || 7; dt.setUTCDate(dt.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1)); return { year: dt.getUTCFullYear(), week: Math.ceil(((dt - y0) / 86400000 + 1) / 7) }; }
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  function relative(ns, nowNs) {
    let s = Number((nowNs - ns) / 1000000000n); const past = s >= 0; s = Math.abs(s); const u = [["year", 31557600], ["month", 2629800], ["day", 86400], ["hour", 3600], ["minute", 60], ["second", 1]];
    for (const [n, v] of u) if (s >= v) { const q = Math.floor(s / v); return q + " " + n + (q === 1 ? "" : "s") + (past ? " ago" : " from now"); }
    return "right now";
  }
  const BASES = { filetime: -11644473600000n, dotnet: -62135596800000n, cocoa: 978307200000n, webkit: -11644473600000n, hfs: -2082844800000n };
  function utcString(ms) { const d = new Date(ms), y = d.getUTCFullYear(); return (y < 0 ? "-" + pad(y, 6) : y > 9999 ? "+" + pad(y, 6) : pad(y, 4)) + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds()); }
  function fracText(ns) { const f = ((ns % 1000000000n) + 1000000000n) % 1000000000n; return f === 0n ? "" : "." + String(f).padStart(9, "0").replace(/0+$/, ""); }
  // everything about a moment, as rows [label, value, hint?]
  function describe(ns, zone, nowNs) {
    const ms = msOf(ns), fr = fracText(ns), secs = ns >= 0n ? ns / 1000000000n : -((-ns + 999999999n) / 1000000000n), rows = [];
    const u = parts(ms, "UTC");
    rows.push(["UTC (ISO 8601)", utcString(ms) + fr + "Z"]);
    if (zone && zone !== "UTC") { const o = offsetMin(ms, zone), p = parts(ms, zone); rows.push([zone, pad(p.y, 4) + "-" + pad(p.mo) + "-" + pad(p.d) + "T" + pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s) + fr + offText(o), abbr(ms, zone) + ", UTC" + offText(o)]); }
    rows.push(["Unix time (seconds)", String(secs) + (fr ? fr : "")]);
    rows.push(["Unix time (milliseconds)", String(ns / NS - (ns < 0n && ns % NS !== 0n ? 1n : 0n))]);
    rows.push(["Unix time (microseconds)", String(ns / 1000n)]); rows.push(["Unix time (nanoseconds)", String(ns)]);
    rows.push(["Email / HTTP date (RFC 2822)", DAYS[new Date(ms).getUTCDay()].slice(0, 3) + ", " + pad(u.d) + " " + MONTHS[u.mo - 1] + " " + pad(u.y, 4) + " " + pad(u.h) + ":" + pad(u.mi) + ":" + pad(u.s) + " GMT"]);
    rows.push(["Day of the week", DAYS[new Date(ms).getUTCDay()] + " (UTC)"]);
    const w = isoWeek(u.y, u.mo, u.d); rows.push(["ISO week", w.year + "-W" + pad(w.week) + "-" + (new Date(ms).getUTCDay() || 7)]);
    rows.push(["Day of the year", String(Math.round((Date.UTC(u.y, u.mo - 1, u.d) - Date.UTC(u.y, 0, 1)) / 86400000) + 1) + (isLeap(u.y) ? " (leap year)" : "")]);
    if (nowNs !== undefined) rows.push(["Relative to now", relative(ns, nowNs)]);
    const hundredNs = x => String((ns - x * NS) / 100n);
    rows.push(["Windows FILETIME / Active Directory", hundredNs(BASES.filetime), "100-nanosecond steps since 1601-01-01"]);
    rows.push([".NET ticks", hundredNs(BASES.dotnet), "100-nanosecond steps since 0001-01-01"]);
    rows.push(["Chrome / WebKit time", String((ns - BASES.webkit * NS) / 1000n), "microseconds since 1601-01-01"]);
    rows.push(["Apple / Cocoa time", (Number(ns - BASES.cocoa * NS) / 1e9).toFixed(3).replace(/\.?0+$/, ""), "seconds since 2001-01-01 UTC"]);
    rows.push(["Classic Mac (HFS) time", String((ns - BASES.hfs * NS) / 1000000000n), "seconds since 1904-01-01"]);
    const ex = Number(ns - (-2209161600000n) * NS) / 86400e9; rows.push(["Excel / spreadsheet date", ex.toFixed(6).replace(/\.?0+$/, ""), "days since 1899-12-30 (the usual setting; a few old Mac files use 1904)"]);
    rows.push(["Julian date", (jdn(u.y, u.mo, u.d) - 0.5 + (u.h + u.mi / 60 + u.s / 3600) / 24).toFixed(5)]);
    return rows;
  }
  const api = { interpret, describe, zones, validZone, offsetMin, parts, zonedToNs, numToNs, guessUnit, msOf, valid, relative, isoWeek, offText, abbr, UNITS };
  if (typeof window !== "undefined") window.TimeConv = api;
  if (typeof module !== "undefined") module.exports = api;
})();
