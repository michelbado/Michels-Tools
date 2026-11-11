/* Reference cards: one shared screen for static look-up tables (search box, sections of rows, phone-friendly cards).
   The data lives in lib/ref-<name>.js and registers itself in window.RefData; nothing here reads anything from the network.
   Everything reaches the page through textContent. Exports window.RefKit. */
(() => {
  "use strict";
  // def = { intro, sections: [{ title, intro?, columns: [...], rows: [[...]], level?: row => "good"|"warn"|"bad"|"" }] }
  function mount(root, prefix, def) {
    const $ = id => root.querySelector("#" + prefix + "-" + id);
    const q = $("q"), out = $("out"), count = $("count"), status = $("status");
    $("intro").textContent = def.intro || "";
    const secs = def.sections.map(s => {
      const fs = document.createElement("fieldset"), lg = document.createElement("legend");
      lg.textContent = s.title; fs.append(lg);
      if (s.intro) { const p = document.createElement("p"); p.className = "tk-muted"; p.textContent = s.intro; fs.append(p); }
      const tb = document.createElement("table"); tb.className = "tk-list ref-table";
      const hr = document.createElement("tr"); hr.className = "tk-head";
      for (const c of s.columns) { const th = document.createElement("th"); th.textContent = c; hr.append(th); }
      tb.append(hr);
      const rows = s.rows.map(r => {
        const tr = document.createElement("tr"), lv = s.level ? s.level(r) : "";
        if (lv) tr.className = "ref-" + lv;
        r.forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; td.dataset.label = s.columns[i] || ""; if (i === 0) td.className = "tk-mono"; tr.append(td); });
        tb.append(tr);
        const text = r.join(" ").toLowerCase();
        return { tr, text, flat: text.replace(/[-_.\/]/g, "") };
      });
      fs.append(tb);
      if (s.foot) { const p = document.createElement("p"); p.className = "tk-foot"; p.textContent = s.foot; fs.append(p); }
      out.append(fs);
      return { fs, rows };
    });
    const total = secs.reduce((n, s) => n + s.rows.length, 0);
    function filter() {
      const words = q.value.toLowerCase().split(/\s+/).filter(Boolean); // hyphens and dots are ignored, so sha384 finds SHA-384
      let shown = 0;
      for (const s of secs) {
        let any = 0;
        for (const r of s.rows) { const hit = words.every(w => r.text.includes(w) || r.flat.includes(w.replace(/[-_.\/]/g, ""))); r.tr.hidden = !hit; if (hit) any++; }
        s.fs.hidden = !any; shown += any;
      }
      count.textContent = words.length ? shown + " of " + total + " rows match" : total + " rows";
      status.textContent = words.length && !shown ? "Nothing matches." : "Ready";
      let none = out.querySelector(".ref-none");
      if (!shown && words.length) { if (!none) { none = document.createElement("p"); none.className = "tk-muted ref-none"; out.append(none); } none.textContent = "Nothing matches \"" + q.value.trim() + "\"."; }
      else if (none) none.remove();
    }
    q.addEventListener("input", filter);
    filter();
    return { destroy() {} };
  }
  const api = { mount };
  if (typeof window !== "undefined") window.RefKit = api;
  if (typeof module !== "undefined") module.exports = api;
})();
