/* JSON Formatter & Validator. Parsing, exact formatting, repair and path lookup are in lib/jsonfmt.js. Text only reaches the page through textContent / .value. */
(window.DesktopApps = window.DesktopApps || {}).jsonfmt = (() => {
  function init(root) {
    const $ = id => root.querySelector("#jsonfmt-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const J = window.JsonFmt, TK = window.TK; let result = "", errPos = -1, tree = null;
    const MAX = 5 * 1024 * 1024;
    const fmtNum = n => n.toLocaleString("en-US");
    function run() {
      result = ""; errPos = -1; tree = null; $("out").value = ""; $("copy").disabled = $("save").disabled = $("use").disabled = true; $("fixrow").hidden = true; $("repairnote").textContent = ""; $("summary").textContent = ""; $("pathout").textContent = "";
      const src = $("in").value;
      if (src.length > MAX) { TK.notes($("notes"), [{ level: "bad", text: "The text is larger than 5 MB. Please use a smaller piece." }]); return; }
      const r = J.parse(src);
      if (r.empty) { TK.notes($("notes"), []); setStatus("Ready"); return; }
      if (!r.ok) {
        errPos = r.error.pos; $("fixrow").hidden = false;
        TK.notes($("notes"), [{ level: "bad", text: "Not valid JSON. Line " + r.error.line + ", column " + r.error.col + ": " + r.error.msg }]);
        setStatus("Invalid JSON at line " + r.error.line + ", column " + r.error.col + "."); return;
      }
      tree = r.value; const ind = $("indent").value;
      result = J.format(r.value, { indent: ind === "tab" ? "tab" : Number(ind), sort: $("sort").checked });
      $("out").value = result; $("copy").disabled = $("save").disabled = $("use").disabled = false;
      TK.notes($("notes"), r.warnings.map(w => ({ level: "warn", text: w })));
      const s = J.stats(r.value), kind = r.value.t === "obj" ? "object" : r.value.t === "arr" ? "array" : r.value.t === "str" ? "string" : r.value.t === "num" ? "number" : r.value.raw;
      $("summary").textContent = "Valid JSON (" + kind + "). " + fmtNum(s.keys) + " key" + (s.keys === 1 ? "" : "s") + ", " + fmtNum(s.objects) + " object" + (s.objects === 1 ? "" : "s") + ", " + fmtNum(s.arrays) + " array" + (s.arrays === 1 ? "" : "s") + ", " + fmtNum(s.strings) + " string" + (s.strings === 1 ? "" : "s") + ", " + fmtNum(s.numbers) + " number" + (s.numbers === 1 ? "" : "s") + ", depth " + s.depth + ". " + fmtNum(src.length) + " characters in, " + fmtNum(result.length) + " out.";
      setStatus("Valid JSON."); path();
    }
    function path() {
      const p = $("path").value.trim(), out = $("pathout"); out.textContent = "";
      if (!p || !tree) return;
      const g = J.get(tree, p);
      out.textContent = g.found ? J.format(g.node, { indent: 2 }) : g.bad ? "That path is not written correctly. Use $.name, $.items[0] or $[\"odd key\"]." : "Nothing is at that path.";
    }
    $("goto").addEventListener("click", () => { const t = $("in"); t.focus(); t.setSelectionRange(Math.max(0, errPos), Math.min(t.value.length, Math.max(0, errPos) + 1)); });
    $("repair").addEventListener("click", () => {
      const r = J.repair($("in").value); if (!r.fixes.length) { $("repairnote").textContent = "Nothing could be repaired automatically."; return; }
      const check = J.parse(r.text);
      if (!check.ok) { $("repairnote").textContent = "Applied " + r.fixes.join(", ") + ", but the text is still not valid (" + check.error.msg + ")"; $("in").value = r.text; run(); $("repairnote").textContent = "Fixed: " + r.fixes.join(", ") + ". Still not valid; see the message above."; return; }
      $("in").value = r.text; run(); setStatus("Repaired: " + r.fixes.join(", ") + ".");
    });
    $("in").addEventListener("input", TK.debounce(run, 250));
    for (const id of ["indent", "sort"]) $(id).addEventListener("change", run);
    $("path").addEventListener("input", TK.debounce(path, 150));
    $("copy").addEventListener("click", () => TK.copy(result, setStatus));
    $("save").addEventListener("click", () => TK.save("formatted.json", result));
    $("use").addEventListener("click", () => { $("in").value = result; run(); });
    $("clear").addEventListener("click", () => { $("in").value = ""; $("path").value = ""; run(); });
    $("open").addEventListener("click", () => $("file").click());
    $("file").addEventListener("change", async () => { const f = $("file").files[0]; $("file").value = ""; if (!f) return; if (f.size > MAX) { TK.notes($("notes"), [{ level: "bad", text: "That file is larger than 5 MB." }]); return; } $("in").value = await f.text(); run(); setStatus("Opened " + f.name + "."); });
    return { destroy() {} };
  }
  return { init };
})();
