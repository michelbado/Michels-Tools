/* DORA major-incident classification and reporting clock.
   Pure logic: no page, no network, nothing stored. Everything the visitor types stays in their browser.
   Sources (as understood by the author; the official text prevails):
     Commission Delegated Regulation (EU) 2024/1772, Articles 1-9 (classification: critical services, materiality thresholds, recurring incidents)
     Commission Delegated Regulation (EU) 2025/301, Article 5 (time limits of the initial notification, intermediate and final reports)
   Every number and every rule lives in the tables at the top of this file, so a correction is one edit.
   Answers are "yes" | "no" | "unk" (do not know). Dates are milliseconds since 1970 (local time of the visitor's browser). Exports window.DoraClass. */
(() => {
  "use strict";

  // ---- The rules ------------------------------------------------------------------------------------------------------
  const LIMITS = {
    clientsPct: 10, clientsAbs: 100000, counterpartsPct: 30, transactionsPct: 10, valuePct: 10,   // Art. 9(1)
    durationH: 24, downtimeH: 2,                                                                  // Art. 9(3)
    memberStates: 2,                                                                              // Art. 9(4)
    euro: 100000,                                                                                 // Art. 9(6)
    recurringMonths: 6,                                                                           // Art. 8(2)(a)
    othersNeeded: 2,                                                                              // Art. 8(1)(b): two or more of the other thresholds
  };
  const REPORTING = { initialAfterClassificationH: 4, initialAfterAwarenessH: 24, intermediateAfterInitialH: 72, finalAfterIntermediateMonths: 1 }; // 2025/301 Art. 5

  // Critical services (Art. 6): any one of these makes the incident relevant for the thresholds.
  const GATE = [
    { id: "gc", art: "Art. 6(a)", text: "The incident affects ICT services or systems that support critical or important functions.", hint: "A critical or important function is one you could not do without, or could not lawfully go on without: payments, core banking, trading, online banking. A forgotten internal portal is not." },
    { id: "gf", art: "Art. 6(b)", text: "It affects financial services that need an authorisation or registration, or that a competent authority supervises.", hint: "Anything you may only do because you hold a licence or are registered. For a regulated entity this is yes for almost every client-facing service." },
    { id: "gm", art: "Art. 6(c)", text: "Someone gained successful, malicious, unauthorised access to your network and information systems (a breach).", hint: "Someone actually got in. A blocked attempt does not count; a phishing mail that worked, a stolen password that was used, or ransomware that ran does." },
  ];

  // Materiality thresholds (Art. 9). card = the box on screen; strong = the one that makes the incident major together with the critical services (Art. 8(1)(b)(i)).
  // auto = the item is answered from numbers the visitor typed (see derive()).
  const THRESHOLDS = [
    { id: "t1", card: "clients", art: "Art. 9(1)", title: "Clients, financial counterparts and transactions", items: [
      { id: "c_pct", text: "More than " + LIMITS.clientsPct + " % of all clients that use the affected service are affected.", auto: true },
      { id: "c_abs", text: "More than " + LIMITS.clientsAbs.toLocaleString("en-GB") + " clients that use the affected service are affected.", auto: true },
      { id: "p_pct", text: "More than " + LIMITS.counterpartsPct + " % of the financial counterparts doing business related to the affected service are affected.", auto: true },
      { id: "x_cnt", text: "The affected transactions are more than " + LIMITS.transactionsPct + " % of the daily average number of transactions of the service.", auto: true },
      { id: "x_val", text: "The affected transactions are worth more than " + LIMITS.valuePct + " % of the daily average value of the service's transactions.", auto: true },
      { id: "rel", text: "Clients or counterparts that you have identified as relevant (Art. 1(3)) are affected." },
    ] },
    { id: "t2", card: "reputation", art: "Art. 9(2)", title: "Reputational impact (any one is enough)", items: [
      { id: "r_media", text: "The incident has been reported in the media." },
      { id: "r_compl", text: "Different clients or counterparts have complained repeatedly (about client-facing services or critical business relationships)." },
      { id: "r_reg", text: "You are, or are likely to be, unable to meet regulatory requirements because of it." },
      { id: "r_lost", text: "You have lost, or are likely to lose, clients or counterparts, with a material business impact." },
    ] },
    { id: "t3", card: "duration", art: "Art. 9(3)", title: "Duration and service downtime", items: [
      { id: "d_dur", text: "The incident lasts longer than " + LIMITS.durationH + " hours (from when it occurred to when it is resolved).", auto: true },
      { id: "d_down", text: "Service downtime is longer than " + LIMITS.downtimeH + " hours for ICT services that support critical or important functions.", auto: true },
    ] },
    { id: "t4", card: "geo", art: "Art. 9(4)", title: "Geographical spread", items: [
      { id: "g_geo", text: "The incident has a significant impact in " + LIMITS.memberStates + " or more Member States (Art. 4: on clients or counterparts there, on group branches or entities there, or on market infrastructures or providers that serve entities there).", auto: true },
    ] },
    { id: "t5a", card: "data", art: "Art. 9(5)(a)", title: "Data losses: effect on data", items: [
      { id: "l_data", text: "The availability, authenticity, integrity or confidentiality of data is affected, and this has (or will have) an adverse effect on your business objectives or on your ability to meet regulatory requirements." },
    ] },
    { id: "t5b", card: "data", art: "Art. 9(5)(b)", title: "Data losses: malicious access", strong: true, items: [
      { id: "l_mal", text: "A successful, malicious, unauthorised access to network and information systems has occurred (and is not already covered by the line above) where it may result in data losses." },
    ] },
    { id: "t6", card: "economic", art: "Art. 9(6)", title: "Economic impact", items: [
      { id: "e_eur", text: "Costs and losses have exceeded, or are likely to exceed, EUR " + LIMITS.euro.toLocaleString("en-GB") + " (gross: direct and indirect, before deducting any recoveries, not counting normal running costs).", auto: true },
    ] },
  ];

  // Recurring incidents (Art. 8(2)): incidents that are not major one by one count as one major incident when all three hold.
  const RECURRING = [
    { id: "q_twice", art: "Art. 8(2)(a)", text: "At least two such incidents occurred within " + LIMITS.recurringMonths + " months." },
    { id: "q_cause", art: "Art. 8(2)(b)", text: "They have the same apparent root cause." },
    { id: "q_crit", art: "Art. 8(2)(c)", text: "Taken together they meet the major-incident conditions (critical services affected, and the data-loss threshold or two other thresholds)." },
  ];

  // Entity types. noExt = the weekend / public-holiday extension of 2025/301 Art. 5(4) does NOT apply (Art. 5(5)); micro = recurring check does not apply (Art. 8(2)).
  const ENTITIES = [
    { id: "ext", title: "Financial entity (the weekend and holiday extension applies)", noExt: false, micro: false },
    { id: "noext", title: "Credit institution, central counterparty, trading venue, or NIS2 essential / important entity (no extension, Art. 5(5))", noExt: true, micro: false },
    { id: "auth", title: "Other financial entity that my competent authority has told the extension does not apply to (Art. 5(6))", noExt: true, micro: false },
    { id: "micro", title: "Microenterprise or entity under the simplified framework (Art. 16(1)); extension applies", noExt: false, micro: true },
  ];

  // ---- Small helpers ----------------------------------------------------------------------------------------------------
  const H = 3600000;
  const num = v => { const s = String(v == null ? "" : v).trim().replace(/[\s,_]/g, ""); return /^\d*\.?\d+$/.test(s) ? Number(s) : null; };
  const isAns = v => v === "yes" || v === "no" || v === "unk";
  const pad = n => String(n).padStart(2, "0");
  const dayKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const fmtNum = n => Number.isInteger(n) ? n.toLocaleString("en-GB") : String(Math.round(n * 100) / 100);

  function fmtDate(ms) {
    if (ms == null || !isFinite(ms)) return "-";
    const d = new Date(ms);
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] + " " + d.getFullYear() + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtSpan(ms) {
    const a = Math.abs(ms), m = Math.round(a / 60000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
    if (m < 1) return "less than a minute";
    return (d ? d + " d " : "") + (h || d ? h + " h " : "") + (d ? "" : mm + " min");
  }
  // datetime-local text <-> milliseconds (local time)
  const parseLocal = s => { const t = String(s || "").trim(); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t)) return null; const v = new Date(t).getTime(); return isFinite(v) ? v : null; };
  const toLocalInput = ms => { const d = new Date(ms); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };

  // ---- Answers taken from numbers -------------------------------------------------------------------------------------
  // n = the numbers the visitor typed (text); t = times. Returns { itemId: { state, detail } } for the items that can be decided from them.
  function derive(n, t, now) {
    const out = {}, set = (id, state, detail) => { out[id] = { state, detail }; };
    const a = num(n.clients), tot = num(n.clientsTotal);
    if (a != null) set("c_abs", a > LIMITS.clientsAbs ? "yes" : "no", fmtNum(a) + " clients");
    if (a != null && tot != null && tot > 0) { const p = a / tot * 100; set("c_pct", p > LIMITS.clientsPct ? "yes" : "no", fmtNum(a) + " of " + fmtNum(tot) + " = " + fmtNum(p) + " %"); }
    const c = num(n.cps), ct = num(n.cpsTotal);
    if (c != null && ct != null && ct > 0) { const p = c / ct * 100; set("p_pct", p > LIMITS.counterpartsPct ? "yes" : "no", fmtNum(c) + " of " + fmtNum(ct) + " = " + fmtNum(p) + " %"); }
    const x = num(n.tx), xd = num(n.txDaily);
    if (x != null && xd != null && xd > 0) { const p = x / xd * 100; set("x_cnt", p > LIMITS.transactionsPct ? "yes" : "no", fmtNum(x) + " of a daily average of " + fmtNum(xd) + " = " + fmtNum(p) + " %"); }
    const v = num(n.txVal), vd = num(n.txValDaily);
    if (v != null && vd != null && vd > 0) { const p = v / vd * 100; set("x_val", p > LIMITS.valuePct ? "yes" : "no", fmtNum(v) + " of a daily average of " + fmtNum(vd) + " = " + fmtNum(p) + " %"); }
    // duration: from the start (else the detection) to the resolution (else now); an unfinished incident under the limit is still open
    const start = t.started != null ? t.started : t.detected;
    if (start != null) {
      const end = t.resolved != null ? t.resolved : now, hrs = (end - start) / H, basis = t.started != null ? "since it started" : "since it was detected (start time unknown)";
      if (hrs > LIMITS.durationH) set("d_dur", "yes", fmtSpan(end - start) + (t.resolved != null ? " in total" : " so far, " + basis));
      else if (t.resolved != null) set("d_dur", "no", fmtSpan(end - start) + " in total");
      else set("d_dur", "unk", fmtSpan(Math.max(0, end - start)) + " so far; the 24 hours are reached on " + fmtDate(start + LIMITS.durationH * H));
    }
    const dh = num(n.downH);
    if (dh != null) set("d_down", dh > LIMITS.downtimeH ? "yes" : "no", fmtNum(dh) + " hours of downtime");
    const ms = num(n.states);
    if (ms != null) set("g_geo", ms >= LIMITS.memberStates ? "yes" : "no", fmtNum(ms) + " Member State" + (ms === 1 ? "" : "s"));
    const eur = num(n.eur);
    if (eur != null) set("e_eur", eur > LIMITS.euro ? "yes" : "no", "EUR " + fmtNum(eur));
    return out;
  }

  // any yes -> yes; every one no -> no; otherwise unknown
  function groupState(states) { return states.some(s => s === "yes") ? "yes" : states.every(s => s === "no") ? "no" : "unk"; }
  function allState(states) { return states.some(s => s === "no") ? "no" : states.every(s => s === "yes") ? "yes" : "unk"; }

  // ---- Classification -----------------------------------------------------------------------------------------------------
  // input: { answers: {itemId: "yes"|"no"|"unk"}, nums: {...text}, times: {started, detected, resolved}, entity, now }
  function classify(input) {
    const answers = input.answers || {}, now = input.now != null ? input.now : Date.now(), ent = ENTITIES.find(e => e.id === input.entity) || ENTITIES[0];
    const auto = derive(input.nums || {}, input.times || {}, now);
    const item = (def, art) => {
      const d = auto[def.id], state = d ? d.state : isAns(answers[def.id]) ? answers[def.id] : "unk";
      return { id: def.id, text: def.text, art: def.art || art, state, auto: !!d, detail: d ? d.detail : "" };
    };
    // Malicious access that may cause data loss (Art. 9(5)(b)) is by definition a successful malicious unauthorised access (Art. 6(c)):
    // one "yes" answers both, so the gate follows it even when the visitor left the Art. 6(c) line on "not sure" or "no".
    const impliedGm = answers.l_mal === "yes";
    const gate = GATE.map(g => {
      const i = item(g);
      if (g.id === "gm" && impliedGm && i.state !== "yes") return { ...i, state: "yes", auto: true, detail: "Follows from your answer on step 2: malicious access that may cause data loss is also a successful malicious unauthorised access." };
      return i;
    });
    const gateState = groupState(gate.map(i => i.state));
    const thresholds = THRESHOLDS.map(t => { const items = t.items.map(i => item(i, t.art)); return { id: t.id, card: t.card, art: t.art, title: t.title, strong: !!t.strong, items, state: groupState(items.map(i => i.state)) }; });
    const strong = thresholds.find(t => t.strong), others = thresholds.filter(t => !t.strong);
    const metOthers = others.filter(t => t.state === "yes").length, possibleOthers = others.filter(t => t.state !== "no").length;

    // Someone who says "no" to all three critical-services lines (so also "no" to a breach) and left the malicious-access line open has not
    // described a breach: that line counts as "no". A "yes" on it always wins and makes the gate "yes" (see impliedGm above).
    const strongState = gate.every(i => i.state === "no") && strong.state === "unk" ? "no" : strong.state;
    const major = (assumeUnknown) => {
      const yes = s => s === "yes" || (assumeUnknown && s === "unk");
      return yes(gateState) && (yes(strongState) || others.filter(t => yes(t.state)).length >= LIMITS.othersNeeded);
    };
    // recurring incidents: only for incidents that are not major one by one; microenterprises and Art. 16(1) entities are outside this rule
    // The question is only raised once the visitor says "yes" to one of its lines; left untouched it does not keep a verdict open.
    const rec = RECURRING.map(r => item(r)), recState = ent.micro ? "no" : allState(rec.map(i => i.state)), recRaised = !ent.micro && rec.some(i => i.state === "yes");
    const lo = major(false), hi = major(true);
    const recLo = recState === "yes", recHi = recRaised && recState !== "no";
    let code = lo ? "major" : (!hi && !recHi) ? "notmajor" : (!lo && recLo) ? "major" : "open";
    const viaRecurring = code === "major" && !lo && recLo;

    // reasons in plain words
    const reasons = [], unknown = [];
    const names = list => list.map(t => t.title.replace(/ \(any one is enough\)/, "")).join("; ");
    if (code === "major" && !viaRecurring) {
      reasons.push("Critical services are affected (Art. 6), and " + (strongState === "yes" ? "a successful, malicious, unauthorised access that may result in data losses is present (Art. 9(5)(b)), which is enough on its own" : metOthers + " materiality thresholds are met (two are needed): " + names(others.filter(t => t.state === "yes"))) + ".");
    } else if (viaRecurring) {
      reasons.push("Individually these incidents may not be major, but at least two with the same apparent root cause within " + LIMITS.recurringMonths + " months that together meet the major-incident conditions count as one major incident (Art. 8(2)).");
    } else if (code === "notmajor") {
      if (gateState === "no") reasons.push("None of the three conditions of Art. 6 applies: no critical or important function, no authorised financial service and no breach is affected, so the incident cannot be major.");
      else reasons.push("Critical services are " + (gateState === "yes" ? "affected" : "possibly affected") + ", but even if every open question turned out to be a yes, fewer than two other materiality thresholds could be met and there is no malicious access that may cause data loss.");
      if (!recRaised && !ent.micro) reasons.push("Recurring incidents (Art. 8(2)) were not raised: if this is the second or later incident with the same cause within 6 months, answer step 4.");
    } else {
      reasons.push("It is not possible yet to say that this incident is NOT major: " + (gateState === "unk" ? "whether critical services are affected is open" : gateState === "yes" ? "critical services are affected" : "critical services are not affected, but recurring incidents are still open") + (gateState !== "no" ? "; " + metOthers + " of the other thresholds are met so far and up to " + possibleOthers + " could be." : "."));
      reasons.push("Treat it as possibly major, keep the reporting clock in mind, and find out the open points below.");
      if (gateState === "unk") for (const i of gate) if (i.state === "unk") unknown.push({ art: i.art, text: i.text });
      if (gateState !== "no") for (const t of thresholds) if (t.state === "unk") for (const i of t.items) if (i.state === "unk") unknown.push({ art: t.art, text: i.text, detail: i.detail });
      if (recRaised && recState === "unk") for (const i of rec) if (i.state === "unk") unknown.push({ art: i.art, text: i.text });
    }
    // groups still open that could change the outcome (empty when the verdict is settled)
    const flip = code !== "open" ? [] : [
      ...(gateState === "unk" ? [{ id: "gate", title: "Critical services (Art. 6)" }] : []),
      ...(gateState !== "no" ? thresholds.filter(t => t.state === "unk").map(t => ({ id: t.id, title: t.title, art: t.art })) : []),
    ];
    return { code, viaRecurring, reasons, unknown, flip, gate: { state: gateState, items: gate }, thresholds, metOthers, possibleOthers, othersNeeded: LIMITS.othersNeeded, strongState,
      recurring: { state: recState, items: rec, applies: !ent.micro }, entity: ent };
  }

  // ---- The reporting clock (2025/301 Art. 5) --------------------------------------------------------------------------------
  function isWorking(d, hol) { const w = d.getDay(); return w !== 0 && w !== 6 && !hol.has(dayKey(d)); }
  function nextWorkingNoon(ms, hol) { const d = new Date(ms); d.setHours(12, 0, 0, 0); do { d.setDate(d.getDate() + 1); } while (!isWorking(d, hol)); return d.getTime(); }
  function addMonths(ms, n) { const d = new Date(ms), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return d.getTime(); }

  // o: { detected, started, classified, initialSent, interimSent, resolved, now, entity, holidays: ["YYYY-MM-DD"] }
  function clock(o) {
    const now = o.now != null ? o.now : Date.now(), ent = ENTITIES.find(e => e.id === o.entity) || ENTITIES[0], hol = new Set(o.holidays || []);
    const notes = [], warnings = [];
    let aware = o.detected != null ? o.detected : null;
    if (aware == null && o.started != null) { aware = o.started; notes.push("No time of awareness was given, so the start of the incident is used as the moment you became aware. If you noticed it later, enter that time."); }
    if (aware == null) return { ok: false, rows: [], notes, warnings: [], message: "Enter when you became aware of the incident (or when it started) to see the deadlines." };
    if (o.started != null && o.detected != null && o.detected < o.started) warnings.push("You became aware of the incident before it started: please check the two times.");
    if (o.classified != null && o.classified < aware) warnings.push("The classification as major is earlier than the moment you became aware: please check the two times.");
    if (o.resolved != null && o.resolved < (o.started != null ? o.started : aware)) warnings.push("The incident is resolved before it started: please check the two times.");
    // Art. 5(5): for these entities the extension is removed for the initial notification and the intermediate report, not for the final report
    const adj = (raw, final) => {
      if (ent.noExt && !final) return { due: raw, raw, extended: false };
      const d = new Date(raw);
      return isWorking(d, hol) ? { due: raw, raw, extended: false } : { due: nextWorkingNoon(raw, hol), raw, extended: true };
    };
    const rows = [];
    const outer = aware + REPORTING.initialAfterAwarenessH * H;

    // initial notification
    let init;
    if (o.classified != null) {
      const late = o.classified - aware > REPORTING.initialAfterAwarenessH * H, byClass = o.classified + REPORTING.initialAfterClassificationH * H;
      const raw = late ? byClass : Math.min(byClass, outer), a = adj(raw);
      init = { id: "initial", title: "Initial notification", due: a.due, raw: a.raw, extended: a.extended, sent: o.initialSent,
        basis: late ? "4 hours after you classified it as major (" + fmtDate(o.classified) + "). Classification came more than 24 hours after you became aware, so the 24-hour limit no longer applies (Art. 5(2))."
          : raw === outer ? "24 hours after you became aware (" + fmtDate(aware) + "). This is earlier than 4 hours after classification, and the 24 hours is the latest allowed."
            : "4 hours after you classified it as major (" + fmtDate(o.classified) + "), and in any case within 24 hours of becoming aware." };
    } else {
      init = { id: "initial", title: "Initial notification", due: outer, raw: outer, extended: false, sent: o.initialSent, open: true,
        basis: "4 hours after you classify the incident as major, and no later than 24 hours after you became aware (" + fmtDate(aware) + "). The time shown is that outer limit. Enter the classification time to see the exact deadline." };
      if (now > outer) { init.due = null; init.raw = null; init.late24 = true; init.basis = "More than 24 hours have passed since you became aware (" + fmtDate(aware) + ") and the incident has not been classified as major. If you classify it as major now, the initial notification is due 4 hours after that classification (Art. 5(2)). Enter the classification time."; }
      else { const a = adj(outer); init.due = a.due; init.extended = a.extended; init.raw = a.raw; }
    }
    rows.push(init);

    // intermediate report: 72 hours after the initial notification was SUBMITTED. Without a submission time no date is promised;
    // the date it would have if the initial notification went out at its own deadline is given in words only.
    if (o.initialSent != null) {
      const a = adj(o.initialSent + REPORTING.intermediateAfterInitialH * H);
      rows.push({ id: "intermediate", title: "Intermediate report", due: a.due, raw: a.raw, extended: a.extended, sent: o.interimSent,
        basis: "72 hours after the initial notification was submitted (" + fmtDate(o.initialSent) + "), even if nothing has changed." });
    } else {
      const late = init.due != null ? adj(init.due + REPORTING.intermediateAfterInitialH * H).due : null;
      rows.push({ id: "intermediate", title: "Intermediate report", due: null, sent: o.interimSent, dueText: "72 hours after you submit the initial notification",
        basis: "Enter the time the initial notification was submitted to see the date." + (late != null ? " For orientation: if it is submitted at its latest time, this report is due by " + fmtDate(late) + " at the latest; submitting earlier brings it forward." : "") });
    }

    // updated intermediate report: when regular activities have recovered
    rows.push({ id: "update", title: "Updated intermediate report", due: null, sent: null, special: true,
      basis: o.resolved != null ? "Regular activities recovered at " + fmtDate(o.resolved) + ". An updated intermediate report is due without undue delay once regular activities have recovered." : "Due without undue delay as soon as regular activities have recovered, and whenever the situation changes materially." });

    // final report: no later than one month after the latest intermediate report (the latest date, not the only trigger)
    if (o.interimSent != null) {
      const a = adj(addMonths(o.interimSent, REPORTING.finalAfterIntermediateMonths), true);
      rows.push({ id: "final", title: "Final report", due: a.due, raw: a.raw, extended: a.extended, latest: true,
        basis: "Latest date: one month after the latest intermediate report was submitted (" + fmtDate(o.interimSent) + "). Send it sooner if the root cause analysis is finished; an updated intermediate report moves this date." });
    } else {
      const im = rows.find(r => r.id === "intermediate"), late = im && im.due != null ? adj(addMonths(im.due, REPORTING.finalAfterIntermediateMonths), true).due : null;
      rows.push({ id: "final", title: "Final report", due: null, dueText: "No later than one month after the latest intermediate report",
        basis: "Enter the time the latest intermediate report was submitted to see the date." + (late != null ? " For orientation: if the intermediate report goes out at its deadline, the final report is due by " + fmtDate(late) + " at the latest." : "") });
    }

    for (const r of rows) {
      if (r.special) { r.state = o.resolved != null ? "now" : "waiting"; continue; }
      if (r.due == null) { r.state = r.late24 ? "late" : "waiting"; continue; }
      if (r.sent != null) { r.state = r.sent > r.due ? "sentlate" : "done"; continue; }
      const left = r.due - now;
      r.left = left; r.state = left < 0 ? "late" : left <= 4 * H ? "soon" : "ok";
    }
    const lateRows = rows.filter(r => r.state === "late" && !r.special);
    if (lateRows.length) warnings.push("A time limit has passed (" + lateRows.map(r => r.title.toLowerCase()).join(", ") + "). If you cannot meet a time limit, inform the competent authority without undue delay and no later than that time limit, and explain the reasons (2025/301 Art. 5(3)).");
    if (ent.noExt) notes.push("The weekend and public-holiday extension does not apply to your entity type (Art. 5(5)): the initial notification and the intermediate report stay due even on a weekend or a holiday. The final report keeps the extension.");
    else if (rows.some(r => r.extended)) notes.push("A deadline falls on a weekend or a holiday you ticked, so it moves to noon of the next working day (Art. 5(4)). The original time is shown beside it.");
    return { ok: true, rows, notes, warnings, aware, entity: ent };
  }

  // ---- Other duties that may run at the same time -------------------------------------------------------------------------
  // o: { aware (ms or null), now, personal: "yes"|"no"|"unk", major: classify().code }
  // GDPR Art. 33: 72 hours from becoming aware of a personal data breach (unless it is unlikely to result in a risk). DORA Art. 19(3): clients
  // whose financial interests are affected are told without undue delay. Shown for orientation only; neither is part of the DORA reports.
  function parallel(o) {
    const now = o.now != null ? o.now : Date.now(), rows = [];
    if (o.personal !== "no") {
      const due = o.aware != null ? o.aware + 72 * H : null;
      rows.push({ id: "gdpr", title: "Personal data breach notice to the data protection authority (GDPR Art. 33)", due,
        state: due == null ? "waiting" : now > due ? "late" : due - now <= 12 * H ? "soon" : "ok", left: due == null ? null : due - now, maybe: o.personal !== "yes",
        basis: (o.personal === "yes" ? "Personal data is involved. " : "Only if personal data is involved. ") + "Due within 72 hours of becoming aware, unless the breach is unlikely to result in a risk to people. This is a separate duty with its own recipient; it does not replace the DORA reports." });
    }
    if (o.major !== "notmajor") {
      rows.push({ id: "clients", title: "Tell affected clients (DORA Art. 19(3))", due: null, state: "waiting", dueText: "Without undue delay", maybe: o.major === "open",
        basis: "When a major incident affects the financial interests of your clients, tell them without undue delay, say what they can do to limit the effects, and do it as soon as you are aware." });
    }
    return rows;
  }

  // ---- The report as one standalone HTML file ---------------------------------------------------------------------------
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const DISCLAIMER = "This is a decision aid, not a ruling. The questions, limits and deadlines follow Commission Delegated Regulations (EU) 2024/1772 and 2025/301 as the tool's author understands them. That reading may be incomplete, out of date or simply wrong, and your incident may have facts the tool cannot see, so the result is not a 100 % conclusion. Use it to organise your thinking, then check the official texts, your competent authority's instructions and your own compliance or legal advisers before you decide whether, and when, to report.";
  const STATE_WORD = { yes: "Yes", no: "No", unk: "Don't know" };
  const VERDICT_TEXT = {
    major: ["Meets the criteria for a major incident", "Based on your answers this meets the criteria for a major incident: report it to your competent authority within the time limits below."],
    notmajor: ["Does not meet the criteria for a major incident", "Based on your inputs this does not meet the criteria for a major incident, and only for the facts entered: check again when the duration, the number of clients or the costs change. It is still an incident to record and manage, and a significant cyber threat can be notified to your authority voluntarily."],
    open: ["Cannot rule out a major incident yet", "Treat as possibly major until the open points are answered."],
  };
  // input: the same object classify() takes plus { title, times, clockInput, now }. result = classify(...), cl = clock(...)
  function reportHtml(o) {
    const r = o.result, cl = o.clock, now = o.now != null ? o.now : Date.now(), tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ""; } })();
    const t = o.times || {}, rowTimes = [["Incident started", t.started], ["You became aware of it", t.detected], ["Classified as major", t.classified], ["Resolved / regular activities recovered", t.resolved], ["Initial notification submitted", t.initialSent], ["Latest intermediate report submitted", t.interimSent]];
    const badge = s => '<span class="b ' + s + '">' + esc(STATE_WORD[s]) + "</span>";
    const items = list => '<table class="items"><tbody>' + list.map(i => "<tr><td class=\"s\">" + badge(i.state) + "</td><td>" + esc(i.text) + (i.detail ? '<div class="d">' + esc(i.detail) + (i.auto ? " (worked out from the numbers entered)" : "") + "</div>" : "") + '<div class="a">' + esc(i.art) + "</div></td></tr>").join("") + "</tbody></table>";
    const vt = VERDICT_TEXT[r.code];
    let h = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + esc("DORA incident classification" + (o.title ? " - " + o.title : "")) + "</title><style>" +
      ":root{--ink:#16202e;--mut:#5a6577;--line:#d9dee7;--bg:#f4f6fa;--card:#fff;--red:#b3261e;--redbg:#fdecea;--grn:#25693a;--grnbg:#e8f5ec;--amb:#8a5a00;--ambbg:#fff4d6;--blue:#1f4fb4}" +
      "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:24px 14px}" +
      ".w{max-width:860px;margin:0 auto}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 8px;border-bottom:2px solid var(--line);padding-bottom:4px}.m{color:var(--mut);font-size:13px}" +
      ".v{border-radius:12px;padding:16px 18px;margin:16px 0;border:1px solid}.v.major{background:var(--redbg);border-color:var(--red);color:#6b1510}.v.notmajor{background:var(--grnbg);border-color:var(--grn);color:#173f24}.v.open{background:var(--ambbg);border-color:var(--amb);color:#553700}" +
      ".v b{font-size:21px;display:block}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 14px;margin:10px 0}.card h3{margin:0 0 4px;font-size:15px}" +
      "table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mut);font-weight:600;font-size:13px}" +
      ".items td{border-bottom:1px solid #eef1f6}.s{width:92px}.b{display:inline-block;border-radius:99px;padding:1px 10px;font-size:12px;font-weight:700}.b.yes{background:var(--redbg);color:var(--red)}.b.no{background:var(--grnbg);color:var(--grn)}.b.unk{background:var(--ambbg);color:var(--amb)}" +
      ".d{color:var(--blue);font-size:13px}.a{color:var(--mut);font-size:12px}.due{font-weight:700}.late{color:var(--red)}.note{background:var(--ambbg);border:1px solid var(--amb);color:#553700;border-radius:8px;padding:8px 12px;margin:8px 0}" +
      "footer{margin-top:28px;color:var(--mut);font-size:12px}@media print{body{background:#fff;padding:0}.card{break-inside:avoid}}</style></head><body><div class=\"w\">";
    h += "<h1>DORA major-incident classification</h1><div class=\"m\">" + (o.title ? "Reference: <b>" + esc(o.title) + "</b> &middot; " : "") + "Prepared " + esc(fmtDate(now)) + (tz ? " (" + esc(tz) + ")" : "") + " with Michel's Tools, in the browser; nothing was sent anywhere.</div>";
    h += '<div class="v ' + r.code + '"><b>' + esc(vt[0]) + "</b>" + esc(vt[1]) + (r.viaRecurring ? " (as recurring incidents)" : "") + "</div>";
    h += "<div class=\"note\"><b>Read first.</b> " + esc(DISCLAIMER) + "</div><h2>Why</h2><div class=\"card\">" + r.reasons.map(x => "<p>" + esc(x) + "</p>").join("") + "</div>";
    if (r.unknown.length) h += "<div class=\"note\"><b>Still to find out</b><ul>" + r.unknown.map(u => "<li>" + esc(u.text) + " <span class=\"a\">" + esc(u.art) + "</span></li>").join("") + "</ul></div>";
    h += "<h2>Times</h2><div class=\"card\"><table><tbody>" + rowTimes.map(x => "<tr><th>" + esc(x[0]) + "</th><td>" + (x[1] != null ? esc(fmtDate(x[1])) : '<span class="m">not entered / not known</span>') + "</td></tr>").join("") + "</tbody></table></div>";
    h += "<h2>Reporting timetable</h2>";
    if (!cl.ok) h += "<div class=\"note\">" + esc(cl.message) + "</div>";
    else {
      h += "<div class=\"card\"><table><thead><tr><th>Report</th><th>Due</th><th>Basis</th></tr></thead><tbody>" + cl.rows.map(x => "<tr><td><b>" + esc(x.title) + "</b></td><td class=\"due" + (x.state === "late" ? " late" : "") + "\">" + (x.due != null ? esc(fmtDate(x.due)) : x.special ? "Without undue delay" : (x.dueText || "see basis")) + (x.extended ? '<div class="m">moved from ' + esc(fmtDate(x.raw)) + "</div>" : "") + (x.sent != null ? '<div class="m">submitted ' + esc(fmtDate(x.sent)) + "</div>" : "") + "</td><td>" + esc(x.basis) + "</td></tr>").join("") + "</tbody></table></div>";
      for (const w of cl.warnings) h += "<div class=\"note\">" + esc(w) + "</div>";
      for (const n of cl.notes) h += "<p class=\"m\">" + esc(n) + "</p>";
      h += "<p class=\"m\">Entity type: " + esc(r.entity.title) + ". Deadlines are local time of the browser that made this report" + (tz ? " (" + esc(tz) + ")" : "") + ".</p>";
    }
    if (o.parallel && o.parallel.length) h += "<h2>Other duties that may run at the same time</h2><div class=\"card\"><table><tbody>" + o.parallel.map(x => "<tr><td><b>" + esc(x.title) + "</b>" + (x.maybe ? ' <span class="m">(only if it applies)</span>' : "") + '</td><td class="due">' + (x.due != null ? esc(fmtDate(x.due)) : esc(x.dueText || "")) + "</td><td>" + esc(x.basis) + "</td></tr>").join("") + "</tbody></table></div>";
    h += "<h2>Step 1: are critical services affected?</h2><div class=\"card\"><p><b>Outcome: " + esc(r.gate.state === "yes" ? "yes (at least one condition applies)" : r.gate.state === "no" ? "no (none applies)" : "not yet known") + "</b></p>" + items(r.gate.items) + "</div>";
    h += "<h2>Step 2: materiality thresholds</h2><p class=\"m\">The incident is major when critical services are affected and either the malicious-access data-loss threshold (Art. 9(5)(b)) is met or at least " + r.othersNeeded + " of the other thresholds are met. Met so far: " + r.metOthers + " of the other thresholds (up to " + r.possibleOthers + " possible).</p>";
    for (const th of r.thresholds) h += '<div class="card"><h3>' + esc(th.title) + " " + badge(th.state) + '</h3><div class="a">' + esc(th.art) + "</div>" + items(th.items) + "</div>";
    h += "<h2>Recurring incidents</h2><div class=\"card\">" + (r.recurring.applies ? "<p><b>Outcome: " + esc(r.recurring.state === "yes" ? "yes, they count as one major incident" : r.recurring.state === "no" ? "no" : "not yet known") + "</b></p>" + items(r.recurring.items) : "<p>Not applicable for the entity type chosen (Art. 8(2)).</p>") + "</div>";
    h += "<footer><p><b>How far to rely on this record.</b> " + esc(DISCLAIMER) + "</p><p>It is not legal advice and not a submission to any authority. The classification stays the responsibility of the entity that applies it.</p></footer></div></body></html>";
    return h;
  }

  function summaryText(o) {
    const r = o.result, cl = o.clock, vt = VERDICT_TEXT[r.code], L = [];
    L.push("DORA incident classification" + (o.title ? " - " + o.title : ""), "Result: " + vt[0] + (r.viaRecurring ? " (recurring incidents)" : ""), ...r.reasons.map(x => "- " + x));
    L.push("Critical services (Art. 6): " + ({ yes: "affected", no: "not affected", unk: "not known" })[r.gate.state]);
    for (const t of r.thresholds) L.push("- " + t.title + " (" + t.art + "): " + ({ yes: "crossed", no: "below", unk: "not known" })[t.state]);
    if (r.unknown.length) { L.push("Still to find out:"); for (const u of r.unknown) L.push("- " + u.text); }
    if (cl && cl.ok) { L.push("Reporting timetable:"); for (const x of cl.rows) L.push("- " + x.title + ": " + (x.due != null ? fmtDate(x.due) : x.special ? "without undue delay" : (x.dueText || "see basis"))); }
    if (o.parallel && o.parallel.length) { L.push("Other duties that may run at the same time:"); for (const x of o.parallel) L.push("- " + x.title + ": " + (x.due != null ? fmtDate(x.due) : x.dueText || "see basis") + (x.maybe ? " (only if it applies)" : "")); }
    L.push("", "Decision aid only; it may be incomplete or wrong. Check the official texts and your competent authority before deciding.");
    return L.join("\n");
  }
  const api = { parallel, DISCLAIMER, summaryText, LIMITS, REPORTING, GATE, THRESHOLDS, RECURRING, ENTITIES, num, fmtDate, fmtSpan, parseLocal, toLocalInput, derive, classify, clock, addMonths, nextWorkingNoon, reportHtml, esc, VERDICT_TEXT, STATE_WORD };
  if (typeof window !== "undefined") window.DoraClass = api;
  if (typeof module !== "undefined") module.exports = api;
})();
