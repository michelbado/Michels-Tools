/* SPF, DKIM & DMARC Reader. All analysis is in lib/mailauth.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).mailauth = (() => {
  function init(root) {
    const $ = id => root.querySelector("#mailauth-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const MA = window.MailAuth, TK = window.TK;
    let text = "";
    function table(rows) {
      const tb = document.createElement("table"); tb.className = "tk-list tk-stack";
      const hr = document.createElement("tr"); hr.className = "tk-head";
      for (const t of ["Part", "Kind", "What it means"]) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
      tb.append(hr);
      for (const r of rows) { const tr = document.createElement("tr"); r.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i === 0) td.className = "tk-mono"; tr.append(td); }); tb.append(tr); }
      return tb;
    }
    function run() {
      const out = $("out"); out.textContent = ""; $("copy").disabled = true; text = "";
      const src = $("in").value;
      if (!src.trim()) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      const a = MA.analyze(src), domain = $("domain").value.trim().replace(/\.$/, ""), sel = $("selector").value.trim();
      $("summary").textContent = a.summary;
      TK.notes($("notes"), a.notes);
      const lines = ["SPF, DKIM & DMARC Reader (Michel's Tools)", a.summary, ""];
      for (const n of a.notes) lines.push("* " + n.text);
      for (const r of a.results) {
        const fs = document.createElement("fieldset"), lg = document.createElement("legend"), h = document.createElement("div");
        lg.textContent = r.summary; fs.append(lg);
        h.className = "tk-summary tk-mono mailauth-rec"; h.textContent = r.text.length > 180 ? r.text.slice(0, 180) + " ..." : r.text; fs.append(h);
        const ul = document.createElement("ul"); ul.className = "tk-notes"; TK.notes(ul, r.notes); fs.append(ul);
        if (r.rows.length) fs.append(table(r.rows));
        if (r.publish) {
          const p = document.createElement("p"); p.className = "tk-foot";
          let where = r.publish;
          if (domain) where = r.kind === "spf" ? "Where: a TXT record at " + domain + ". " : r.kind === "dmarc" ? "Where: a TXT record at _dmarc." + domain + ". " : sel ? "Where: a TXT record at " + sel + "._domainkey." + domain + ". " : "";
          p.textContent = where + r.publish; fs.append(p);
        }
        out.append(fs);
        lines.push("", r.summary, "  " + r.text);
        for (const n of r.notes) lines.push("  * " + n.text);
        for (const row of r.rows) lines.push("  " + row.join(" | "));
      }
      text = lines.join("\n"); $("copy").disabled = false; setStatus("Done.");
    }
    $("in").addEventListener("input", TK.debounce(run, 250));
    $("domain").addEventListener("input", TK.debounce(run, 250)); $("selector").addEventListener("input", TK.debounce(run, 250));
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    return { destroy() {} };
  }
  return { init };
})();
