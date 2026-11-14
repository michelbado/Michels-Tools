/* nftables firewall builder: a ruleset for a server or a small router (allowed ports, sources, ping, rate limits, logging, NAT, port forwards) as a file for `nft -f`.
   Pure text building; nothing is loaded into any firewall. Uses numeric chain priorities and interface-name matches so it also loads on older nftables versions.
   Needs lib/cmdkit.js for validation (looked up when used). Exports window.NftBuild. */
(() => {
  "use strict";
  const K = () => (typeof window !== "undefined" ? window : globalThis).CmdKit;
  const ifOk = s => /^[A-Za-z0-9_.:@-]{1,15}$/.test(s) && !s.includes("/");
  const portsOk = s => s.split(",").every(p => { p = p.trim(); const m = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(p); return !!m && +m[1] >= 1 && +m[1] <= 65535 && (m[2] === undefined || (+m[2] <= 65535 && +m[2] >= +m[1])); });
  const addrOk = a => { const k = K(); const m = /^(.+)\/(\d{1,3})$/.exec(a); if (m) return (k.isIPv4(m[1]) && +m[2] <= 32) || (k.isIPv6(m[1]) && +m[2] <= 128); return k.isIPv4(a) || k.isIPv6(a); };
  const v6 = a => a.includes(":");
  const portSet = s => { const l = s.split(",").map(x => x.trim()); return l.length === 1 ? l[0] : "{ " + l.join(", ") + " }"; };
  const addrRules = (addrs, tail) => { const a4 = addrs.filter(x => !v6(x)), a6 = addrs.filter(v6), out = []; if (a4.length) out.push("ip saddr " + (a4.length > 1 ? "{ " + a4.join(", ") + " }" : a4[0]) + " " + tail); if (a6.length) out.push("ip6 saddr " + (a6.length > 1 ? "{ " + a6.join(", ") + " }" : a6[0]) + " " + tail); return out; };

  function build(v) {
    const k = K(), notes = [], bad = m => notes.push({ level: "bad", text: m }), ind = "\t\t";
    const lan = v.lan.trim(), wan = v.wan.trim(), router = v.role === "router";
    if (router) { if (!ifOk(lan) || !ifOk(wan)) { bad("Type the names of the inside (LAN) and outside (WAN) interfaces, for example eth1 and eth0."); } else if (lan === wan) bad("The inside and outside interfaces must be different."); }
    const ssh = v.ssh.trim();
    if (v.sshOn) { if (!/^\d{1,5}$/.test(ssh) || +ssh < 1 || +ssh > 65535) bad("The SSH port must be 1 to 65535."); }
    const srcs = (v.sshFrom || "").split(/[\s,]+/).filter(Boolean); for (const a of srcs) if (!addrOk(a)) bad("\"" + a + "\" is not an address or network (10.0.0.0/8, 2001:db8::/32).");
    const rate = v.sshRate.trim(); if (v.sshOn && rate && !/^\d{1,4}$/.test(rate)) bad("The SSH rate limit is a number of new connections per minute.");
    const allow = []; for (const line of k.lines(v.allow)) {
      const m = /^(tcp|udp)\s+([0-9,\-\s]+?)(?:\s+from\s+(.+))?$/i.exec(line);
      if (!m) { bad("\"" + line + "\": write it as tcp 443 or udp 51820 or tcp 8000-8100 from 10.0.0.0/8."); continue; }
      const ports = m[2].replace(/\s+/g, ""); if (!portsOk(ports)) { bad("\"" + line + "\": ports are 1 to 65535, with commas or ranges like 8000-8100."); continue; }
      const from = m[3] ? m[3].split(/[\s,]+/).filter(Boolean) : []; if (from.some(a => !addrOk(a))) { bad("\"" + line + "\": the part after from must be addresses or networks."); continue; }
      allow.push({ proto: m[1].toLowerCase(), ports, from });
    }
    const fwd = []; if (router) for (const line of k.lines(v.dnat)) {
      const m = /^(tcp|udp)\s+(\d{1,5})\s*(?:->|=>|to)?\s*(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/i.exec(line);
      if (!m || !k.isIPv4(m[3]) || +m[2] < 1 || +m[2] > 65535 || +m[4] < 1 || +m[4] > 65535) { bad("\"" + line + "\": write it as tcp 8080 -> 192.168.1.10:80 (outside port, then inside address and port)."); continue; }
      fwd.push({ proto: m[1].toLowerCase(), port: m[2], ip: m[3], dport: m[4] });
    }
    const out = (v.outAllow || "").trim(); let outPorts = null;
    if (v.outPolicy === "drop") { outPorts = "53,80,123,443"; if (out) { if (!portsOk(out)) bad("The output ports are 1 to 65535, with commas or ranges."); else outPorts = out.replace(/\s+/g, ""); } }
    if (notes.some(n => n.level === "bad")) return { outputs: [], notes };
    const L = ["#!/usr/sbin/nft -f", ""]; if (v.flush) L.push("flush ruleset", "");
    L.push("table inet filter {", "\tchain input {", "\t\ttype filter hook input priority 0; policy " + (v.inPolicy === "accept" ? "accept" : "drop") + ";", "");
    const I = r => L.push(ind + r);
    I("ct state invalid drop"); I("ct state established,related accept"); I("iifname \"lo\" accept"); L.push("");
    if (v.icmp !== "none") {
      const lim = v.icmp === "limited" ? " limit rate 10/second burst 20 packets" : "";
      I("ip protocol icmp icmp type { echo-request, destination-unreachable, time-exceeded, parameter-problem }" + lim + " accept");
      I("ip6 nexthdr ipv6-icmp icmpv6 type { destination-unreachable, packet-too-big, time-exceeded, parameter-problem, echo-request, nd-router-solicit, nd-router-advert, nd-neighbor-solicit, nd-neighbor-advert }" + lim + " accept");
    }
    if (v.dhcp) I("udp sport 67 udp dport 68 accept");
    if (v.dhcp6) I("ip6 saddr fe80::/10 udp dport 546 accept");
    if (v.sshOn) {
      const tail = "tcp dport " + ssh + " ct state new" + (rate ? " limit rate " + rate + "/minute burst " + Math.max(5, +rate) + " packets" : "") + " accept";
      if (srcs.length) for (const r of addrRules(srcs, tail)) I(r); else I(tail);
    }
    for (const a of allow) { const tail = a.proto + " dport " + portSet(a.ports) + " accept"; if (a.from.length) for (const r of addrRules(a.from, tail)) I(r); else I(tail); }
    if (router && v.lanInput) I("iifname \"" + lan + "\" accept");
    if (v.log) { L.push(""); I("limit rate 5/minute burst 10 packets log prefix \"nft-input-drop: \" level info"); }
    L.push("\t}", "");
    L.push("\tchain forward {", "\t\ttype filter hook forward priority 0; policy " + (router && v.fwdPolicy === "accept" ? "accept" : "drop") + ";", "");
    if (router || v.fwdPolicy === "accept") { I("ct state invalid drop"); I("ct state established,related accept"); }
    if (router) {
      I("iifname \"" + lan + "\" oifname \"" + wan + "\" accept");
      if (fwd.length) I("ct status dnat accept");
      if (v.log) { L.push(""); I("limit rate 5/minute burst 10 packets log prefix \"nft-forward-drop: \" level info"); }
    }
    L.push("\t}", "");
    L.push("\tchain output {", "\t\ttype filter hook output priority 0; policy " + (v.outPolicy === "drop" ? "drop" : "accept") + ";");
    if (v.outPolicy === "drop") { L.push(""); I("ct state established,related accept"); I("oifname \"lo\" accept"); I("tcp dport " + portSet(outPorts) + " accept"); I("udp dport { 53, 123 } accept"); I("meta l4proto { icmp, ipv6-icmp } accept"); }
    L.push("\t}", "}");
    if (router) {
      L.push("", "table ip nat {");
      L.push("\tchain prerouting {", "\t\ttype nat hook prerouting priority -100; policy accept;");
      for (const f of fwd) L.push(ind + "iifname \"" + wan + "\" " + f.proto + " dport " + f.port + " dnat to " + f.ip + ":" + f.dport);
      L.push("\t}", "", "\tchain postrouting {", "\t\ttype nat hook postrouting priority 100; policy accept;");
      if (v.masq) L.push(ind + "oifname \"" + wan + "\" masquerade");
      L.push("\t}", "}");
    }
    const conf = L.join("\n") + "\n";
    // ---- notes
    if (!v.sshOn && v.inPolicy !== "accept") notes.push({ level: "warn", text: "SSH is not allowed in. If you load this over an SSH session, you will be locked out." });
    if (v.sshOn && srcs.length === 0) notes.push({ level: "info", text: "SSH is open to everyone. Limiting it to your own addresses (the \"only from\" box) removes most of the noise from password guessing." });
    if (v.sshOn && ssh !== "22") notes.push({ level: "info", text: "SSH is on port " + ssh + ": make sure that is the port sshd really uses." });
    if (v.flush) notes.push({ level: "warn", text: "flush ruleset removes ALL existing nftables rules, including those added by Docker, libvirt, fail2ban or other tools. Untick it to load these as one more table." });
    if (v.icmp === "none") notes.push({ level: "warn", text: "Blocking ICMP breaks things: path MTU discovery needs it, and IPv6 does not work at all without neighbour discovery (ICMPv6)." });
    if (router) {
      notes.push({ level: "info", text: "Routing also needs forwarding switched on: sudo sysctl -w net.ipv4.ip_forward=1 (and net.ipv6.conf.all.forwarding=1 for IPv6); to keep it, put the setting in /etc/sysctl.d/99-forward.conf." });
      if (!v.masq) notes.push({ level: "info", text: "No masquerading: the networks behind this router must have routable addresses, or the other side needs a route back to them." });
      if (fwd.length) notes.push({ level: "info", text: "Port forwards only apply to IPv4 from the outside interface. The matching forward rule is already included (ct status dnat accept)." });
      if (v.fwdPolicy === "accept") notes.push({ level: "warn", text: "Forwarding policy accept lets the outside reach the inside unless you add rules. Drop is the safer starting point." });
    }
    if (v.outPolicy === "drop") notes.push({ level: "warn", text: "Dropping output by default is strict: only the ports " + outPorts + " (TCP) and DNS/NTP (UDP) are allowed out. Updates, mail or other services need more ports." });
    if (allow.some(a => a.proto === "udp" && /(^|,)(53|123|161|1900)(,|$)/.test(a.ports))) notes.push({ level: "info", text: "UDP services such as DNS, NTP, SNMP and SSDP are used in reflection attacks; allow them only from the networks that need them." });
    notes.push({ level: "info", text: "Interface names are matched with iifname/oifname, so rules load even if an interface does not exist yet. nftables 0.9 or newer is assumed; the file uses numeric priorities so older versions work too." });
    const outs = [{ title: "nftables.conf", text: conf, file: "nftables.conf" }];
    const steps = ["# 1. check the file (nothing is loaded)", "sudo nft -c -f nftables.conf", "",
      "# 2. try it for 60 seconds: the rules are removed again unless you press Ctrl-C (protects against locking yourself out)", "sudo sh -c 'nft -f nftables.conf && sleep 60 && nft flush ruleset'", "",
      "# 3. make it permanent (Debian, Ubuntu, Fedora, RHEL: the nftables service loads /etc/nftables.conf at boot)", "sudo cp nftables.conf /etc/nftables.conf", "sudo systemctl enable --now nftables", "",
      "# look at what is loaded, with counters", "sudo nft list ruleset"];
    outs.push({ title: "Check, try and install", text: steps.join("\n") + "\n" });
    return { outputs: outs, notes };
  }
  const T = (key, label, value, extra) => Object.assign({ key, label, value, type: "text" }, extra || {});
  const C = (key, label, value, extra) => Object.assign({ key, label, value, type: "check" }, extra || {});
  const S = (key, label, value, options, extra) => Object.assign({ key, label, value, options, type: "select" }, extra || {});
  const FIELDS = [
    S("role", "This machine is", "server", [["server", "A server (traffic for itself only)"], ["router", "A router / gateway (also forwards between networks)"]], { group: "Role" }),
    T("lan", "Inside (LAN) interface", "eth1", { group: "Role", showIf: v => v.role === "router" }),
    T("wan", "Outside (WAN) interface", "eth0", { group: "Role", showIf: v => v.role === "router" }),
    C("lanInput", "Let the inside network reach this machine (all services)", true, { group: "Role", showIf: v => v.role === "router" }),
    S("inPolicy", "Traffic coming in", "drop", [["drop", "Block everything except what is allowed below (recommended)"], ["accept", "Allow everything (only the rules below matter for logging)"]], { group: "Coming in" }),
    C("sshOn", "Allow SSH", true, { group: "Coming in" }),
    T("ssh", "SSH port", "22", { group: "Coming in", showIf: v => v.sshOn }),
    T("sshFrom", "Only from these addresses or networks (optional)", "", { group: "Coming in", showIf: v => v.sshOn, placeholder: "203.0.113.5 192.168.0.0/16" }),
    T("sshRate", "At most this many new SSH connections per minute (optional)", "10", { group: "Coming in", showIf: v => v.sshOn }),
    { group: "Coming in", key: "allow", label: "Other services to allow, one per line", type: "area", rows: 4, value: "tcp 80,443", hint: "tcp 443   or   udp 51820   or   tcp 8000-8100   or   tcp 5432 from 10.0.0.0/8" },
    S("icmp", "Ping and other ICMP", "limited", [["limited", "Allowed, rate limited (recommended)"], ["all", "Allowed"], ["none", "Blocked (breaks things)"]], { group: "Coming in" }),
    C("dhcp", "This machine gets its address by DHCP (IPv4)", false, { group: "Coming in" }),
    C("dhcp6", "... and by DHCPv6", false, { group: "Coming in" }),
    S("fwdPolicy", "Forwarding between networks", "drop", [["drop", "Only what is allowed (inside to outside)"], ["accept", "Allow everything"]], { group: "Router", showIf: v => v.role === "router" }),
    C("masq", "Share one public address (masquerade / NAT) on the outside interface", true, { group: "Router", showIf: v => v.role === "router" }),
    { group: "Router", key: "dnat", label: "Port forwards, one per line", type: "area", rows: 3, value: "", showIf: v => v.role === "router", hint: "tcp 8080 -> 192.168.1.10:80   (outside port, inside address and port)" },
    S("outPolicy", "Traffic going out", "accept", [["accept", "Allow everything (usual)"], ["drop", "Block everything except DNS, web, NTP (strict)"]], { group: "Going out" }),
    T("outAllow", "TCP ports allowed out when strict", "53,80,123,443", { group: "Going out", showIf: v => v.outPolicy === "drop" }),
    C("log", "Log what is dropped (rate limited)", false, { group: "Options" }),
    C("flush", "Start with \"flush ruleset\" (removes all other nftables rules)", true, { group: "Options" }),
  ];
  const EXAMPLES = [
    { name: "Web server with SSH from the office", values: { role: "server", sshOn: true, sshFrom: "203.0.113.0/24", allow: "tcp 80,443" } },
    { name: "Database server for the app network", values: { role: "server", sshOn: true, sshFrom: "10.0.0.0/8", allow: "tcp 5432 from 10.1.0.0/16", icmp: "limited" } },
    { name: "Home or small office router", values: { role: "router", lan: "eth1", wan: "eth0", masq: true, sshOn: true, sshFrom: "", allow: "", lanInput: true } },
    { name: "Router with a web server behind it", values: { role: "router", lan: "eth1", wan: "eth0", masq: true, dnat: "tcp 80 -> 192.168.1.10:80\ntcp 443 -> 192.168.1.10:443", sshOn: true, allow: "", log: true } },
    { name: "WireGuard endpoint", values: { role: "server", sshOn: true, allow: "udp 51820", icmp: "limited" } },
  ];
  const builder = { fields: FIELDS, build, examples: EXAMPLES };
  const api = { build, builder, FIELDS, EXAMPLES };
  if (typeof window !== "undefined") window.NftBuild = api;
  if (typeof module !== "undefined") module.exports = api;
})();
