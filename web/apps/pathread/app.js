/* Ping & Traceroute Reader. The reading is done by lib/pathread.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).pathread = (() => {
  const KINDS = { ping: "ping", trace: "tracert / traceroute", mtr: "mtr / WinMTR", pathping: "pathping" };
  function init(root) {
    const $ = id => root.querySelector("#pathread-" + id);
    const PR = window.PathRead, TK = window.TK;
    const setStatus = m => { $("status").textContent = m; };
    let text = "";
    function run() {
      const out = $("out"); out.textContent = ""; $("copy").disabled = $("save").disabled = true; text = ""; $("kind").textContent = "";
      const src = $("in").value;
      if (!src.trim()) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      const r = PR.analyze(src);
      if (r.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: r.error }]); return; }
      $("summary").textContent = r.summary;
      $("kind").textContent = "Recognised: " + (KINDS[r.kind] || r.kind);
      TK.notes($("notes"), r.notes);
      if (r.sections && r.sections.length) { const h = document.createElement("div"); TK.render(h, r.sections); out.append(h); }
      if (r.table) {
        const fs = document.createElement("fieldset"), lg = document.createElement("legend"), tb = document.createElement("table");
        lg.textContent = "Hop by hop"; tb.className = "tk-list";
        const hr = document.createElement("tr");
        for (const t of r.table.heads) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
        tb.append(hr);
        for (const row of r.table.rows) { const tr = document.createElement("tr"); row.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i !== 1) td.className = "tk-mono"; tr.append(td); }); tb.append(tr); }
        fs.append(lg, tb); out.append(fs);
      }
      text = PR.toText(r, { when: new Date().toLocaleString() });
      $("copy").disabled = $("save").disabled = false;
      setStatus("Done.");
    }
    $("in").addEventListener("input", TK.debounce(run, 250));
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    $("save").addEventListener("click", () => TK.save("path-reading.txt", text));
    return { destroy() {} };
  }
  return { init };
})();
