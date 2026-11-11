/* Timestamp & Date Converter. All the arithmetic is in lib/timeconv.js (time zones come from the browser's own Intl data). Nothing is sent anywhere. */
(window.DesktopApps = window.DesktopApps || {}).timeconv = (() => {
  function init(root) {
    const $ = id => root.querySelector("#timeconv-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const T = window.TimeConv, TK = window.TK; let timer = 0, cur = null;
    const OTHERS = ["UTC", "America/Los_Angeles", "America/New_York", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Africa/Cairo", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney"];
    let local = "UTC"; try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }
    const zones = T.zones(); if (!zones.includes(local)) zones.splice(1, 0, local);
    for (const z of zones) { const o = document.createElement("option"); o.value = z; o.textContent = z === local ? z + " (your computer's zone)" : z; $("zone").append(o); }
    $("zone").value = local;
    function tick() { const ms = Date.now(); $("clock").textContent = "Right now: Unix time " + Math.floor(ms / 1000) + " (" + ms + " ms), " + new Date(ms).toISOString().replace(/\.\d+Z$/, "Z") + "."; }
    function run() {
      const text = $("in").value, zone = $("zone").value; $("out").textContent = ""; $("others").textContent = ""; $("summary").textContent = ""; cur = null;
      const r = T.interpret(text, { unit: $("unit").value, zone });
      if (r.empty) { TK.notes($("notes"), []); setStatus("Ready"); return; }
      if (r.error) { TK.notes($("notes"), [{ level: "bad", text: r.error }]); setStatus("Not understood."); return; }
      cur = r; TK.notes($("notes"), r.note ? [{ level: "warn", text: r.note }] : []);
      const nowNs = BigInt(Date.now()) * 1000000n, rows = T.describe(r.ns, zone, nowNs);
      $("summary").textContent = "Read as: " + r.how + ". " + rows[0][1].replace(/\.?0*Z$/, (m) => m) + (zone !== "UTC" ? "  =  " + rows[1][1] + " in " + zone : "");
      TK.render($("out"), [{ title: "This moment, in every form", rows, mono: true }], { copy: true, status: setStatus });
      const ms = T.msOf(r.ns), other = OTHERS.concat(zone !== "UTC" && !OTHERS.includes(zone) ? [zone] : []).map(z => { const p = T.parts(ms, z), o = T.offsetMin(ms, z); const pad = (n, w = 2) => String(n).padStart(w, "0"); return [z, pad(p.y, 4) + "-" + pad(p.mo) + "-" + pad(p.d) + " " + pad(p.h) + ":" + pad(p.mi) + ":" + pad(p.s) + "  (UTC" + T.offText(o) + ")", T.abbr(ms, z)]; });
      TK.render($("others"), [{ title: "The same moment around the world", rows: other, mono: true }], { copy: true, status: setStatus });
      setStatus("Converted.");
    }
    $("in").addEventListener("input", TK.debounce(run, 200));
    for (const id of ["unit", "zone"]) $(id).addEventListener("change", run);
    $("now").addEventListener("click", () => { $("in").value = String(Math.floor(Date.now() / 1000)); $("unit").value = "s"; run(); });
    tick(); timer = setInterval(tick, 1000);
    return { destroy() { clearInterval(timer); } };
  }
  return { init };
})();
