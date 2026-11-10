/* Email Header Analyser. All analysis is in lib/mailhdr.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).mailhdr = (() => {
  function init(root) {
    const $ = id => root.querySelector("#mailhdr-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const MH = window.MailHdr, TK = window.TK;
    let text = "";
    function table(heads, rows) {
      const tb = document.createElement("table"); tb.className = "tk-list";
      const hr = document.createElement("tr");
      for (const t of heads) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
      tb.append(hr);
      for (const r of rows) { const tr = document.createElement("tr"); r.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i === 0) td.className = "tk-mono"; tr.append(td); }); tb.append(tr); }
      return tb;
    }
    function box(title, el) { const fs = document.createElement("fieldset"), lg = document.createElement("legend"); lg.textContent = title; fs.append(lg, el); return fs; }
    function run() {
      const out = $("out"); out.textContent = ""; $("copy").disabled = true; text = "";
      const src = $("in").value;
      if (!src.trim()) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      const r = MH.analyze(src);
      if (r.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: r.error }]); return; }
      $("summary").textContent = r.summary;
      TK.notes($("notes"), r.notes);
      const lines = ["Email Header Analyser (Michel's Tools)", r.summary, ""];
      for (const n of r.notes) lines.push("* " + n.text);
      if (r.hops.length) {
        const rows = r.hops.map(h => [String(h.n), (h.fromHost || "(internal step)") + (h.ips.length ? " [" + h.ips.join(", ") + "]" : ""), h.byHost, h.with || "", MH.fmt(h.when), h.delay == null ? "" : (h.delay < 0 ? "-" : "+") + MH.dur(h.delay)]);
        out.append(box("Route (oldest hop first)", table(["#", "From", "By", "With", "Time", "Wait"], rows)));
        lines.push("", "Route"); for (const x of rows) lines.push("  " + x.join(" | "));
      }
      if (r.auth.length) {
        const rows = r.auth.map(a => [a.method.toUpperCase(), a.result, [a.prop["smtp.mailfrom"] || a.prop["header.from"] || a.prop["header.d"] || "", a.server ? "checked by " + a.server : ""].filter(Boolean).join(", ")]);
        out.append(box("SPF, DKIM and DMARC", table(["Check", "Result", "About"], rows)));
        lines.push("", "Authentication"); for (const x of rows) lines.push("  " + x.join(" | "));
      }
      if (r.dkimSigs.length) {
        const rows = r.dkimSigs.map(s => [s.d || "?", s.s || "", s.a || ""]);
        out.append(box("DKIM signatures on the message", table(["Domain", "Selector", "Algorithm"], rows)));
      }
      const sec = [{ title: "Headline headers", rows: r.keyRows }];
      if (r.spam.length) sec.push({ title: "Spam filter marks", rows: r.spam });
      const holder = document.createElement("div"); TK.render(holder, sec, { copy: false }); out.append(holder);
      for (const s of sec) { lines.push("", s.title); for (const [k, v] of s.rows) lines.push("  " + k + ": " + v); }
      text = lines.join("\n");
      $("copy").disabled = false;
      setStatus("Done.");
    }
    $("in").addEventListener("input", TK.debounce(run, 250));
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    return { destroy() {} };
  }
  return { init };
})();
