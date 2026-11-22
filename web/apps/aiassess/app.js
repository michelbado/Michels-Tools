/* AI Use Case Intake & Assessment: collects the answers and shows the result. All rules, questions and the verdict are in lib/aiassess.js.
   Nothing is saved or sent; the answers can be saved to a file on the visitor's own computer. Text reaches the page only through textContent. */
(window.DesktopApps = window.DesktopApps || {}).aiassess = (() => {
  function init(root) {
    const $ = id => root.querySelector("#aiassess-" + id);
    const A = window.AIAssess, TK = window.TK;
    const setStatus = m => { $("status").textContent = m; };
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const FORMAT = "michels-tools-aiassess-answers";
    const TEXTS = [["name", "Name of the use case", 120, 1], ["ref", "Reference (optional)", 80], ["owner", "Business owner", 120], ["techowner", "Technical owner", 120], ["assessor", "Assessed by", 120], ["model", "AI model or product and version", 120], ["region", "Where it runs (hosting region)", 120], ["countries", "Countries of operation and of the people affected", 200, 1]];
    const AREAS = [["purpose", "Purpose and the business problem it solves", 600], ["process", "The process it supports and the decision it informs or makes", 600], ["benefit", "Expected benefit (why it is worth the risk)", 400]];
    const SELECTS = [["stage", "Stage", A.STAGES], ["build", "How is it built or bought?", A.BUILDS], ["autonomy", "How much does it do on its own?", A.AUTONOMY], ["scale", "Volume", A.SCALE]];
    const CHECKS = [["people", "Who is affected by what it does?", A.PEOPLE], ["data", "What other data does it touch?", A.DATA]];
    const inputs = {}, rows = {}, tabs = [], panels = [], empties = {};
    let step = 1, result = null;

    // ---- build ---------------------------------------------------------------------------------------------------------------------
    function buildTabs() {
      const nav = $("tabs");
      A.SECTIONS.concat([{ id: "result", short: "Result", title: "Result" }]).forEach((s, i) => {
        const b = el("button", "aia-tab" + (i === 0 ? " on" : "")); b.type = "button";
        b.append(el("span", "aia-n", String(i + 1)), el("span", null, s.short)); b.addEventListener("click", () => go(i + 1));
        nav.append(b); tabs.push(b);
      });
    }
    function box(title, intro) { const b = el("div", "aia-box"); b.append(el("h3", null, title)); if (intro) b.append(el("p", "aia-intro", intro)); return b; }
    function navRow(i) {
      const n = el("div", "aia-nav");
      if (i > 1) { const b = el("button", "xp-btn", "Back"); b.type = "button"; b.addEventListener("click", () => go(i - 1)); n.append(b); } else n.append(el("span"));
      const nx = el("button", "xp-btn is-default", i === 7 ? "See the result" : "Next: " + (i < 7 ? A.SECTIONS[i].short : "")); nx.type = "button"; nx.addEventListener("click", () => go(i + 1)); n.append(nx);
      return n;
    }
    function buildIntake(p) {
      const b = box(A.SECTIONS[0].title, A.SECTIONS[0].intro), form = el("div", "aia-form");
      for (const [id, lab, max, wide] of TEXTS) {
        const l = el("label", "f" + (wide ? " wide" : "")); l.append(el("b", null, lab));
        const i = el("input", "xp-field"); i.type = "text"; i.maxLength = max; i.autocomplete = "off"; i.addEventListener("input", TK.debounce(update, 200)); l.append(i); form.append(l); inputs[id] = i;
      }
      for (const [id, lab, max] of AREAS) {
        const l = el("label", "f wide"); l.append(el("b", null, lab));
        const i = el("textarea"); i.maxLength = max; i.addEventListener("input", TK.debounce(update, 200)); l.append(i); form.append(l); inputs[id] = i;
      }
      for (const [id, lab, opts] of SELECTS) {
        const l = el("label", "f wide"); l.append(el("b", null, lab));
        const s = el("select", "xp-select"); s.append(new Option("Choose...", "")); for (const [v, t] of opts) s.append(new Option(t, v)); s.addEventListener("change", update); l.append(s); form.append(l); inputs[id] = s;
      }
      for (const [id, lab, opts] of CHECKS) {
        const g = el("div", "f wide"); g.append(el("b", null, lab)); const list = el("div", "aia-checks"); inputs[id] = {};
        for (const [v, t] of opts) { const l = el("label"), c = el("input"); c.type = "checkbox"; c.value = v; c.addEventListener("change", () => { if (id === "people" && v === "none" && c.checked) for (const [k, o] of Object.entries(inputs.people)) if (k !== "none") o.checked = false; if (id === "people" && v !== "none" && c.checked && inputs.people.none) inputs.people.none.checked = false; update(); }); l.append(c, el("span", null, t)); list.append(l); inputs[id][v] = c; }
        g.append(list); form.append(g);
      }
      b.append(form); p.append(b);
    }
    function buildRow(q) {
      const row = el("div", "aia-item"), txt = el("div", "aia-itext", q.text);
      const ib = el("button", "aia-i", "i"), info = el("div", "aia-info"); ib.type = "button"; ib.setAttribute("aria-expanded", "false"); ib.setAttribute("aria-label", "Explain this question"); ib.title = "Explain this question"; info.hidden = true;
      if (q.info) info.append(el("p", null, q.info));
      if (q.orig && q.orig !== q.text) info.append(el("p", "aia-exact", "Exact wording: " + q.orig));
      ib.addEventListener("click", () => { info.hidden = !info.hidden; ib.setAttribute("aria-expanded", String(!info.hidden)); });
      if (info.childNodes.length) txt.append(" ", ib, info);
      if (q.ref) txt.append(el("span", "aia-ref", q.ref));
      const todo = el("span", "aia-todo"); todo.hidden = true; if (q.kind === "ctl") txt.append(todo);
      const seg = el("div", "aia-seg " + (q.kind === "ctl" ? "aia-ctl" : "aia-fact")); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", q.text);
      const radios = {};
      const labs = q.kind === "ctl" ? [["yes", "In place"], ["no", "Not in place"], ["unk", "Not sure"]] : [["yes", "Yes"], ["no", "No"], ["unk", "Not sure"]];
      for (const [v, lab] of labs) {
        const rid = "aiassess-r-" + q.id + "-" + v, i = el("input"); i.type = "radio"; i.name = "aiassess-r-" + q.id; i.value = v; i.id = rid; if (v === "unk") i.checked = true;
        const l = el("label", null, lab); l.htmlFor = rid; seg.append(i, l); radios[v] = i; i.addEventListener("change", update);
      }
      row.append(txt, seg); rows[q.id] = { el: row, radios, todo, q };
      return row;
    }
    function buildPanels() {
      const host = $("panels");
      A.SECTIONS.forEach((s, idx) => {
        const p = el("section", "aia-panel"); p.hidden = idx !== 0; panels.push(p);
        if (idx === 0) buildIntake(p);
        else {
          const b = box(s.title, s.intro); let any = false;
          for (const q of A.QUESTIONS) if (q.sec === s.id) { b.append(buildRow(q)); any = true; }
          if (any) { const e = el("p", "aia-empty", "Nothing to ask here for this use case."); e.hidden = true; empties[s.id] = e; b.append(e); }
          p.append(b);
        }
        p.append(navRow(idx + 1)); host.append(p);
      });
      const rp = el("section", "aia-panel"); rp.hidden = true; panels.push(rp);
      rp.append(el("div", null)); rp.firstChild.id = "aiassess-result";
      const rec = box("Keep a record", "Nothing you type is saved or sent anywhere. Download the report, or save your answers to a file on your own computer and load them again later; the file holds only what you typed here.");
      const r1 = el("div", "tk-row");
      for (const [id, t, def] of [["download", "Download report (HTML)", 1], ["copy", "Copy summary"], ["saveans", "Save my answers (file)"], ["loadans", "Load answers from a file"], ["reset", "Start again"]]) {
        const b = el("button", "xp-btn" + (def ? " is-default" : ""), t); b.type = "button"; b.id = "aiassess-" + id; r1.append(b);
      }
      const file = el("input"); file.type = "file"; file.id = "aiassess-loadfile"; file.accept = ".json,application/json"; file.hidden = true; r1.append(file);
      rec.append(r1); rp.append(rec);
      const back = el("div", "aia-nav"); const bb = el("button", "xp-btn", "Back to governance"); bb.type = "button"; bb.addEventListener("click", () => go(7)); back.append(bb); rp.append(back);
      host.append(rp);
    }

    // ---- state ---------------------------------------------------------------------------------------------------------------------
    function collect() {
      const f = {};
      for (const [id] of TEXTS.concat(AREAS)) f[id] = inputs[id].value.trim();
      for (const [id] of SELECTS) f[id] = inputs[id].value;
      for (const [id] of CHECKS) f[id] = Object.entries(inputs[id]).filter(([, c]) => c.checked).map(([v]) => v);
      const q = {};
      for (const [id, r] of Object.entries(rows)) q[id] = r.radios.yes.checked ? "yes" : r.radios.no.checked ? "no" : "unk";
      return { f, q };
    }
    function go(n) {
      step = Math.max(1, Math.min(8, n));
      panels.forEach((p, i) => { p.hidden = i !== step - 1; }); tabs.forEach((t, i) => t.classList.toggle("on", i === step - 1));
      const body = root.querySelector(".tk-body"); if (body) body.scrollTop = 0;
    }
    function list(ul, items) { for (const x of items) ul.append(el("li", null, x)); return ul; }
    function gapList(items, title, empty) {
      const b = box(title); if (!items.length) { b.append(el("p", "aia-empty", empty)); return b; }
      for (const i of items) {
        const d = el("div", "aia-gap"), s = el("span", "aia-sev " + i.sev, A.SEV_T[i.sev]); d.append(s, document.createTextNode(" " + i.text));
        if (i.fix) d.append(el("span", "aia-fix", "To do: " + i.fix)); if (i.ref) d.append(el("span", "aia-ref", i.ref)); b.append(d);
      }
      return b;
    }
    function renderResult(a, r) {
      const o = A.OUTCOME[r.code], host = $("result"); host.textContent = "";
      const v = el("section", "aia-verdict " + o.cls), ic = el("div", "aia-vicon", o.cls === "bad" ? "!" : o.cls === "good" ? "✓" : "?"), main = el("div");
      ic.setAttribute("aria-hidden", "true");
      main.append(el("div", "aia-vkicker", "Result of this decision aid"), el("div", "aia-vtitle", o.title), el("p", "aia-vtext", o.text)); v.append(ic, main); host.append(v);
      const why = box("Why this result"), ul = el("ul", "aia-list"); list(ul, r.why); why.append(ul); const T = A.TIER_TEXT[r.tier]; why.append(el("p", "tk-muted", T.title + ". " + T.sub)); host.append(why);
      const rb = box("Your roles"); const ru = el("ul", "aia-list"); list(ru, r.roles.length ? r.roles : ["Not enough answers to say."]); rb.append(ru); host.append(rb);
      const reg = box("Which rules apply"), tb = el("table", "aia-tbl");
      for (const x of r.regimes) { const tr = el("tr"); tr.append(el("td", null, x.name), el("td", null, x.state === "applies" ? "Applies" : x.state === "no" ? "Does not apply (as you answered)" : "To be confirmed")); tb.append(tr); }
      reg.append(tb);
      if (r.dpia !== "no") reg.append(el("p", "tk-muted", r.dpia === "needed" ? "A data protection impact assessment (DPIA) is likely needed: at least one trigger is present." : "Whether a DPIA is needed is still open."));
      host.append(reg);
      if (r.openClass.length) { const b = box("What would settle the classification"), u = el("ul", "aia-list"); list(u, r.openClass.map(id => A.BY[id].text)); b.append(u); host.append(b); }
      host.append(gapList(r.gaps, "Gaps to close (" + r.gaps.length + ")", "No gaps on these answers."));
      host.append(gapList(r.open, "Still unknown (" + r.open.length + "): each is a finding", "Nothing is unknown among the questions asked."));
      const tr = box("Re-assess when"), tu = el("ul", "aia-list"); list(tu, A.TRIGGERS); tr.append(tu); host.append(tr);
      const n = box("Read this too"); n.append(el("p", "tk-muted", A.DATES), el("p", "tk-muted", A.DISCLAIMER)); host.append(n);
    }
    function update() {
      const a = collect(), r = A.evaluate(a); result = { a, r };
      for (const [id, row] of Object.entries(rows)) {
        row.el.hidden = !r.visible[id];
        if (row.q.kind === "ctl") { const no = row.radios.no.checked && r.visible[id]; row.todo.hidden = !no || !row.q.fix; row.todo.textContent = no ? "To do: " + row.q.fix : ""; }
      }
      for (const s of A.SECTIONS) if (empties[s.id]) empties[s.id].hidden = A.QUESTIONS.some(q => q.sec === s.id && r.visible[q.id]);
      renderResult(a, r);
    }

    buildTabs(); buildPanels();

    // ---- files -----------------------------------------------------------------------------------------------------------------------
    const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()); };
    const safeName = s => String(s || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    function download(name, text, type) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }
    $("download").addEventListener("click", () => {
      update(); const name = "ai-assessment-" + (safeName(result.a.f.ref || result.a.f.name) ? safeName(result.a.f.ref || result.a.f.name) + "-" : "") + stamp() + ".html";
      download(name, A.reportHtml(result.a, result.r, Date.now()), "text/html;charset=utf-8"); setStatus("Report saved as " + name + ".");
    });
    $("copy").addEventListener("click", () => { update(); TK.copy(A.summaryText(result.a, result.r), setStatus); });
    $("saveans").addEventListener("click", () => {
      update(); const o = { format: FORMAT, version: 1, saved: new Date().toISOString(), f: result.a.f, q: {} };
      for (const [id, v] of Object.entries(result.a.q)) if (v !== "unk") o.q[id] = v;
      const name = "ai-assessment-answers-" + (safeName(o.f.ref || o.f.name) ? safeName(o.f.ref || o.f.name) + "-" : "") + stamp() + ".json";
      download(name, JSON.stringify(o, null, 1), "application/json"); setStatus("Answers saved as " + name + ".");
    });
    function clearAll() {
      for (const [id] of TEXTS.concat(AREAS)) inputs[id].value = "";
      for (const [id] of SELECTS) inputs[id].value = "";
      for (const [id] of CHECKS) for (const c of Object.values(inputs[id])) c.checked = false;
      for (const r of Object.values(rows)) r.radios.unk.checked = true;
    }
    // everything read from the file is checked against what the page knows; unknown names and odd values are ignored
    function apply(o) {
      if (!o || typeof o !== "object" || o.format !== FORMAT || o.version !== 1) throw new Error("This is not a file saved by this tool.");
      const own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k), f = o.f && typeof o.f === "object" ? o.f : {}, q = o.q && typeof o.q === "object" ? o.q : {};
      clearAll();
      for (const [id, , max] of TEXTS.concat(AREAS)) if (own(f, id) && typeof f[id] === "string") inputs[id].value = f[id].slice(0, typeof max === "number" ? max : 200);
      for (const [id, , opts] of SELECTS) if (own(f, id) && typeof f[id] === "string" && opts.some(x => x[0] === f[id])) inputs[id].value = f[id];
      for (const [id] of CHECKS) if (Array.isArray(f[id])) for (const v of f[id]) if (typeof v === "string" && own(inputs[id], v)) inputs[id][v].checked = true;
      for (const id of Object.keys(rows)) if (own(q, id) && (q[id] === "yes" || q[id] === "no")) rows[id].radios[q[id]].checked = true;
    }
    $("loadans").addEventListener("click", () => $("loadfile").click());
    $("loadfile").addEventListener("change", () => {
      const file = $("loadfile").files[0]; $("loadfile").value = ""; if (!file) return;
      if (file.size > 200000) { setStatus("That file is too large to be a saved answer file."); return; }
      const rd = new FileReader();
      rd.onerror = () => setStatus("The file could not be read.");
      rd.onload = () => { try { apply(JSON.parse(String(rd.result))); update(); go(1); setStatus("Answers loaded from " + file.name + "."); } catch (e) { setStatus("Not loaded: " + (e instanceof SyntaxError ? "the file is not valid JSON." : e && e.message ? e.message : "unreadable.")); } };
      rd.readAsText(file);
    });
    $("reset").addEventListener("click", () => { clearAll(); update(); go(1); setStatus("Cleared."); });

    update();
    return { destroy() {} };
  }
  return { init };
})();
