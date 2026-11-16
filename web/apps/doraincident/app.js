/* DORA Incident Classification: a three-step decision aid (critical services, thresholds, decision).
   The rules and the deadline arithmetic are in lib/doraclass.js; this file only collects answers and shows the result.
   Nothing is saved or sent. Text reaches the page only through textContent. */
(window.DesktopApps = window.DesktopApps || {}).doraincident = (() => {
  function init(root) {
    const $ = id => root.querySelector("#doraincident-" + id);
    const D = window.DoraClass, TK = window.TK;
    const setStatus = m => { $("status").textContent = m; };
    const TIMES = ["started", "detected", "classified", "resolved", "initialSent", "interimSent"];
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const holidays = [];
    let step = 1;

    // every question the library knows, by id
    const ITEM = {};
    for (const g of D.GATE) ITEM[g.id] = g;
    for (const t of D.THRESHOLDS) for (const i of t.items) ITEM[i.id] = i;
    // not part of the classification: it only decides whether the data protection clock is shown beside the DORA reports
    ITEM.pd = { id: "pd", text: "Does the incident involve personal data (a personal data breach)?", hint: "Customer, staff or other people's data that was lost, altered, disclosed or reached by someone who should not have it. If yes, a data protection notice may be due at the same time as the DORA reports." };
    // short labels for the rows that show a limit
    const LIM = {
      c_pct: "Share of the service's clients (limit: over 10 %)", c_abs: "Number of clients (limit: over 100,000)", p_pct: "Share of the service's counterparts (limit: over 30 %)",
      x_cnt: "Share of the daily number of transactions (limit: over 10 %)", x_val: "Share of the daily transaction value (limit: over 10 %)",
      d_dur: "Duration (limit: over 24 hours)", d_down: "Downtime of a critical or important function (limit: over 2 hours)",
      g_geo: "Member States with a significant impact (limit: 2 or more)", e_eur: "Costs and losses (limit: over EUR 100,000)",
    };
    const CARDS = [
      { key: "clients", tid: ["t1"], title: "Clients, counterparts and transactions", art: "Art. 9(1)", nums: [["clients", "Clients affected"], ["clientsTotal", "All clients using the service"]], limits: ["c_pct", "c_abs"],
        more: { nums: [["cps", "Counterparts affected"], ["cpsTotal", "All counterparts of the service"], ["tx", "Transactions affected"], ["txDaily", "Daily average number of transactions"], ["txVal", "Value of transactions affected"], ["txValDaily", "Daily average value (same currency)"]], limits: ["p_pct", "x_cnt", "x_val"], tri: ["rel"] },
        none: "None of this: below all the limits", note: "Use the clients, counterparts and transactions of the affected service as the total, not those of the whole firm." },
      { key: "reputation", tid: ["t2"], title: "Reputation", art: "Art. 9(2)", ticks: [["r_media", "The incident has been in the news"], ["r_compl", "Several clients or counterparts have complained about it"], ["r_reg", "You cannot meet a regulatory duty because of it (or are likely not to)"], ["r_lost", "Clients or counterparts that matter are leaving, or are likely to leave"]], none: "None of these" },
      { key: "duration", tid: ["t3"], title: "Duration and downtime", art: "Art. 9(3)", nums: [["downH", "Hours of downtime of the critical or important service"]], limits: ["d_dur", "d_down"], none: "Under 24 hours, and under 2 hours of downtime", note: "The duration is worked out from the start and resolution times on step 1." },
      { key: "geo", tid: ["t4"], title: "Geographical spread", art: "Art. 9(4) and Art. 4", nums: [["states", "EU Member States with a significant impact"]], limits: ["g_geo"], none: "Only one Member State, or none, is significantly affected", note: "Significant means: clients or counterparts there, group branches or entities there, or market infrastructures or providers that serve entities there." },
      { key: "data", tid: ["t5a", "t5b"], title: "Data", art: "Art. 9(5)", tri: ["l_data", "l_mal"] },
      { key: "amount", tid: ["t6"], title: "Costs and losses", art: "Art. 9(6)", nums: [["eur", "Costs and losses in EUR (gross, so far or expected)"]], limits: ["e_eur"], none: "Below EUR 100,000", note: "Direct and indirect costs, before deducting any recoveries; normal running costs do not count." },
    ];
    const FLIP = {
      gate: "answer the three questions on step 1", t1: "the number of clients affected and the total using the service (and, if relevant, counterparts and transactions)",
      t2: "whether the incident was in the news, drew complaints, endangers a regulatory duty or loses clients (tick them, or tick \"none\")", t3: "the start and resolution times, and the hours of downtime",
      t4: "how many Member States are significantly affected", t5a: "whether data was affected with an adverse effect on your objectives or duties", t5b: "whether there was malicious access that may cause data loss", t6: "an estimate of the costs and losses",
    };
    const THR_LIMIT = {
      t1: "Over 10 % or 100,000 clients; over 30 % of counterparts; over 10 % of transactions or their value; relevant clients", t2: "Any one of: news, complaints, duties at risk, lost clients",
      t3: "Over 24 hours, or over 2 hours of downtime on a critical function", t4: "2 or more Member States, significantly", t5a: "Data affected, with an adverse effect on objectives or duties",
      t5b: "Malicious access that may cause data loss (enough on its own)", t6: "Over EUR 100,000",
    };
    const STATE_TXT = { yes: "Crossed", no: "Below the limit", unk: "Not known yet" };

    const ui = { tri: {}, tick: {}, none: {}, num: {}, limit: {}, card: {} };

    // ---- build ---------------------------------------------------------------------------------------------------------
    function buildTri(id) {
      const def = ITEM[id], row = el("div", "dora-item"), txt = el("div", "dora-itext", def.text);
      if (def.hint) txt.append(el("span", "dora-hint", def.hint));
      const seg = el("div", "dora-seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", def.text);
      const radios = {};
      for (const [v, lab] of [["yes", "Yes"], ["no", "No"], ["unk", "Not sure"]]) {
        const rid = "doraincident-r-" + id + "-" + v, inp = document.createElement("input"); inp.type = "radio"; inp.name = "doraincident-r-" + id; inp.value = v; inp.id = rid; if (v === "unk") inp.checked = true;
        const l = el("label", null, lab); l.htmlFor = rid; seg.append(inp, l); radios[v] = inp; inp.addEventListener("change", update);
      }
      row.append(txt, seg); ui.tri[id] = radios; return row;
    }
    function buildNums(list) {
      const box = el("div", "dora-nums");
      for (const [id, lab] of list) {
        const f = el("label", "tk-fld"), s = el("span", null, lab), inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.maxLength = 18; inp.className = "xp-field"; inp.id = "doraincident-n-" + id; inp.autocomplete = "off";
        const er = el("span", "dora-numerr"); er.setAttribute("role", "status");
        f.htmlFor = inp.id; f.append(s, inp, er); box.append(f); ui.num[id] = inp; inp.placeholder = "e.g. 12000"; inp.addEventListener("input", again);
        inp.addEventListener("input", () => { const bad = inp.value.trim() !== "" && D.num(inp.value) == null; inp.classList.toggle("dora-bad", bad); inp.setAttribute("aria-invalid", bad ? "true" : "false"); er.textContent = bad ? "Digits only, please (a decimal point is fine; commas and spaces are ignored)." : ""; });
      }
      return box;
    }
    function buildLimits(ids, box) {
      for (const id of ids) { const r = el("div", "dora-limit"), t = el("span", "dora-ltxt", LIM[id]), p = el("span", "dora-lpill unk", "-"), d = el("span", "dora-ldet"); r.append(t, p, d); box.append(r); ui.limit[id] = { pill: p, det: d, row: r }; }
    }
    function buildCard(c) {
      const card = el("div", "dora-q"), head = el("div", "dora-qhead"), t = el("div", "dora-qtitle", c.title), badge = el("span", "dora-badge unk", STATE_TXT.unk);
      t.append(el("span", "dora-art", c.art)); head.append(t, badge); card.append(head);
      if (c.note) card.append(el("p", "tk-muted dora-cnote", c.note));
      if (c.nums) card.append(buildNums(c.nums));
      if (c.limits) { const box = el("div", "dora-limits"); buildLimits(c.limits, box); card.append(box); }
      if (c.ticks) {
        const box = el("div", "dora-ticks");
        for (const [id, lab] of c.ticks) { const l = el("label", "dora-tick"), i = document.createElement("input"); i.type = "checkbox"; i.id = "doraincident-t-" + id; l.append(i, el("span", null, lab)); box.append(l); ui.tick[id] = i; i.addEventListener("change", () => { if (i.checked && ui.none[c.key]) ui.none[c.key].checked = false; update(); }); }
        card.append(box);
      }
      if (c.tri) for (const id of c.tri) card.append(buildTri(id));
      if (c.more) {
        const det = el("details", "dora-more"), sum = el("summary", null, "More: counterparts, transactions and relevant clients");
        det.append(sum, buildNums(c.more.nums)); const box = el("div", "dora-limits"); buildLimits(c.more.limits, box); det.append(box); for (const id of c.more.tri) det.append(buildTri(id)); card.append(det);
      }
      if (c.none) {
        const l = el("label", "dora-tick dora-none"), i = document.createElement("input"); i.type = "checkbox"; i.id = "doraincident-none-" + c.key; l.append(i, el("span", null, c.none)); card.append(l); ui.none[c.key] = i;
        i.addEventListener("change", () => { if (i.checked) for (const [id] of (c.ticks || [])) ui.tick[id].checked = false; update(); });
      }
      ui.card[c.key] = { card, badge };
      return card;
    }
    function build() {
      $("disc").textContent = D.DISCLAIMER;
      $("pdbox").append(buildTri("pd"));
      for (const g of D.GATE) $("gate").append(buildTri(g.id));
      for (const c of CARDS) $("cards").append(buildCard(c));
      for (const e of D.ENTITIES) { const o = document.createElement("option"); o.value = e.id; o.textContent = e.title; $("entity").append(o); }
      try { $("tz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"; } catch { $("tz").textContent = "local time"; }
    }

    // ---- read the inputs -----------------------------------------------------------------------------------------------
    const readTimes = () => { const t = {}; for (const k of TIMES) t[k] = D.parseLocal($(k).value); return t; };
    const readNums = () => { const n = {}; for (const id of Object.keys(ui.num)) n[id] = ui.num[id].value; return n; };
    const triVal = id => (Object.entries(ui.tri[id]).find(([, r]) => r.checked) || ["unk"])[0];
    function readAnswers() {
      const a = {};
      for (const id of Object.keys(ui.tri)) a[id] = triVal(id);
      for (const c of CARDS) {
        const none = ui.none[c.key] && ui.none[c.key].checked;
        for (const tid of c.tid) for (const it of D.THRESHOLDS.find(t => t.id === tid).items) {
          if (ui.tri[it.id]) { if (a[it.id] === "unk" && none) a[it.id] = "no"; continue; }
          if (ui.tick[it.id]) { a[it.id] = ui.tick[it.id].checked ? "yes" : none ? "no" : "unk"; continue; }
          a[it.id] = none ? "no" : "unk";
        }
      }
      return a;
    }

    // ---- show ----------------------------------------------------------------------------------------------------------
    function showLimits(result) {
      const items = {}; for (const t of result.thresholds) for (const i of t.items) items[i.id] = i;
      for (const [id, u] of Object.entries(ui.limit)) {
        const i = items[id]; if (!i) continue;
        const known = i.auto || i.state !== "unk";
        u.pill.className = "dora-lpill " + (known ? i.state : "unk"); u.pill.textContent = known ? (i.state === "yes" ? "crossed" : i.state === "no" ? "below" : "open") : "-";
        u.det.textContent = i.detail || "";
      }
    }
    function showCards(result) {
      const st = {}; for (const t of result.thresholds) st[t.id] = t;
      for (const c of CARDS) {
        const states = c.tid.map(id => st[id].state), s = states.includes("yes") ? "yes" : states.every(x => x === "no") ? "no" : "unk", u = ui.card[c.key];
        u.badge.className = "dora-badge " + s; u.badge.textContent = (c.key === "data" && st.t5b.state === "yes") ? "Crossed: enough on its own" : STATE_TXT[s];
        u.card.className = "dora-q " + s;
      }
    }
    function showGate(result) {
      $("hint1").textContent = result.gate.state === "no" ? "None applies, so on your facts it is not a major incident." : result.gate.state === "yes" ? "Critical services are affected: continue with the thresholds." : "";
    }
    function showTally(r) {
      const t = $("tally"), g = { yes: "yes", no: "no", unk: "not known yet" };
      t.textContent = r.metOthers + " of 6 thresholds crossed (two are needed)  ·  malicious access with data loss: " + g[r.strongState] + (r.gate.state === "no" ? "  ·  critical services: no" : "");
      t.className = "dora-tally " + (r.code === "major" ? "major" : r.code === "notmajor" ? "notmajor" : "open");
    }
    function showVerdict(r) {
      const vt = D.VERDICT_TEXT[r.code], mark = r.code === "major" ? "!" : r.code === "notmajor" ? "–" : "?", title = vt[0] + (r.viaRecurring ? " (recurring incidents)" : "");
      $("verdict").className = "dora-verdict " + r.code; $("vicon").textContent = mark; $("vtitle").textContent = title;
      $("strip").className = "dora-strip " + r.code; $("sdot").textContent = mark; $("stext").textContent = title + "  ·  " + r.metOthers + " of 6 thresholds crossed";
      $("vcaution").textContent = vt[1];
      $("markclass").hidden = !(r.code === "major" && !$("classified").value);
      const g = { yes: "yes", no: "no", unk: "not known yet" };
      $("vmeta").textContent = "Critical services: " + g[r.gate.state] + "  ·  Other thresholds crossed: " + r.metOthers + " (two needed)  ·  Malicious access with data loss: " + g[r.strongState];
      const why = $("why"); why.textContent = ""; for (const x of r.reasons) why.append(el("li", null, x));
    }
    function showPar(rows) {
      const list = $("par"); list.textContent = ""; $("parh").hidden = $("par").hidden = !rows.length;
      let n = 0;
      for (const x of rows) {
        n++;
        const li = el("li", "dora-step " + (x.state === "late" ? "late" : x.state === "soon" ? "soon" : "ok")), mark = el("div", "dora-mark", String(n)), card = el("div", "dora-card");
        const title = el("div", "dora-sttitle", x.title), pill = el("span", "dora-pill", x.maybe ? "if it applies" : x.state === "late" ? "overdue by " + D.fmtSpan(-x.left) : x.left != null ? "in " + D.fmtSpan(x.left) : "");
        title.append(pill);
        card.append(title, el("div", "dora-due", x.due != null ? "Within 72 hours: " + D.fmtDate(x.due) : x.dueText || ""), el("div", "dora-basis", x.basis));
        li.append(mark, card); list.append(li);
      }
    }
    function showFlip(r) {
      const box = $("flipbox"), list = $("flip"); list.textContent = "";
      if (r.code === "open") {
        $("fliptitle").textContent = "What would settle it";
        for (const f of r.flip) list.append(el("li", null, f.title + ": add " + (FLIP[f.id] || "what you know") + "."));
        box.hidden = !r.flip.length;
      } else if (r.code === "notmajor") {
        $("fliptitle").textContent = "Look again if the facts change";
        list.append(el("li", null, "Not major does not mean nothing to do: record and manage the incident, and consider notifying your authority of a significant cyber threat (voluntary)."));
        const below = r.thresholds.filter(t => t.state === "no" && !t.strong);
        if (r.gate.state === "no") list.append(el("li", null, "A critical or important function, or a licensed service, is affected after all, or someone gains malicious access."));
        else for (const t of below) list.append(el("li", null, t.title + ": " + THR_LIMIT[t.id] + "."));
        box.hidden = !list.children.length;
      } else box.hidden = true;
    }
    function showLimitTable(r) {
      const box = $("limits"); box.textContent = "";
      const add = (name, art, limit, state, det) => {
        const row = el("div", "dora-lrow " + state), a = el("div", "dora-lname", name), b = el("div", "dora-llimit", limit), c = el("div", "dora-lstate"), p = el("span", "dora-lpill " + state, STATE_TXT[state]);
        a.append(el("span", "dora-art", art)); c.append(p); if (det) c.append(el("span", "dora-ldet", det)); row.append(a, b, c); box.append(row);
      };
      add("Critical services", "Art. 6", "Any one of the three conditions", r.gate.state, "");
      for (const t of r.thresholds) add(t.title, t.art, THR_LIMIT[t.id], t.state, t.items.filter(i => i.detail).map(i => i.detail).join("; "));
    }
    const COUNT = { ok: v => "in " + D.fmtSpan(v), soon: v => "in " + D.fmtSpan(v), late: v => "overdue by " + D.fmtSpan(v) };
    function showClock(cl, r) {
      const list = $("timeline"), notes = $("clocknotes"); list.textContent = "";
      $("clockintro").textContent = r.code === "major" ? "On your facts this meets the criteria, so these reports apply." : r.code === "open" ? "Not settled yet. If it turns out to be major, these are the limits, and the first clock may already be running." : "On your facts no report is due. Shown only for reference, in case that changes.";
      list.className = "dora-timeline" + (r.code === "notmajor" ? " dim" : "");
      const msgs = [];
      if (!cl.ok) msgs.push({ level: "warn", text: cl.message });
      else {
        let n = 0;
        for (const x of cl.rows) {
          n++;
          const li = el("li", "dora-step " + (x.state || "ok")), mark = el("div", "dora-mark", String(n)), card = el("div", "dora-card");
          const title = el("div", "dora-sttitle", x.title), pill = el("span", "dora-pill");
          pill.textContent = x.state === "done" ? "sent" : x.state === "sentlate" ? "sent late" : x.state === "waiting" ? "waiting" : x.state === "now" ? "send now" : x.left != null ? COUNT[x.state === "late" ? "late" : x.state](x.state === "late" ? -x.left : x.left) : x.state === "late" ? "overdue" : "";
          title.append(pill);
          const due = el("div", "dora-due", x.due != null ? (x.open || x.latest ? "No later than " : "") + D.fmtDate(x.due) : x.special ? "Without undue delay" : x.late24 ? "4 hours after classification" : (x.dueText || "After the earlier report"));
          card.append(title, due);
          if (x.extended) card.append(el("div", "dora-was", "Moved from " + D.fmtDate(x.raw) + " (weekend or holiday: noon of the next working day)."));
          if (x.sent != null) card.append(el("div", "dora-basis", "Submitted " + D.fmtDate(x.sent) + (x.state === "sentlate" ? ", after the deadline." : ".")));
          card.append(el("div", "dora-basis", x.basis));
          li.append(mark, card); list.append(li);
        }
        for (const w of cl.warnings) msgs.push({ level: "bad", text: w });
        for (const nn of cl.notes) msgs.push({ level: "info", text: nn });
      }
      TK.notes(notes, msgs);
      $("clocknote").textContent = cl.ok ? "Deadlines are counted in this browser's time zone." : "";
    }

    let last = null;
    function update() {
      const times = readTimes(), nums = readNums(), answers = readAnswers(), entity = $("entity").value || "ext", now = Date.now();
      const result = D.classify({ answers, nums, times, entity, now });
      const cl = D.clock({ detected: times.detected, started: times.started, classified: times.classified, initialSent: times.initialSent, interimSent: times.interimSent, resolved: times.resolved, now, entity, holidays });
      const par = D.parallel({ aware: cl.ok ? cl.aware : (times.detected != null ? times.detected : times.started), now, personal: triVal("pd"), major: result.code });
      const skip2 = result.gate.state === "no";
      $("tab2").disabled = skip2; $("tab2").title = skip2 ? "Not needed: no critical service is affected" : "";
      root.querySelector('#doraincident-p1 [data-go="2"]').textContent = skip2 ? "Next: decision" : "Next: thresholds";
      showPar(par);
      showLimits(result); showCards(result); showGate(result); showTally(result); showVerdict(result); showFlip(result); showLimitTable(result); showClock(cl, result);
      last = { result, cl, times, now, par };
      return last;
    }
    const again = TK.debounce(update, 120);

    // ---- steps ---------------------------------------------------------------------------------------------------------
    function go(n) {
      if (n === 2 && last && last.result.gate.state === "no") n = 3; // thresholds do not matter when no critical service is affected
      step = n;
      for (const i of [1, 2, 3]) { $("p" + i).hidden = i !== n; $("tab" + i).classList.toggle("on", i === n); $("tab" + i).setAttribute("aria-current", i === n ? "step" : "false"); }
      root.querySelector(".tk-body").scrollTop = 0; update();
    }
    for (const b of root.querySelectorAll("[data-go]")) b.addEventListener("click", () => go(Number(b.dataset.go)));

    // ---- buttons -------------------------------------------------------------------------------------------------------
    for (const k of TIMES) { $(k).addEventListener("input", again); $(k).addEventListener("change", update); }
    for (const b of root.querySelectorAll("button[data-now]")) b.addEventListener("click", () => { $(b.dataset.now).value = D.toLocalInput(Date.now()); update(); setStatus("Time set to now."); });
    $("entity").addEventListener("change", update);
    function drawChips() {
      const box = $("chips"); box.textContent = "";
      for (const d of holidays) { const c = el("span", "dora-chip", d), x = el("button", null, "×"); x.type = "button"; x.setAttribute("aria-label", "Remove " + d); x.addEventListener("click", () => { holidays.splice(holidays.indexOf(d), 1); drawChips(); update(); }); c.append(x); box.append(c); }
    }
    $("holadd").addEventListener("click", () => {
      const v = $("hol").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { setStatus("Pick a date first."); return; }
      if (!holidays.includes(v)) { holidays.push(v); holidays.sort(); }
      $("hol").value = ""; drawChips(); update();
    });
    $("download").addEventListener("click", () => {
      const s = update(), ref = $("ref").value.trim();
      const html = D.reportHtml({ result: s.result, clock: s.cl, times: s.times, title: ref, now: s.now, parallel: s.par });
      const d = new Date(s.now), p = n => String(n).padStart(2, "0");
      const safe = ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      const name = "dora-classification-" + (safe ? safe + "-" : "") + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".html";
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setStatus("Report saved as " + name + ".");
    });
    $("copy").addEventListener("click", () => { const s = update(); TK.copy(D.summaryText({ result: s.result, clock: s.cl, title: $("ref").value.trim(), parallel: s.par }), setStatus); });
    function clearAll() {
      for (const k of TIMES) $(k).value = "";
      for (const i of Object.values(ui.num)) { i.value = ""; i.classList.remove("dora-bad"); i.setAttribute("aria-invalid", "false"); if (i.nextSibling) i.nextSibling.textContent = ""; }
      for (const i of Object.values(ui.tick)) i.checked = false;
      for (const i of Object.values(ui.none)) i.checked = false;
      for (const r of Object.values(ui.tri)) r.unk.checked = true;
      $("ref").value = ""; $("entity").value = "ext"; holidays.length = 0; drawChips();
    }
    $("reset").addEventListener("click", () => { clearAll(); go(1); setStatus("Cleared."); });

    // ---- save / load the answers as a file on the visitor's own computer ---------------------------------------------------
    const FORMAT = "michels-tools-dora-answers";
    function collect() {
      const o = { format: FORMAT, version: 1, saved: new Date().toISOString(), ref: $("ref").value.trim(), entity: $("entity").value, holidays: holidays.slice(), times: {}, nums: {}, ticks: [], none: [], tri: {} };
      for (const k of TIMES) if ($(k).value) o.times[k] = $(k).value;
      for (const [id, i] of Object.entries(ui.num)) if (i.value.trim()) o.nums[id] = i.value.trim();
      for (const [id, i] of Object.entries(ui.tick)) if (i.checked) o.ticks.push(id);
      for (const [k, i] of Object.entries(ui.none)) if (i.checked) o.none.push(k);
      for (const id of Object.keys(ui.tri)) o.tri[id] = triVal(id);
      return o;
    }
    // everything read from the file is checked against what the page knows; unknown names and odd values are ignored
    function apply(o) {
      if (!o || typeof o !== "object" || o.format !== FORMAT || o.version !== 1) throw new Error("This is not a file saved by this tool.");
      const isStr = (v, n) => typeof v === "string" && v.length <= n, own = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
      clearAll();
      if (isStr(o.ref, 80)) $("ref").value = o.ref;
      if (isStr(o.entity, 20) && D.ENTITIES.some(e => e.id === o.entity)) $("entity").value = o.entity;
      if (Array.isArray(o.holidays)) for (const d of o.holidays.slice(0, 100)) if (isStr(d, 10) && /^\d{4}-\d{2}-\d{2}$/.test(d) && !holidays.includes(d)) holidays.push(d);
      holidays.sort(); drawChips();
      if (o.times && typeof o.times === "object") for (const k of TIMES) if (own(o.times, k) && isStr(o.times[k], 16) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(o.times[k])) $(k).value = o.times[k];
      if (o.nums && typeof o.nums === "object") for (const id of Object.keys(ui.num)) if (own(o.nums, id) && isStr(o.nums[id], 18)) { ui.num[id].value = o.nums[id]; ui.num[id].dispatchEvent(new Event("input")); }
      if (Array.isArray(o.ticks)) for (const id of o.ticks) if (typeof id === "string" && own(ui.tick, id)) ui.tick[id].checked = true;
      if (Array.isArray(o.none)) for (const k of o.none) if (typeof k === "string" && own(ui.none, k)) ui.none[k].checked = true;
      if (o.tri && typeof o.tri === "object") for (const id of Object.keys(ui.tri)) if (own(o.tri, id) && ["yes", "no", "unk"].includes(o.tri[id])) ui.tri[id][o.tri[id]].checked = true;
      // a "none of these" box wins over ticks that contradict it, as on screen
      for (const c of CARDS) if (ui.none[c.key] && ui.none[c.key].checked) for (const [id] of (c.ticks || [])) ui.tick[id].checked = false;
    }
    $("saveans").addEventListener("click", () => {
      const o = collect(), d = new Date(), p = n => String(n).padStart(2, "0");
      const safe = o.ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      const name = "dora-answers-" + (safe ? safe + "-" : "") + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + ".json";
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(o, null, 1)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setStatus("Answers saved as " + name + ".");
    });
    $("loadans").addEventListener("click", () => $("loadfile").click());
    $("loadfile").addEventListener("change", () => {
      const file = $("loadfile").files[0]; $("loadfile").value = ""; if (!file) return;
      if (file.size > 200000) { setStatus("That file is too large to be a saved answer file."); return; }
      const rd = new FileReader();
      rd.onerror = () => setStatus("The file could not be read.");
      rd.onload = () => { try { apply(JSON.parse(String(rd.result))); go(1); setStatus("Answers loaded from " + file.name + "."); } catch (e) { setStatus("Not loaded: " + (e instanceof SyntaxError ? "the file is not valid JSON." : e && e.message ? e.message : "the file is not valid.")); } };
      rd.readAsText(file);
    });
    $("markclass").addEventListener("click", () => { $("classified").value = D.toLocalInput(Date.now()); update(); setStatus("Classification time set to now."); });

    build(); update();
    const timer = setInterval(() => { if (root.isConnected) update(); }, 30000);
    return { destroy() { clearInterval(timer); } };
  }
  return { init };
})();
