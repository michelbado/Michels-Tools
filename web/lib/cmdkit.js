/* Command builder kit: quoting helpers for shell lines, and the screen shared by the command builders (a form made from a list of fields on the left,
   the result on the right). A builder is one object { fields, build(values), examples }; build() is pure and returns { outputs, notes, explain }.
   Nothing is run and nothing is sent; text reaches the page through textContent only. Exports window.CmdKit. */
(() => {
  "use strict";
  // POSIX shell quoting: leave plain words alone, otherwise wrap in single quotes
  function shq(s) { s = String(s); if (s === "") return "''"; return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; }
  const lines = s => String(s == null ? "" : s).split(/\r?\n/).map(x => x.trim()).filter(x => x && x[0] !== "#");
  const isIPv4 = s => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(s);
  const isIPv6 = s => /^[0-9a-f:.]+$/i.test(s) && s.includes(":") && s.split("::").length <= 2 && s.length <= 45 && !/:::|^:[^:]|[^:]:$/.test(s) && (s.includes("::") || s.split(":").length === 8) && s.split(":").every(p => p === "" || /^[0-9a-f]{1,4}$/i.test(p) || /^\d+(\.\d+){3}$/.test(p));
  const isHost = s => s.length <= 253 && /^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/.test(s);
  const isPort = s => /^\d{1,5}$/.test(String(s)) && +s >= 1 && +s <= 65535;
  const isUser = s => /^[A-Za-z_][A-Za-z0-9_.-]{0,63}\$?$/.test(s);

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  // fields: [{ key, label, type: text|area|select|check, options: [[value, label]], value, hint, placeholder, group, showIf(values), width }]
  function mount(root, id, B) {
    const TK = window.TK, status = root.querySelector("#" + id + "-status"), setStatus = m => { if (status) status.textContent = m; };
    const form = root.querySelector("#" + id + "-form"), out = root.querySelector("#" + id + "-out");
    const inputs = {}, wraps = {};
    const group = {};
    for (const f of B.fields) {
      let fs = group[f.group || ""];
      if (!fs) { fs = group[f.group || ""] = el("fieldset"); if (f.group) fs.append(el("legend", null, f.group)); form.append(fs); }
      const wrap = el("div", "cmdkit-fld"); wraps[f.key] = wrap; const iid = id + "-f-" + f.key;
      let inp;
      if (f.type === "check") {
        const lab = el("label", "cmdkit-check"); inp = el("input"); inp.type = "checkbox"; inp.id = iid; inp.checked = !!f.value; lab.append(inp, document.createTextNode(" " + f.label)); wrap.append(lab);
      } else {
        const lab = el("label", null); lab.htmlFor = iid; lab.append(el("b", null, f.label)); wrap.append(lab);
        if (f.type === "select") { inp = el("select", "xp-select"); for (const [v, t] of f.options) { const o = el("option", null, t); o.value = v; inp.append(o); } inp.value = f.value == null ? f.options[0][0] : f.value; }
        else if (f.type === "area") { inp = el("textarea", "xp-text"); inp.rows = f.rows || 3; inp.value = f.value || ""; inp.spellcheck = false; }
        else { inp = el("input", "xp-field"); inp.type = "text"; inp.value = f.value || ""; inp.maxLength = f.max || 300; inp.spellcheck = false; inp.autocomplete = "off"; }
        if (f.placeholder) inp.placeholder = f.placeholder; inp.id = iid; wrap.append(inp);
      }
      if (f.hint) wrap.append(el("div", "tk-muted", f.hint));
      fs.append(wrap); inputs[f.key] = inp;
    }
    const values = () => { const v = {}; for (const f of B.fields) v[f.key] = f.type === "check" ? inputs[f.key].checked : inputs[f.key].value; return v; };
    function setValues(v) { for (const f of B.fields) if (v[f.key] !== undefined) { if (f.type === "check") inputs[f.key].checked = !!v[f.key]; else inputs[f.key].value = v[f.key]; } }
    const defaults = values();
    let last = null;
    function render() {
      const v = values();
      for (const f of B.fields) wraps[f.key].hidden = !!(f.showIf && !f.showIf(v));
      const r = B.build(v); last = r; out.textContent = "";
      const ul = el("ul", "tk-notes"); out.append(ul); TK.notes(ul, r.notes || []);
      for (const o of r.outputs || []) {
        const fs = el("fieldset"); fs.append(el("legend", null, o.title));
        const pre = el("pre", "cmdkit-pre", o.text); pre.tabIndex = 0; fs.append(pre);
        const row = el("div", "tk-row"); const c = el("button", "xp-btn small", "Copy"); c.type = "button"; c.addEventListener("click", () => TK.copy(o.text, setStatus)); row.append(c);
        if (o.file) { const s = el("button", "xp-btn small", "Save as " + o.file); s.type = "button"; s.addEventListener("click", () => TK.save(o.file, o.text.endsWith("\n") ? o.text : o.text + "\n")); row.append(s); }
        if (o.hint) row.append(el("span", "tk-muted", o.hint));
        fs.append(row); out.append(fs);
      }
      if (r.explain && r.explain.length) TK.render(out.appendChild(el("div")), [{ title: "What each part does", rows: r.explain, mono: false }], { status: setStatus });
      setStatus(r.outputs && r.outputs.length ? "Built." : "Fill in the form.");
    }
    form.addEventListener("input", TK.debounce(render, 80)); form.addEventListener("change", render);
    // examples
    if (B.examples && B.examples.length) {
      const bar = root.querySelector("#" + id + "-examples");
      if (bar) { const sel = el("select", "xp-select"); sel.setAttribute("aria-label", "Start from an example"); const o0 = el("option", null, "Start from an example…"); o0.value = ""; sel.append(o0);
        B.examples.forEach((e, i) => { const o = el("option", null, e.name); o.value = String(i); sel.append(o); });
        sel.addEventListener("change", () => { if (sel.value === "") return; setValues(Object.assign({}, defaults, B.examples[+sel.value].values)); sel.value = ""; render(); });
        const reset = el("button", "xp-btn", "Reset"); reset.type = "button"; reset.addEventListener("click", () => { setValues(defaults); render(); });
        bar.append(sel, reset); }
    }
    render();
    return { destroy() {}, render, values, setValues };
  }
  const api = { shq, lines, isIPv4, isIPv6, isHost, isPort, isUser, mount };
  if (typeof window !== "undefined") window.CmdKit = api;
  if (typeof module !== "undefined") module.exports = api;
})();
