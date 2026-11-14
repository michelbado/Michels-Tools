/* iproute2 command builder: addresses, links, VLANs, bridges, tunnels, routes, policy routing and neighbours as `ip` commands, with the command that undoes each.
   Pure text building; nothing is run. Needs lib/cmdkit.js for quoting (looked up when used). Exports window.IpRoute. */
(() => {
  "use strict";
  const K = () => (typeof window !== "undefined" ? window : globalThis).CmdKit;
  const ifOk = s => /^[A-Za-z0-9_.@:-]{1,15}$/.test(s) && !/^\.\.?$/.test(s) && !/[\/\s]/.test(s);
  const v4pre = s => { const m = /^(.+)\/(\d{1,2})$/.exec(s); return !!m && K().isIPv4(m[1]) && +m[2] <= 32; };
  const v6pre = s => { const m = /^(.+)\/(\d{1,3})$/.exec(s); return !!m && K().isIPv6(m[1]) && +m[2] <= 128; };
  const isPre = s => v4pre(s) || v6pre(s), isIP = s => K().isIPv4(s) || K().isIPv6(s);
  const fam = s => (s.includes(":") ? 6 : 4);
  const macOk = s => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(s);
  const tableOk = s => /^\d+$/.test(s) ? +s >= 1 && +s <= 4294967295 : /^[A-Za-z][A-Za-z0-9_-]{0,30}$/.test(s);
  const nOk = (s, lo, hi) => /^\d+$/.test(String(s).trim()) && +s >= lo && +s <= hi;

  function build(v) {
    const k = K(), notes = [], run = [], undo = [], persist = [], bad = m => { notes.push({ level: "bad", text: m }); };
    const T = v.task, need = (cond, m) => { if (!cond) { bad(m); return false; } return true; };
    const dev = (v.dev || "").trim();
    const empty = text => ({ outputs: [], notes: [{ level: "info", text }] });
    const sh = k.shq;
    if (T === "addr") {
      const ip = v.ip.trim(); if (!dev || !ip) return empty("Type the interface (for example eth0) and the address with its prefix length (192.168.1.10/24).");
      if (!need(ifOk(dev), "\"" + dev + "\" is not an interface name (at most 15 characters, no spaces or slashes).")) return { outputs: [], notes };
      if (!need(isPre(ip), "The address must have a prefix length, for example 192.168.1.10/24 or 2001:db8::10/64.")) return { outputs: [], notes };
      run.push("ip address add " + sh(ip) + " dev " + sh(dev)); undo.push("ip address del " + sh(ip) + " dev " + sh(dev));
      if (v.up) { run.push("ip link set dev " + sh(dev) + " up"); }
      if (ip.endsWith("/32") || ip.endsWith("/128")) notes.push({ level: "info", text: "A /32 or /128 address has no local network: add a route (or use a point-to-point link) for anything beyond the address itself." });
      if (v.src === "yes" && fam(ip) === 4) { }
      notes.push({ level: "info", text: "These changes are lost at reboot. To keep them, put the address in your distribution's network configuration (netplan, /etc/network/interfaces, NetworkManager, systemd-networkd). A systemd-networkd example is below." });
      persist.push("[Match]\nName=" + dev + "\n\n[Network]\nAddress=" + ip + "\n");
    } else if (T === "link") {
      if (!dev) return empty("Type the interface name.");
      if (!need(ifOk(dev), "\"" + dev + "\" is not an interface name.")) return { outputs: [], notes };
      if (v.state === "up") { run.push("ip link set dev " + sh(dev) + " up"); undo.push("ip link set dev " + sh(dev) + " down"); } else if (v.state === "down") { run.push("ip link set dev " + sh(dev) + " down"); undo.push("ip link set dev " + sh(dev) + " up"); }
      const mtu = v.mtu.trim(); if (mtu) { if (!need(nOk(mtu, 68, 65535), "The MTU must be a number from 68 to 65535.")) return { outputs: [], notes }; run.push("ip link set dev " + sh(dev) + " mtu " + mtu); undo.push("ip link set dev " + sh(dev) + " mtu 1500"); if (+mtu < 1280) notes.push({ level: "warn", text: "IPv6 needs an MTU of at least 1280; below that IPv6 is switched off on the interface." }); if (+mtu > 1500) notes.push({ level: "info", text: "An MTU above 1500 (jumbo frames) only works if every device on the path, including switches, allows it." }); }
      const mac = v.mac.trim(); if (mac) { if (!need(macOk(mac), "The MAC address must look like 02:11:22:33:44:55.")) return { outputs: [], notes }; run.push("ip link set dev " + sh(dev) + " address " + mac); notes.push({ level: "info", text: "Changing the MAC address usually needs the interface to be down first (ip link set dev " + dev + " down)." }); }
      if (v.promisc) { run.push("ip link set dev " + sh(dev) + " promisc on"); undo.push("ip link set dev " + sh(dev) + " promisc off"); }
      if (!run.length) return empty("Choose what to change: up or down, the MTU, the MAC address, promiscuous mode.");
    } else if (T === "vlan") {
      const vid = v.vid.trim(); if (!dev || !vid) return empty("Type the parent interface and the VLAN number.");
      if (!need(ifOk(dev), "\"" + dev + "\" is not an interface name.") || !need(nOk(vid, 1, 4094), "A VLAN number is 1 to 4094.")) return { outputs: [], notes };
      const name = v.vname.trim() || dev + "." + vid; if (!need(ifOk(name), "\"" + name + "\" is not an interface name.")) return { outputs: [], notes };
      run.push("ip link add link " + sh(dev) + " name " + sh(name) + " type vlan id " + vid); undo.push("ip link del " + sh(name));
      const ip = v.ip.trim(); if (ip) { if (!need(isPre(ip), "The address must have a prefix length, for example 10.0.100.1/24.")) return { outputs: [], notes }; run.push("ip address add " + sh(ip) + " dev " + sh(name)); }
      run.push("ip link set dev " + sh(dev) + " up", "ip link set dev " + sh(name) + " up");
      if (name.length > 15) bad("Interface names are at most 15 characters.");
      notes.push({ level: "info", text: "The switch port must carry VLAN " + vid + " tagged (a trunk) for traffic to pass. The VLAN interface's MTU is the parent's; the 4-byte tag fits in a 1500-byte payload on most hardware." });
    } else if (T === "bridge") {
      const br = v.brname.trim(), ports = (v.ports || "").split(/[\s,]+/).filter(Boolean);
      if (!br) return empty("Type a name for the bridge, for example br0, and the interfaces to put in it.");
      if (!need(ifOk(br), "\"" + br + "\" is not an interface name.")) return { outputs: [], notes };
      for (const p of ports) if (!need(ifOk(p), "\"" + p + "\" is not an interface name.")) return { outputs: [], notes };
      run.push("ip link add name " + sh(br) + " type bridge" + (v.stp ? " stp_state 1" : "")); undo.push("ip link del " + sh(br));
      for (const p of ports) { run.push("ip link set dev " + sh(p) + " master " + sh(br)); undo.unshift("ip link set dev " + sh(p) + " nomaster"); }
      run.push("ip link set dev " + sh(br) + " up"); for (const p of ports) run.push("ip link set dev " + sh(p) + " up");
      const ip = v.ip.trim(); if (ip) { if (!need(isPre(ip), "The address must have a prefix length.")) return { outputs: [], notes }; run.push("ip address add " + sh(ip) + " dev " + sh(br)); }
      notes.push({ level: "warn", text: "If you do this over SSH on the interface you are using, you lose the connection. Put the address on the bridge, not on the port you add, and do it from the console." });
      if (ports.some(p => /^wl/.test(p))) notes.push({ level: "info", text: "A Wi-Fi interface in client mode usually cannot be bridged." });
    } else if (T === "gre") {
      const n = v.tname.trim(), loc = v.local.trim(), rem = v.remote.trim(); if (!n || !loc || !rem) return empty("Type a name for the tunnel and the two outer addresses (this machine and the other end).");
      if (!need(ifOk(n), "\"" + n + "\" is not an interface name.") || !need(isIP(loc) && isIP(rem) && fam(loc) === fam(rem), "Local and remote must be addresses of the same kind (both IPv4 or both IPv6).")) return { outputs: [], notes };
      const kind = v.tmode === "ipip" ? (fam(loc) === 6 ? "ip6tnl mode ipip6" : "ipip") : (fam(loc) === 6 ? "ip6gre" : "gre");
      const ttl = v.ttl.trim(); if (ttl && !need(nOk(ttl, 1, 255), "TTL is 1 to 255.")) return { outputs: [], notes };
      run.push("ip link add " + sh(n) + " type " + kind + " local " + sh(loc) + " remote " + sh(rem) + (ttl ? " ttl " + ttl : "")); undo.push("ip link del " + sh(n));
      const ip = v.ip.trim(); if (ip) { if (!need(isPre(ip), "The tunnel address must have a prefix length, for example 10.255.0.1/30.")) return { outputs: [], notes }; run.push("ip address add " + sh(ip) + " dev " + sh(n)); }
      const mtu = v.mtu.trim(); if (mtu) { if (!need(nOk(mtu, 68, 65535), "The MTU must be a number from 68 to 65535.")) return { outputs: [], notes }; run.push("ip link set dev " + sh(n) + " mtu " + mtu); }
      run.push("ip link set dev " + sh(n) + " up");
      notes.push({ level: "info", text: (v.tmode === "ipip" ? "IP-in-IP" : "GRE") + " does not encrypt anything. The outer header adds " + (v.tmode === "ipip" ? 20 : 24) + " bytes (IPv4), so the tunnel MTU is about " + (1500 - (v.tmode === "ipip" ? 20 : 24)) + " on a 1500-byte path; MSS clamping is usually needed too. Firewalls must allow " + (v.tmode === "ipip" ? "IP protocol 4" : "IP protocol 47") + " between the two outer addresses." });
    } else if (T === "vxlan") {
      const n = v.tname.trim(), vni = v.vni.trim(), loc = v.local.trim(), rem = v.remote.trim(), port = v.vport.trim();
      if (!n || !vni) return empty("Type a name and the VXLAN network identifier (VNI).");
      if (!need(ifOk(n), "\"" + n + "\" is not an interface name.") || !need(nOk(vni, 1, 16777215), "The VNI is 1 to 16777215.")) return { outputs: [], notes };
      if (loc && !need(isIP(loc), "Local must be an IP address.")) return { outputs: [], notes }; if (rem && !need(isIP(rem), "Remote must be an IP address.")) return { outputs: [], notes };
      if (port && !need(nOk(port, 1, 65535), "The UDP port is 1 to 65535.")) return { outputs: [], notes };
      if (dev && !need(ifOk(dev), "\"" + dev + "\" is not an interface name.")) return { outputs: [], notes };
      run.push("ip link add " + sh(n) + " type vxlan id " + vni + (loc ? " local " + sh(loc) : "") + (rem ? " remote " + sh(rem) : "") + " dstport " + (port || "4789") + (dev ? " dev " + sh(dev) : "") + (!rem ? " nolearning" : "")); undo.push("ip link del " + sh(n));
      const ip = v.ip.trim(); if (ip) { if (!need(isPre(ip), "The address must have a prefix length.")) return { outputs: [], notes }; run.push("ip address add " + sh(ip) + " dev " + sh(n)); }
      const mtu = v.mtu.trim(); if (mtu) { if (!need(nOk(mtu, 68, 65535), "The MTU must be a number from 68 to 65535.")) return { outputs: [], notes }; run.push("ip link set dev " + sh(n) + " mtu " + mtu); }
      run.push("ip link set dev " + sh(n) + " up");
      if (!rem) { run[0] = run[0].replace(" nolearning", ""); notes.push({ level: "info", text: "With no remote address, remote ends are learned from traffic or you add them with: bridge fdb append 00:00:00:00:00:00 dev " + n + " dst <remote address>." }); }
      notes.push({ level: "info", text: "VXLAN adds 50 bytes (IPv4 outer header, UDP, VXLAN, inner Ethernet): the inner MTU is 1450 on a 1500-byte path unless the path allows bigger frames. Allow UDP port " + (port || "4789") + " between the two ends." });
    } else if (T === "route") {
      let dst = v.dest.trim(); if (!dst) return empty("Type the destination network, for example 10.20.0.0/16, or default.");
      const via = v.via.trim(), rdev = (v.rdev || "").trim(), kind = v.rkind;
      if (dst !== "default" && !isPre(dst) && !isIP(dst)) { bad("The destination must be default, a network with prefix length (10.20.0.0/16) or an address."); return { outputs: [], notes }; }
      if (dst !== "default" && /\/(\d+)$/.test(dst) === false && isIP(dst)) dst += fam(dst) === 6 ? "/128" : "/32";
      if (via && !need(isIP(via), "The gateway (via) must be an IP address.")) return { outputs: [], notes };
      if (rdev && !need(ifOk(rdev), "\"" + rdev + "\" is not an interface name.")) return { outputs: [], notes };
      if (kind === "unicast" && !via && !rdev) return empty("A route needs a gateway (via), an interface (dev), or both.");
      if (via && dst !== "default" && fam(via) !== fam(dst.split("/")[0])) { bad("The destination and the gateway must both be IPv4 or both IPv6."); return { outputs: [], notes }; }
      const met = v.metric.trim(), table = v.table.trim(), src = v.rsrc.trim();
      if (met && !need(nOk(met, 0, 4294967295), "The metric must be a whole number.")) return { outputs: [], notes };
      if (table && !need(tableOk(table), "The table is a number (1 to 4294967295) or a name from /etc/iproute2/rt_tables.")) return { outputs: [], notes };
      if (src && !need(isIP(src), "The source address must be an IP address.")) return { outputs: [], notes };
      const f6 = fam((via || dst.split("/")[0] || "4")) === 6 && dst !== "default" || (via && fam(via) === 6);
      const pre = f6 ? "ip -6 route" : "ip route";
      const tail = (via ? " via " + sh(via) : "") + (rdev ? " dev " + sh(rdev) : "") + (src ? " src " + sh(src) : "") + (met ? " metric " + met : "") + (table ? " table " + table : "") + (v.onlink && via ? " onlink" : "");
      const body = (kind === "unicast" ? "" : kind + " ") + (dst === "default" ? "default" : dst);
      run.push(pre + " add " + body + (kind === "unicast" ? tail : (met ? " metric " + met : "") + (table ? " table " + table : "")));
      undo.push(pre + " del " + body + (met ? " metric " + met : "") + (table ? " table " + table : ""));
      run.push(pre + " get " + (dst === "default" ? (f6 ? "2001:db8::1" : "192.0.2.1") : dst.split("/")[0]) + (table ? " table " + table : "") + "    # check which route is used");
      if (kind !== "unicast") notes.push({ level: "info", text: kind === "blackhole" ? "A blackhole route drops matching packets silently." : kind === "unreachable" ? "An unreachable route drops packets and sends ICMP host unreachable to the sender." : "A prohibit route drops packets and sends ICMP administratively prohibited." });
      if (dst === "default") notes.push({ level: "warn", text: "A second default route does not replace the first; the lower metric wins. Add the new one with a lower metric or delete the old one first. Changing the default route over SSH can lock you out." });
      if (via && !rdev) notes.push({ level: "info", text: "The gateway must be reachable on a directly connected network; otherwise the command fails with \"Nexthop has invalid gateway\". Add onlink if you know it is on the link anyway." });
      notes.push({ level: "info", text: "Routes added this way are lost at reboot; keep them in the network configuration of your distribution." });
      if (!table && !met && kind === "unicast") { persist.push("[Match]\nName=" + (rdev || "eth0") + "\n\n[Route]\nDestination=" + (dst === "default" ? "0.0.0.0/0" : dst) + (via ? "\nGateway=" + via : "") + "\n"); }
    } else if (T === "rule") {
      const from = v.rfrom.trim(), tbl = v.rtable.trim(), gw = v.rgw.trim(), rdev = (v.rdev || "").trim(), pr = v.rprio.trim();
      if (!from || !tbl) return empty("Type the source network (traffic from this network is steered) and a routing table number.");
      if (!need(isPre(from) || isIP(from), "The source must be an address or a network with prefix length.") || !need(tableOk(tbl), "The table is a number (1 to 4294967295) or a name from /etc/iproute2/rt_tables.")) return { outputs: [], notes };
      if (pr && !need(nOk(pr, 1, 32765), "The priority is 1 to 32765 (lower is checked first).")) return { outputs: [], notes };
      if (gw && !need(isIP(gw), "The gateway must be an IP address.")) return { outputs: [], notes }; if (rdev && !need(ifOk(rdev), "\"" + rdev + "\" is not an interface name.")) return { outputs: [], notes };
      const r6 = fam(from.split("/")[0]) === 6, p = r6 ? "ip -6" : "ip";
      run.push(p + " rule add from " + sh(from) + " table " + sh(tbl) + (pr ? " priority " + pr : "")); undo.push(p + " rule del from " + sh(from) + " table " + sh(tbl) + (pr ? " priority " + pr : ""));
      if (gw || rdev) { run.push(p + " route add default" + (gw ? " via " + sh(gw) : "") + (rdev ? " dev " + sh(rdev) : "") + " table " + sh(tbl)); undo.unshift(p + " route del default table " + sh(tbl)); }
      run.push(p + " route get 8.8.8.8 from " + sh(from.split("/")[0]) + (r6 ? "" : "") + "    # check: which way does this source go?");
      run.push(p + " rule show");
      notes.push({ level: "info", text: "Traffic from " + from + " now uses routing table " + tbl + " instead of the main table. Replies to a connection must leave the same way they came in: that is the usual reason for this setup (two uplinks)." });
      if (!gw && !rdev) notes.push({ level: "info", text: "The rule alone does nothing useful until table " + tbl + " has a route; add a gateway or interface above to get the default route for it." });
      notes.push({ level: "info", text: "Also check reverse-path filtering when you have two uplinks: net.ipv4.conf.all.rp_filter=2 (loose) is often needed." });
    } else if (T === "neigh") {
      const ip = v.nip.trim(), mac = v.nmac.trim(); if (!ip || !mac || !dev) return empty("Type the IP address, its MAC address and the interface.");
      if (!need(isIP(ip), "The address must be an IPv4 or IPv6 address.") || !need(macOk(mac), "The MAC address must look like 02:11:22:33:44:55.") || !need(ifOk(dev), "\"" + dev + "\" is not an interface name.")) return { outputs: [], notes };
      run.push("ip neighbour replace " + sh(ip) + " lladdr " + mac + " dev " + sh(dev) + " nud permanent"); undo.push("ip neighbour del " + sh(ip) + " dev " + sh(dev)); run.push("ip neighbour show dev " + sh(dev));
      notes.push({ level: "info", text: "A permanent entry never expires and is never updated by ARP or neighbour discovery; if the real device changes its MAC address, traffic stops." });
    } else if (T === "show") {
      run.push("ip -br address    # addresses, one line per interface", "ip -br link    # state and MAC addresses", "ip route    # the main routing table", "ip -6 route", "ip rule    # policy routing rules", "ip neighbour    # ARP / neighbour cache", "ip -s link show" + (dev && ifOk(dev) ? " " + sh(dev) : "") + "    # packet and error counters", "ip route get 8.8.8.8    # which way would a packet to 8.8.8.8 go?");
    }
    if (notes.some(n => n.level === "bad")) return { outputs: [], notes };
    const outputs = [{ title: "Commands (run as root)", text: run.join("\n") + "\n", hint: "Each line is one command." }];
    if (undo.length) outputs.push({ title: "To undo", text: undo.join("\n") + "\n" });
    if (persist.length) outputs.push({ title: "To keep it after a reboot (systemd-networkd, /etc/systemd/network/10-" + (dev || "eth0") + ".network)", text: persist.join("\n"), file: "10-" + (dev || "eth0") + ".network" });
    return { outputs, notes };
  }
  const T = (key, label, value, extra) => Object.assign({ key, label, value, type: "text" }, extra || {});
  const is = (...t) => v => t.includes(v.task);
  const FIELDS = [
    { group: "What to do", key: "task", label: "Task", type: "select", value: "addr", options: [["addr", "Give an interface an address"], ["link", "Change an interface: up/down, MTU, MAC"], ["vlan", "Create a VLAN interface"], ["bridge", "Create a bridge"], ["gre", "Create a GRE or IP-in-IP tunnel"], ["vxlan", "Create a VXLAN interface"], ["route", "Add a route"], ["rule", "Send traffic from a source out another way (policy routing)"], ["neigh", "Add a static ARP / neighbour entry"], ["show", "Show everything (look around)"]] },
    T("dev", "Interface", "eth0", { group: "Details", showIf: is("addr", "link", "vlan", "neigh", "show", "vxlan"), placeholder: "eth0" }),
    T("ip", "Address with prefix length", "192.168.1.10/24", { group: "Details", showIf: is("addr", "vlan", "bridge", "gre", "vxlan"), placeholder: "192.168.1.10/24" }),
    { group: "Details", key: "up", label: "Bring the interface up", type: "check", value: true, showIf: is("addr") },
    { group: "Details", key: "src", label: "", type: "text", value: "", showIf: () => false },
    { group: "Details", key: "state", label: "State", type: "select", value: "none", options: [["none", "Leave as it is"], ["up", "Up"], ["down", "Down"]], showIf: is("link") },
    T("mtu", "MTU (optional)", "", { group: "Details", showIf: is("link", "gre", "vxlan") }),
    T("mac", "New MAC address (optional)", "", { group: "Details", showIf: is("link") }),
    { group: "Details", key: "promisc", label: "Promiscuous mode on", type: "check", value: false, showIf: is("link") },
    T("vid", "VLAN number", "100", { group: "Details", showIf: is("vlan") }),
    T("vname", "Name of the VLAN interface (optional)", "", { group: "Details", showIf: is("vlan"), placeholder: "eth0.100" }),
    T("brname", "Bridge name", "br0", { group: "Details", showIf: is("bridge") }),
    T("ports", "Interfaces to put in the bridge", "eth0 eth1", { group: "Details", showIf: is("bridge") }),
    { group: "Details", key: "stp", label: "Spanning tree", type: "check", value: false, showIf: is("bridge") },
    T("tname", "Tunnel interface name", "gre1", { group: "Details", showIf: is("gre", "vxlan") }),
    { group: "Details", key: "tmode", label: "Type", type: "select", value: "gre", options: [["gre", "GRE"], ["ipip", "IP-in-IP"]], showIf: is("gre") },
    T("local", "Local outer address", "192.0.2.1", { group: "Details", showIf: is("gre", "vxlan") }),
    T("remote", "Remote outer address", "198.51.100.1", { group: "Details", showIf: is("gre", "vxlan") }),
    T("ttl", "TTL (optional)", "255", { group: "Details", showIf: is("gre") }),
    T("vni", "VXLAN network identifier (VNI)", "100", { group: "Details", showIf: is("vxlan") }),
    T("vport", "UDP port", "4789", { group: "Details", showIf: is("vxlan") }),
    T("dest", "Destination", "10.20.0.0/16", { group: "Details", showIf: is("route"), placeholder: "10.20.0.0/16 or default" }),
    T("via", "Gateway (via)", "192.168.1.1", { group: "Details", showIf: is("route") }),
    T("rdev", "Interface (dev, optional)", "", { group: "Details", showIf: is("route", "rule") }),
    { group: "Details", key: "rkind", label: "Kind of route", type: "select", value: "unicast", options: [["unicast", "Normal"], ["blackhole", "Blackhole (drop silently)"], ["unreachable", "Unreachable (drop and tell the sender)"], ["prohibit", "Prohibit (drop and say prohibited)"]], showIf: is("route") },
    T("metric", "Metric (optional)", "", { group: "Details", showIf: is("route") }),
    T("table", "Routing table (optional)", "", { group: "Details", showIf: is("route") }),
    T("rsrc", "Preferred source address (optional)", "", { group: "Details", showIf: is("route") }),
    { group: "Details", key: "onlink", label: "Treat the gateway as directly reachable (onlink)", type: "check", value: false, showIf: is("route") },
    T("rfrom", "Traffic from this source", "192.168.2.0/24", { group: "Details", showIf: is("rule") }),
    T("rtable", "uses routing table", "100", { group: "Details", showIf: is("rule") }),
    T("rgw", "Default gateway in that table (optional)", "198.51.100.1", { group: "Details", showIf: is("rule") }),
    T("rprio", "Rule priority (optional)", "", { group: "Details", showIf: is("rule") }),
    T("nip", "IP address", "192.168.1.50", { group: "Details", showIf: is("neigh") }),
    T("nmac", "MAC address", "02:11:22:33:44:55", { group: "Details", showIf: is("neigh") }),
  ].filter(f => f.key !== "src");
  const EXAMPLES = [
    { name: "Address on an interface", values: { task: "addr", dev: "eth0", ip: "192.168.1.10/24" } },
    { name: "VLAN 100 with an address", values: { task: "vlan", dev: "eth0", vid: "100", ip: "10.0.100.1/24" } },
    { name: "Default route via a gateway", values: { task: "route", dest: "default", via: "192.168.1.1", rdev: "eth0" } },
    { name: "Two uplinks: reply the way it came", values: { task: "rule", rfrom: "198.51.100.10/32", rtable: "100", rgw: "198.51.100.1", rdev: "eth1" } },
    { name: "GRE tunnel", values: { task: "gre", tname: "gre1", local: "192.0.2.1", remote: "198.51.100.1", ip: "10.255.0.1/30", mtu: "1476" } },
    { name: "Bridge two ports", values: { task: "bridge", brname: "br0", ports: "eth0 eth1" } },
  ];
  const builder = { fields: FIELDS, build, examples: EXAMPLES };
  const api = { build, builder, FIELDS, EXAMPLES };
  if (typeof window !== "undefined") window.IpRoute = api;
  if (typeof module !== "undefined") module.exports = api;
})();
