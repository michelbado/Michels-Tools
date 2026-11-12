/* OpenSSL Command Helper: picks a task and writes the exact openssl command (lib/sslcmds.js, every command tested with a real openssl). Runs nothing, sends nothing.
   Text reaches the page through textContent only. */
(window.DesktopApps = window.DesktopApps || {}).opensslhelp = (() => {
  function init(root) {
    const $ = id => root.querySelector("#opensslhelp-" + id), setStatus = m => { $("status").textContent = m; };
    const S = window.SslCmds, TK = window.TK;
    const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
    let current = S.TASKS[0].id; const values = {};
    function renderSide() {
      const side = $("side"); side.textContent = "";
      for (const grp of S.GROUPS) {
        side.append(el("h4", null, grp));
        for (const t of S.TASKS.filter(x => x.group === grp)) {
          const b = el("button", "xp-btn", t.title); b.type = "button"; if (t.id === current) b.setAttribute("aria-current", "true");
          b.addEventListener("click", () => { current = t.id; renderSide(); renderMain(); }); side.append(b);
        }
      }
    }
    function renderMain() {
      const t = S.byId[current], main = $("main"); main.textContent = "";
      const v = values[current] = values[current] || S.defaults(current);
      main.append(el("h3", null, t.title), el("p", null, t.about));
      const form = el("div", "tk-row");
      for (const f of t.fields) {
        const lab = el("label", f.type === "check" ? "ct-ack" : "tk-fld"); lab.htmlFor = "opensslhelp-f-" + f.id;
        let inp;
        if (f.type === "check") { inp = el("input"); inp.type = "checkbox"; inp.checked = !!v[f.id]; lab.append(inp, document.createTextNode(" " + f.label)); }
        else if (f.type === "select") { inp = el("select", "xp-field"); for (const [val, text] of f.options) { const o = el("option", null, text); o.value = val; inp.append(o); } inp.value = v[f.id]; lab.append(el("b", null, f.label), inp); }
        else { inp = el("input", "xp-field"); inp.type = "text"; inp.value = v[f.id]; inp.spellcheck = false; inp.autocomplete = "off"; inp.setAttribute("autocapitalize", "off"); lab.append(el("b", null, f.label), inp); if (f.hint) lab.append(el("span", "tk-hint", f.hint)); }
        inp.id = "opensslhelp-f-" + f.id;
        inp.addEventListener(f.type === "text" || !f.type ? "input" : "change", () => { v[f.id] = f.type === "check" ? inp.checked : inp.value; renderCmds(); });
        form.append(lab);
      }
      main.append(form);
      const out = el("div"); out.id = "opensslhelp-out"; main.append(out);
      renderCmds();
    }
    function renderCmds() {
      const t = S.byId[current], out = $("out"); out.textContent = "";
      const cmds = S.build(current, values[current]);
      const fs = el("fieldset"); fs.append(el("legend", null, "Commands"));
      for (const c of cmds) {
        fs.append(el("p", "tk-muted", c.note));
        const row = el("div", "ct-cmd"), code = el("code", null, c.cmd), b = el("button", "xp-btn small"); b.type = "button"; b.textContent = "Copy"; b.addEventListener("click", () => TK.copy(c.cmd, setStatus)); row.append(code, b); fs.append(row);
      }
      out.append(fs);
      const ex = el("fieldset"); ex.append(el("legend", null, "What the parts mean"));
      const tb = el("table", "tk-table"); for (const [k, m] of t.explain) { const tr = el("tr"); tr.append(el("th", "tk-mono", k), el("td", null, m)); tb.append(tr); } ex.append(tb); out.append(ex);
      out.append(el("p", "tk-muted", "Run these on your own computer. Where a password is needed, openssl asks for it: nothing is typed into this page."));
    }
    renderSide(); renderMain();
    return { destroy() {} };
  }
  return { init };
})();
