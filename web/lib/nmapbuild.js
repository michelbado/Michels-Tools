/* nmap command builder: choices in, one nmap command line out, with every option explained and conflicting choices pointed out.
   Pure text building; nothing is run and nothing is scanned. Only ordinary scan options are offered (no spoofing, decoys or fragmenting).
   Needs lib/cmdkit.js for quoting (looked up when used). Exports window.NmapBuild. */
(() => {
  "use strict";
  const K = () => (typeof window !== "undefined" ? window : globalThis).CmdKit;
  const octet = "(\\*|\\d{1,3}(-\\d{1,3})?(,\\d{1,3}(-\\d{1,3})?)*)";
  const V4RANGE = new RegExp("^" + octet + "(\\." + octet + "){3}$"), V4CIDR = /^\d{1,3}(\.\d{1,3}){3}\/(\d|[12]\d|3[0-2])$/;
  function checkTarget(t) {
    const k = K();
    if (V4CIDR.test(t)) { const [a, m] = t.split("/"); if (!k.isIPv4(a)) return { error: "\"" + t + "\" is not a valid network." }; return { count: Math.pow(2, 32 - +m), kind: "network" }; }
    if (k.isIPv4(t)) return { count: 1, kind: "address" };
    if (V4RANGE.test(t) && t.split(".").every(p => p === "*" || p.split(",").every(r => r.split("-").every(n => +n <= 255)))) { let c = 1; for (const p of t.split(".")) c *= p === "*" ? 256 : p.split(",").reduce((s, r) => { const [a, b] = r.split("-").map(Number); return s + (b === undefined ? 1 : Math.max(0, b - a + 1)); }, 0); return { count: c, kind: "range" }; }
    const m6 = /^(.*)\/(\d{1,3})$/.exec(t); if (m6 && k.isIPv6(m6[1]) && +m6[2] <= 128) return { count: m6[2] >= 112 ? Math.pow(2, 128 - m6[2]) : Infinity, kind: "network", v6: true };
    if (k.isIPv6(t)) return { count: 1, kind: "address", v6: true };
    if (k.isHost(t) && /[A-Za-z]/.test(t)) return { count: 1, kind: "name" };
    return { error: "\"" + t + "\" is not an address, a network (10.0.0.0/24), a range (10.0.0-3.1-254) or a host name." };
  }
  // ports: 22,80,443  1-1024  T:80,U:53  -  (all)
  function checkPorts(s) {
    s = s.trim(); if (!s) return { error: "Type the ports." };
    if (s === "-") return { ok: true, count: 65535 };
    let count = 0;
    for (let part of s.split(",")) {
      part = part.trim().replace(/^[TUS]:/i, ""); if (part === "") return { error: "There is an empty entry in the list of ports." };
      if (part === "-") { count += 65535; continue; }
      let m = /^(\d{1,5})-(\d{1,5})$/.exec(part); if (m) { if (+m[1] < 1 || +m[2] > 65535 || +m[1] > +m[2]) return { error: "\"" + part + "\" is not a valid range (1 to 65535, low first)." }; count += +m[2] - +m[1] + 1; continue; }
      m = /^(\d{1,5})-$/.exec(part); if (m) { if (+m[1] < 1 || +m[1] > 65535) return { error: "\"" + part + "\" is not a valid port." }; count += 65535 - +m[1] + 1; continue; }
      m = /^-(\d{1,5})$/.exec(part); if (m) { if (+m[1] < 1 || +m[1] > 65535) return { error: "\"" + part + "\" is not a valid port." }; count += +m[1]; continue; }
      if (/^\d{1,5}$/.test(part)) { if (+part < 1 || +part > 65535) return { error: "Port " + part + " is outside 1 to 65535." }; count++; continue; }
      if (/^[A-Za-z][A-Za-z0-9*?-]{0,30}$/.test(part)) { count++; continue; }   // a service name such as http or http*
      return { error: "\"" + part + "\" is not a port, a range or a service name." };
    }
    return { ok: true, count };
  }
  const SCRIPTS = { none: null, default: "default", safe: "safe", discovery: "discovery", vuln: "vuln", auth: "auth", version: "version" };

  function build(v) {
    const k = K(), notes = [], explain = [], args = [];
    const tg = (v.targets || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean), file = (v.listfile || "").trim();
    if (!tg.length && !file) return { outputs: [], notes: [{ level: "info", text: "Type what to scan: an address, a network such as 192.168.1.0/24, or a host name." }] };
    let hosts = 0, bad = false, v6 = false;
    for (const t of tg) { const r = checkTarget(t); if (r.error) { notes.push({ level: "bad", text: r.error }); bad = true; } else { hosts += r.count; if (r.v6) v6 = true; } }
    if (tg.some(t => t.startsWith("-"))) { notes.push({ level: "bad", text: "A target cannot start with a dash." }); bad = true; }
    if (file && (!/^[^\s'"`$;|&<>]+$/.test(file) || file.startsWith("-"))) { notes.push({ level: "bad", text: "The target file name has characters that need care; use a plain path." }); bad = true; }
    const ex = (v.exclude || "").split(/[\s,]+/).map(x => x.trim()).filter(Boolean); for (const t of ex) { const r = checkTarget(t); if (r.error) { notes.push({ level: "bad", text: "Exclude: " + r.error }); bad = true; } }
    const mode = v.scan, ports = v.ports, a = (flag, text, val) => { args.push(val === undefined ? flag : flag + " " + val); explain.push([val === undefined ? flag : flag + " " + val, text]); };
    const listOnly = mode === "list", pingOnly = mode === "ping", noPorts = listOnly || pingOnly;
    const root = ["syn", "udp", "both", "ack"].includes(mode) || v.os;
    // scan type
    if (mode === "syn") a("-sS", "SYN scan: sends a connection start and reads the answer, never completes the connection (fast, the usual choice; needs root)");
    else if (mode === "connect") a("-sT", "connect scan: opens real connections (slower and logged by the target, but needs no special rights)");
    else if (mode === "udp") a("-sU", "UDP scan: slow, because closed and filtered ports often give no answer; needs root");
    else if (mode === "both") { a("-sS", "SYN scan for TCP (needs root)"); a("-sU", "UDP scan as well (slow)"); }
    else if (mode === "ack") a("-sA", "ACK scan: does not find open ports; it shows which ports a firewall lets through unfiltered (needs root)");
    else if (pingOnly) a("-sn", "host discovery only: finds which hosts answer, no port scan");
    else if (listOnly) a("-sL", "list scan: only lists the targets (and looks up their names); sends nothing to them");
    // ports
    if (!noPorts) {
      if (ports === "top") { const n = (v.topn || "").trim(); if (!/^\d+$/.test(n) || +n < 1 || +n > 65535) { notes.push({ level: "bad", text: "The number of top ports must be 1 to 65535." }); bad = true; } else a("--top-ports", "scan the " + n + " most common ports", n); }
      else if (ports === "fast") a("-F", "fast: the 100 most common ports instead of 1000");
      else if (ports === "all") a("-p-", "all 65535 ports (takes a long time on a slow or filtered host)");
      else if (ports === "custom") { const r = checkPorts(v.portlist || ""); if (r.error) { notes.push({ level: "bad", text: r.error }); bad = true; } else { a("-p", "only these ports", (v.portlist || "").trim().replace(/\s+/g, "")); if ((v.portlist || "").trim() && /(^|,)[TU]:/i.test(v.portlist) && !["udp", "both"].includes(mode) && /U:/i.test(v.portlist)) notes.push({ level: "info", text: "The list has U: (UDP) ports but the scan type is not UDP; add a UDP scan to test them." }); } }
      else notes.push({ level: "info", text: "No port option: nmap scans the 1000 most common ports." });
    }
    // detection
    if (!noPorts) {
      if (v.version) a("-sV", "find out which program and version answers on each open port");
      if (v.os) a("-O", "guess the operating system from how the host answers (needs root; wants at least one open and one closed port)");
      if (v.scripts !== "none" && SCRIPTS[v.scripts]) { if (v.scripts === "default") a("-sC", "run the default set of NSE scripts (same as --script=default)"); else a("--script", "run the NSE scripts of the \"" + v.scripts + "\" category", SCRIPTS[v.scripts]); }
      if (v.scripts === "custom") { const sc = (v.script || "").trim(); if (!/^[A-Za-z0-9_.*,+-]+$/.test(sc)) { notes.push({ level: "bad", text: "Script names may use letters, digits and _ . * , - only." }); bad = true; } else a("--script", "run these scripts", sc); }
      if (v.trace) a("--traceroute", "also trace the path to each host");
    } else if (v.version || v.os || v.scripts !== "none" || v.trace) notes.push({ level: "warn", text: "Version detection, OS detection, scripts and traceroute need a port scan; with " + (listOnly ? "a list scan" : "host discovery only") + " they were left out." });
    // host discovery
    if (!listOnly) {
      if (v.disc === "skip") { a("-Pn", "treat every host as up: skip the ping step (needed when a firewall blocks pings; slower on empty networks)"); if (pingOnly) notes.push({ level: "warn", text: "Host discovery only (-sn) together with -Pn leaves nothing to discover: every host is reported up." }); }
      else if (v.disc === "icmp") a("-PE", "discover hosts with ICMP echo (ping)");
      else if (v.disc === "syn") a("-PS" + v.discports.replace(/\s+/g, ""), "discover hosts with a TCP SYN to these ports");
      else if (v.disc === "ack") a("-PA" + v.discports.replace(/\s+/g, ""), "discover hosts with a TCP ACK to these ports");
      else if (v.disc === "arp") a("-PR", "discover hosts on the local network with ARP (the default for local targets)");
      if ((v.disc === "syn" || v.disc === "ack")) { const r = checkPorts(v.discports || ""); if (r.error) { notes.push({ level: "bad", text: "Discovery ports: " + r.error }); bad = true; } }
    }
    // name resolution
    if (v.dns === "never") a("-n", "never look up host names (faster)"); else if (v.dns === "always") a("-R", "always look up host names");
    if (v.ipv6 || v6) a("-6", "use IPv6" + (v6 && !v.ipv6 ? " (needed for the IPv6 targets)" : ""));
    // speed
    if (v.timing !== "") a("-T" + v.timing, { 0: "paranoid: extremely slow, one probe at a time", 1: "sneaky: very slow", 2: "polite: slows down to use less bandwidth", 3: "normal (the default)", 4: "aggressive: for fast, reliable networks (a common choice)", 5: "insane: may lose results on anything but a very fast, close link" }[v.timing]);
    if (v.maxrate.trim()) { if (!/^\d+$/.test(v.maxrate.trim()) || +v.maxrate < 1) { notes.push({ level: "bad", text: "The packet rate limit must be a whole number." }); bad = true; } else a("--max-rate", "never send more than " + v.maxrate.trim() + " packets per second (be gentle on weak links and devices)", v.maxrate.trim()); }
    if (v.retries.trim()) { if (!/^\d+$/.test(v.retries.trim()) || +v.retries > 50) { notes.push({ level: "bad", text: "Retries must be a whole number from 0 to 50." }); bad = true; } else a("--max-retries", "resend an unanswered probe at most this many times", v.retries.trim()); }
    if (v.hosttimeout.trim()) { if (!/^\d+(ms|s|m|h)?$/.test(v.hosttimeout.trim())) { notes.push({ level: "bad", text: "The host time limit looks like 30s, 10m or 1h." }); bad = true; } else a("--host-timeout", "give up on a host after this time", v.hosttimeout.trim()); }
    if (v.iface.trim()) { if (!/^[A-Za-z0-9_.:@-]{1,32}$/.test(v.iface.trim())) { notes.push({ level: "bad", text: "The interface name has unusual characters." }); bad = true; } else a("-e", "send and receive on this network interface", v.iface.trim()); }
    // output
    if (v.verbose === "1") a("-v", "show more while it runs (open ports as soon as they are found)"); else if (v.verbose === "2") a("-vv", "show even more while it runs");
    if (v.open && !noPorts) a("--open", "show only open (or possibly open) ports");
    if (v.reason) a("--reason", "say why each port is shown as open, closed or filtered");
    const outname = v.outfile.trim();
    if (v.output !== "none") {
      if (!outname) { notes.push({ level: "bad", text: "Type a file name for the saved results." }); bad = true; }
      else if (!/^[A-Za-z0-9_.\/~-][A-Za-z0-9_.\/~ -]*$/.test(outname) || outname.startsWith("-")) { notes.push({ level: "bad", text: "The output file name has characters that need care; use letters, digits and _ . - /" }); bad = true; }
      else { const o = { normal: ["-oN", "normal text"], xml: ["-oX", "XML (for other programs)"], grep: ["-oG", "the old grep-friendly text"], all: ["-oA", "all three formats (.nmap, .xml, .gnmap)"] }[v.output]; a(o[0], "save the results as " + o[1], outname); }
    }
    if (file) a("-iL", "read the targets from this file, one per line", file);
    for (const e of ex) { /* joined below */ }
    if (ex.length) a("--exclude", "leave these out of the scan", ex.join(","));
    if (bad) return { outputs: [], notes };
    // notes about what was chosen
    if (root && !v.sudo) notes.push({ level: "info", text: "This scan type needs root (raw packets). Run it with sudo, or tick the sudo box. Without root nmap quietly falls back to a connect scan for -sS." });
    if (mode === "udp" || mode === "both") notes.push({ level: "info", text: "UDP scans are slow (a closed port may answer only once a second). Limit the ports (--top-ports 100) and add --max-retries 1 to keep it short." });
    if (v.scripts === "vuln" || v.scripts === "auth") notes.push({ level: "warn", text: "The \"" + v.scripts + "\" scripts probe for weaknesses and can disturb fragile services. Run them only on systems you own or have permission to test." });
    if (ports === "all" && v.timing !== "4" && v.timing !== "5" && !noPorts) notes.push({ level: "info", text: "All 65535 ports with the default speed can take a long time; -T4 and --max-retries 2 usually help on a reliable network." });
    if (hosts > 65536) notes.push({ level: "warn", text: "About " + (hosts === Infinity ? "an enormous number of" : hosts.toLocaleString("en-US")) + " addresses. Such a scan can take days; scan in smaller pieces and use -F, --top-ports or -sn first." });
    else if (hosts > 1024 && !noPorts) notes.push({ level: "info", text: "About " + hosts.toLocaleString("en-US") + " addresses: consider a ping sweep first (-sn) and then scan only the hosts that answer." });
    if (!listOnly) notes.push({ level: "info", text: "Scan only networks and systems you own or are allowed to test. Scans can trip intrusion alarms and may be against the rules of a network that is not yours." });
    const cmd = (v.sudo ? "sudo " : "") + ["nmap"].concat(args.map(x => { const i = x.indexOf(" "); return i < 0 ? x : x.slice(0, i) + " " + k.shq(x.slice(i + 1)); }), tg.map(k.shq)).join(" ");
    const sum = (listOnly ? "Lists the targets" : pingOnly ? "Finds which hosts are up" : "Scans " + ({ syn: "TCP ports with SYN", connect: "TCP ports with full connections", udp: "UDP ports", both: "TCP and UDP ports", ack: "TCP ports with ACK (firewall mapping)" }[mode])) + " on " + (tg.length + (file ? 1 : 0) > 1 || hosts > 1 ? (hosts === Infinity ? "very many" : hosts.toLocaleString("en-US")) + " address(es)" : "1 address") + ".";
    return { outputs: [{ title: "Command", text: cmd + "\n", hint: sum }], notes, explain };
  }
  const T = (key, label, value, extra) => Object.assign({ key, label, value, type: "text" }, extra || {});
  const S = (key, label, value, options, extra) => Object.assign({ key, label, value, options, type: "select" }, extra || {});
  const C = (key, label, value, extra) => Object.assign({ key, label, value, type: "check" }, extra || {});
  const FIELDS = [
    T("targets", "What to scan", "192.168.1.0/24", { group: "Targets", placeholder: "192.168.1.10 10.0.0.0/24 server.example.net", hint: "Addresses, networks (10.0.0.0/24), ranges (10.0.0-3.1-254) or names, separated by spaces." }),
    T("listfile", "Or read targets from a file (optional)", "", { group: "Targets", placeholder: "targets.txt" }),
    T("exclude", "Leave out (optional)", "", { group: "Targets", placeholder: "192.168.1.1 192.168.1.5" }),
    S("scan", "Scan type", "syn", [["syn", "SYN scan (-sS): fast and the usual choice, needs root"], ["connect", "Connect scan (-sT): no root needed"], ["udp", "UDP scan (-sU): slow"], ["both", "TCP SYN and UDP together"], ["ack", "ACK scan (-sA): map firewall rules"], ["ping", "Only find which hosts are up (-sn)"], ["list", "Only list the targets (-sL)"]], { group: "What kind of scan" }),
    S("ports", "Ports", "default", [["default", "Default: the 1000 most common"], ["fast", "Fast: the 100 most common (-F)"], ["top", "The N most common (--top-ports)"], ["all", "All 65535 ports (-p-)"], ["custom", "My own list (-p)"]], { group: "What kind of scan", showIf: v => v.scan !== "ping" && v.scan !== "list" }),
    T("topn", "How many", "200", { group: "What kind of scan", showIf: v => v.ports === "top" && v.scan !== "ping" && v.scan !== "list" }),
    T("portlist", "Ports", "22,80,443,8000-8100", { group: "What kind of scan", showIf: v => v.ports === "custom" && v.scan !== "ping" && v.scan !== "list", hint: "For example 22,80,443 or 1-1024 or T:80,U:53." }),
    S("disc", "Finding live hosts first", "default", [["default", "Default for the target"], ["skip", "Skip it: treat every host as up (-Pn)"], ["icmp", "ICMP echo (-PE)"], ["syn", "TCP SYN to ports (-PS)"], ["ack", "TCP ACK to ports (-PA)"], ["arp", "ARP, local network only (-PR)"]], { group: "What kind of scan", showIf: v => v.scan !== "list" }),
    T("discports", "Ports for that probe", "22,80,443", { group: "What kind of scan", showIf: v => (v.disc === "syn" || v.disc === "ack") && v.scan !== "list" }),
    C("version", "Find service versions (-sV)", false, { group: "Find out more", showIf: v => v.scan !== "ping" && v.scan !== "list" }),
    C("os", "Guess the operating system (-O)", false, { group: "Find out more", showIf: v => v.scan !== "ping" && v.scan !== "list" }),
    S("scripts", "Scripts", "none", [["none", "None"], ["default", "Default scripts (-sC)"], ["safe", "Safe scripts"], ["discovery", "Discovery scripts"], ["version", "Version scripts"], ["vuln", "Vulnerability scripts"], ["auth", "Authentication scripts"], ["custom", "Scripts I name…"]], { group: "Find out more", showIf: v => v.scan !== "ping" && v.scan !== "list" }),
    T("script", "Script names", "http-title,ssl-cert", { group: "Find out more", showIf: v => v.scripts === "custom" && v.scan !== "ping" && v.scan !== "list" }),
    C("trace", "Trace the path to each host (--traceroute)", false, { group: "Find out more", showIf: v => v.scan !== "ping" && v.scan !== "list" }),
    S("dns", "Host names", "default", [["default", "Default"], ["never", "Never look them up (-n)"], ["always", "Always look them up (-R)"]], { group: "Speed and output" }),
    C("ipv6", "IPv6 (-6)", false, { group: "Speed and output" }),
    S("timing", "Speed template", "", [["", "Default (-T3)"], ["2", "Polite (-T2)"], ["3", "Normal (-T3)"], ["4", "Aggressive (-T4)"], ["5", "Insane (-T5)"], ["1", "Sneaky (-T1)"], ["0", "Paranoid (-T0)"]], { group: "Speed and output" }),
    T("maxrate", "At most this many packets per second (optional)", "", { group: "Speed and output" }),
    T("retries", "Retries per probe (optional)", "", { group: "Speed and output" }),
    T("hosttimeout", "Give up on a host after (optional)", "", { group: "Speed and output", placeholder: "10m" }),
    T("iface", "Network interface (optional)", "", { group: "Speed and output", placeholder: "eth0" }),
    S("verbose", "Progress", "1", [["0", "Quiet"], ["1", "Verbose (-v)"], ["2", "Very verbose (-vv)"]], { group: "Speed and output" }),
    C("open", "Show only open ports (--open)", false, { group: "Speed and output" }),
    C("reason", "Show why (--reason)", false, { group: "Speed and output" }),
    S("output", "Save the results", "none", [["none", "Do not save"], ["normal", "Normal text (-oN)"], ["xml", "XML (-oX)"], ["grep", "Grep-friendly (-oG)"], ["all", "All formats (-oA)"]], { group: "Speed and output" }),
    T("outfile", "File name", "scan-results", { group: "Speed and output", showIf: v => v.output !== "none" }),
    C("sudo", "Start the command with sudo", false, { group: "Speed and output" }),
  ];
  const EXAMPLES = [
    { name: "Which hosts are up on my LAN", values: { targets: "192.168.1.0/24", scan: "ping", sudo: false } },
    { name: "Quick look at one server", values: { targets: "192.168.1.10", scan: "syn", ports: "fast", version: true, timing: "4", sudo: true } },
    { name: "All ports of one host, saved", values: { targets: "192.168.1.10", scan: "syn", ports: "all", timing: "4", retries: "2", output: "all", outfile: "host10", sudo: true } },
    { name: "Web servers: titles and certificates", values: { targets: "192.168.1.0/24", scan: "connect", ports: "custom", portlist: "80,443,8080,8443", scripts: "custom", script: "http-title,ssl-cert", open: true } },
    { name: "Common UDP services", values: { targets: "192.168.1.1", scan: "udp", ports: "custom", portlist: "U:53,67,123,161,500", retries: "1", sudo: true } },
    { name: "Is the firewall letting these ports through", values: { targets: "203.0.113.10", scan: "ack", ports: "custom", portlist: "22,80,443", disc: "skip", sudo: true } },
  ];
  const builder = { fields: FIELDS, build, examples: EXAMPLES };
  const api = { build, builder, FIELDS, EXAMPLES, checkTarget, checkPorts };
  if (typeof window !== "undefined") window.NmapBuild = api;
  if (typeof module !== "undefined") module.exports = api;
})();
