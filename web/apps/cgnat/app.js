/* CGNAT Port Calculator. The arithmetic is in lib/cgnat.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).cgnat = (() => {
  function init(root) {
    const $ = id => root.querySelector("#cgnat-" + id);
    const C = window.CgNat, TK = window.TK, setStatus = m => { $("status").textContent = m; };
    const n = v => v.toLocaleString("en-US");
    let plan = null, tableRows = [];
    function readPlan() {
      const subs = C.parseRanges($("subs").value), pool = C.parseRanges($("pool").value), notes = [];
      for (const e of subs.errors) notes.push({ level: "bad", text: "Subscribers: " + e });
      for (const e of pool.errors) notes.push({ level: "bad", text: "Pool: " + e });
      for (const e of subs.notes) notes.push({ level: "info", text: e });
      for (const e of pool.notes) notes.push({ level: "info", text: e });
      if (subs.errors.length || pool.errors.length) return { notes };
      const o = { subs, pool, mode: $("mode").value, portStart: $("first").value.trim(), portEnd: $("last").value.trim() };
      if (o.mode === "perip") o.perIp = $("amount").value.trim(); else o.blockSize = $("amount").value.trim();
      const p = C.plan(o);
      if (p.error) { notes.push({ level: "bad", text: p.error }); return { notes }; }
      return { plan: p, notes: notes.concat(p.notes) };
    }
    function run() {
      $("amountlabel").textContent = $("mode").value === "perip" ? "Subscribers per public address" : "Ports per subscriber";
      const r = readPlan(); plan = r.plan || null;
      $("sections").textContent = ""; $("summary").textContent = "";
      TK.notes($("notes"), r.notes);
      for (const id of ["findbox", "fwdbox", "tablebox"]) $(id).hidden = !plan;
      if (plan) {
        $("summary").textContent = "Each subscriber gets " + n(plan.blockSize) + " ports; " + n(plan.perIp) + " subscribers share one public address; " + n(plan.subsTotal) + " subscribers need " + n(plan.ipsNeeded) + " public address" + (plan.ipsNeeded === 1 ? "" : "es") + (plan.ipsNeeded > 1 ? " (a /" + plan.poolPrefix + " holds them)" : "") + ".";
        TK.render($("sections"), [{ title: "The layout", rows: [
          ["Ports translated", plan.portStart + " to " + plan.portEnd + " (" + n(plan.usable) + " ports)"],
          ["Ports per subscriber", n(plan.blockSize)], ["Subscribers per public address", n(plan.perIp)],
          ["Ports left unused on each address", n(plan.unused)],
          ["Subscribers", n(plan.subsTotal)], ["Public addresses in the pool", n(plan.poolTotal)],
          ["Public addresses needed", n(plan.ipsNeeded) + (plan.fits ? "" : "  (more than the pool has)")], ["Subscribers the pool can serve", n(plan.capacity)],
        ] }]);
        fwd(); rev(); table();
      }
      sizing();
    }
    function fwd() {
      const out = $("fout"), v = $("fip").value.trim(); out.textContent = "";
      if (!plan || !v) return;
      const r = C.forward(plan, v);
      if (r.error) { out.append(msgBox(r.error)); return; }
      TK.render(out, [{ title: "Answer", rows: [["Public address", r.publicIp], ["Ports", r.portFirst + " to " + r.portLast], ["Subscriber number", n(r.index + 1) + " of " + n(plan.subsTotal)], ["Block on that address", r.slot + " of " + plan.perIp]], mono: true }], { copy: true, status: setStatus });
    }
    function rev() {
      const out = $("rout"), ip = $("rip").value.trim(), pt = $("rport").value.trim(); out.textContent = "";
      if (!plan || (!ip && !pt)) return;
      if (!ip || !pt) return;
      const r = C.reverse(plan, ip, pt);
      if (r.error) { out.append(msgBox(r.error)); return; }
      TK.render(out, [{ title: "Answer", rows: [["Subscriber (private address)", r.privateIp], ["Had the ports", r.portFirst + " to " + r.portLast + " on " + r.publicIp], ["Subscriber number", n(r.index + 1) + " of " + n(plan.subsTotal)]], mono: true }], { copy: true, status: setStatus });
    }
    function msgBox(text) { const li = document.createElement("li"); li.textContent = text; const ul = document.createElement("ul"); ul.className = "tk-notes"; li.className = "warn"; ul.append(li); return ul; }
    function table() {
      const box = $("table"); box.textContent = "";
      tableRows = C.table(plan, 0, 10);
      const tb = document.createElement("table"); tb.className = "tk-list";
      const hr = document.createElement("tr"); for (const h of ["Subscriber (private)", "Public address", "Ports"]) { const th = document.createElement("th"); th.textContent = h; hr.append(th); } tb.append(hr);
      for (const row of tableRows) { const tr = document.createElement("tr"); row.forEach(c => { const td = document.createElement("td"); td.className = "tk-mono"; td.textContent = c; tr.append(td); }); tb.append(tr); }
      box.append(tb);
      const total = Math.min(plan.subsTotal, plan.capacity), big = C.csv(plan) === null;
      $("csv").disabled = big; $("copy").disabled = !tableRows.length;
      $("tablenote").textContent = "First " + tableRows.length + " of " + n(total) + " subscribers." + (big ? " The whole table is too large to save from here (more than 200,000 rows); the calculation above still answers any single question." : "");
    }
    function sizing() {
      const box = $("sizeout"); box.textContent = "";
      const rng = { portStart: $("first").value.trim(), portEnd: $("last").value.trim() };
      const a = C.sizing(Object.assign({ subscribers: $("sn").value.trim(), mode: "ports", blockSize: $("sp").value.trim() }, rng));
      const b = C.sizing(Object.assign({ subscribers: $("sn").value.trim(), mode: "ports", blockSize: 1, pool: $("sa").value.trim() }, rng));
      const rows = [];
      if (a.error) rows.push(["Addresses needed", a.error]); else rows.push(["Addresses needed", n(a.ips) + " (a /" + a.prefix + " has " + n(a.poolSize) + ")", n(a.perIp) + " subscribers share each address"]);
      if (b.error) rows.push(["Ports per subscriber with that many addresses", b.error]); else rows.push(["Ports per subscriber with " + n(Number($("sa").value.trim())) + " addresses", n(b.blockSize), n(b.perIp) + " subscribers share each address"]);
      TK.render(box, [{ title: "Result", rows, mono: true }]);
    }
    const again = TK.debounce(run, 150);
    for (const id of ["subs", "pool", "amount", "first", "last", "sn", "sp", "sa"]) $(id).addEventListener("input", again);
    $("mode").addEventListener("change", () => { $("amount").value = $("mode").value === "perip" ? "32" : "2016"; run(); });
    $("fip").addEventListener("input", fwd); $("rip").addEventListener("input", rev); $("rport").addEventListener("input", rev);
    $("csv").addEventListener("click", () => { const t = plan && C.csv(plan); if (t) { TK.save("cgnat-port-blocks.csv", t); setStatus("Saved."); } });
    $("copy").addEventListener("click", () => TK.copy(["private\tpublic\tports"].concat(tableRows.map(r => r.join("\t"))).join("\n"), setStatus));
    run();
    return { destroy() {} };
  }
  return { init };
})();
