/* Subnet Splitter. Everything runs in the browser; nothing is sent to the server. */
(window.DesktopApps = window.DesktopApps || {}).splitter = (() => {
  const { parseInput, blockOf, subnetInfo, rangeToCidrs, cidrText } = window.IPv4;
  const MAX_SUBNETS = 65536;   // refuse to generate more than this
  const SHOW_ROWS = 2000;      // rows drawn in the table (copy always has all of them)

  /* ---------- planning (pure; also used by the tests) ---------- */

  // a /prefix network -> block, normalized; error string when unusable
  function parseNetwork(text) {
    const p = parseInput(text);
    if (!p) return { error: "That is not a valid network. Use something like 10.0.0.0/16." };
    if (p.prefix === null) return { error: "Add a prefix length, for example 10.0.0.0/16." };
    const b = blockOf(p.ip, p.prefix);
    return { block: b, normalized: b.start !== p.ip };
  }

  // equal split at a chosen new prefix -> [{start, prefix}]
  function splitBySize(block, newPrefix) {
    if (!(newPrefix > block.prefix && newPrefix <= 32)) return { error: "Pick a size smaller than the network." };
    const count = Math.pow(2, newPrefix - block.prefix);
    if (count > MAX_SUBNETS) return { error: `That makes ${count.toLocaleString()} subnets. The limit is ${MAX_SUBNETS.toLocaleString()}; pick a larger size.` };
    const size = Math.pow(2, 32 - newPrefix);
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ start: block.start + i * size, prefix: newPrefix });
    return { rows, count };
  }

  // split into n equal parts (rounded up to a power of two)
  function splitByCount(block, n) {
    if (!Number.isInteger(n) || n < 1) return { error: "Enter a whole number of parts, 1 or more." };
    let bits = 0;
    while (Math.pow(2, bits) < n) bits++;
    const newPrefix = block.prefix + bits;
    if (newPrefix > 32) return { error: `A /${block.prefix} network cannot be split into ${n.toLocaleString()} parts.` };
    const r = bits === 0 ? { rows: [{ start: block.start, prefix: block.prefix }], count: 1 } : splitBySize(block, newPrefix);
    if (r.error) return r;
    r.requested = n;
    r.rounded = Math.pow(2, bits) !== n;
    return r;
  }

  // "Sales 100" / "100" / "Sales: 100" lines -> [{ name, hosts }] and the bad lines
  function parseHosts(text) {
    const reqs = [], bad = [];
    String(text).split(/\r?\n/).forEach(line => {
      const t = line.trim();
      if (!t) return;
      const m = /^(?:(.*?)[\s:=,]+)?(\d+)$/.exec(t);
      if (!m || Number(m[2]) < 1) { bad.push(t); return; }
      reqs.push({ name: (m[1] || "").trim(), hosts: Number(m[2]) });
    });
    return { reqs, bad };
  }

  // smallest block (bits of host space) that holds `hosts` usable addresses, never below /30
  function bitsFor(hosts) {
    let k = 2;
    while (Math.pow(2, k) - 2 < hosts) k++;
    return k;
  }

  // VLSM: largest subnet first, packed from the start of the network
  function planVlsm(block, reqs) {
    const items = reqs.map((r, i) => ({ ...r, i, k: bitsFor(r.hosts) }));
    items.sort((a, b) => b.k - a.k || a.i - b.i);
    const end = block.end;
    let cursor = block.start;
    const rows = [], unplaced = [];
    for (const it of items) {
      const size = Math.pow(2, it.k);
      if (it.k > 32 - block.prefix || cursor + size - 1 > end) { unplaced.push(it); continue; }
      rows.push({ start: cursor, prefix: 32 - it.k, name: it.name, hosts: it.hosts });
      cursor += size;
    }
    const free = cursor <= end ? rangeToCidrs(cursor, end) : [];
    return { rows, unplaced, free, used: cursor - block.start, total: block.size };
  }

  /* ---------- the window ---------- */

  function init(root) {
    const $ = id => root.querySelector("#splitter-" + id);
    const fmt = n => n.toLocaleString();
    const getMode = () => root.querySelector('input[name="splitter-mode"]:checked').value;

    let lines = { cidrs: "", table: "" };   // what the Copy buttons put on the clipboard

    // size list: refreshed when the network's prefix changes
    const sel = $("prefix");
    function fillSizes(parentPrefix) {
      const keep = sel.value;
      sel.textContent = "";
      for (let p = Math.min(parentPrefix + 1, 32); p <= 32; p++) {
        const o = document.createElement("option");
        o.value = String(p);
        o.textContent = `/${p} - ${window.IPv4.intToIp(window.IPv4.maskInt(p))}`;
        sel.append(o);
      }
      if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
      else sel.selectedIndex = Math.min(sel.options.length - 1, 7);   // default: 8 bits below the parent (e.g. /16 -> /24)
    }
    let filledFor = -1;

    function setHead(cols) {
      const head = $("head");
      head.textContent = "";
      const tr = document.createElement("tr");
      for (const c of cols) { const th = document.createElement("th"); th.textContent = c; tr.append(th); }
      head.append(tr);
    }

    function cell(tr, text, cls) {
      const td = document.createElement("td");
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }

    function clear(message, status) {
      $("head").textContent = "";
      $("body").textContent = "";
      $("summary").textContent = message;
      $("status").textContent = status || message;
      $("n").textContent = "0";
      $("copycidr").disabled = $("copytable").disabled = true;
      lines = { cidrs: "", table: "" };
    }

    function show(rows, opts) {
      const vlsm = !!opts.vlsm;
      const cols = ["#"].concat(vlsm ? ["Name", "Hosts needed"] : [], ["Subnet", "Mask", "First usable", "Last usable", "Broadcast", "Usable hosts"]);
      setHead(cols);
      const body = $("body");
      body.textContent = "";
      const tsv = [cols.join("\t")], cidrs = [];
      const shown = Math.min(rows.length, SHOW_ROWS);
      const frag = document.createDocumentFragment();
      rows.forEach((r, idx) => {
        const info = subnetInfo(r.start, r.prefix);
        const cidr = cidrText(r.start, r.prefix);
        const fields = [String(idx + 1)].concat(vlsm ? [r.name || "", String(r.hosts)] : [], [cidr, info.mask, info.first, info.last, info.broadcast, fmt(info.hosts)]);
        tsv.push(fields.join("\t"));
        cidrs.push(cidr);
        if (idx < shown) {
          const tr = document.createElement("tr");
          let c = 0;
          cell(tr, fields[c++], "num");
          if (vlsm) { cell(tr, fields[c++], "txt"); cell(tr, fields[c++], "num"); }
          cell(tr, fields[c++]); cell(tr, fields[c++]); cell(tr, fields[c++]); cell(tr, fields[c++]); cell(tr, fields[c++]); cell(tr, fields[c++], "num");
          frag.append(tr);
        }
      });
      if (opts.free) {
        for (const f of opts.free) {
          const info = subnetInfo(f.start, f.prefix);
          const tr = document.createElement("tr");
          tr.className = "free";
          cell(tr, "", "num");
          if (vlsm) { cell(tr, "Free", "txt"); cell(tr, "", "num"); }
          cell(tr, cidrText(f.start, f.prefix)); cell(tr, info.mask); cell(tr, info.first); cell(tr, info.last); cell(tr, info.broadcast);
          cell(tr, fmt(info.hosts), "num");
          frag.append(tr);
        }
      }
      body.append(frag);
      lines = { cidrs: cidrs.join("\n"), table: tsv.join("\n") };
      $("n").textContent = fmt(rows.length);
      $("copycidr").disabled = $("copytable").disabled = rows.length === 0;
      return shown < rows.length ? ` Showing the first ${fmt(shown)}; Copy has all ${fmt(rows.length)}.` : "";
    }

    function update() {
      const mode = getMode();
      ["size", "count", "vlsm"].forEach(m => { $("opt-" + m).hidden = m !== mode; });

      const parsed = parseNetwork($("net").value);
      $("net").classList.toggle("invalid", !!parsed.error && !!$("net").value.trim());
      if (parsed.error) { clear($("net").value.trim() ? parsed.error : "Enter a network to split.", parsed.error); return; }
      const block = parsed.block;
      if (block.prefix >= 32) { clear("A /32 is a single address and cannot be split.", "A /32 cannot be split."); return; }
      if (filledFor !== block.prefix) { fillSizes(block.prefix); filledFor = block.prefix; }
      const netText = `${cidrText(block.start, block.prefix)}${parsed.normalized ? " (host bits cleared)" : ""}`;

      if (mode === "size" || mode === "count") {
        const raw = $("count").value.trim();
        const r = mode === "size" ? splitBySize(block, Number(sel.value)) : splitByCount(block, /^\d+$/.test(raw) ? Number(raw) : NaN);
        if (r.error) { clear(r.error); return; }
        const first = r.rows[0], per = subnetInfo(first.start, first.prefix);
        const more = show(r.rows, {});
        let msg = `${fmt(r.count)} subnet${r.count === 1 ? "" : "s"} of /${first.prefix}, ${fmt(per.hosts)} usable host${per.hosts === 1 ? "" : "s"} each.`;
        if (r.rounded) msg = `${fmt(r.requested)} parts rounded up to ${fmt(r.count)}. ` + msg;
        $("summary").textContent = msg + more;
        $("status").textContent = `${netText}: ${msg}`;
        return;
      }

      // VLSM
      const { reqs, bad } = parseHosts($("hosts").value);
      if (!reqs.length && !bad.length) { clear("Enter the hosts needed, one subnet per line.", `${netText}. Enter the hosts needed per subnet.`); return; }
      const plan = planVlsm(block, reqs);
      const more = show(plan.rows, { vlsm: true, free: plan.free });
      const pct = plan.total ? (plan.used / plan.total * 100) : 0;
      let msg = `${fmt(plan.rows.length)} subnet${plan.rows.length === 1 ? "" : "s"}, using ${fmt(plan.used)} of ${fmt(plan.total)} addresses (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%).`;
      const problems = [];
      if (plan.unplaced.length) problems.push(`Does not fit: ${plan.unplaced.map(u => (u.name ? u.name + " " : "") + u.hosts).join(", ")}.`);
      if (bad.length) problems.push(`Ignored: ${bad.join(", ")}.`);
      $("summary").textContent = [msg].concat(problems).join(" ") + more;
      $("status").textContent = problems.length ? problems.join(" ") : `${netText}: ${msg}`;
    }

    async function copy(text, what) {
      try {
        await navigator.clipboard.writeText(text);
        $("status").textContent = `Copied ${what}.`;
      } catch {
        const t = document.createElement("textarea");
        t.value = text;
        t.style.position = "fixed";
        t.style.opacity = "0";
        document.body.append(t);
        t.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { /* ignore */ }
        t.remove();
        $("status").textContent = ok ? `Copied ${what}.` : "Copy blocked by the browser. Select the text and press Ctrl+C.";
      }
    }

    $("net").addEventListener("input", update);
    root.querySelectorAll('input[name="splitter-mode"]').forEach(r => r.addEventListener("change", update));
    sel.addEventListener("change", update);
    $("count").addEventListener("input", update);
    let t = 0;
    $("hosts").addEventListener("input", () => { clearTimeout(t); t = setTimeout(update, 150); });
    $("copycidr").addEventListener("click", () => copy(lines.cidrs, "the subnet list"));
    $("copytable").addEventListener("click", () => copy(lines.table, "the table"));

    update();
    return { destroy() { clearTimeout(t); } };
  }

  return { init, parseNetwork, splitBySize, splitByCount, parseHosts, bitsFor, planVlsm, MAX_SUBNETS };
})();
