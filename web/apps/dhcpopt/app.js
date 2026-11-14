/* DHCP Option Helper. The encoders, decoders and server lines are in lib/dhcpopt.js; this file only shows them.
   Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).dhcpopt = (() => {
  // example values per kind of option; also what the help line says
  const HELP = {
    ip: ["One IPv4 address.", "192.168.1.1"], ips: ["One or more IPv4 addresses, separated by commas or spaces.", "1.1.1.1, 8.8.8.8"], pairs: ["Pairs of addresses, written one after the other.", "10.0.0.0, 10.0.0.1"],
    text: ["Plain text.", "example.com"], bool: ["yes or no.", "yes"], u8: ["A whole number, 0 to 255.", "64"], u16: ["A whole number, 0 to 65535.", "1492"], i32: ["Seconds from UTC, negative for west.", "3600"],
    secs: ["Seconds, or a time such as 12h, 30m, 1d 12h, or the word infinite.", "12h"], u16list: ["Numbers separated by commas.", "296, 508, 1006"], msgtype: ["A message type: DISCOVER, OFFER, REQUEST, ACK ...", "ACK"],
    nbnt: ["1, 2, 4 or 8.", "8"], overload: ["1 (file), 2 (sname) or 3 (both).", "1"], arch: ["The architecture number (0 = BIOS, 7 = EFI x64, 9 = EFI x86-64).", "7"], prl: ["Option numbers the client wants, separated by commas.", "1, 3, 6, 15, 42, 121"],
    domains: ["Domain names, separated by commas, spaces or new lines.", "example.com, corp.example.com"], routes: ["One route per line: network/length via gateway. Use \"default via ...\" for the default route.", "default via 192.168.1.1\n10.10.0.0/16 via 192.168.1.2\n172.16.5.0/24 via 192.168.1.3"],
    vendor: ["Sub-options, one per line: code kind value. Kinds: text, ip, ips, u8, u16, u32, hex.", "241 ips 192.168.10.5 192.168.10.6"], vendor125: ["Start with a line \"enterprise NUMBER\", then the sub-options of that vendor, one per line: code kind value.", "enterprise 3561\n4 text 00D09E\n5 text SN123456\n6 text IGD"],
    agent: ["Sub-options, one per line: code kind value. 1 = circuit ID, 2 = remote ID.", "1 hex 00:04:00:64:01:02\n2 hex 00:06:aa:bb:cc:dd:ee:ff"],
    clientid: ["A MAC address (type 01 is added), or the type and value in hex.", "aa:bb:cc:dd:ee:ff"], fqdn: ["The client's name.", "pc1.example.com"], hex: ["Hex bytes.", "de ad be ef"], empty: ["This option has no value.", ""],
  };
  const PRESETS = [["", "(choose an example)"], ["43|241 ips 192.168.10.5 192.168.10.6", "43: Cisco access points find their controller (f1)"], ["43|1 ip 192.168.1.10", "43: Ubiquiti UniFi controller (sub-option 1)"], ["121|default via 192.168.1.1\n10.10.0.0/16 via 192.168.1.2", "121: default route and one more route"],
    ["82|1 hex 00:04:00:64:01:02\n2 hex 00:06:aa:bb:cc:dd:ee:ff", "82: circuit ID (VLAN 100, module 1, port 2) and remote ID (MAC)"], ["125|enterprise 3561\n4 text 00D09E\n5 text SN123456\n6 text IGD", "125: TR-069 gateway identification (Broadband Forum)"], ["150|10.1.1.1, 10.1.1.2", "150: Cisco TFTP servers (IP phones)"],
    ["66|tftp.example.com", "66: boot server name"], ["67|pxelinux.0", "67: boot file name"], ["119|example.com, corp.example.com", "119: domain search list"], ["6|1.1.1.1, 8.8.8.8", "6: DNS servers"], ["42|10.0.0.1", "42: NTP server"], ["26|1492", "26: interface MTU"], ["114|https://portal.example.com/api", "114: captive portal URI"]];
  function init(root) {
    const $ = id => root.querySelector("#dhcpopt-" + id);
    const D = window.DhcpOpt, TK = window.TK, setStatus = m => { $("status").textContent = m; };
    const codes = Object.keys(D.OPTIONS).map(Number).filter(c => c !== 0 && c !== 255).sort((a, b) => a - b);
    for (const id of ["bopt", "ropt"]) { const s = $(id); for (const c of codes) { const o = document.createElement("option"); o.value = String(c); o.textContent = c + "  " + D.OPTIONS[c].n; s.append(o); } }
    for (const [v, t] of PRESETS) { const o = document.createElement("option"); o.value = v; o.textContent = t; $("bpreset").append(o); }
    $("bopt").value = "121"; $("ropt").value = "121";

    /* -------------------------------------------------------- build */
    function build() {
      const code = Number($("bopt").value), opt = D.OPTIONS[code], h = HELP[opt.t] || ["", ""];
      $("bvallabel").textContent = "Value: " + opt.n;
      $("bhelp").textContent = (opt.d ? opt.d + " " : "") + h[0] + (opt.rfc ? " (" + opt.rfc + ")" : "");
      $("bval").placeholder = h[1];
      const out = $("bout"); out.textContent = "";
      if (!$("bval").value.trim() && opt.t !== "empty") { TK.notes($("bnotes"), []); return; }
      const r = D.encode(code, $("bval").value);
      if (r.error) { TK.notes($("bnotes"), [{ level: "bad", text: r.error }]); return; }
      TK.notes($("bnotes"), r.notes);
      const back = D.decode(code, r.bytes), hex = D.bytesToHex(r.bytes), whole = D.bytesToHex([code, Math.min(255, r.bytes.length)].concat(r.bytes.length <= 255 ? r.bytes : []));
      const secs = [{ title: "On the wire", rows: [["Value bytes", hex || "(none)", r.bytes.length + " byte" + (r.bytes.length === 1 ? "" : "s")], ["Whole option (number, length, value)", r.bytes.length <= 255 ? whole : "too long for one option: " + r.bytes.length + " bytes", "option " + code + ", length " + r.bytes.length], ["Colon form", D.bytesToHex(r.bytes, ":") || "(none)"], ["Read back", back.text || "(empty)", "decoded again from those bytes, to check it says what you meant"]], mono: true }];
      TK.render(out, secs, { copy: true, status: setStatus });
      const box = document.createElement("div"); const hd = document.createElement("h3"); hd.textContent = "Server configuration"; box.append(hd);
      const note = document.createElement("p"); note.className = "tk-muted"; note.textContent = "Starting points: check the exact syntax against the manual of the version you run."; box.append(note);
      for (const c of D.configFor(code, r.bytes)) {
        const head = document.createElement("div"); head.className = "dho-conf-head"; const t = document.createElement("span"); t.textContent = c.name; const b = document.createElement("button"); b.type = "button"; b.className = "xp-btn small"; b.textContent = "Copy"; b.addEventListener("click", () => TK.copy(c.text, setStatus)); head.append(t, b);
        const pre = document.createElement("code"); pre.className = "dho-conf"; pre.textContent = c.text; box.append(head, pre);
      }
      out.append(box);
    }
    $("bopt").addEventListener("change", () => { $("bval").value = ""; $("bpreset").value = ""; build(); });
    $("bval").addEventListener("input", TK.debounce(build, 150));
    $("bpreset").addEventListener("change", () => { const v = $("bpreset").value; if (!v) return; const i = v.indexOf("|"); $("bopt").value = v.slice(0, i); $("bval").value = v.slice(i + 1); build(); });

    /* -------------------------------------------------------- read bytes */
    function showDecoded(box, notesBox, d) {
      box.textContent = "";
      TK.notes(notesBox, d.notes || []);
      const rows = [["Meaning", d.text || "(empty)"]];
      if (d.lines && d.lines.length > 1) d.lines.forEach((l, i) => rows.push([i === 0 ? "Parts" : "", l]));
      TK.render(box, [{ title: "Read", rows }], { copy: false });
    }
    function read() {
      const box = $("rout"), h = D.hexToBytes($("rhex").value); box.textContent = "";
      if (!$("rhex").value.trim()) { TK.notes($("rnotes"), []); return; }
      if (h.error) { TK.notes($("rnotes"), [{ level: "bad", text: h.error }]); return; }
      showDecoded(box, $("rnotes"), D.decode(Number($("ropt").value), h.bytes));
    }
    $("ropt").addEventListener("change", read); $("rhex").addEventListener("input", TK.debounce(read, 150));

    /* -------------------------------------------------------- message */
    function message() {
      const box = $("mout"); box.textContent = ""; $("msum").textContent = "";
      const text = $("mhex").value;
      if (!text.trim()) { TK.notes($("mnotes"), []); return; }
      const P = window.PktDecode;
      const h = P ? P.parseHex(text) : D.hexToBytes(text);
      if (h.error) { TK.notes($("mnotes"), [{ level: "bad", text: h.error }]); return; }
      let bytes = Array.from(h.bytes), where = "";
      const looksDhcp = bytes.length >= 240 && bytes[236] === 0x63 && bytes[237] === 0x82 && bytes[238] === 0x53 && bytes[239] === 0x63;
      if (!looksDhcp && P) {
        const d = P.decode(Uint8Array.from(bytes), { link: "auto" }), l = d.layers.find(x => x.name === "dhcp");
        if (l) { bytes = bytes.slice(l.start, l.end); where = "The DHCP message was found inside the packet (bytes " + l.start + " to " + l.end + "). "; }
      }
      const m = D.decodeMessage(bytes);
      if (m.error) { TK.notes($("mnotes"), [{ level: "bad", text: m.error + " If you pasted a whole packet, check that it starts at the Ethernet or IP header." }]); return; }
      $("msum").textContent = (m.type ? "DHCP " + m.type : "DHCP message") + " " + (m.op === 1 ? "from the client " : "to the client ") + m.mac + ", transaction 0x" + m.xid + (m.yiaddr !== "0.0.0.0" ? ", address " + m.yiaddr : "") + ".";
      TK.notes($("mnotes"), (where ? [{ level: "info", text: where }] : []).concat(m.cookie ? [] : [{ level: "bad", text: "The magic cookie (63 82 53 63) is missing: this is old BOOTP or not DHCP at all." }], m.notes));
      TK.render(box, [{ title: "Fixed part", rows: m.fields.map(f => [f.name, f.value]) }, { title: "Options (" + m.options.length + ")", rows: m.options.map(o => [o.code + "  " + o.name, o.text || "(empty)", o.lines && o.lines.length > 1 ? o.lines.join("  |  ") : (o.notes && o.notes.length ? o.notes.map(n => n.text).join(" ") : "")]) }]);
    }
    $("mhex").addEventListener("input", TK.debounce(message, 200));

    /* -------------------------------------------------------- list */
    function list() {
      const q = $("fsearch").value.trim().toLowerCase(), v6 = $("fver").value === "6", box = $("fout"); box.textContent = "";
      const rows = v6 ? D.V6.map(r => ({ code: r[0], name: r[1], d: r[2], rfc: r[3], t: "" })) : codes.map(c => ({ code: c, name: D.OPTIONS[c].n, d: D.OPTIONS[c].d, rfc: D.OPTIONS[c].rfc, t: D.OPTIONS[c].t }));
      const hit = rows.filter(r => !q || String(r.code) === q || (r.name + " " + r.d + " " + r.rfc).toLowerCase().includes(q));
      const fs = document.createElement("fieldset"), lg = document.createElement("legend"), tb = document.createElement("table"); lg.textContent = (v6 ? "DHCPv6 options" : "DHCP options for IPv4") + " (" + hit.length + ")"; tb.className = "tk-list tk-stack";
      const hr = document.createElement("tr"); hr.className = "tk-head"; for (const h of ["Option", "Name", "What it is", "Defined in"]) { const th = document.createElement("th"); th.textContent = h; hr.append(th); } tb.append(hr);
      for (const r of hit) { const tr = document.createElement("tr"); [String(r.code), r.name, r.d, r.rfc || ""].forEach((c, i) => { const td = document.createElement("td"); td.textContent = c; if (i === 0) td.className = "tk-mono"; tr.append(td); }); tb.append(tr); }
      if (!hit.length) { const p = document.createElement("p"); p.className = "tk-muted"; p.textContent = "Nothing matches. Options not listed here are still fine to use: build them in hex."; fs.append(lg, p); } else fs.append(lg, tb);
      box.append(fs);
    }
    $("fsearch").addEventListener("input", TK.debounce(list, 100)); $("fver").addEventListener("change", list);

    /* -------------------------------------------------------- tabs */
    const tabs = ["build", "read", "msg", "ref"].map(n => [n, $("tab-" + n), $("panel-" + n)]);
    function select(name) { tabs.forEach(([n, t, p]) => { const on = n === name; t.classList.toggle("on", on); t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; p.hidden = !on; }); }
    tabs.forEach(([n, t], i) => {
      t.addEventListener("click", () => select(n));
      t.addEventListener("keydown", e => { if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; const nx = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; select(nx[0]); nx[1].focus(); e.preventDefault(); });
    });
    $("bval").value = "default via 192.168.1.1\n10.10.0.0/16 via 192.168.1.2";
    build(); list();
    return { destroy() {} };
  }
  return { init };
})();
