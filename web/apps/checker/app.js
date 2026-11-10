/* IP Checker: is an address (or subnet) covered by my list? Plus range <-> CIDR.
   Everything runs in the browser; nothing is sent to the server. */
(window.DesktopApps = window.DesktopApps || {}).checker = (() => {
  const { ipToInt, intToIp, blockOf, rangeToCidrs, mergeRanges, cidrText } = window.IPv4;
  const SHOW_ROWS = 2000;   // rows drawn in the table (Copy always has all of them)

  /* ---------- parsing (pure; also used by the tests) ---------- */

  const IP = "\\d{1,3}(?:\\.\\d{1,3}){3}";
  const TAIL = "(?![\\d]|\\.\\d)";
  const HEAD = "(?<![\\d.])";
  const BLOCK_RE = () => new RegExp(`${HEAD}(${IP})(?:/(\\d{1,2}))?${TAIL}`, "g");
  const RANGE_OR_BLOCK_RE = () => new RegExp(`${HEAD}(${IP})\\s*(?:-|\\u2013|\\u2014|\\bto\\b|\\.\\.)\\s*(${IP})${TAIL}|${HEAD}(${IP})(?:/(\\d{1,2}))?${TAIL}`, "gi");

  // every address / a.b.c.d/len found in any text -> { items: [{ start, end, prefix, text }], invalid: [token] }
  function extractBlocks(text) {
    const items = [], invalid = [];
    for (const m of String(text).matchAll(BLOCK_RE())) {
      const ip = ipToInt(m[1]);
      const prefix = m[2] === undefined ? 32 : Number(m[2]);
      if (ip === null || prefix > 32) { invalid.push(m[0]); continue; }
      const b = blockOf(ip, prefix);
      items.push({ start: b.start, end: b.end, prefix, text: m[2] === undefined ? m[1] : `${intToIp(b.start)}/${prefix}` });
    }
    return { items, invalid };
  }

  // a laminar family of subnets (nested or disjoint) in start order, each knowing its parent
  function buildIndex(blocks) {
    const sorted = blocks.slice().sort((a, b) => a.start - b.start || a.prefix - b.prefix);
    const list = [];
    for (const b of sorted) {
      const last = list[list.length - 1];
      if (last && last.start === b.start && last.prefix === b.prefix) continue;   // duplicate
      list.push({ start: b.start, end: b.end, prefix: b.prefix, parent: -1 });
    }
    const stack = [];
    list.forEach((e, i) => {
      while (stack.length && list[stack[stack.length - 1]].end < e.start) stack.pop();
      e.parent = stack.length ? stack[stack.length - 1] : -1;
      stack.push(i);
    });
    return list;
  }

  // last entry whose start <= x
  function lastAtOrBefore(list, x) {
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].start <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // does the family cover [s, e]?  { kind: "covered", by } | { kind: "partial" } | { kind: "none" }
  function lookup(list, s, e) {
    let i = lastAtOrBefore(list, s);
    // most specific entry that reaches the end of the range
    let j = i;
    while (j >= 0 && list[j].end < e) j = list[j].parent;
    if (j >= 0) return { kind: "covered", by: list[j] };
    // not fully covered: does anything overlap?
    let k = i;
    while (k >= 0 && list[k].end < s) k = list[k].parent;
    if (k >= 0) return { kind: "partial" };                       // something contains the start
    if (i + 1 < list.length && list[i + 1].start <= e) return { kind: "partial" };   // something starts inside
    return { kind: "none" };
  }

  // ranges ("a - b", "a to b"), subnets and single addresses in any text
  // -> { ranges: [[start, end]], invalid: [token] }
  function extractRanges(text) {
    const ranges = [], invalid = [];
    for (const m of String(text).matchAll(RANGE_OR_BLOCK_RE())) {
      if (m[1] !== undefined) {
        const a = ipToInt(m[1]), b = ipToInt(m[2]);
        if (a === null || b === null || a > b) { invalid.push(m[0]); continue; }
        ranges.push([a, b]);
      } else {
        const ip = ipToInt(m[3]);
        const prefix = m[4] === undefined ? 32 : Number(m[4]);
        if (ip === null || prefix > 32) { invalid.push(m[0]); continue; }
        const b = blockOf(ip, prefix);
        ranges.push([b.start, b.end]);
      }
    }
    return { ranges, invalid };
  }

  function rangesToCidrLines(ranges, merge) {
    const rs = merge ? mergeRanges(ranges) : ranges;
    const out = [];
    for (const [s, e] of rs) for (const c of rangeToCidrs(s, e)) out.push(cidrText(c.start, c.prefix));
    return out;
  }

  const rangeLines = ranges => ranges.map(([s, e]) => `${intToIp(s)} - ${intToIp(e)}`);

  /* ---------- the window ---------- */

  function init(root) {
    const $ = id => root.querySelector("#checker-" + id);
    const fmt = n => n.toLocaleString();
    const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
    const getConv = () => root.querySelector('input[name="checker-conv"]:checked').value;

    let results = [];    // last lookup results, for Copy
    let rout = "";

    /* tabs */
    const tabs = [["check", $("tab-check"), $("panel-check")], ["range", $("tab-range"), $("panel-range")]];
    function selectTab(name) {
      tabs.forEach(([n, tab, panel]) => {
        const on = n === name;
        tab.classList.toggle("on", on);
        tab.setAttribute("aria-selected", String(on));
        tab.tabIndex = on ? 0 : -1;
        panel.hidden = !on;
      });
    }
    tabs.forEach(([n, tab], i) => {
      tab.addEventListener("click", () => selectTab(n));
      tab.addEventListener("keydown", e => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        selectTab(next[0]);
        next[1].focus();
      });
    });

    /* ---- tab 1: check ---- */
    function checkUpdate() {
      const subs = extractBlocks($("subnets").value);
      const items = extractBlocks($("items").value);
      const index = buildIndex(subs.items);
      $("subcount").textContent = plural(index.length, "subnet", "subnets") + (subs.invalid.length ? `, ${fmt(subs.invalid.length)} invalid` : "");

      // each distinct entry once, in the order it first appears
      const seen = new Set(), entries = [];
      for (const it of items.items) {
        const key = `${it.start}/${it.prefix}`;
        if (!seen.has(key)) { seen.add(key); entries.push(it); }
      }
      $("itemcount").textContent = plural(entries.length, "entry", "entries") + (items.invalid.length ? `, ${fmt(items.invalid.length)} invalid` : "");

      results = entries.map(it => ({ entry: it.text, ...lookup(index, it.start, it.end) }));
      const body = $("body");
      body.textContent = "";
      const frag = document.createDocumentFragment();
      results.slice(0, SHOW_ROWS).forEach(r => {
        const tr = document.createElement("tr");
        const a = document.createElement("td"); a.textContent = r.entry;
        const b = document.createElement("td");
        b.textContent = r.kind === "covered" ? "Covered" : r.kind === "partial" ? "Partly covered" : "Not covered";
        b.className = r.kind === "covered" ? "ok" : r.kind === "partial" ? "partial" : "no";
        const c = document.createElement("td"); c.textContent = r.kind === "covered" ? cidrText(r.by.start, r.by.prefix) : "";
        tr.append(a, b, c);
        frag.append(tr);
      });
      body.append(frag);

      const covered = results.filter(r => r.kind === "covered").length;
      const partial = results.filter(r => r.kind === "partial").length;
      const none = results.length - covered - partial;
      $("copyresults").disabled = results.length === 0;
      $("copyuncovered").disabled = none === 0;
      if (!results.length) {
        $("summary").textContent = index.length ? "Add the addresses or subnets to look up." : "Paste a list of subnets and the addresses to look up.";
        $("status").textContent = $("summary").textContent;
      } else if (!index.length) {
        $("summary").textContent = "Your subnet list is empty, so nothing can be covered yet.";
        $("status").textContent = $("summary").textContent;
      } else {
        const more = results.length > SHOW_ROWS ? ` Showing the first ${fmt(SHOW_ROWS)}; Copy has all.` : "";
        $("summary").textContent = `${fmt(covered)} covered, ${fmt(none)} not covered` + (partial ? `, ${fmt(partial)} partly covered` : "") + `.${more}`;
        $("status").textContent = `Checked ${plural(results.length, "entry", "entries")} against ${plural(index.length, "subnet", "subnets")}.`;
      }
    }

    /* ---- tab 2: range converter ---- */
    function rangeUpdate() {
      const conv = getConv();
      $("mergewrap").hidden = conv !== "r2c";
      $("rinlabel").textContent = conv === "r2c"
        ? "Ranges like 10.0.0.5 - 10.0.0.200, one per line or in any text. Single addresses and subnets work too."
        : "Subnets like 10.0.0.0/24, one per line or in any text.";
      $("routlabel").textContent = conv === "r2c" ? "The fewest CIDR blocks that cover the ranges exactly." : "Each subnet as first address - last address.";
      const { ranges, invalid } = extractRanges($("rin").value);
      $("rincount").textContent = plural(ranges.length, "entry", "entries") + (invalid.length ? `, ${fmt(invalid.length)} invalid` : "");
      const lines = conv === "r2c" ? rangesToCidrLines(ranges, $("merge").checked) : rangeLines(ranges);
      rout = lines.join("\n");
      $("rout").value = rout;
      $("routcount").textContent = plural(lines.length, "line", "lines");
      $("rcopy").disabled = lines.length === 0;
      if (!$("rin").value.trim()) $("status").textContent = "Ready";
      else if (invalid.length) $("status").textContent = `Skipped ${fmt(invalid.length)} invalid: ${invalid.slice(0, 5).join(", ")}${invalid.length > 5 ? ", ..." : ""}`;
      else $("status").textContent = conv === "r2c" ? `${plural(ranges.length, "entry", "entries")} became ${plural(lines.length, "CIDR block", "CIDR blocks")}.` : `${plural(lines.length, "subnet", "subnets")} converted.`;
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

    let t1 = 0, t2 = 0;
    const later = (fn, which) => () => { clearTimeout(which === 1 ? t1 : t2); const id = setTimeout(fn, 150); if (which === 1) t1 = id; else t2 = id; };
    $("subnets").addEventListener("input", later(checkUpdate, 1));
    $("items").addEventListener("input", later(checkUpdate, 1));
    $("rin").addEventListener("input", later(rangeUpdate, 2));
    $("merge").addEventListener("change", rangeUpdate);
    root.querySelectorAll('input[name="checker-conv"]').forEach(r => r.addEventListener("change", rangeUpdate));

    const label = k => (k === "covered" ? "Covered" : k === "partial" ? "Partly covered" : "Not covered");
    $("copyresults").addEventListener("click", () =>
      copy(["Entry\tResult\tCovered by"].concat(results.map(r => `${r.entry}\t${label(r.kind)}\t${r.kind === "covered" ? cidrText(r.by.start, r.by.prefix) : ""}`)).join("\n"), "the results"));
    $("copyuncovered").addEventListener("click", () => {
      const list = results.filter(r => r.kind === "none").map(r => r.entry);
      copy(list.join("\n"), `${plural(list.length, "entry", "entries")} not covered`);
    });
    $("rcopy").addEventListener("click", () => copy(rout, "the output"));

    checkUpdate();
    rangeUpdate();
    $("status").textContent = "Ready";
    return { destroy() { clearTimeout(t1); clearTimeout(t2); } };
  }

  return { init, extractBlocks, buildIndex, lookup, extractRanges, rangesToCidrLines, rangeLines };
})();
