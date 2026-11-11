/* HTTP Header Reader. All analysis is in lib/httphdr.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).httphdr = (() => {
  function init(root) {
    const $ = id => root.querySelector("#httphdr-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const HH = window.HttpHdr, TK = window.TK;
    let text = "";
    function cell(tr, t, cls) { const td = document.createElement("td"); td.textContent = t; if (cls) td.className = cls; tr.append(td); return td; }
    function table(heads, rows) {
      const tb = document.createElement("table"); tb.className = "tk-list tk-stack";
      const hr = document.createElement("tr"); hr.className = "tk-head";
      for (const t of heads) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
      tb.append(hr);
      for (const r of rows) { const tr = document.createElement("tr"); r(tr); tb.append(tr); }
      return tb;
    }
    function box(title, el) { const fs = document.createElement("fieldset"), lg = document.createElement("legend"); lg.textContent = title; fs.append(lg, el); return fs; }
    function run() {
      const out = $("out"); out.textContent = ""; $("copy").disabled = true; text = "";
      const src = $("in").value;
      if (!src.trim()) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      const a = HH.analyze(src, window.CDN ? window.CDN.detect : undefined);
      if (a.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: a.error }]); return; }
      $("summary").textContent = a.summary;
      TK.notes($("notes"), a.notes);
      out.append(box("Security headers and other checks", table(["Check", "Result", "Value", "What it means"], a.checks.map(c => tr => {
        cell(tr, c.name); cell(tr, HH.LEVEL[c.level], "httphdr-lv " + c.level); cell(tr, c.value, "httphdr-val"); cell(tr, c.text);
      }))));
      if (a.cookies.length) out.append(box("Cookies (values are not shown)", table(["Name", "Result", "Flags", "What it means"], a.cookies.map(c => tr => {
        cell(tr, c.name, "tk-mono"); cell(tr, HH.LEVEL[c.level], "httphdr-lv " + c.level); cell(tr, c.flags, "httphdr-val"); cell(tr, c.text);
      }))));
      if (a.chain.length > 1) out.append(box("Redirect chain", table(["Step", "Status", "Goes to"], a.chain.map((c, i) => tr => { cell(tr, String(i + 1)); cell(tr, c.status + " " + c.reason); cell(tr, c.location || "(final answer)", "httphdr-val"); }))));
      const holder = document.createElement("div"); TK.render(holder, a.sections.map(s => ({ title: s.title, rows: s.rows.map(r => [r[0], r[1], r[2]]) }))); out.append(holder);
      text = HH.toText(a); $("copy").disabled = false; setStatus("Done.");
    }
    $("in").addEventListener("input", TK.debounce(run, 250));
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    return { destroy() {} };
  }
  return { init };
})();
