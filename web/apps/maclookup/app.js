/* MAC Lookup. The manufacturer list (vendor/oui.json, from the IEEE registry) is fetched from this site once; lookups happen in the browser. */
(window.DesktopApps = window.DesktopApps || {}).maclookup = (() => {
  const MAX_LINES = 200;
  function init(root) {
    const $ = id => root.querySelector("#maclookup-" + id);
    const setStatus = m => { $("status").textContent = m; };
    let db = null, gone = false;
    function run() {
      const lines = $("in").value.split(/\r?\n|[,;]+/).map(x => x.trim()).filter(Boolean).slice(0, MAX_LINES);
      const notes = [], box = $("sections");
      if (!lines.length) { $("summary").textContent = ""; window.TK.notes($("notes"), []); box.textContent = ""; return; }
      const res = lines.map(l => window.MacLib.describe(db, l));
      if (lines.length === 1) {
        const r = res[0];
        if (r.error) { $("summary").textContent = ""; window.TK.notes($("notes"), [{ level: "bad", text: r.error }]); box.textContent = ""; return; }
        $("summary").textContent = r.vendor || (r.local ? "Locally assigned address (no maker)" : "Manufacturer not found");
        window.TK.notes($("notes"), r.notes.map(t => ({ level: "", text: t })));
        window.TK.render(box, [{ title: r.input, rows: r.rows }], { copy: true, status: setStatus });
        return;
      }
      const good = res.filter(r => !r.error);
      $("summary").textContent = good.length + " of " + res.length + " addresses read" + (good.length ? ", " + good.filter(r => r.vendor).length + " with a manufacturer" : "");
      window.TK.notes($("notes"), res.filter(r => r.error).slice(0, 5).map(r => ({ level: "bad", text: "\"" + r.input.slice(0, 40) + "\" is not a MAC address." })));
      box.textContent = "";
      const tb = document.createElement("table"); tb.className = "tk-list";
      const hr = document.createElement("tr"); for (const t of ["Address", "Manufacturer"]) { const th = document.createElement("th"); th.textContent = t; hr.append(th); }
      tb.append(hr);
      for (const r of good) {
        const tr = document.createElement("tr"), a = document.createElement("td"), b = document.createElement("td");
        a.textContent = r.input; a.className = "tk-mono"; b.textContent = r.vendor || (r.local ? "(locally assigned: random or virtual)" : "(not found)");
        tr.append(a, b); tb.append(tr);
      }
      box.append(tb);
    }
    $("in").addEventListener("input", window.TK.debounce(run, 150));
    (async () => {
      try {
        const res = await fetch(new URL("vendor/oui.json", document.baseURI).href, { credentials: "same-origin" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const j = await res.json();
        if (gone) return;
        db = j;
        $("date").textContent = "list of " + (j.date || "unknown date");
        setStatus("Ready. " + (Object.keys(j.l).length + Object.keys(j.m).length + Object.keys(j.s).length).toLocaleString("en-US") + " manufacturer blocks.");
      } catch (e) {
        $("date").textContent = "list not loaded";
        setStatus("The manufacturer list could not be loaded; flags and formats still work.");
      }
      run();
    })();
    return { destroy() { gone = true; } };
  }
  return { init };
})();
