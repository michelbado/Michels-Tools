/* Port Reference. The list is lib/portdata.js; the page filters it as you type. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).portref = (() => {
  function init(root) {
    const $ = id => root.querySelector("#portref-" + id);
    const D = window.PortData;
    function run() {
      const r = D.search($("q").value, { proto: $("proto").value, risky: $("risky").checked }), out = $("out");
      out.textContent = "";
      if (r.error) { $("summary").textContent = r.error; return; }
      const typed = $("q").value.trim();
      $("summary").textContent = r.rows.length + (r.rows.length === 1 ? " match" : " matches") + (r.classText ? ". " + typed + " is a " + r.classText.toLowerCase() : "");
      if (!r.rows.length) {
        const p = document.createElement("p"); p.className = "tk-muted";
        p.textContent = r.num != null ? "Nothing in this list uses port " + r.num + ". It may be a custom service or a temporary port." : "Nothing matches. Try fewer words, a port number, or a range such as 8000-8100.";
        out.append(p); return;
      }
      const tb = document.createElement("table"); tb.className = "tk-list";
      const hr = document.createElement("tr"); for (const t of ["Port", "Protocol", "Name", "What it is for", "Watch out"]) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
      tb.append(hr);
      for (const e of r.rows) {
        const tr = document.createElement("tr");
        const cells = [D.label(e), e[1].toUpperCase().replace("/", " + "), e[2], e[3], e[4].split("").filter(f => f !== "u").map(f => f === "c" ? "not encrypted" : "often attacked").join(", ")];
        cells.forEach((t, i) => { const td = document.createElement("td"); td.textContent = t; if (i === 0) td.className = "tk-mono"; tr.append(td); });
        if (e[4].includes("u")) { const td = tr.children[2]; td.title = D.FLAGS.u; td.textContent += " (unofficial)"; }
        tr.children[4].title = e[4].split("").map(f => D.FLAGS[f]).filter(Boolean).join(" ");
        tb.append(tr);
      }
      out.append(tb);
    }
    const later = window.TK.debounce(run, 120);
    $("q").addEventListener("input", later);
    $("proto").addEventListener("change", run);
    $("risky").addEventListener("change", run);
    run();
    return { destroy() {} };
  }
  return { init };
})();
