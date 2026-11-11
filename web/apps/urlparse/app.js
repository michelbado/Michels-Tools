/* URL Parser. All parsing is in lib/urlparse.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).urlparse = (() => {
  function init(root) {
    const $ = id => root.querySelector("#urlparse-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const UP = window.UrlParse, TK = window.TK; let text = "";
    function table(heads, rows) {
      const tb = document.createElement("table"); tb.className = "tk-list tk-stack";
      const hr = document.createElement("tr"); hr.className = "tk-head"; for (const t of heads) { const th = document.createElement("th"); th.textContent = t; hr.append(th); } tb.append(hr);
      for (const r of rows) { const tr = document.createElement("tr"); r.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i < 2) td.className = "tk-mono"; tr.append(td); }); tb.append(tr); }
      return tb;
    }
    function run() {
      const out = $("out"); out.textContent = ""; $("copy").disabled = true; text = "";
      const r = UP.parse($("in").value);
      if (r.empty) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      if (r.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: r.error }]); return; }
      $("summary").textContent = r.scheme + "://" + (r.unicodeHost || r.host) + (r.port ? ":" + r.port : "") + " : " + (r.params.length ? r.params.length + " parameter" + (r.params.length === 1 ? "" : "s") : "no parameters");
      TK.notes($("notes"), r.notes);
      const holder = document.createElement("div"); TK.render(holder, [{ title: "The parts", rows: r.rows }], { copy: true, status: setStatus }); out.append(holder);
      const lines = ["URL Parser (Michel's Tools)", r.href, ""]; for (const [k, v, h] of r.rows) lines.push(k + ": " + v + (h ? " (" + h + ")" : ""));
      if (r.segments.length) { const fs = document.createElement("fieldset"), lg = document.createElement("legend"); lg.textContent = "Path segments"; fs.append(lg, table(["#", "Segment"], r.segments.map((s, i) => [String(i + 1), s]))); out.append(fs); lines.push("", "Path segments"); r.segments.forEach((s, i) => lines.push("  " + (i + 1) + ". " + s)); }
      if (r.params.length) { const fs = document.createElement("fieldset"), lg = document.createElement("legend"); lg.textContent = "Query parameters (decoded)"; fs.append(lg, table(["#", "Key", "Value"], r.params.map((p, i) => [String(i + 1), p.key, p.value]))); out.append(fs); lines.push("", "Query parameters"); r.params.forEach(p => lines.push("  " + p.key + " = " + p.value)); }
      text = lines.join("\n"); $("copy").disabled = false; setStatus("Done.");
    }
    $("in").addEventListener("input", TK.debounce(run, 200));
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    return { destroy() {} };
  }
  return { init };
})();
