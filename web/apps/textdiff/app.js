/* Text Compare. The comparison is in lib/textdiff.js. Everything shown from the texts goes through textContent. */
(window.DesktopApps = window.DesktopApps || {}).textdiff = (() => {
  function init(root) {
    const $ = id => root.querySelector("#textdiff-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const D = window.TextDiff, TK = window.TK; let unified = "";
    const MAXROWS = 3000, MAXCHARS = 2000000;
    const td = (cls, text) => { const c = document.createElement("td"); c.className = cls; if (text !== undefined) c.textContent = text; return c; };
    function cell(side, kind) { // the text cell of one side, with word marks when present
      const c = td("t " + kind); const s = side;
      if (!s) return c;
      if (s.segs) for (const g of s.segs) { if (g.t === "eq") c.append(document.createTextNode(g.s)); else { const m = document.createElement("mark"); m.className = g.t === "del" ? "d" : "a"; m.textContent = g.s; c.append(m); } }
      else c.textContent = s.text;
      return c;
    }
    function run() {
      const ta = $("a").value, tb = $("b").value, table = $("table"); table.textContent = ""; unified = ""; $("copy").disabled = $("save").disabled = true; $("summary").textContent = "";
      if (ta.length + tb.length > MAXCHARS) { TK.notes($("notes"), [{ level: "bad", text: "The texts together are longer than 2 million characters. Please use smaller pieces." }]); return; }
      if (!ta && !tb) { TK.notes($("notes"), []); setStatus("Ready"); return; }
      const c = D.compare(ta, tb, { ignoreCase: $("case").checked, ignoreSpace: $("space").value, words: $("words").checked }), st = c.stats, notes = [];
      if (!c.exact) notes.push({ level: "warn", text: "The two texts are very different, so the exact search was stopped and the middle part is shown as replaced as a whole." });
      $("summary").textContent = st.identical ? "The two texts are identical" + ($("case").checked || $("space").value !== "none" ? " with the chosen options." : ".") : st.changed + " changed, " + st.removed + " removed, " + st.added + " added, " + st.same + " unchanged lines (" + st.linesA + " lines in the original, " + st.linesB + " in the changed text).";
      let rows = c.rows; const only = $("only").checked;
      if (only && !st.identical) { const keep = new Array(rows.length).fill(false); rows.forEach((r, i) => { if (r.type !== "eq") for (let k = Math.max(0, i - 3); k <= Math.min(rows.length - 1, i + 3); k++) keep[k] = true; }); const out = []; let skipped = 0; rows.forEach((r, i) => { if (keep[i]) { if (skipped) { out.push({ type: "gap", n: skipped }); skipped = 0; } out.push(r); } else skipped++; }); if (skipped) out.push({ type: "gap", n: skipped }); rows = out; }
      let shown = rows; if (rows.length > MAXROWS) { shown = rows.slice(0, MAXROWS); notes.push({ level: "warn", text: "Showing the first " + MAXROWS + " of " + rows.length + " rows. The unified diff you can copy or save has everything." }); }
      TK.notes($("notes"), notes);
      for (const r of shown) {
        const tr = document.createElement("tr"); tr.className = r.type;
        if (r.type === "gap") { const g = td("", "… " + r.n + " unchanged line" + (r.n === 1 ? "" : "s") + " …"); g.colSpan = 4; tr.append(g); }
        else { tr.append(td("n", r.a ? String(r.a.n) : ""), cell(r.a, "a"), td("n", r.b ? String(r.b.n) : ""), cell(r.b, "b")); }
        table.append(tr);
      }
      unified = D.unified(c.rows, "original", "changed", 3); $("copy").disabled = $("save").disabled = !unified;
      setStatus(st.identical ? "Identical." : "Compared.");
    }
    const go = TK.debounce(run, 300);
    for (const id of ["a", "b"]) $(id).addEventListener("input", go);
    for (const id of ["space", "case", "words", "only"]) $(id).addEventListener("change", run);
    $("swap").addEventListener("click", () => { const t = $("a").value; $("a").value = $("b").value; $("b").value = t; run(); });
    $("copy").addEventListener("click", () => TK.copy(unified, setStatus));
    $("save").addEventListener("click", () => TK.save("changes.diff", unified));
    for (const s of ["a", "b"]) {
      $("open" + s).addEventListener("click", () => $("file" + s).click());
      $("file" + s).addEventListener("change", async () => { const f = $("file" + s).files[0]; $("file" + s).value = ""; if (!f) return; if (f.size > MAXCHARS) { TK.notes($("notes"), [{ level: "bad", text: f.name + " is larger than 2 MB." }]); return; } $(s).value = await f.text(); run(); setStatus("Opened " + f.name + "."); });
    }
    return { destroy() {} };
  }
  return { init };
})();
