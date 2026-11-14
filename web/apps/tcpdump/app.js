/* tcpdump & Wireshark Filters. All the reading, building and translating is in lib/pcapfilter.js; this file shows it and collects the choices.
 * Nothing is sent anywhere. Text reaches the page only through textContent. */
(window.DesktopApps = window.DesktopApps || {}).tcpdump = (() => {
  function init(root) {
    const $ = id => root.querySelector("#tcpdump-" + id);
    const PF = window.PcapFilter, TK = window.TK;
    const setStatus = m => { $("status").textContent = m; };
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

    /* ------------------------------------------------------------ what can be added */
    const TYPES = [["port", "Port"], ["host", "Address (IP or host name)"], ["net", "Network (a range of addresses)"], ["proto", "Protocol"], ["tcpflags", "TCP flags (SYN, ACK, RST ...)"], ["icmp", "ICMP / ICMPv6 message"], ["mac", "MAC address"], ["vlan", "VLAN"], ["size", "Packet size"], ["cast", "Broadcast or multicast"], ["ttl", "TTL / hop limit"], ["dscp", "DSCP (QoS class)"], ["frag", "IPv4 fragments / don't-fragment"], ["raw", "My own filter text"]];
    const DIRS = [["any", "From or to"], ["src", "From (the sender)"], ["dst", "To (the receiver)"]];
    const PORT_DIRS = [["any", "Either side"], ["src", "Sender's port"], ["dst", "Receiver's port"]];
    const IPV = [["both", "IPv4 and IPv6"], ["4", "IPv4 only"], ["6", "IPv6 only"]];
    const PROTOS = [
      ["Common", [["tcp", "TCP"], ["udp", "UDP"], ["icmp", "ICMP (IPv4)"], ["icmp6", "ICMPv6"], ["arp", "ARP"], ["ip", "All IPv4"], ["ip6", "All IPv6"]]],
      ["Tunnels and routing", [["esp", "IPsec ESP"], ["ah", "IPsec AH"], ["gre", "GRE"], ["ospf", "OSPF"], ["vrrp", "VRRP"], ["eigrp", "EIGRP"], ["igmp", "IGMP"], ["pim", "PIM"], ["sctp", "SCTP"], ["ipip", "IP-in-IP"], ["l2tp", "L2TP (over IP)"], ["num", "Another IP protocol number ..."]]],
      ["Link layer", [["stp", "Spanning tree (STP)"], ["lldp", "LLDP"], ["lacp", "LACP"], ["pppoe-discovery", "PPPoE discovery"], ["pppoe-session", "PPPoE session"], ["mpls", "MPLS"]]],
    ];
    const FLAG_KEYS = [["syn", "SYN"], ["ack", "ACK"], ["fin", "FIN"], ["rst", "RST"], ["push", "PSH"], ["urg", "URG"], ["ece", "ECE"], ["cwr", "CWR"]];
    const FLAG_PRESETS = [["New connections (SYN only)", { syn: "set", ack: "clear" }], ["Answers to new connections (SYN + ACK)", { syn: "set", ack: "set" }], ["Resets (RST)", { rst: "set" }], ["Closing (FIN)", { fin: "set" }], ["No flags at all (scan)", { fin: "clear", syn: "clear", rst: "clear", push: "clear", ack: "clear", urg: "clear" }], ["FIN + PSH + URG (\"Xmas\" scan)", { fin: "set", push: "set", urg: "set" }]];
    const DEFAULTS = {
      host: { dir: "any", value: "" }, net: { dir: "any", value: "" }, port: { proto: "any", dir: "any", value: "" }, proto: { value: "tcp", num: "" }, mac: { dir: "any", value: "" }, vlan: { value: "" },
      tcpflags: { ip: "both", flags: { syn: "set", ack: "clear" } }, icmp: { ver: "4", type: "8", code: "" }, size: { op: "greater", value: "1400" }, dscp: { ip: "both", value: "46" },
      ttl: { ip: "both", op: "<", value: "5" }, cast: { value: "broadcast" }, frag: { value: "any" }, raw: { value: "" },
    };
    const newRow = t => Object.assign({ t, not: false }, JSON.parse(JSON.stringify(DEFAULTS[t])));
    const EXAMPLES = ["port 80 or 443", "host 10.0.0.1 or host 10.0.0.2 and port 80", "not host 10.0.0.1 and 10.0.0.2", "tcp[tcpflags] & (tcp-syn|tcp-ack) = tcp-syn", "tcp dst port 22 and src net 10.0.0.0/8", "icmp[icmptype] != icmp-echo and icmp[icmptype] != icmp-echoreply", "ip[6:2] & 0x3fff != 0", "tcp[((tcp[12] & 0xf0) >> 2):4] = 0x47455420", "vlan 100 and tcp port 443", "udp port 500 or 4500 or esp"];
    const RECIPE_DISPLAY = new Map(PF.RECIPES.filter(r => r.display).map(r => [r.bpf, r.display]));

    /* ------------------------------------------------------------ state */
    let spec = { op: "and", items: [Object.assign(newRow("port"), { proto: "tcp", value: "443" })] };
    let mode = "build", cmdOpts = null, current = { bpf: "", wsh: null };
    const probEls = new Map();

    /* ------------------------------------------------------------ the builder */
    const refreshSoon = TK.debounce(() => refresh(), 120);
    const changed = () => refreshSoon();
    const fld = (label, control, cls) => { const l = el("label", "tk-fld" + (cls ? " " + cls : "")); l.append(el("b", null, label), control); return l; };
    function textIn(row, key, ph, cls, label) {
      const i = el("input", "xp-field " + (cls || "tk-wide")); i.type = "text"; i.value = row[key] == null ? "" : row[key]; i.maxLength = 300; i.autocomplete = "off"; i.spellcheck = false; i.autocapitalize = "off";
      if (ph) i.placeholder = ph; i.setAttribute("aria-label", label);
      i.addEventListener("input", () => { row[key] = i.value; changed(); }); return i;
    }
    function selectIn(row, key, opts, label, after) {
      const s = el("select", "xp-select"); s.setAttribute("aria-label", label);
      const add = (parent, [v, t]) => { const o = el("option", null, t); o.value = v; parent.append(o); };
      for (const o of opts) { if (Array.isArray(o[1])) { const g = el("optgroup"); g.label = o[0]; for (const x of o[1]) add(g, x); s.append(g); } else add(s, o); }
      s.value = row[key]; s.addEventListener("change", () => { row[key] = s.value; if (after) after(); changed(); }); return s;
    }
    function rowFields(row, rerender) {
      const out = [];
      switch (row.t) {
        case "host": out.push(fld("Direction", selectIn(row, "dir", DIRS, "Direction")), fld("IP address or host name", textIn(row, "value", "10.0.0.1  or  2001:db8::1", "tk-wide", "Address"))); break;
        case "net": out.push(fld("Direction", selectIn(row, "dir", DIRS, "Direction")), fld("Network (address/length)", textIn(row, "value", "10.0.0.0/8  or  2001:db8::/32", "tk-wide", "Network"))); break;
        case "port": out.push(fld("Protocol", selectIn(row, "proto", [["any", "TCP, UDP and SCTP"], ["tcp", "TCP"], ["udp", "UDP"], ["sctp", "SCTP"]], "Protocol")), fld("Which side", selectIn(row, "dir", PORT_DIRS, "Which side")), fld("Port numbers (several: 80,443  a range: 8000-8100)", textIn(row, "value", "443", "tk-wide", "Ports"))); break;
        case "proto": {
          const num = fld("Protocol number (0 to 255)", textIn(row, "num", "47", "tk-narrow", "Protocol number")); num.hidden = row.value !== "num";
          out.push(fld("Protocol", selectIn(row, "value", PROTOS, "Protocol", () => { num.hidden = row.value !== "num"; })), num); break;
        }
        case "mac": out.push(fld("Direction", selectIn(row, "dir", DIRS, "Direction")), fld("MAC address", textIn(row, "value", "aa:bb:cc:dd:ee:ff", "tk-wide", "MAC address"))); break;
        case "vlan": out.push(fld("VLAN ID (empty = any tagged frame)", textIn(row, "value", "100", "tk-narrow", "VLAN ID"))); break;
        case "size": out.push(fld("Frame is", selectIn(row, "op", [["greater", "at least"], ["less", "at most"]], "At least or at most")), fld("Bytes (the whole frame, headers included)", textIn(row, "value", "1400", "tk-narrow", "Bytes"))); break;
        case "cast": out.push(fld("Which", selectIn(row, "value", [["broadcast", "Ethernet broadcast"], ["multicast", "Any multicast (Ethernet, IPv4 or IPv6)"], ["ip-multicast", "IPv4 multicast"], ["ip6-multicast", "IPv6 multicast"], ["ip-broadcast", "IPv4 broadcast address"]], "Which"))); break;
        case "frag": out.push(fld("Which", selectIn(row, "value", [["any", "Fragmented IPv4 packets (pieces of a bigger packet)"], ["df", "IPv4 packets with the don't-fragment flag"]], "Which"))); break;
        case "ttl": out.push(fld("Applies to", selectIn(row, "ip", IPV, "IP version")), fld("TTL (IPv4) or hop limit (IPv6) is", selectIn(row, "op", [["<", "less than"], ["<=", "at most"], ["=", "exactly"], [">", "more than"], [">=", "at least"]], "Comparison")), fld("Value (0 to 255)", textIn(row, "value", "5", "tk-narrow", "Value"))); break;
        case "dscp": out.push(fld("Applies to", selectIn(row, "ip", IPV, "IP version")), fld("DSCP value (0 to 63; 46 = EF, voice)", textIn(row, "value", "46", "tk-narrow", "DSCP"))); break;
        case "raw": out.push(fld("Filter text (tcpdump syntax)", textIn(row, "value", "ip[8] < 5 and icmp", "tk-wide", "Filter text"))); break;
        case "icmp": {
          const types = el("input", "xp-field tk-wide"); types.type = "text"; types.value = row.type; types.maxLength = 3; types.setAttribute("aria-label", "Message type"); types.autocomplete = "off"; types.placeholder = "any type";
          const listId = "tcpdump-icmp" + row.ver + "-" + Math.random().toString(36).slice(2, 7); const dl = el("datalist"); dl.id = listId; const map = row.ver === "6" ? PF.ICMP6 : PF.ICMP4;
          for (const k of Object.keys(map)) { const o = el("option"); o.value = k; o.label = map[k]; dl.append(o); } types.setAttribute("list", listId);
          types.addEventListener("input", () => { row.type = types.value; changed(); });
          out.push(fld("Version", selectIn(row, "ver", [["4", "ICMP (IPv4)"], ["6", "ICMPv6"]], "Version", () => { row.type = ""; row.code = ""; rerender(); })), fld("Message type (number; the list helps)", types), dl, fld("Code (optional)", textIn(row, "code", "", "tk-narrow", "Code"))); break;
        }
        case "tcpflags": {
          out.push(fld("Applies to", selectIn(row, "ip", IPV, "IP version")));
          const preset = el("select", "xp-select"); preset.setAttribute("aria-label", "Preset"); const first = el("option", null, "Presets ..."); first.value = ""; preset.append(first);
          FLAG_PRESETS.forEach(([n], i) => { const o = el("option", null, n); o.value = String(i); preset.append(o); });
          preset.addEventListener("change", () => { if (preset.value !== "") { row.flags = Object.assign({}, FLAG_PRESETS[+preset.value][1]); rerender(); changed(); } });
          out.push(fld("Start from", preset));
          const grid = el("div", "tdf-flags"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "TCP flags");
          for (const [k, name] of FLAG_KEYS) {
            const s = el("select", "xp-select"); s.setAttribute("aria-label", name + " flag");
            for (const [v, t] of [["any", "don't care"], ["set", "must be set"], ["clear", "must be clear"]]) { const o = el("option", null, t); o.value = v; s.append(o); }
            s.value = (row.flags && row.flags[k]) || "any";
            s.addEventListener("change", () => { row.flags = row.flags || {}; if (s.value === "any") delete row.flags[k]; else row.flags[k] = s.value; changed(); });
            const l = el("label"); l.append(el("b", null, name), s); grid.append(l);
          }
          out.push(grid); break;
        }
      }
      return out;
    }
    function renderRow(items, idx, path, rerender) {
      const row = items[idx], box = el("div", "tdf-row" + (row.not ? " is-not" : ""));
      const nl = el("label", "tdf-chk"), nc = el("input", "xp-check"); nc.type = "checkbox"; nc.checked = !!row.not; nc.setAttribute("aria-label", "NOT: catch everything except this condition");
      nc.addEventListener("change", () => { row.not = nc.checked; box.classList.toggle("is-not", row.not); changed(); }); nl.append(nc, document.createTextNode("NOT"));
      const ts = el("select", "xp-select"); ts.setAttribute("aria-label", "Kind of condition");
      for (const [v, t] of TYPES) { const o = el("option", null, t); o.value = v; ts.append(o); } ts.value = row.t;
      ts.addEventListener("change", () => { items[idx] = Object.assign(newRow(ts.value), { not: row.not }); rerender(); changed(); });
      const rm = el("button", "xp-btn small", "Remove"); rm.type = "button"; rm.addEventListener("click", () => { items.splice(idx, 1); rerender(); refresh(); });
      box.append(nl, fld("Condition", ts));
      for (const f of rowFields(row, rerender)) box.append(f);
      box.append(rm);
      const prob = el("p", "tdf-problem"); prob.hidden = true; prob.setAttribute("role", "alert"); box.append(prob); probEls.set(path.join("."), prob);
      return box;
    }
    function addControls(items, allowGroup, rerender) {
      const wrap = el("div", "tk-row"), sel = el("select", "xp-select"); sel.setAttribute("aria-label", "Kind of condition to add");
      for (const [v, t] of TYPES) { const o = el("option", null, t); o.value = v; sel.append(o); }
      const add = el("button", "xp-btn", "Add condition"); add.type = "button"; add.addEventListener("click", () => { items.push(newRow(sel.value)); rerender(); refresh(); });
      wrap.append(sel, add);
      if (allowGroup) { const g = el("button", "xp-btn", "Add a group (A or B) ..."); g.type = "button"; g.addEventListener("click", () => { items.push({ g: true, op: "or", not: false, items: [newRow("host"), newRow("host")] }); rerender(); refresh(); }); wrap.append(g); }
      return wrap;
    }
    function renderItems(container, items, basePath) {
      const rerender = () => renderAll();
      items.forEach((it, i) => {
        const path = basePath.concat(i);
        if (!it.g) { container.append(renderRow(items, i, path, rerender)); return; }
        const g = el("div", "tdf-group"), head = el("div", "tdf-head");
        const nl = el("label", "tdf-chk"), nc = el("input", "xp-check"); nc.type = "checkbox"; nc.checked = !!it.not; nc.setAttribute("aria-label", "NOT: catch everything except this group");
        nc.addEventListener("change", () => { it.not = nc.checked; changed(); }); nl.append(nc, document.createTextNode("NOT"));
        const op = el("select", "xp-select"); op.setAttribute("aria-label", "Group: all or any");
        for (const [v, t] of [["or", "ANY ONE of these"], ["and", "ALL of these"]]) { const o = el("option", null, t); o.value = v; op.append(o); } op.value = it.op;
        op.addEventListener("change", () => { it.op = op.value; changed(); });
        const rm = el("button", "xp-btn small", "Remove the group"); rm.type = "button"; rm.addEventListener("click", () => { items.splice(i, 1); renderAll(); refresh(); });
        head.append(nl, fld("A group: a packet matches", op), rm); g.append(head);
        const inner = el("div"); renderItems(inner, it.items, path); g.append(inner, addControls(it.items, false, rerender));
        container.append(g);
      });
    }
    function renderAll() {
      probEls.clear(); const rows = $("rows"); rows.textContent = "";
      if (!spec.items.length) rows.append(el("p", "tk-muted", "No conditions yet: add one below, or open a recipe."));
      renderItems(rows, spec.items, []);
      $("op").value = spec.op;
    }
    // the model with "another IP protocol number" turned into the form the library reads
    const forLib = list => list.map(r => r.g ? Object.assign({}, r, { items: forLib(r.items) }) : r.t === "proto" && r.value === "num" ? Object.assign({}, r, { value: "num:" + String(r.num || "").trim() }) : r);

    /* ------------------------------------------------------------ the result */
    function showWords(e) {
      const box = $("words"); box.textContent = "";
      box.append(el("div", "tdf-line lead", e.head));
      for (const l of e.lines) box.append(el("div", "tdf-line d" + Math.min(6, l.d + 1), (l.d || e.lines.length > 1 ? "• " : "") + l.text));
    }
    function renderCommands() {
      if (!current.bpf) { $("cmds").textContent = ""; return; }
      const mode2 = $("out").value, file = $("file").value.trim();
      $("rotrow").hidden = mode2 !== "save"; $("file").disabled = mode2 === "screen";
      const o = { iface: $("iface").value, count: $("count").value, dir: $("dir").value, verbose: $("verbose").value, dump: $("dump").value, time: $("time").value, nn: $("nn").checked, snap0: $("snap0").checked, link: $("link").checked, line: $("line").checked, sudo: $("sudo").checked, tsharkDisplay: $("tsd").checked,
        file: mode2 === "save" ? file : "", read: mode2 === "read" ? file : "", rot: $("rot").value, rotSize: $("rotsize").value, rotSecs: $("rotsecs").value, rotFiles: $("rotfiles").value };
      if (mode2 === "read" && !file) { TK.notes($("cmderr"), [{ level: "warn", text: "Type the name of the saved capture file to read." }]); $("cmds").textContent = ""; return; }
      if (mode2 === "save" && !file) o.file = "capture.pcap";
      const c = PF.commands(o, current.bpf, { text: current.wsh });
      TK.notes($("cmderr"), c.errors.map(t => ({ level: "bad", text: t })));
      if (c.errors.length) { $("cmds").textContent = ""; return; }
      TK.render($("cmds"), c.list.map(x => ({ title: x.label, rows: [["Command", x.text, x.hint]], mono: true })), { copy: true, status: setStatus });
    }
    function showResult(ast, notes, override) {
      const bpf = PF.print(ast), e = PF.explain(ast), d = PF.display(ast);
      const wsh = override || d.text;
      current = { bpf, wsh };
      $("bpf").textContent = bpf; $("livebpf").textContent = bpf; $("live").hidden = mode !== "build"; showWords(e);
      $("wsh").textContent = wsh || "No Wireshark display filter is offered for this one.";
      $("copywsh").hidden = !wsh;
      TK.notes($("wshnotes"), wsh && override && !d.text ? [{ level: "info", text: "A display filter is applied after capturing (it hides packets); the capture filter above decides what is captured at all." }] : d.notes);
      TK.notes($("notes"), (notes || []).concat(e.notes));
      $("result").hidden = false; renderCommands();
    }
    function hideResult(msg) { current = { bpf: "", wsh: null }; $("result").hidden = true; $("live").hidden = true; setStatus(msg || "Ready"); }
    function refresh() {
      if (mode === "recipes") { $("result").hidden = true; $("live").hidden = true; return; }
      if (mode === "build") {
        spec.op = $("op").value === "or" ? "or" : "and";
        const b = PF.build({ op: spec.op, items: forLib(spec.items) });
        for (const p of probEls.values()) { p.hidden = true; p.textContent = ""; }
        for (const p of b.problems) { const e = probEls.get(p.path.join(".")); if (e) { e.textContent = p.msg; e.hidden = false; } }
        if (!b.ast) { hideResult(b.problems.length ? "Fix the marked conditions to see the filter." : "Add a condition to build a filter."); return; }
        const notes = b.notes.slice(); if (b.problems.length) notes.unshift({ level: "warn", text: "Some conditions have a problem and are left out of the filter until you fix them." });
        showResult(b.ast, notes); setStatus("Done."); return;
      }
      const text = $("filter").value, r = PF.parse(text), err = $("err");
      err.hidden = true; err.textContent = "";
      if (r.empty) { hideResult("Type or paste a filter."); return; }
      if (!r.ok) {
        const e = r.errors[0]; err.textContent = text.replace(/\s+$/, "") + "\n" + " ".repeat(Math.min(Math.max(0, e.pos), 400)) + "^ " + e.msg; err.hidden = false; hideResult("This is not a filter I can read."); return;
      }
      showResult(r.ast, r.warnings, RECIPE_DISPLAY.get(text.trim())); setStatus("Done.");
    }

    /* ------------------------------------------------------------ recipes */
    function renderRecipes() {
      const q = $("rsearch").value.trim().toLowerCase(), box = $("recipes"); box.textContent = ""; let group = null, shown = 0;
      for (const r of PF.RECIPES) {
        if (q && !(r.title + " " + r.desc + " " + r.group + " " + r.bpf).toLowerCase().includes(q)) continue;
        shown++;
        if (r.group !== group) { group = r.group; box.append(el("h3", "tdf-group-title", group)); }
        const c = el("div", "tdf-card"); c.append(el("h4", null, r.title), el("p", null, r.desc), el("code", "tdf-code", r.bpf));
        const row = el("div", "tk-row");
        const b1 = el("button", "xp-btn", "Explain it"); b1.type = "button"; b1.addEventListener("click", () => { $("filter").value = r.bpf; selectTab("explain"); });
        const b2 = el("button", "xp-btn", "Add to the builder"); b2.type = "button"; b2.addEventListener("click", () => { spec.items.push({ t: "raw", not: false, value: r.bpf }); renderAll(); selectTab("build"); setStatus("Added to the builder."); });
        const b3 = el("button", "xp-btn", "Copy"); b3.type = "button"; b3.addEventListener("click", () => TK.copy(r.bpf, setStatus));
        row.append(b1, b2, b3); c.append(row); box.append(c);
      }
      if (!shown) box.append(el("p", "tk-muted", "No recipe matches that."));
    }

    /* ------------------------------------------------------------ tabs and wiring */
    const tabs = [["build", $("tab-build"), $("panel-build")], ["explain", $("tab-explain"), $("panel-explain")], ["recipes", $("tab-recipes"), $("panel-recipes")]];
    function selectTab(name) {
      mode = name;
      tabs.forEach(([n, tab, panel]) => { const on = n === name; tab.classList.toggle("on", on); tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1; panel.hidden = !on; });
      refresh();
    }
    tabs.forEach(([n, tab], i) => {
      tab.addEventListener("click", () => selectTab(n));
      tab.addEventListener("keydown", e => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; selectTab(next[0]); next[1].focus(); });
    });
    for (const [t, n] of TYPES) { const o = el("option", null, n); o.value = t; $("addtype").append(o); }
    $("add").addEventListener("click", () => { spec.items.push(newRow($("addtype").value)); renderAll(); refresh(); });
    $("addgroup").addEventListener("click", () => { spec.items.push({ g: true, op: "or", not: false, items: [newRow("host"), newRow("host")] }); renderAll(); refresh(); });
    $("reset").addEventListener("click", () => { spec = { op: "and", items: [] }; renderAll(); refresh(); });
    $("op").addEventListener("change", () => { spec.op = $("op").value; refresh(); });
    const first = el("option", null, "Choose an example ..."); first.value = ""; $("example").append(first);
    for (const x of EXAMPLES) { const o = el("option", null, x); o.value = x; $("example").append(o); }
    $("example").addEventListener("change", () => { if ($("example").value) { $("filter").value = $("example").value; refresh(); } });
    $("filter").addEventListener("input", TK.debounce(() => { $("example").value = ""; refresh(); }, 150));
    $("tobuilder").addEventListener("click", () => { const t = $("filter").value.trim(); if (!PF.parse(t).ok) { setStatus("That filter cannot be read yet, so it cannot be added."); return; } spec.items.push({ t: "raw", not: false, value: t }); renderAll(); selectTab("build"); setStatus("Added to the builder as your own filter text."); });
    $("rsearch").addEventListener("input", TK.debounce(renderRecipes, 120));
    $("copybpf").addEventListener("click", () => TK.copy(current.bpf, setStatus));
    $("copylive").addEventListener("click", () => TK.copy(current.bpf, setStatus));
    $("copywsh").addEventListener("click", () => { if (current.wsh) TK.copy(current.wsh, setStatus); });
    for (const id of ["iface", "count", "file", "rotsize", "rotsecs", "rotfiles"]) $(id).addEventListener("input", TK.debounce(renderCommands, 120));
    for (const id of ["dir", "verbose", "dump", "time", "nn", "snap0", "link", "line", "sudo", "tsd", "out", "rot"]) $(id).addEventListener("change", renderCommands);

    renderAll(); renderRecipes(); refresh();
    return { destroy() {} };
  }
  return { init };
})();
