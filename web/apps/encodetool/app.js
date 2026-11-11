/* Base64 & URL Encoder. All the conversions are in lib/encodetool.js. A file chosen here is read in the browser and never sent anywhere. Text only reaches the page
   through textContent / .value. */
(window.DesktopApps = window.DesktopApps || {}).encodetool = (() => {
  function init(root) {
    const $ = id => root.querySelector("#encodetool-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const E = window.EncodeTool, TK = window.TK;
    let fileBytes = null, fileName = "", outBytes = null, outText = "";
    const MAXFILE = 5 * 1024 * 1024;
    const kind = () => $("kind").value, dir = () => (root.querySelector('input[name="encodetool-dir"]:checked') || {}).value || "enc";
    const HELP = {
      b64: "Base64 writes any bytes using only letters, digits, + and /, so they can travel in text (e-mail, JSON, data: URLs). It is not encryption.",
      b64url: "The URL-safe kind uses - and _ instead of + and /, and usually leaves out the = padding. It is used in JWT tokens and web addresses.",
      pct: "Percent-encoding writes characters that are not allowed in a web address as %XX (the UTF-8 bytes in hex). A space becomes %20 (or + in web forms).",
      hex: "Each byte is written as two hexadecimal digits. Decoding accepts spaces, commas, 0x and \\x prefixes.",
      html: "Replaces characters that mean something in HTML (< > & \" ') with entities such as &lt;. Decoding also understands numbers (&#233; &#xE9;) and the common names.",
      uni: "Writes characters as \\uXXXX escapes, as used in JSON and JavaScript strings. Characters outside the basic range become two escapes (a surrogate pair).",
    };
    function makeOpts() {
      const o = $("opts"); o.textContent = ""; const k = kind(), d = dir();
      const add = (id, label, type, choices, checked) => {
        const l = document.createElement("label"); if (type === "select") { l.className = "tk-fld"; const b = document.createElement("b"); b.textContent = label; const s = document.createElement("select"); s.className = "xp-select"; s.id = "encodetool-o-" + id; for (const [v, t] of choices) { const op = document.createElement("option"); op.value = v; op.textContent = t; s.append(op); } l.append(b, s); s.addEventListener("change", run); }
        else { const c = document.createElement("input"); c.type = "checkbox"; c.className = "xp-check"; c.id = "encodetool-o-" + id; c.checked = !!checked; l.append(c, document.createTextNode(" " + label)); c.addEventListener("change", run); }
        o.append(l);
      };
      if (k === "b64" && d === "enc") { add("pad", "Add = padding", "check", null, true); add("wrap", "Line length", "select", [["0", "One long line"], ["64", "64 characters"], ["76", "76 characters (e-mail)"]]); }
      if (k === "b64url" && d === "enc") add("pad", "Add = padding", "check", null, false);
      if (k === "pct" && d === "enc") add("mode", "What to encode", "select", [["component", "Everything except letters, digits and - _ . ! ~ * ' ( ) (like encodeURIComponent)"], ["full", "A whole address (keeps : / ? # & = and so on)"], ["strict", "Strict (RFC 3986: only letters, digits and - _ . ~ stay)"], ["form", "Web form (space becomes +)"], ["all", "Every byte"]]);
      if (k === "pct" && d === "dec") add("plus", "+ means space (web forms)", "check", null, false);
      if (k === "hex" && d === "enc") { add("upper", "Capital letters", "check", null, false); add("sep", "Between bytes", "select", [[" ", "a space"], ["", "nothing"], [":", "a colon"], [",", "a comma"]]); }
      if (k === "html" && d === "enc") add("ascii", "Also write every non-ASCII character as a number", "check", null, false);
      if (k === "uni" && d === "enc") { add("all", "Escape every character, even letters", "check", null, false); add("braces", "Use \\u{1F600} for characters above U+FFFF", "check", null, false); }
    }
    const val = id => { const e = root.querySelector("#encodetool-o-" + id); return e ? (e.type === "checkbox" ? e.checked : e.value) : undefined; };
    function layout() {
      const d = dir(); $("inlegend").textContent = d === "enc" ? "Text to encode" : "Text to decode"; $("outlegend").textContent = d === "enc" ? "Result" : "Decoded";
      $("help").textContent = HELP[kind()]; $("open").hidden = !(d === "enc" && (kind() === "b64" || kind() === "b64url" || kind() === "hex"));
      if ($("open").hidden) { fileBytes = null; $("fileinfo").textContent = ""; } makeOpts();
    }
    function show(text, bytes, notes) {
      outText = text; outBytes = bytes; $("out").value = text; $("copy").disabled = !text; $("save").disabled = !text && !bytes; $("swap").disabled = !text;
      TK.notes($("notes"), (notes || []).map(t => ({ level: "", text: t })));
    }
    function run() {
      const k = kind(), d = dir(), src = $("in").value; outBytes = null;
      const empty = !src && !fileBytes; if (empty) { show("", null, []); setStatus("Ready"); return; }
      const bytes = fileBytes && d === "enc" ? fileBytes : E.toBytes(src);
      if (d === "enc") {
        let out = "", notes = [];
        if (k === "b64") out = E.b64encode(bytes, { pad: val("pad"), wrap: Number(val("wrap")) || 0 });
        else if (k === "b64url") out = E.b64encode(bytes, { url: true, pad: val("pad") });
        else if (k === "pct") out = E.pctEncode(src, val("mode"));
        else if (k === "hex") out = E.hexEncode(bytes, { upper: val("upper"), sep: val("sep") });
        else if (k === "html") out = E.htmlEncode(src, { ascii: val("ascii") });
        else out = E.uniEncode(src, { all: val("all"), braces: val("braces") });
        if (fileBytes && !["b64", "b64url", "hex"].includes(k)) notes.push("A file can only be encoded as Base64 or hexadecimal.");
        show(out, null, notes); setStatus("Encoded: " + out.length.toLocaleString("en-US") + " characters."); return;
      }
      let r;
      if (k === "b64" || k === "b64url") r = E.b64decode(src); else if (k === "hex") r = E.hexDecode(src);
      else if (k === "pct") { r = E.pctDecode(src, { plus: val("plus") }); } else if (k === "html") { const h = E.htmlDecode(src); show(h.text, null, h.notes); setStatus("Decoded."); return; } else { const u = E.uniDecode(src); show(u.text, null, u.notes); setStatus("Decoded."); return; }
      if (r.error) { show("", null, []); TK.notes($("notes"), [{ level: "bad", text: r.error }]); setStatus("Could not decode."); return; }
      const notes = (r.notes || []).slice(); const t = r.text !== undefined ? r.text : E.utf8(r.bytes);
      if (t === null) { const kindTxt = E.sniff(r.bytes); notes.unshift("The decoded data is not text" + (kindTxt ? "; it looks like " + kindTxt : "") + ". " + r.bytes.length.toLocaleString("en-US") + " bytes. Use Save as file to keep it. A hex view of the start is shown."); show(E.hexdump(r.bytes), r.bytes, notes); $("copy").disabled = true; $("swap").disabled = true; }
      else show(t, r.bytes, notes);
      setStatus("Decoded: " + r.bytes.length.toLocaleString("en-US") + " bytes.");
    }
    $("save").addEventListener("click", () => {
      if (outBytes && dir() === "dec" && E.utf8(outBytes) === null) { const a = document.createElement("a"), b = new Blob([outBytes], { type: "application/octet-stream" }); a.href = URL.createObjectURL(b); a.download = "decoded.bin"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); setStatus("Saved decoded.bin."); }
      else TK.save(dir() === "enc" ? "encoded.txt" : "decoded.txt", outText);
    });
    $("copy").addEventListener("click", () => TK.copy(outText, setStatus));
    $("swap").addEventListener("click", () => { $("in").value = outText; fileBytes = null; $("fileinfo").textContent = ""; (dir() === "enc" ? $("d2") : $("d1")).checked = true; layout(); run(); });
    for (const id of ["d1", "d2"]) $(id).addEventListener("change", () => { layout(); run(); });
    $("kind").addEventListener("change", () => { layout(); run(); });
    $("in").addEventListener("input", TK.debounce(() => { if (fileBytes) { fileBytes = null; $("fileinfo").textContent = ""; } run(); }, 200));
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", async () => { const f = $("file").files[0]; $("file").value = ""; if (!f) return; if (f.size > MAXFILE) { TK.notes($("notes"), [{ level: "bad", text: f.name + " is larger than 5 MB." }]); return; } fileBytes = new Uint8Array(await f.arrayBuffer()); fileName = f.name; $("in").value = ""; $("fileinfo").textContent = "Using the file " + f.name + " (" + f.size.toLocaleString("en-US") + " bytes). Typing in the box above replaces it."; run(); });
    layout();
    return { destroy() {} };
  }
  return { init };
})();
