/* Tool kit helpers shared by the small paste-and-read tools. Everything reaches the page through textContent. Exports window.TK. */
(() => {
  "use strict";
  const TK = {
    // sections: [{ title, rows: [[label, value, hint?], ...], foot?, mono? }]. opts.copy adds a Copy button to every row.
    render(box, sections, opts) {
      opts = opts || {};
      box.textContent = "";
      for (const s of sections) {
        const fs = document.createElement("fieldset"), lg = document.createElement("legend"), tb = document.createElement("table");
        tb.className = "tk-table"; lg.textContent = s.title; fs.append(lg);
        for (const [k, v, hint] of s.rows) {
          const tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td");
          th.textContent = k; td.textContent = v;
          if (s.mono || opts.mono) td.className = "tk-mono";
          if (opts.copy) {
            const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = "Copy";
            b.addEventListener("click", () => TK.copy(String(v), opts.status));
            td.append(b);
          }
          if (hint) { const h = document.createElement("span"); h.className = "tk-hint"; h.textContent = hint; td.append(h); }
          tr.append(th, td); tb.append(tr);
        }
        fs.append(tb);
        if (s.foot) { const p = document.createElement("p"); p.className = "tk-foot"; p.textContent = s.foot; fs.append(p); }
        box.append(fs);
      }
    },
    notes(ul, list) {
      ul.textContent = ""; ul.hidden = !list.length;
      for (const n of list) { const li = document.createElement("li"); li.className = n.level || ""; li.textContent = n.text; ul.append(li); }
    },
    // a plain-text version of sections, for Copy / Save
    toText(title, sections, notes) {
      const out = [title, ""];
      for (const n of notes || []) out.push("* " + n.text);
      if (notes && notes.length) out.push("");
      for (const s of sections) { out.push(s.title); for (const [k, v] of s.rows) out.push("  " + k + ": " + v); out.push(""); }
      return out.join("\n");
    },
    async copy(text, status) {
      const say = m => { if (status) status(m); };
      try { await navigator.clipboard.writeText(text); say("Copied."); }
      catch {
        const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.append(ta); ta.select();
        try { document.execCommand("copy"); say("Copied."); } catch { say("Copying is blocked here; select the text and copy it by hand."); }
        ta.remove();
      }
    },
    save(name, text) {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    },
    debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; },
  };
  window.TK = TK;
})();
