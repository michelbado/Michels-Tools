/* Crontab Generator. All reading, explaining and run-time maths is in lib/crontab.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).crontab = (() => {
  function init(root) {
    const $ = id => root.querySelector("#crontab-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const CT = window.CronTab, TK = window.TK; const FIELD = ["minute", "hour", "dom", "month", "dow"];
    for (const [n, e] of CT.PRESETS) { const o = document.createElement("option"); o.value = e; o.textContent = n + "  (" + e + ")"; $("preset").append(o); }
    const blank = document.createElement("option"); blank.value = ""; blank.textContent = "Choose an example..."; $("preset").prepend(blank); $("preset").value = "";
    const fmt = d => { const utc = $("tz").value === "utc"; const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], p = n => String(n).padStart(2, "0"); return utc ? days[d.getUTCDay()] + " " + d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC" : days[d.getDay()] + " " + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); };
    function syncFields(p) { if (p && p.fields) FIELD.forEach((id, i) => { $("f-" + id).value = p.fields[i].text; }); }
    function show(fromFields) {
      const p = CT.parse($("expr").value), sum = $("summary"), line = $("line"); line.textContent = ""; $("runs").textContent = "";
      if (p.empty) { sum.textContent = ""; TK.notes($("notes"), []); $("runbox").hidden = true; return; }
      if (p.error) { sum.textContent = ""; TK.notes($("notes"), [{ level: "bad", text: p.error }]); $("runbox").hidden = true; return; }
      if (!fromFields) syncFields(p);
      sum.textContent = CT.explain(p); TK.notes($("notes"), p.notes);
      const cmd = $("cmd").value.trim() || p.command, full = p.text + (cmd ? " " + cmd : "");
      TK.render(line, [{ title: "Your crontab line", rows: [["Line", full]], mono: true }], { copy: true, status: setStatus });
      const runs = CT.nextRuns(p, new Date(), Number($("count").value), $("tz").value === "utc");
      $("runbox").hidden = p.kind !== "fields";
      if (p.kind === "fields") {
        if (!runs.length) { const t = document.createElement("p"); t.className = "tk-muted"; t.textContent = "This schedule never runs in the next nine years."; $("runs").append(t); }
        else { const tb = document.createElement("table"); tb.className = "tk-list"; const hr = document.createElement("tr"); for (const h of ["#", "When", "In"]) { const th = document.createElement("th"); th.textContent = h; hr.append(th); } tb.append(hr);
          runs.forEach((d, i) => { const tr = document.createElement("tr"), ms = d - Date.now(), mins = Math.round(ms / 60000), rel = mins < 90 ? mins + " min" : mins < 2880 ? Math.round(mins / 60) + " h" : Math.round(mins / 1440) + " days"; for (const c of [String(i + 1), fmt(d), "in " + rel]) { const td = document.createElement("td"); td.textContent = c; tr.append(td); } tb.append(tr); }); $("runs").append(tb); }
      }
      setStatus("Done.");
    }
    $("expr").addEventListener("input", TK.debounce(() => { $("preset").value = ""; show(false); }, 200));
    $("cmd").addEventListener("input", TK.debounce(() => show(true), 200));
    $("preset").addEventListener("change", () => { if ($("preset").value) { $("expr").value = $("preset").value; show(false); } });
    for (const id of FIELD) $("f-" + id).addEventListener("input", TK.debounce(() => { $("preset").value = ""; const cmd = $("cmd").value.trim(); $("expr").value = CT.build({ minute: $("f-minute").value, hour: $("f-hour").value, dom: $("f-dom").value, month: $("f-month").value, dow: $("f-dow").value }); show(true); }, 200));
    $("tz").addEventListener("change", () => show(true)); $("count").addEventListener("change", () => show(true));
    show(false);
    return { destroy() {} };
  }
  return { init };
})();
