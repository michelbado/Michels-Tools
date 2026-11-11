/* Regular expression tester helpers (JavaScript regular expressions). run() finds every match with its position and capture groups, and can preview a
   replacement. The page runs it in a worker (lib/regexworker.js) so that a pattern that backtracks forever can be stopped. Pure code. Exports window.RegexTest. */
(() => {
  "use strict";
  const MAXTEXT = 300000, MAXMATCHES = 5000;
  const FLAGS = { g: "global: find all matches", i: "ignore case", m: "^ and $ match at every line", s: ". also matches a line break", u: "Unicode mode", y: "sticky: match only at the exact position", v: "Unicode sets mode (newer browsers)" };
  let hasD = true; try { new RegExp("a", "d"); } catch { hasD = false; }

  function build(pattern, flags) {
    flags = [...new Set(String(flags || "").replace(/[^dgimsuvy]/g, ""))].join("");
    if (flags.includes("u") && flags.includes("v")) return { error: "The flags u and v cannot be used together." };
    try { return { re: new RegExp(pattern, flags + (hasD && !flags.includes("d") ? "d" : "")), flags }; }
    catch (e) { return { error: String(e.message || e).replace(/^Invalid regular expression: /, "").replace(/^\/.*?\/[a-z]*: /, "") }; }
  }
  /* run({ pattern, flags, text, replacement, limit }) ->
     { ok, matches: [{ index, end, text, groups: [{ n, name, text, start, end } | { n, name, text: undefined }] }], truncated, replaced, replacedCount, flags } or { ok: false, error } */
  function run(o) {
    const text = String(o.text === undefined ? "" : o.text), limit = Math.min(o.limit || MAXMATCHES, MAXMATCHES);
    if (text.length > MAXTEXT) return { ok: false, error: "The text is longer than " + MAXTEXT.toLocaleString("en-US") + " characters." };
    const b = build(o.pattern, o.flags); if (b.error) return { ok: false, error: b.error };
    if (o.pattern === "") return { ok: true, matches: [], flags: b.flags, emptyPattern: true };
    const re = b.re, global = re.global || re.sticky, matches = []; let truncated = false, last = 0, m;
    re.lastIndex = 0;
    const names = [];
    while ((m = re.exec(text)) !== null) {
      const groups = [];
      for (let i = 1; i < m.length; i++) { const ind = m.indices && m.indices[i]; groups.push({ n: i, text: m[i], start: ind ? ind[0] : undefined, end: ind ? ind[1] : undefined }); }
      if (m.groups) { const gnames = Object.keys(m.groups); for (const nm of gnames) { const idx = groups.findIndex(g => g.name === undefined && g.text === m.groups[nm] && !groups.some(h => h.name === nm)); if (idx >= 0) groups[idx].name = nm; if (!names.includes(nm)) names.push(nm); } }
      matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups });
      if (matches.length >= limit) { truncated = true; break; }
      if (!global) break;
      if (m[0] === "") re.lastIndex = re.lastIndex + 1 > text.length ? text.length + 1 : (re.unicode || re.unicodeSets) && /[\ud800-\udbff]/.test(text[re.lastIndex] || "") ? re.lastIndex + 2 : re.lastIndex + 1;
      if (re.lastIndex > text.length) break;
    }
    const res = { ok: true, matches, truncated, flags: b.flags, names };
    if (typeof o.replacement === "string") {
      try {
        let n = 0; text.replace(re, () => { n++; return ""; });
        res.replacedCount = n; res.replaced = text.replace(re, o.replacement);
        if (!re.global && n) res.replaceNote = "The g flag is off, so only the first match is replaced.";
      } catch (e) { res.replaceError = String(e.message || e); }
    }
    return res;
  }
  // a quick warning about the classic catastrophic shapes: a group with a repeat inside, itself repeated
  function risky(pattern) {
    const p = String(pattern);
    if (/\((?:[^()\\]|\\.)*[+*](?:\?)?(?:[^()\\]|\\.)*\)[+*]|\((?:[^()\\]|\\.)*[+*](?:\?)?(?:[^()\\]|\\.)*\)\{\d+,\}/.test(p)) return "This pattern repeats a group that already contains a repeat, like (a+)+ . On text that almost matches, this can take exponentially long (catastrophic backtracking).";
    if (/\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)[+*]/.test(p) && /(\.\*|\.\+|\\w\+|\\w\*|\\s\*|\\s\+)/.test(p)) return "Alternatives inside a repeated group combined with .* or \\w+ can backtrack very slowly on text that almost matches.";
    return null;
  }
  const escapeText = s => String(s).replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  const EXAMPLES = [
    { name: "E-mail address", pattern: "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+", flags: "g", text: "Write to ann@example.com or bob.smith+tag@mail.example.org today." },
    { name: "IPv4 address", pattern: "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b", flags: "g", text: "Hosts 10.0.0.1, 192.168.1.254 and 999.1.1.1 (not valid)." },
    { name: "Date (YYYY-MM-DD)", pattern: "(?<y>\\d{4})-(?<m>0[1-9]|1[0-2])-(?<d>0[1-9]|[12]\\d|3[01])", flags: "g", text: "From 2024-05-06 to 2024-12-31, not 2024-13-01.", replacement: "$<d>/$<m>/$<y>" },
    { name: "Hex colour", pattern: "#(?:[0-9a-fA-F]{3}){1,2}\\b", flags: "g", text: "Use #fff, #1A2B3C and #12 (too short)." },
    { name: "Web address", pattern: "https?:\\/\\/[^\\s\"'<>]+", flags: "gi", text: "See https://example.com/a?b=1 and http://test.org." },
    { name: "UUID", pattern: "\\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\b", flags: "gi", text: "id=123e4567-e89b-12d3-a456-426614174000 end" },
    { name: "MAC address", pattern: "\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b", flags: "g", text: "aa:bb:cc:dd:ee:ff and 00-1A-2B-3C-4D-5E" },
    { name: "Words repeated twice", pattern: "\\b(\\w+)\\s+\\1\\b", flags: "gi", text: "This is is a test of the the system." },
  ];
  const CHEAT = [
    ["." , "any character except a line break (with the s flag: any character)"], ["\\d \\w \\s", "a digit, a letter/digit/underscore, a white space; capital letters mean the opposite"], ["\\b", "a word boundary"], ["^ $", "start and end of the text (of each line with the m flag)"],
    ["[abc] [^abc] [a-z]", "one of these characters, none of these, a range"], ["a* a+ a?", "zero or more, one or more, zero or one"], ["a{3} a{2,5} a{2,}", "exactly 3, between 2 and 5, at least 2"], ["a+? a*?", "lazy: as few as possible"],
    ["(abc)", "a capture group, numbered from 1"], ["(?:abc)", "a group that does not capture"], ["(?<name>abc)", "a named group; use \\k<name> to repeat it"], ["a|b", "a or b"],
    ["(?=x) (?!x)", "followed by x / not followed by x"], ["(?<=x) (?<!x)", "preceded by x / not preceded by x"], ["\\1 \\k<name>", "the same text as an earlier group"], ["\\. \\* \\( \\\\", "a literal special character: put a backslash before it"],
    ["$1 $<name> $&", "in a replacement: group 1, a named group, the whole match"],
  ];
  const api = { run, build, risky, escapeText, EXAMPLES, CHEAT, FLAGS, MAXTEXT, MAXMATCHES, hasIndices: hasD };
  if (typeof window !== "undefined") window.RegexTest = api;
  if (typeof self !== "undefined" && typeof window === "undefined") self.RegexTest = api;
  if (typeof module !== "undefined") module.exports = api;
})();
