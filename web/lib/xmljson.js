/* XML <-> JSON converter. XML and JSON do not map one to one, so a fixed, simple convention is used and shown to the visitor:
     attributes become keys that start with @ ("@id"), the text of an element that also has attributes or child elements becomes "#text",
     an element repeated under the same parent becomes an array, an empty element becomes "". Comments, processing instructions and the
   DOCTYPE are dropped. The browser's own XML parser reads the XML (it never loads external files). Works only on the text given.
   Exports window.XmlJson. */
(() => {
  "use strict";
  const MAX = 2 * 1024 * 1024, MAX_DEPTH = 200;
  const NAME = /^[A-Za-z_À-ÖØ-öø-˿Ͱ-ͽͿ-῿‌‍⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�][A-Za-z0-9_.\-·À-ÖØ-öø-ͽͿ-῿‌‍‿⁀⁰-↏Ⰰ-⿯、-퟿豈-﷏ﷰ-�]*(:[A-Za-z_][A-Za-z0-9_.\-]*)?$/;
  const NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
  const typed = (s, on) => { if (!on) return s; if (s === "true") return true; if (s === "false") return false; if (NUMBER.test(s) && Number.isFinite(+s) && String(+s) === s) return +s; return s; };   // only when the number reads back exactly (so 1.10, 007 and 1e3 stay text)


  // ---------- a strict-but-conservative well-formedness check, run BEFORE the browser's parser ----------
  // It reports only definite XML 1.0 violations (so it never rejects valid XML), with a line and column. Besides better messages, it
  // means the browser's parser only ever sees well-formed text: on malformed XML browsers build an error page whose inline style
  // shows up as a console warning under a strict Content-Security-Policy.
  const XNAME = /^[A-Za-z_:\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][A-Za-z0-9_.:\-\u00B7\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u037D\u037F-\u1FFF\u200C\u200D\u203F\u2040\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]*$/;
  const BADXML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  function wellFormed(src) {
    const n = src.length; let i = src.charCodeAt(0) === 0xFEFF ? 1 : 0;
    const at = pos => { let line = 1, col = 1; for (let k = 0; k < pos && k < n; k++) { if (src[k] === "\n") { line++; col = 1; } else col++; } return { line, col }; };
    const fail = (msg, pos) => { const p = at(pos); return { msg, line: p.line, col: p.col }; };
    const ents = new Set(["lt", "gt", "amp", "quot", "apos"]);
    const refErr = (txt, base) => {   // every & must start a valid, defined reference
      for (let k = txt.indexOf("&"); k >= 0; k = txt.indexOf("&", k + 1)) {
        const m = /^&(?:#([0-9]+)|#x([0-9a-fA-F]+)|([A-Za-z_:][A-Za-z0-9_.:\-]*));/.exec(txt.slice(k, k + 40));
        if (!m) return fail("A lone & must be written &amp; (an & starts a reference like &amp; or &lt;)", base + k);
        if (m[3] !== undefined && !ents.has(m[3])) return fail("The entity &" + m[3] + "; is not defined (only &lt; &gt; &amp; &quot; &apos; exist unless the DOCTYPE defines more)", base + k);
        if (m[1] !== undefined || m[2] !== undefined) { const cp = m[1] !== undefined ? parseInt(m[1], 10) : parseInt(m[2], 16); if (!(cp === 9 || cp === 10 || cp === 13 || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF))) return fail("The character reference " + m[0] + " is not a character XML allows", base + k); }
      }
      return null;
    };
    if (src.startsWith("<?xml", i) && /[\s?]/.test(src[i + 5] || "")) { const j = src.indexOf("?>", i); if (j < 0) return fail("The XML declaration is not closed (it must end with ?>)", i); const decl = src.slice(i, j + 2); if (!/^<\?xml\s+version\s*=\s*(?:"1\.[0-9]+"|'1\.[0-9]+')(?:\s+encoding\s*=\s*(?:"[A-Za-z][A-Za-z0-9._-]*"|'[A-Za-z][A-Za-z0-9._-]*'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>$/.test(decl)) return fail("The XML declaration is not valid. It looks like <?xml version=\"1.0\" encoding=\"UTF-8\"?>", i); i = j + 2; }
    const stack = []; let root = false, closed = false;
    while (i < n) {
      if (src[i] === "<") {
        if (src.startsWith("<!--", i)) { const e = src.indexOf("-->", i + 4); if (e < 0) return fail("A comment is not closed (it must end with -->)", i); const body = src.slice(i + 4, e); if (body.includes("--") || body.endsWith("-")) return fail("A comment cannot contain two hyphens in a row (--)", i); if (BADXML.test(body)) return fail("Illegal character in a comment", i); i = e + 3; continue; }
        if (src.startsWith("<![CDATA[", i)) { if (!stack.length) return fail("Text (a CDATA section) outside the root element", i); const e = src.indexOf("]]>", i + 9); if (e < 0) return fail("A CDATA section is not closed (it must end with ]]>)", i); if (BADXML.test(src.slice(i + 9, e))) return fail("Illegal character in a CDATA section", i); i = e + 3; continue; }
        if (src.startsWith("<?", i)) { const e = src.indexOf("?>", i + 2); if (e < 0) return fail("A processing instruction is not closed (it must end with ?>)", i); const t = /^[^\s?]+/.exec(src.slice(i + 2, e)); if (!t || !XNAME.test(t[0])) return fail("A processing instruction needs a name", i); if (/^xml$/i.test(t[0])) return fail("The <?xml ... ?> declaration is allowed only at the very start of the text", i); if (BADXML.test(src.slice(i, e))) return fail("Illegal character", i); i = e + 2; continue; }
        if (src.startsWith("<!DOCTYPE", i)) {
          if (root || stack.length) return fail("A DOCTYPE is allowed only before the root element", i);
          // The DOCTYPE grammar is loose and parsers differ, so this check understands only a clean, standard DOCTYPE and otherwise steps aside.
          const dm = /^<!DOCTYPE\s+[A-Za-z_:][A-Za-z0-9_.:\-]*(?:\s+(?:SYSTEM\s+(?:"[^"]*"|'[^']*')|PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')))?\s*(?:\[(?:[^\]"']|"[^"]*"|'[^']*')*\]\s*)?>/.exec(src.slice(i));
          if (!dm) return null;
          for (const m of dm[0].matchAll(/<!ENTITY\s+([A-Za-z_:][A-Za-z0-9_.:\-]*)\s/g)) ents.add(m[1]);
          i += dm[0].length; continue;
        }
        if (src.startsWith("<!", i)) return fail("Unknown markup <!... (only comments, CDATA and the DOCTYPE start with <!)", i);
        if (src[i + 1] === "/") {
          const m = /^<\/([^\s>]*)\s*>/.exec(src.slice(i, i + 400)); if (!m) return fail("An end tag is not closed properly (write </name>)", i);
          if (!stack.length) return fail("The end tag </" + m[1] + "> has no matching start tag", i);
          if (stack[stack.length - 1] !== m[1]) return fail("The end tag </" + m[1] + "> does not match the start tag <" + stack[stack.length - 1] + ">", i);
          stack.pop(); if (!stack.length) closed = true; i += m[0].length; continue;
        }
        // a start tag
        const nm = /^<([^\s\/>=<"']+)/.exec(src.slice(i, i + 400)); if (!nm) return fail("A < must start a tag (write &lt; for a literal less-than sign)", i);
        if (!XNAME.test(nm[1])) return fail("\"" + nm[1] + "\" is not a valid element name", i);
        if (closed) return fail("Only one root element is allowed: <" + nm[1] + "> follows the end of the root", i);
        let j = i + nm[0].length; const seen = new Set(); let selfClose = false, first = true;
        for (;;) {
          let ws = 0; while (j < n && /[ \t\r\n]/.test(src[j])) { j++; ws++; }
          if (j >= n) return fail("The tag <" + nm[1] + "> is not closed (it must end with > or />)", i);
          if (src[j] === ">") { j++; break; }
          if (src[j] === "/") { if (src[j + 1] === ">") { selfClose = true; j += 2; break; } return fail("A / inside the tag <" + nm[1] + "> must be followed by >", j); }
          if (!ws) return fail("Attributes must be separated by a space", j);
          const an = /^[^\s=\/>"'<]+/.exec(src.slice(j, j + 300)); if (!an) return fail("An attribute needs a name", j);
          if (!XNAME.test(an[0])) return fail("\"" + an[0] + "\" is not a valid attribute name", j);
          if (seen.has(an[0])) return fail("The attribute \"" + an[0] + "\" appears twice in <" + nm[1] + ">", j); seen.add(an[0]);
          j += an[0].length; while (j < n && /[ \t\r\n]/.test(src[j])) j++;
          if (src[j] !== "=") return fail("The attribute \"" + an[0] + "\" needs a value: write " + an[0] + "=\"...\"", j); j++;
          while (j < n && /[ \t\r\n]/.test(src[j])) j++;
          const q = src[j]; if (q !== '"' && q !== "'") return fail("The value of \"" + an[0] + "\" must be in quotes", j);
          const e = src.indexOf(q, j + 1); if (e < 0) return fail("The value of \"" + an[0] + "\" is not closed (missing " + q + ")", j);
          const v = src.slice(j + 1, e); if (v.includes("<")) return fail("An attribute value cannot contain < (write &lt;)", j);
          if (BADXML.test(v)) return fail("Illegal character in an attribute value", j); const re = refErr(v, j + 1); if (re) return re;
          j = e + 1; first = false;
        }
        root = true; if (!selfClose) stack.push(nm[1]); else if (!stack.length) closed = true; i = j; continue;
      }
      let j = src.indexOf("<", i); if (j < 0) j = n; const txt = src.slice(i, j);
      if (!stack.length) { if (/[^ \t\r\n]/.test(txt)) return fail("Text is not allowed outside the root element", i + txt.search(/[^ \t\r\n]/)); }
      else { if (txt.includes("]]>")) return fail("The text ]]> is not allowed (write ]]&gt;)", i + txt.indexOf("]]>")); if (BADXML.test(txt)) return fail("Illegal character in the text", i); const re = refErr(txt, i); if (re) return re; }
      i = j;
    }
    if (stack.length) return fail("The element <" + stack[stack.length - 1] + "> is never closed", n);
    if (!root) return fail("There is no root element", 0);
    return null;
  }

  // ---------- XML -> JSON ----------
  function xmlToJson(text, opts) {
    opts = opts || {}; const src = String(text == null ? "" : text);
    if (!src.trim()) return { empty: true };
    if (src.length > MAX) return { error: "The text is larger than 2 MB. Split it up or use a command-line tool." };
    const wf = wellFormed(src); if (wf) return { error: "The XML is not well-formed: " + wf.msg + " (line " + wf.line + ", column " + wf.col + ")." };
    const DP = globalThis.DOMParser; if (!DP) return { error: "This browser cannot read XML." };
    let doc; try { doc = new DP().parseFromString(src, "application/xml"); } catch (e) { return { error: "The XML could not be read: " + e.message }; }
    const pe = doc.getElementsByTagName("parsererror")[0];
    if (pe || !doc.documentElement) return { error: "The XML is not well-formed. " + (pe ? (pe.textContent || "").replace(/\s+/g, " ").trim().slice(0, 300) : "") };
    const notes = [], dropped = { comment: 0, pi: 0 }; let mixed = false, nonDefault = false;
    const conv = (el, depth) => {
      if (depth > MAX_DEPTH) throw new Error("The XML is nested more than " + MAX_DEPTH + " levels deep.");
      const obj = {}, texts = [], kids = []; let hasAttr = false;
      for (const a of Array.from(el.attributes)) { obj["@" + a.name] = typed(a.value, opts.types); hasAttr = true; }
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 1) kids.push(n); else if (n.nodeType === 3 || n.nodeType === 4) { if (n.nodeValue.trim() !== "" || n.nodeType === 4) texts.push(n.nodeValue); } else if (n.nodeType === 8) dropped.comment++; else if (n.nodeType === 7) dropped.pi++;
      }
      const text = texts.length ? texts.join("").replace(/^\s+|\s+$/g, "") : "";
      if (!kids.length && !hasAttr) return text === "" && !texts.length ? "" : typed(text, opts.types);
      if (kids.length && texts.length) mixed = true;
      const groups = new Map();
      for (const k of kids) { const nm = k.nodeName; if (!groups.has(nm)) groups.set(nm, []); groups.get(nm).push(conv(k, depth + 1)); }
      for (const [nm, list] of groups) obj[nm] = list.length > 1 || opts.arrays ? list : list[0];
      if (texts.length) obj["#text"] = typed(text, opts.types);
      // an element name that clashes with an attribute-style key cannot happen (XML names cannot start with @), but #text can clash with nothing
      return obj;
    };
    let result; try { result = { [doc.documentElement.nodeName]: conv(doc.documentElement, 1) }; } catch (e) { return { error: e.message }; }
    if (/<!DOCTYPE/i.test(src)) notes.push({ level: "", text: "The DOCTYPE was ignored. Entities defined in it are expanded by the parser, but external files are never loaded." });
    if (dropped.comment) notes.push({ level: "", text: dropped.comment + " comment" + (dropped.comment === 1 ? "" : "s") + " cannot be represented in JSON and were dropped." });
    if (dropped.pi) notes.push({ level: "", text: dropped.pi + " processing instruction" + (dropped.pi === 1 ? "" : "s") + " were dropped." });
    if (mixed) notes.push({ level: "warn", text: "Some elements mix text and child elements. The text is kept under \"#text\", but its position between the children is lost." });
    if (!opts.arrays) notes.push({ level: "", text: "An element becomes an array only when it appears more than once. A list with a single item therefore looks different from a list with several: tick \"always use arrays\" if a program reads the JSON." });
    if (!opts.types) notes.push({ level: "", text: "All values are text, as in XML. Tick \"numbers and true/false\" to turn values like 12 or true into JSON numbers and booleans (values such as 007 stay text)." });
    const indent = opts.indent === 0 ? 0 : (opts.indent || 2);
    return { json: JSON.stringify(result, null, indent), object: result, notes };
  }

  // ---------- JSON -> XML ----------
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escAttr = s => esc(s).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
  const BADCHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  function jsonToXml(text, opts) {
    opts = opts || {}; const src = String(text == null ? "" : text);
    if (!src.trim()) return { empty: true };
    if (src.length > MAX) return { error: "The text is larger than 2 MB." };
    let data; try { data = JSON.parse(src); } catch (e) { return { error: "This is not valid JSON: " + e.message }; }
    const notes = [], indentN = opts.indent === 0 ? 0 : (opts.indent == null ? 2 : opts.indent), nl = indentN ? "\n" : "", pad = d => " ".repeat(indentN * d);
    const rootName = (opts.root || "root").trim() || "root";
    if (!NAME.test(rootName)) return { error: "\"" + rootName + "\" is not a valid XML element name (start with a letter or _, then letters, digits, . - _)." };
    let err = null, mixedOrder = false;
    const bad = (k) => { err = err || "\"" + k + "\" cannot be used as an XML name. Names start with a letter or _ and contain only letters, digits, . - and _ (no spaces). Rename the key" + (/^\d/.test(k) ? " (names cannot start with a digit)" : "") + "."; };
    const textOf = v => { const s = v === null ? "" : typeof v === "string" ? v : String(v); if (BADCHAR.test(s)) { err = err || "The text contains a character that XML 1.0 does not allow (a control character)."; } return s; };
    const elem = (name, v, depth) => {
      if (depth > MAX_DEPTH) { err = err || "The JSON is nested more than " + MAX_DEPTH + " levels deep."; return ""; }
      if (!NAME.test(name)) { bad(name); return ""; }
      if (Array.isArray(v)) return v.map(x => elem(name, x, depth)).join(nl);
      if (v === null || typeof v !== "object") { const t = textOf(v); return pad(depth) + (t === "" ? "<" + name + "/>" : "<" + name + ">" + esc(t) + "</" + name + ">"); }
      let attrs = "", txt = null; const kids = [];
      for (const [k, val] of Object.entries(v)) {
        if (k[0] === "@") { const an = k.slice(1); if (!NAME.test(an)) { bad(k); continue; } if (val !== null && typeof val === "object") { err = err || "The attribute \"" + k + "\" must be a text, number, true/false or null, not an object or array."; continue; } attrs += " " + an + "=\"" + escAttr(textOf(val)) + "\""; }
        else if (k === "#text") txt = textOf(val);
        else kids.push([k, val]);
      }
      if (!kids.length) return pad(depth) + (txt === null || txt === "" ? "<" + name + attrs + "/>" : "<" + name + attrs + ">" + esc(txt) + "</" + name + ">");
      if (txt) mixedOrder = true;
      const inner = kids.map(([k, val]) => elem(k, val, depth + 1)).filter(s => s !== "").join(nl);
      return pad(depth) + "<" + name + attrs + ">" + (txt ? (indentN ? nl + pad(depth + 1) : "") + esc(txt) : "") + (inner ? nl + inner : "") + nl + pad(depth) + "</" + name + ">";
    };
    let body;
    if (data !== null && typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 1 && Object.keys(data)[0][0] !== "@" && Object.keys(data)[0] !== "#text" && !Array.isArray(Object.values(data)[0])) body = elem(Object.keys(data)[0], Object.values(data)[0], 0);
    else if (Array.isArray(data)) { body = elem(rootName, { item: data }, 0); notes.push({ level: "", text: "The JSON is a list, and XML needs a single top-level element, so the items were put inside <" + rootName + "> as <item> elements." }); }
    else { body = elem(rootName, data, 0); notes.push({ level: "", text: "The JSON has no single top-level key, so it was wrapped in <" + rootName + ">." }); }
    if (err) return { error: err };
    if (mixedOrder) notes.push({ level: "warn", text: "Elements that have both \"#text\" and child elements are written with the text first." });
    notes.push({ level: "", text: "Arrays become repeated elements with the same name. null becomes an empty element, and numbers and true/false become text." });
    const xml = (opts.declaration === false ? "" : "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" + nl) + body;
    return { xml, notes };
  }
  const api = { xmlToJson, jsonToXml, NAME, wellFormed };
  if (typeof window !== "undefined") window.XmlJson = api;
  if (typeof module !== "undefined") module.exports = api;
})();
