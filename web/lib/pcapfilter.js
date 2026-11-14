/* tcpdump / Wireshark filters: build a capture filter from plain choices, read one in plain words, translate it to a Wireshark display filter.
 *
 * Everything here is pure text work (no network, nothing is run). The BPF capture-filter language ("pcap-filter") is the one libpcap understands, so it is
 * what tcpdump, tshark -f, dumpcap and many other tools accept. Facts that are easy to get wrong were measured against the real tcpdump 4.99 / libpcap 1.10
 * while this was written, and the tests (pcapfilter-test.js, outside the repository) compile every filter with `tcpdump -d` and check what it matches on
 * real captured packets. In particular:
 *   - "and" and "or" have the SAME priority and are read from left to right: "a or b and c" means "(a or b) and c".
 *   - a bare number or address after and/or reuses the qualifiers before it: "port 80 or 443" means "port 80 or port 443". Parentheses stop that.
 *   - tcp[...] and the other byte-offset forms look only at IPv4 (or only at IPv6 for ip6[...]): a TCP-flag filter must be written twice to see both.
 *   - keywords are lower case; a comparison is needed (tcp[13] & 2 alone is an error); "vlan" must come before the things that depend on it.
 * The data model ("AST"): { k:"and"|"or", l, r } (left to right, equal priority), { k:"not", x }, { k:"q", proto, dir, type, id, mask?, plen? } (host, net,
 * port, portrange, proto, protochain), { k:"kw", proto, name, id? } (tcp, ip6, broadcast, vlan 100 ...), { k:"size", op, n } (less, greater) and
 * { k:"rel", op, l, r } with arithmetic { a:"num"|"const"|"len"|"idx"|"bin"|"neg" }. A node may carry desc / disp texts set by the builder.
 * Exports window.PcapFilter. */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ tables */
  const FLAGS = [["fin", 1, "FIN"], ["syn", 2, "SYN"], ["rst", 4, "RST"], ["push", 8, "PSH"], ["ack", 16, "ACK"], ["urg", 32, "URG"], ["ece", 64, "ECE"], ["cwr", 128, "CWR"]];
  const CONSTS = {
    "tcp-fin": 1, "tcp-syn": 2, "tcp-rst": 4, "tcp-push": 8, "tcp-ack": 16, "tcp-urg": 32, "tcp-ece": 64, "tcp-cwr": 128,
    "icmp-echoreply": 0, "icmp-unreach": 3, "icmp-sourcequench": 4, "icmp-redirect": 5, "icmp-echo": 8, "icmp-routeradvert": 9, "icmp-routersolicit": 10,
    "icmp-timxceed": 11, "icmp-paramprob": 12, "icmp-tstamp": 13, "icmp-tstampreply": 14, "icmp-ireq": 15, "icmp-ireqreply": 16, "icmp-maskreq": 17, "icmp-maskreply": 18,
    "icmp6-destinationunreach": 1, "icmp6-packettoobig": 2, "icmp6-timeexceeded": 3, "icmp6-parameterproblem": 4, "icmp6-echo": 128, "icmp6-echoreply": 129,
    "icmp6-multicastlistenerquery": 130, "icmp6-multicastlistenerreportv1": 131, "icmp6-multicastlistenerdone": 132, "icmp6-routersolicit": 133,
    "icmp6-routeradvert": 134, "icmp6-neighborsolicit": 135, "icmp6-neighboradvert": 136, "icmp6-redirect": 137,
    tcpflags: 13, icmptype: 0, icmpcode: 1, icmp6type: 0, icmp6code: 1,
  };
  const ICMP4 = { 0: "echo reply", 3: "destination unreachable", 4: "source quench", 5: "redirect", 8: "echo request (ping)", 9: "router advertisement", 10: "router solicitation", 11: "time exceeded", 12: "parameter problem", 13: "timestamp request", 14: "timestamp reply", 15: "information request", 16: "information reply", 17: "address mask request", 18: "address mask reply" };
  const ICMP6 = { 1: "destination unreachable", 2: "packet too big", 3: "time exceeded", 4: "parameter problem", 128: "echo request (ping)", 129: "echo reply", 130: "multicast listener query", 131: "multicast listener report", 132: "multicast listener done", 133: "router solicitation", 134: "router advertisement", 135: "neighbor solicitation", 136: "neighbor advertisement", 137: "redirect" };
  const ICMP4_UNREACH_CODE = { 0: "network unreachable", 1: "host unreachable", 2: "protocol unreachable", 3: "port unreachable", 4: "fragmentation needed but DF set", 13: "administratively prohibited" };
  const IPPROTO = { 1: "ICMP", 2: "IGMP", 4: "IP-in-IP", 6: "TCP", 17: "UDP", 41: "IPv6 in IPv4", 47: "GRE", 50: "ESP (IPsec)", 51: "AH (IPsec)", 58: "ICMPv6", 88: "EIGRP", 89: "OSPF", 103: "PIM", 112: "VRRP", 115: "L2TP", 132: "SCTP" };
  const IPPROTO_NAME = { icmp: 1, igmp: 2, ipip: 4, tcp: 6, udp: 17, gre: 47, esp: 50, ah: 51, icmp6: 58, eigrp: 88, ospf: 89, pim: 103, vrrp: 112, l2tp: 115, sctp: 132, igrp: 9 };
  const ETHERTYPE = { 0x0800: "IPv4", 0x0806: "ARP", 0x8035: "RARP", 0x8100: "VLAN tag", 0x86dd: "IPv6", 0x8809: "LACP / slow protocols", 0x8847: "MPLS", 0x8863: "PPPoE discovery", 0x8864: "PPPoE session", 0x88cc: "LLDP", 0x88a8: "VLAN tag (QinQ)" };
  const PORTS = { 20: "FTP data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 49: "TACACS+", 53: "DNS", 67: "DHCP server", 68: "DHCP client", 69: "TFTP", 80: "HTTP", 110: "POP3", 123: "NTP", 143: "IMAP", 161: "SNMP", 162: "SNMP traps", 179: "BGP", 389: "LDAP", 443: "HTTPS", 445: "SMB", 500: "IKE (IPsec)", 514: "syslog", 520: "RIP", 546: "DHCPv6 client", 547: "DHCPv6 server", 587: "mail submission", 636: "LDAPS", 853: "DNS over TLS", 993: "IMAPS", 995: "POP3S", 1194: "OpenVPN", 1645: "RADIUS (old auth port)", 1646: "RADIUS (old accounting port)", 1701: "L2TP", 1812: "RADIUS authentication", 1813: "RADIUS accounting", 1985: "HSRP", 2049: "NFS", 3306: "MySQL", 3389: "RDP", 3799: "RADIUS CoA", 4500: "IPsec NAT-T", 5060: "SIP", 5061: "SIP over TLS", 5353: "mDNS", 5432: "PostgreSQL", 51820: "WireGuard (default)" };
  const DSCP = { 0: "CS0 (best effort)", 8: "CS1", 10: "AF11", 12: "AF12", 14: "AF13", 16: "CS2", 18: "AF21", 20: "AF22", 22: "AF23", 24: "CS3", 26: "AF31", 28: "AF32", 30: "AF33", 32: "CS4", 34: "AF41", 36: "AF42", 38: "AF43", 40: "CS5", 46: "EF (voice)", 48: "CS6", 56: "CS7" };

  const PROTO_WORDS = new Set(["ether", "fddi", "tr", "wlan", "ip", "ip6", "arp", "rarp", "decnet", "tcp", "udp", "sctp"]);
  const DIR_WORDS = new Set(["src", "dst"]);
  const TYPE_WORDS = new Set(["host", "net", "port", "portrange", "gateway", "proto", "protochain"]);
  // words that are a complete filter on their own
  const KEYWORDS = new Set(["ip", "ip6", "arp", "rarp", "tcp", "udp", "sctp", "icmp", "icmp6", "igmp", "igrp", "pim", "ah", "esp", "vrrp", "stp", "broadcast", "multicast", "vlan", "mpls", "pppoed", "pppoes"]);
  const INDEX_PROTOS = new Set(["ether", "fddi", "tr", "wlan", "ppp", "slip", "link", "radio", "ip", "ip6", "arp", "rarp", "tcp", "udp", "icmp", "icmp6", "igmp", "igrp", "pim", "vrrp", "sctp"]);
  const RELOPS = new Set(["=", "==", "!=", "<", ">", "<=", ">="]);
  const BIN_LEVELS = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "%"]];   // lowest priority first, as in C (measured against libpcap)

  /* ------------------------------------------------------------------ addresses */
  const isIPv4 = s => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s); return !!m && m.slice(1).every(x => +x <= 255); };
  function isIPv6(s) {
    if (!/^[0-9a-fA-F:.]+$/.test(s) || s.indexOf(":") < 0 || /:::/.test(s) || (s.match(/::/g) || []).length > 1) return false;
    let head = s; const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (m) { if (!isIPv4(m[2])) return false; head = m[1] + "0:0"; }
    const two = head.indexOf("::") >= 0, sides = head.split("::");
    const L = sides[0] ? sides[0].split(":") : [], R = two && sides[1] ? sides[1].split(":") : [];
    const all = two ? L.concat(R) : head.split(":");
    if (!all.every(g => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
    return two ? all.length <= 7 : all.length === 8;
  }
  const isMac = s => /^([0-9a-fA-F]{1,2}:){5}[0-9a-fA-F]{1,2}$/.test(s);
  const v4int = s => s.split(".").reduce((a, o) => a * 256 + (+o), 0);
  const v4str = n => [24, 16, 8, 0].map(sh => Math.floor(n / Math.pow(2, sh)) % 256).join(".");
  function v6big(s) {
    let h = s; const m = /^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
    if (m) h = m[1] + (((+m[2]) << 8) | +m[3]).toString(16) + ":" + (((+m[4]) << 8) | +m[5]).toString(16);
    const two = h.indexOf("::") >= 0, sides = h.split("::"), L = sides[0] ? sides[0].split(":") : [], R = two && sides[1] ? sides[1].split(":") : [];
    const groups = two ? L.concat(new Array(8 - L.length - R.length).fill("0"), R) : h.split(":");
    return groups.reduce((a, g) => (a << 16n) | BigInt(parseInt(g, 16)), 0n);
  }
  function v6str(b) {
    const g = []; for (let i = 7; i >= 0; i--) g.push(Number((b >> BigInt(i * 16)) & 0xffffn).toString(16));
    let best = -1, bl = 0;
    for (let i = 0; i < 8;) { if (g[i] !== "0") { i++; continue; } let j = i; while (j < 8 && g[j] === "0") j++; if (j - i > bl && j - i > 1) { best = i; bl = j - i; } i = j; }
    return best < 0 ? g.join(":") : g.slice(0, best).join(":") + "::" + g.slice(best + bl).join(":");
  }
  // "10.1.2.3/8" -> the network the filter needs ("10.0.0.0/8"); tcpdump refuses an address with host bits set
  function normNet(text) {
    const m = /^([^/\s]+)\/(\d{1,3})$/.exec(text.trim()); if (!m) return null;
    const len = +m[2];
    if (isIPv4(m[1])) { if (len > 32) return null; const mask = len === 0 ? 0 : Math.pow(2, 32) - Math.pow(2, 32 - len), net = Math.floor(v4int(m[1]) / Math.pow(2, 32 - len)) * Math.pow(2, 32 - len); return { text: v4str(net) + "/" + len, changed: net !== v4int(m[1]), v6: false, len, mask }; }
    if (isIPv6(m[1])) { if (len > 128) return null; const a = v6big(m[1]), host = (1n << BigInt(128 - len)) - 1n, net = a & ~host; return { text: v6str(net) + "/" + len, changed: net !== a, v6: true, len }; }
    return null;
  }

  /* ------------------------------------------------------------------ lexer */
  function lex(src) {
    const toks = []; let i = 0, depth = 0; const n = src.length;
    const two = ["&&", "||", "<<", ">>", "==", "!=", "<=", ">="];
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      const d2 = src.substr(i, 2);
      if (two.includes(d2)) { toks.push({ t: "o", s: d2, pos: i }); i += 2; continue; }
      if (c === "[") { depth++; toks.push({ t: "o", s: c, pos: i }); i++; continue; }
      if (c === "]") { depth = Math.max(0, depth - 1); toks.push({ t: "o", s: c, pos: i }); i++; continue; }
      const start = depth ? /[A-Za-z0-9_\\]/ : /[A-Za-z0-9_\\:]/, cont = depth ? /[A-Za-z0-9_\\]/ : /[A-Za-z0-9_.:\-/\\]/;
      if (start.test(c)) {
        let j = i + 1; while (j < n && cont.test(src[j])) j++;
        let s = src.slice(i, j), esc = false; if (s[0] === "\\") { s = s.slice(1); esc = true; }
        toks.push({ t: "w", s, esc, pos: i }); i = j; continue;
      }
      if ("()!&|^+-*/%=<>:".includes(c)) { toks.push({ t: "o", s: c, pos: i }); i++; continue; }
      return { error: { pos: i, msg: "The character " + JSON.stringify(c) + " is not part of the tcpdump filter language." } };
    }
    return { tokens: toks };
  }

  /* ------------------------------------------------------------------ parser */
  class PErr extends Error { constructor(pos, msg) { super(msg); this.pos = pos; } }

  function parse(src) {
    src = String(src == null ? "" : src);
    if (!src.trim()) return { empty: true, ok: false, errors: [], warnings: [] };
    const L = lex(src);
    if (L.error) return { ok: false, errors: [L.error], warnings: [] };
    const T = L.tokens, warnings = [], notes = []; let i = 0, last = null, depth = 0;
    const MAXDEPTH = 60;
    const peek = (k = 0) => T[i + k];
    const isW = (t, ...ws) => !!t && t.t === "w" && !t.esc && ws.includes(t.s);
    const isO = (t, ...os) => !!t && t.t === "o" && os.includes(t.s);
    const here = () => (peek() ? peek().pos : src.length);
    const fail = (msg, pos) => { throw new PErr(pos == null ? here() : pos, msg); };
    const take = () => T[i++];
    const need = what => { const t = peek(); if (!t) fail("The filter ends where " + what + " was expected."); return take(); };

    function expr() {
      let l = unary(), chain = null;
      for (;;) {
        const t = peek();
        const op = isW(t, "and") || isO(t, "&&") ? "and" : isW(t, "or") || isO(t, "||") ? "or" : null;
        if (!op) break;
        i++;
        const r = unary();
        const node = { k: op, l, r };
        if (chain && chain !== op) node.mixed = true;
        chain = op; l = node;
      }
      return l;
    }
    const tooDeep = () => fail("The filter is nested too deeply to read (more than " + MAXDEPTH + " levels of parentheses, \"not\" or brackets).");
    function unary() { if (++depth > MAXDEPTH) tooDeep(); try { return unaryInner(); } finally { depth--; } }
    function unaryInner() {
      const t = peek(); if (!t) fail("The filter ends where a condition was expected.");
      if (isW(t, "not") || isO(t, "!")) { i++; return { k: "not", x: unary() }; }
      if (isO(t, "(")) {
        const save = i, saveLast = last; i++;
        let e = null, ok = true;
        try { e = expr(); if (!isO(peek(), ")")) fail("A closing parenthesis ) is missing here."); i++; }
        catch (x) { if (!(x instanceof PErr)) throw x; ok = false; if (!startsArith(T[save + 1])) throw x; }
        const nx = peek();
        if (ok && !(nx && nx.t === "o" && (RELOPS.has(nx.s) || BIN_LEVELS.some(lv => lv.includes(nx.s))))) { last = null; return e; }
        i = save; last = saveLast;                       // it was the start of a calculation, such as (ip[0] & 0xf) > 5
        return relation();
      }
      return primitive();
    }
    function startsArith(t) { return !!t && ((t.t === "w" && (t.s === "len" || /^(0x[0-9a-fA-F]+|\d+)$/.test(t.s) || (INDEX_PROTOS.has(t.s) && isO(peek(T.indexOf(t) - i + 1), "[")))) || isO(t, "-", "(")); }

    /* ---- arithmetic ---- */
    function arith(level) {
      if (level >= BIN_LEVELS.length) return arithAtom();
      let l = arith(level + 1);
      while (peek() && peek().t === "o" && BIN_LEVELS[level].includes(peek().s)) { const op = take().s; l = { a: "bin", op, l, r: arith(level + 1) }; }
      return l;
    }
    function num(s, pos) {
      if (/^0x[0-9a-fA-F]+$/.test(s)) return { a: "num", v: parseInt(s, 16), raw: s };
      if (/^0[0-7]+$/.test(s)) return { a: "num", v: parseInt(s, 8), raw: s };
      if (/^\d+$/.test(s)) return { a: "num", v: parseInt(s, 10), raw: s };
      return null;
    }
    function arithAtom() { if (++depth > MAXDEPTH) tooDeep(); try { return arithAtomInner(); } finally { depth--; } }
    function arithAtomInner() {
      const t = need("a number or a calculation");
      if (isO(t, "-")) return { a: "neg", x: arithAtom() };
      if (isO(t, "(")) { const e = arith(0); if (!isO(peek(), ")")) fail("A closing parenthesis ) is missing here."); i++; return e; }
      if (t.t !== "w") fail("A number or a calculation was expected here.", t.pos);
      const nn = num(t.s, t.pos); if (nn) return nn;
      if (t.s === "len") return { a: "len" };
      if (Object.prototype.hasOwnProperty.call(CONSTS, t.s)) return { a: "const", name: t.s, v: CONSTS[t.s] };
      if (/^(icmp6?|tcp)-[a-z0-9]+$/.test(t.s)) return { a: "const", name: t.s, v: null };
      if (INDEX_PROTOS.has(t.s) && isO(peek(), "[")) {
        i++; const off = arith(0); let size = 1;
        if (isO(peek(), ":")) { i++; const s = need("the size 1, 2 or 4"); if (!["1", "2", "4"].includes(s.s)) fail("The size after the colon must be 1, 2 or 4 (bytes).", s.pos); size = +s.s; }
        if (!isO(peek(), "]")) fail("A closing bracket ] is missing here.");
        i++; return { a: "idx", proto: t.s, off, size };
      }
      fail("I do not know the word \"" + t.s + "\" inside a calculation.", t.pos);
    }
    function relation() {
      const l = arith(0), t = peek();
      if (!(t && t.t === "o" && RELOPS.has(t.s))) fail("A comparison such as = or != or > is needed: tcpdump does not accept a calculation on its own (write \"... != 0\").");
      i++; const r = arith(0);
      last = null;
      return { k: "rel", op: t.s === "==" ? "=" : t.s, l, r };
    }

    /* ---- primitives ---- */
    const RESERVED = new Set(["and", "or", "not", "src", "dst", "host", "net", "port", "portrange", "gateway", "proto", "protochain", "less", "greater", "len", "mask"]);
    function idWord(what) {
      const t = peek(); if (!t || t.t !== "w") fail("A " + what + " was expected here.");
      if (!t.esc && RESERVED.has(t.s)) fail("A " + what + " was expected here, not the word \"" + t.s + "\".", t.pos);
      i++; return t;
    }
    function checkHost(t, proto) {
      const s = t.s;
      if (proto === "ether") { if (!isMac(s)) fail("\"" + s + "\" is not an Ethernet (MAC) address such as aa:bb:cc:dd:ee:ff.", t.pos); return; }
      if (/^[0-9.]+$/.test(s) && !isIPv4(s)) fail("\"" + s + "\" is not a valid IPv4 address.", t.pos);
      if (s.indexOf(":") >= 0 && !isIPv6(s) && !isMac(s)) fail("\"" + s + "\" is not a valid IPv6 address.", t.pos);
    }
    function netId(proto) {
      const t = idWord("network"); let id = t.s, mask = null, plen = null;
      const m = /^(.*)\/(\d+)$/.exec(id);
      if (m) {
        plen = +m[2]; id = m[1];
        if (isIPv4(id)) { if (plen > 32) fail("A prefix length for an IPv4 network is 0 to 32.", t.pos); const n = normNet(id + "/" + plen); if (n && n.changed) fail("tcpdump refuses \"" + t.s + "\": the address has bits set that the /" + plen + " prefix leaves to hosts. Use " + n.text + ".", t.pos); }
        else if (isIPv6(id)) { if (plen > 128) fail("A prefix length for an IPv6 network is 0 to 128.", t.pos); const n = normNet(id + "/" + plen); if (n && n.changed) fail("tcpdump refuses \"" + t.s + "\": the address has bits set that the /" + plen + " prefix leaves to hosts. Use " + n.text + ".", t.pos); }
        else fail("\"" + id + "\" is not a network address.", t.pos);
      } else if (isW(peek(), "mask")) {
        i++; const mk = idWord("netmask"); mask = mk.s;
        if (!isIPv4(mask)) fail("\"" + mask + "\" is not a valid IPv4 netmask.", mk.pos);
        if (!/^[0-9.]+$/.test(id)) fail("\"" + id + "\" is not a network address.", t.pos);
      } else if (!/^[0-9.]+$/.test(id) && !isIPv6(id)) { /* a network name from /etc/networks */ }
      return { id, mask, plen };
    }
    function portId(range) {
      const t = idWord(range ? "port range such as 8000-8100" : "port number");
      if (range) { const m = /^(\d+)(?:-(\d+))?$/.exec(t.s); if (!m || +m[1] > 65535 || (m[2] != null && +m[2] > 65535)) fail("A port range is written like 8000-8100 (ports 0 to 65535).", t.pos); return t.s; }
      if (/^\d+$/.test(t.s)) { if (+t.s > 65535) fail("A port number is 0 to 65535.", t.pos); return t.s; }
      if (!/^[a-z][a-z0-9_-]*$/.test(t.s)) fail("\"" + t.s + "\" is not a port number or service name.", t.pos);
      return t.s;
    }
    function primitive() {
      const t = peek(); if (!t) fail("The filter ends where a condition was expected.");
      if (t.t !== "w") fail("A condition was expected here, not \"" + t.s + "\".", t.pos);
      if (!t.esc && (t.s === "len" || (INDEX_PROTOS.has(t.s) && isO(peek(1), "[")) || (/^(0x[0-9a-fA-F]+|\d+)$/.test(t.s) && !(last && !(peek(1) && peek(1).t === "o" && (RELOPS.has(peek(1).s) || BIN_LEVELS.some(lv => lv.includes(peek(1).s)))))))) return relation();
      if (!t.esc && (t.s === "less" || t.s === "greater")) { i++; const n = idWord("length in bytes"); if (!/^\d+$/.test(n.s)) fail("A length in bytes (a whole number) is needed after \"" + t.s + "\".", n.pos); last = null; return { k: "size", op: t.s, n: +n.s }; }
      // [proto] [dir] [type] id
      const q = { proto: null, dir: null, type: null }; let any = false;
      if (!t.esc && PROTO_WORDS.has(t.s)) { q.proto = t.s; i++; any = true; }
      let d = peek();
      if (isW(d, "src", "dst")) {
        const n1 = peek(1), n2 = peek(2);
        if (n1 && (isW(n1, "or") || isW(n1, "and")) && n2 && isW(n2, d.s === "src" ? "dst" : "src")) { q.dir = d.s + " " + n1.s + " " + n2.s; i += 3; }
        else { q.dir = d.s; i++; }
        any = true;
      }
      d = peek();
      if (d && d.t === "w" && !d.esc && TYPE_WORDS.has(d.s)) { q.type = d.s; i++; any = true; }
      if (q.type) {
        if (q.type === "net") { const n = netId(q.proto); last = { proto: q.proto, dir: q.dir, type: "net" }; return { k: "q", proto: q.proto, dir: q.dir, type: "net", id: n.id, mask: n.mask, plen: n.plen }; }
        if (q.type === "port") { const id = portId(false); last = { proto: q.proto, dir: q.dir, type: "port" }; return { k: "q", proto: q.proto, dir: q.dir, type: "port", id }; }
        if (q.type === "portrange") { const id = portId(true); last = { proto: q.proto, dir: q.dir, type: "portrange" }; return { k: "q", proto: q.proto, dir: q.dir, type: "portrange", id }; }
        if (q.type === "proto" || q.type === "protochain") { const w = idWord("protocol number or name"); if (!/^(\d+|0x[0-9a-fA-F]+|[a-z][a-z0-9_-]*)$/.test(w.s)) fail("\"" + w.s + "\" is not a protocol number or name.", w.pos); const pv = /^\d+$/.test(w.s) ? +w.s : /^0x/i.test(w.s) ? parseInt(w.s, 16) : null; if (pv != null && pv > (q.proto === "ether" ? 65535 : 255)) fail(q.proto === "ether" ? "An Ethernet type is 0 to 65535 (0xffff)." : "An IP protocol number is 0 to 255.", w.pos); last = { proto: q.proto, dir: q.dir, type: q.type }; return { k: "q", proto: q.proto, dir: q.dir, type: q.type, id: w.s, esc: w.esc }; }
        if (q.type === "gateway") { const w = idWord("host name"); last = null; return { k: "q", proto: q.proto, dir: q.dir, type: "gateway", id: w.s }; }
        const w = idWord("address"); checkHost(w, q.proto); last = { proto: q.proto, dir: q.dir, type: "host" };
        return { k: "q", proto: q.proto, dir: q.dir, type: "host", id: w.s };
      }
      if (q.dir) { const w = idWord("address"); checkHost(w, q.proto); last = { proto: q.proto, dir: q.dir, type: "host" }; return { k: "q", proto: q.proto, dir: q.dir, type: "host", id: w.s }; }
      if (q.proto) {
        const nx = peek();
        if (isW(nx, "broadcast", "multicast") && ["ip", "ip6", "ether"].includes(q.proto)) { i++; last = null; return { k: "kw", proto: q.proto, name: nx.s }; }
        if (["ether", "fddi", "tr", "wlan", "decnet"].includes(q.proto)) fail("\"" + q.proto + "\" needs something after it, such as host, src, dst, proto or broadcast.");
        last = null; return { k: "kw", proto: null, name: q.proto };
      }
      // a complete one-word filter
      if (!t.esc && KEYWORDS.has(t.s)) {
        i++; last = null;
        if (t.s === "vlan" || t.s === "mpls") { const n = peek(); if (n && n.t === "w" && /^\d+$/.test(n.s)) { i++; const max = t.s === "vlan" ? 4095 : 1048575; if (+n.s > max) fail("A " + t.s + " " + (t.s === "vlan" ? "ID" : "label") + " is 0 to " + max + ".", n.pos); return { k: "kw", proto: null, name: t.s, id: n.s }; } }
        return { k: "kw", proto: null, name: t.s };
      }
      // a bare address or number: it reuses the qualifiers of the condition before it ("port 80 or 443")
      if (last) {
        const w = take();
        if (last.type === "port") { if (!/^\d+$/.test(w.s) && !/^[a-z][a-z0-9_-]*$/.test(w.s)) fail("\"" + w.s + "\" is not a port.", w.pos); }
        else if (last.type === "portrange") { if (!/^\d+-\d+$/.test(w.s)) fail("\"" + w.s + "\" is not a port range such as 8000-8100.", w.pos); }
        else if (last.type === "host") checkHost(w, last.proto);
        notes.push({ level: "info", text: "\"" + w.s + "\" has no keyword in front of it, so tcpdump reuses the one before it: it reads \"" + [last.proto, last.dir, last.type, w.s].filter(Boolean).join(" ") + "\"." });
        return { k: "q", proto: last.proto, dir: last.dir, type: last.type, id: w.s, inherited: true };
      }
      fail("I do not know the word \"" + t.s + "\" here. A filter starts with a keyword such as host, net, port, tcp, udp, icmp or arp (keywords are written in lower case).", t.pos);
    }

    try {
      const ast = expr();
      if (peek()) fail(isO(peek(), ")") ? "There is a closing parenthesis ) without an opening one." : "I did not expect \"" + peek().s + "\" here: two conditions need and / or between them.");
      const w = [];
      (function walk(n) { if (!n) return; if (n.mixed) w.push({ level: "warn", text: "\"and\" and \"or\" have the same priority in tcpdump and are read from left to right, so \"A or B and C\" means \"(A or B) and C\". Without your own parentheses this part is read as: " + print(n) + ". Add parentheses to say what you mean." }); walk(n.l); walk(n.r); walk(n.x); })(ast);
      return { ok: true, ast, errors: [], warnings: w.concat(notes) };
    } catch (e) {
      if (!(e instanceof PErr)) throw e;
      return { ok: false, errors: [{ pos: e.pos, msg: e.message }], warnings: [] };
    }
  }

  /* ------------------------------------------------------------------ printer */
  const PREC = { "|": 1, "^": 2, "&": 3, "<<": 4, ">>": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
  function printA(a, parent) {
    switch (a.a) {
      case "num": return a.raw != null ? a.raw : String(a.v);
      case "const": return a.name;
      case "len": return "len";
      case "neg": return "-" + printA(a.x, 9);
      case "idx": { const off = printA(a.off, 0); return a.proto + "[" + (a.size !== 1 && a.off.a === "bin" ? "(" + off + ")" : off) + (a.size !== 1 ? ":" + a.size : "") + "]"; }
      case "bin": { const s = printA(a.l, PREC[a.op]) + " " + a.op + " " + printA(a.r, PREC[a.op] + 0.5); return parent != null && PREC[a.op] < parent ? "(" + s + ")" : s; }
    }
    return "?";
  }
  function printQ(n) {
    const parts = [];
    if (n.proto) parts.push(n.proto);
    if (n.dir) parts.push(n.dir);
    if (n.type) parts.push(n.type);
    parts.push(n.esc ? "\\" + n.id : n.id);
    if (n.mask) parts.push("mask", n.mask);
    else if (n.plen != null) parts[parts.length - 1] += "/" + n.plen;
    return parts.join(" ");
  }
  function print(n) {
    switch (n.k) {
      case "and": case "or": {
        const l = (n.l.k === "and" || n.l.k === "or") && n.l.k !== n.k ? "(" + print(n.l) + ")" : print(n.l);
        const r = n.r.k === "and" || n.r.k === "or" ? "(" + print(n.r) + ")" : print(n.r);
        return l + " " + n.k + " " + r;
      }
      case "not": return "not " + ((n.x.k === "and" || n.x.k === "or") ? "(" + print(n.x) + ")" : print(n.x));
      case "q": return printQ(n);
      case "kw": return [n.proto, n.name, n.id].filter(Boolean).join(" ");
      case "size": return n.op + " " + n.n;
      case "rel": return printA(n.l, 0) + " " + (n.op === "=" ? "=" : n.op) + " " + printA(n.r, 0);
    }
    return "?";
  }

  /* ------------------------------------------------------------------ explaining */
  const hex = n => "0x" + n.toString(16);
  function evalA(a) {
    switch (a.a) {
      case "num": return a.v;
      case "const": return a.v;
      case "neg": { const v = evalA(a.x); return v == null ? null : -v; }
      case "bin": { const l = evalA(a.l), r = evalA(a.r); if (l == null || r == null) return null; switch (a.op) { case "+": return l + r; case "-": return l - r; case "*": return l * r; case "/": return r ? Math.trunc(l / r) : null; case "%": return r ? l % r : null; case "&": return Number(BigInt(l) & BigInt(r)); case "|": return Number(BigInt(l) | BigInt(r)); case "^": return Number(BigInt(l) ^ BigInt(r)); case "<<": return l * Math.pow(2, r); case ">>": return Math.floor(l / Math.pow(2, r)); } return null; }
    }
    return null;
  }
  const flagList = mask => FLAGS.filter(f => mask & f[1]).map(f => f[2]);
  const HDR = { tcp: "TCP header", udp: "UDP header", icmp: "ICMP header", icmp6: "ICMPv6 header", ip: "IPv4 header", ip6: "IPv6 header", ether: "Ethernet header", arp: "ARP packet" };
  function textA(a) {
    switch (a.a) {
      case "num": return a.raw != null && /^0/.test(a.raw) ? a.raw : String(a.v);
      case "const": return a.name;
      case "len": return "the frame length";
      case "neg": return "-" + textA(a.x);
      case "idx": { const o = evalA(a.off); return (a.size === 1 ? "byte " : a.size + " bytes at offset ") + (o != null ? o : "(" + textA(a.off) + ")") + " of the " + (HDR[a.proto] || a.proto) + (a.proto === "tcp" && o === 13 ? " (the flags)" : ""); }
      case "bin": return "(" + textA(a.l) + " " + a.op + " " + textA(a.r) + ")";
    }
    return "?";
  }
  const OPW = { "=": "equals", "!=": "is not", "<": "is less than", ">": "is more than", "<=": "is at most", ">=": "is at least" };
  function payloadOffset(a) {   // the usual way to reach the first byte of the TCP data: ((tcp[12] & 0xf0) >> 2), maybe plus a number
    let extra = 0, e = a;
    if (e.a === "bin" && e.op === "+" && evalA(e.r) != null) { extra = evalA(e.r); e = e.l; }
    if (e.a === "bin" && e.op === ">>" && evalA(e.r) === 2 && e.l.a === "bin" && e.l.op === "&" && evalA(e.l.r) === 0xf0 && e.l.l.a === "idx" && e.l.l.proto === "tcp" && evalA(e.l.l.off) === 12) return extra;
    if (e.a === "bin" && e.op === ">>" && evalA(e.r) === 2 && e.l.a === "idx" && e.l.proto === "tcp" && evalA(e.l.off) === 12) return extra;   // sloppy form (tcp[12] >> 2): keeps the high bits
    return null;
  }
  const ascii = (v, size) => { let s = ""; for (let k = size - 1; k >= 0; k--) { const c = Math.floor(v / Math.pow(256, k)) % 256; if (c < 32 || c > 126) return null; s += String.fromCharCode(c); } return s; };
  // plain words for one comparison
  function describeRel(n) {
    let l = n.l, r = n.r, op = n.op;
    if (evalA(l) != null && evalA(r) == null) { const t = l; l = r; r = t; op = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" }[op] || op; }
    const rv = evalA(r);
    if (rv != null) {
      let mask = null, base = l;
      if (l.a === "bin" && l.op === "&" && evalA(l.r) != null && l.l.a === "idx") { mask = evalA(l.r); base = l.l; } else if (l.a === "bin" && l.op === "&" && evalA(l.l) != null && l.r.a === "idx") { mask = evalA(l.l); base = l.r; }
      if (base.a === "idx") {
        const off = evalA(base.off), p = base.proto;
        const isFlags = (p === "tcp" && off === 13 && base.size === 1) || (p === "ip6" && off === 53 && base.size === 1);
        if (isFlags && (op === "=" || op === "!=")) {
          const m = mask == null ? 255 : mask, where = p === "ip6" ? "TCP flags (IPv6, assuming no extension headers)" : "TCP flags";
          if (m === 255 && rv === 0 && op === "=") return where + ": none set (a \"null\" packet)";
          if (op === "!=" && rv === 0) return where + ": at least one of " + flagList(m).join(", ") + " is set";
          if (op === "=") {
            const on = flagList(rv & m), off2 = flagList(m & ~rv);
            return where + ": " + (on.length ? on.join(" + ") + " set" : "") + (on.length && off2.length ? ", " : "") + (off2.length ? off2.join(" + ") + " not set" : "") + (m !== 255 ? "; the other flags do not matter" : "; nothing else set");
          }
          if (op === "!=") return where + ": anything except exactly " + (flagList(rv).join(" + ") || "no flags") + " (looking at " + flagList(m).join(", ") + ")";
        }
        if (mask == null && base.size === 1 && off === 0 && (p === "icmp" || p === "icmp6") && (op === "=" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=")) {
          const names = p === "icmp" ? ICMP4 : ICMP6;
          return (p === "icmp" ? "ICMP" : "ICMPv6") + " type " + OPW[op].replace("equals", "is") + " " + rv + (names[rv] && (op === "=" || op === "!=") ? " (" + names[rv].replace(/ \((.*)\)$/, ", $1") + ")" : "");
        }
        if (mask == null && base.size === 1 && off === 1 && p === "icmp") return "ICMP code " + OPW[op].replace("equals", "is") + " " + rv + (ICMP4_UNREACH_CODE[rv] ? " (for \"destination unreachable\": " + ICMP4_UNREACH_CODE[rv] + ")" : "");
        if (mask == null && base.size === 1 && off === 1 && p === "icmp6") return "ICMPv6 code " + OPW[op].replace("equals", "is") + " " + rv;
        if (mask == null && base.size === 1 && off === 8 && p === "ip") return "IPv4 time to live (TTL) " + OPW[op] + " " + rv;
        if (mask == null && base.size === 1 && off === 7 && p === "ip6") return "IPv6 hop limit " + OPW[op] + " " + rv;
        if (p === "ip" && off === 1 && base.size === 1 && mask === 0xfc && (op === "=" || op === "!=") && rv % 4 === 0) return "IPv4 DSCP " + OPW[op].replace("equals", "is") + " " + rv / 4 + (DSCP[rv / 4] ? " (" + DSCP[rv / 4] + ")" : "");
        if (p === "ip6" && off === 0 && base.size === 2 && mask === 0x0fc0 && (op === "=" || op === "!=") && rv % 64 === 0) return "IPv6 DSCP " + OPW[op].replace("equals", "is") + " " + rv / 64 + (DSCP[rv / 64] ? " (" + DSCP[rv / 64] + ")" : "");
        if (p === "ip" && off === 6 && base.size === 2 && mask === 0x3fff && op === "!=" && rv === 0) return "IPv4 fragments (more fragments set, or not the first piece)";
        if (p === "ip" && off === 6 && base.size === 1 && mask === 0x40 && op === "!=" && rv === 0) return "IPv4 \"don't fragment\" (DF) flag set";
        if (p === "ip" && off === 6 && base.size === 1 && mask === 0x40 && op === "=" && rv === 0) return "IPv4 \"don't fragment\" (DF) flag not set";
        if (p === "ip" && off === 6 && base.size === 2 && mask === 0x1fff && op === "!=" && rv === 0) return "IPv4 fragments after the first (non-zero fragment offset)";
        if (p === "ip6" && off === 6 && base.size === 1 && mask == null && op === "=") return "IPv6 next header " + OPW[op].replace("equals", "is") + " " + rv + (IPPROTO[rv] ? " (" + IPPROTO[rv] + ")" : "") + ", i.e. the transport header follows directly";
        if (p === "ip" && off === 9 && base.size === 1 && mask == null) return "IPv4 protocol " + OPW[op].replace("equals", "is") + " " + rv + (IPPROTO[rv] ? " (" + IPPROTO[rv] + ")" : "");
      }
      if (base.a === "bin" && base.op === ">>" && base.l.a === "idx" && base.l.proto === "ip" && evalA(base.l.off) === 1 && evalA(base.r) === 2 && (op === "=" || op === "!=")) return "IPv4 DSCP " + OPW[op].replace("equals", "is") + " " + rv + (DSCP[rv] ? " (" + DSCP[rv] + ")" : "");
      if (base.a === "idx" && base.proto === "tcp") {
        const po = payloadOffset(base.off);
        if (po != null && op === "=") {
          const a = ascii(rv, base.size), at = po === 0 ? "The data (payload) of the TCP segment starts with" : "In the data of the TCP segment, " + base.size + " byte" + (base.size > 1 ? "s" : "") + " at offset " + po + " are";
          let hint = ""; if (po === 0 && base.size === 1 && rv === 0x16) hint = " (the first byte of a TLS handshake record)"; else if (po === 5 && base.size === 1 && rv === 1) hint = " (in TLS data: the handshake type ClientHello)";
          return at + " " + (a != null ? "\"" + a + "\" (" + hex(rv) + ")" : hex(rv)) + hint;
        }
      }
      if (mask != null && (op === "!=" || op === "=") && rv === 0) return textA(base) + (op === "!=" ? " has at least one of the bits " : " has none of the bits ") + hex(mask) + " set";
      if (mask != null && op === "=" && rv === mask) return textA(base) + " has all of the bits " + hex(mask) + " set";
    }
    return textA(l) + " " + OPW[op] + " " + textA(r);
  }
  function dirWord(d, fromTo) { return d === "src" ? fromTo[0] : d === "dst" ? fromTo[1] : d === "src or dst" || !d ? fromTo[2] : d === "src and dst" ? fromTo[3] : d; }
  function describeLeaf(n) {
    if (n.desc) return n.desc;
    switch (n.k) {
      case "q": {
        const pr = n.proto === "ip" ? " (IPv4 only)" : n.proto === "ip6" ? " (IPv6 only)" : n.proto === "arp" || n.proto === "rarp" ? " (" + n.proto.toUpperCase() + " packets)" : "";
        if (n.type === "host") {
          if (n.proto === "ether") return dirWord(n.dir, ["From", "To", "From or to", "From and to"]) + " the Ethernet (MAC) address " + n.id;
          return dirWord(n.dir, ["From", "To", "From or to", "From and to"]) + " " + (isIPv4(n.id) || isIPv6(n.id) ? "address " : "host ") + n.id + pr;
        }
        if (n.type === "net") return dirWord(n.dir, ["From", "To", "From or to", "From and to"]) + " the network " + n.id + (n.mask ? " with netmask " + n.mask : n.plen != null ? "/" + n.plen : "") + pr;
        if (n.type === "port" || n.type === "portrange") {
          const what = n.type === "port" ? "port " + n.id + (PORTS[n.id] ? " (" + PORTS[n.id] + ")" : "") : "ports " + n.id.replace("-", " to ");
          const pn = n.proto === "tcp" ? "TCP " : n.proto === "udp" ? "UDP " : n.proto === "sctp" ? "SCTP " : "";
          return pn + what.charAt(0).toUpperCase() + what.slice(1) + " " + dirWord(n.dir, ["as the source", "as the destination", "on either side", "on both sides"]) + (pn ? "" : " (TCP, UDP or SCTP)") + (n.proto === "ip" || n.proto === "ip6" ? " in " + (n.proto === "ip" ? "IPv4" : "IPv6") + " only" : "");
        }
        if (n.type === "proto" || n.type === "protochain") {
          const v = /^\d+$/.test(n.id) ? +n.id : IPPROTO_NAME[n.id];
          const nm = v != null && IPPROTO[v] ? IPPROTO[v] : n.id;
          if (n.proto === "ether") { const e = /^\d+$|^0x/i.test(n.id) ? parseInt(n.id) : null; return "Ethernet type " + n.id + (e != null && ETHERTYPE[e] ? " (" + ETHERTYPE[e] + ")" : ""); }
          return (n.proto === "ip" ? "IPv4" : n.proto === "ip6" ? "IPv6" : "IPv4 or IPv6") + " packets carrying " + nm + " (protocol " + (v != null ? v : n.id) + ")" + (n.type === "protochain" ? ", anywhere in the chain of headers" : "");
        }
        if (n.type === "gateway") return "Packets using " + n.id + " as the gateway (first hop)";
        return printQ(n);
      }
      case "kw": {
        const m = { tcp: "TCP (IPv4 or IPv6)", udp: "UDP (IPv4 or IPv6)", sctp: "SCTP", icmp: "ICMP (IPv4)", icmp6: "ICMPv6", igmp: "IGMP", igrp: "IGRP", pim: "PIM", ah: "IPsec AH", esp: "IPsec ESP", vrrp: "VRRP", arp: "ARP", rarp: "RARP", ip: "IPv4", ip6: "IPv6", stp: "Spanning tree (STP) frames", pppoed: "PPPoE discovery", pppoes: "PPPoE session" };
        if (n.name === "broadcast") return n.proto === "ip" ? "IPv4 broadcast" : "Ethernet broadcast (to ff:ff:ff:ff:ff:ff)";
        if (n.name === "multicast") return n.proto === "ip" ? "IPv4 multicast (destination 224.0.0.0 or higher: tcpdump also counts the reserved range and the broadcast address 255.255.255.255)" : n.proto === "ip6" ? "IPv6 multicast" : n.proto === "ether" ? "Ethernet multicast" : "Multicast (Ethernet or IP)";
        if (n.name === "vlan") return n.id ? "VLAN " + n.id + " (tagged frames only)" : "VLAN-tagged frames";
        if (n.name === "mpls") return n.id ? "MPLS label " + n.id : "MPLS-labelled frames";
        return m[n.name] || n.name;
      }
      case "size": return n.op === "less" ? "At most " + n.n + " bytes long (the whole frame, headers included)" : "At least " + n.n + " bytes long (the whole frame, headers included)";
      case "rel": return describeRel(n);
    }
    return print(n);
  }
  function collect(n, op, out) { if (n.k === op && !n.desc) { collect(n.l, op, out); out.push(n.r); } else out.push(n); return out; }
  function lines(n, d, out) {
    if (n.k === "and" || n.k === "or") {
      if (n.desc) { out.push({ d, text: n.desc }); return; }
      const items = collect(n, n.k, []);
      out.push({ d, text: n.k === "and" ? "ALL of these must be true:" : "ANY ONE of these is enough:" });
      for (const it of items) lines(it, d + 1, out);
    } else if (n.k === "not" && !n.desc) {
      const x = n.x;
      if (x.k === "and" || x.k === "or") { out.push({ d, text: "NOT this:" }); lines(x, d + 1, out); }
      else { const sub = []; lines(x, 0, sub); out.push({ d, text: "NOT: " + sub[0].text }); for (const s of sub.slice(1)) out.push({ d: d + s.d, text: s.text }); }
    } else out.push({ d, text: describeLeaf(n) });
  }
  function notesFor(ast) {
    const notes = []; let sawV6Gap = false, sawIdx = {}, vlanSeen = false, vlanLate = false, ordered = 0, hasHostName = false, hasHost4 = false, ipv6Direct = false;
    (function walk(n, inOr, pos) {
      if (!n) return;
      if (n.k === "and" || n.k === "or") { walk(n.l, inOr || n.k === "or", pos); walk(n.r, inOr || n.k === "or", pos + 1); return; }
      if (n.k === "not") { walk(n.x, inOr, pos); return; }
      ordered++;
      if (n.k === "kw" && n.name === "vlan") { if (ordered > 1 || inOr) vlanLate = true; vlanSeen = true; }
      if (n.k === "q" && n.type === "host" && n.proto == null && isIPv4(n.id)) hasHost4 = true;
      if (n.k === "q" && n.type === "host" && n.proto !== "ether" && !isIPv4(n.id) && !isIPv6(n.id)) hasHostName = true;
      if (n.k === "q" && (n.type === "port" || n.type === "portrange") || n.k === "kw" && ["tcp", "udp", "icmp6", "sctp"].includes(n.name)) ipv6Direct = true;
      const scan = a => { if (!a) return; if (a.a === "idx") sawIdx[a.proto] = true; scan(a.l); scan(a.r); scan(a.x); scan(a.off); };
      if (n.k === "rel") { scan(n.l); scan(n.r); }
    })(ast, false, 0);
    if (vlanLate) notes.push({ level: "warn", text: "\"vlan\" changes how everything AFTER it is read (the offsets assume a VLAN tag), and tcpdump refuses some filters that put it later or combine it with \"or\". Put \"vlan ...\" first and join the rest with \"and\"." });
    if ((sawIdx.tcp || sawIdx.udp || sawIdx.icmp || sawIdx.ip) && !sawIdx.ip6 && !sawIdx.icmp6) notes.push({ level: "info", text: "Offset forms such as tcp[...], udp[...], icmp[...] and ip[...] look at IPv4 packets only. For IPv6 use ip6[...] (the TCP flags byte is then ip6[53], if no extension header sits in between) or icmp6[...]." });
    if (ipv6Direct) notes.push({ level: "info", text: "For IPv6, tcpdump recognises tcp, udp, icmp6 and ports only when the transport header follows the IPv6 header directly. Packets with extension headers in between (for example a fragment header) are not matched." });
    if (hasHost4) notes.push({ level: "info", text: "\"host\" with an IPv4 address also matches ARP (and RARP) packets that mention that address, not only IP traffic. Use \"ip host ...\" for IP traffic only." });
    if (hasHostName) notes.push({ level: "info", text: "A host name is looked up in DNS when tcpdump starts. Use the IP address if you want to be sure which address it is." });
    return notes;
  }
  function explain(ast) {
    const ls = []; lines(ast, 0, ls);
    const head = ast.k === "and" || ast.k === "or" || ast.k === "not" ? null : "Matches packets that are:";
    return { head: head || "Matches packets where:", lines: ls, notes: notesFor(ast), text: (head || "Matches packets where:") + "\n" + ls.map(l => "  ".repeat(l.d + (head ? 1 : 0)) + (l.d || head ? "- " : "") + l.text).join("\n") };
  }

  /* ------------------------------------------------------------------ Wireshark display filter */
  function wsQ(n) {
    const d = n.dir, fam = isIPv6(n.id) ? "ipv6" : "ip";
    const two = (a, b) => d === "src" ? a.src : d === "dst" ? a.dst : d === "src and dst" ? "(" + a.src + " && " + a.dst + ")" : a.any != null ? a.any : "(" + a.src + " || " + a.dst + ")";
    if (n.type === "host") {
      if (n.proto === "ether") return two({ src: "eth.src == " + n.id, dst: "eth.dst == " + n.id, any: "eth.addr == " + n.id });
      if (n.proto === "arp" || n.proto === "rarp") return isIPv4(n.id) ? two({ src: "arp.src.proto_ipv4 == " + n.id, dst: "arp.dst.proto_ipv4 == " + n.id, any: "(arp.src.proto_ipv4 == " + n.id + " || arp.dst.proto_ipv4 == " + n.id + ")" }) : null;
      if (!isIPv4(n.id) && !isIPv6(n.id)) return null;
      return two({ src: fam + ".src == " + n.id, dst: fam + ".dst == " + n.id, any: fam + ".addr == " + n.id });
    }
    if (n.type === "net") {
      if (n.mask) return null;
      const v6 = n.id.indexOf(":") >= 0, f = v6 ? "ipv6" : "ip", full = n.id + (n.plen != null ? "/" + n.plen : "");
      if (!v6 && !isIPv4(n.id)) return null;
      return two({ src: f + ".src == " + full, dst: f + ".dst == " + full, any: f + ".addr == " + full });
    }
    if (n.type === "port" || n.type === "portrange") {
      if (!/^[\d-]+$/.test(n.id)) return null;
      const protos = n.proto === "tcp" || n.proto === "udp" || n.proto === "sctp" ? [n.proto] : ["tcp", "udp", "sctp"];
      const val = f => n.type === "port" ? f + " == " + n.id : f + " in {" + n.id.replace("-", "..") + "}";
      const parts = protos.map(p => two({ src: val(p + ".srcport"), dst: val(p + ".dstport"), any: val(p + ".port") }));
      return parts.length === 1 ? parts[0] : "(" + parts.join(" || ") + ")";
    }
    if (n.type === "proto" || n.type === "protochain") {
      if (n.proto === "ether") { const e = parseInt(n.id); return isNaN(e) ? null : "eth.type == " + hex(e); }
      const v = /^\d+$/.test(n.id) ? +n.id : IPPROTO_NAME[n.id]; if (v == null) return null;
      return n.proto === "ip" ? "ip.proto == " + v : n.proto === "ip6" ? "ipv6.nxt == " + v : "(ip.proto == " + v + " || ipv6.nxt == " + v + ")";
    }
    return null;
  }
  function wsRel(n) {
    let l = n.l, r = n.r, op = n.op;
    if (evalA(l) != null && evalA(r) == null) { const t = l; l = r; r = t; op = { "<": ">", ">": "<", "<=": ">=", ">=": "<=" }[op] || op; }
    const rv = evalA(r); if (rv == null) return null;
    let mask = null, base = l;
    if (l.a === "bin" && l.op === "&" && evalA(l.r) != null && l.l.a === "idx") { mask = evalA(l.r); base = l.l; }
    if (base.a === "idx") {
      const off = evalA(base.off), p = base.proto, w = op === "=" ? "==" : op;
      if (((p === "tcp" && off === 13) || (p === "ip6" && off === 53)) && base.size === 1 && (op === "=" || op === "!=")) {
        const m = mask == null ? 255 : mask, ps = [];
        if (op === "=") { for (const f of FLAGS) if (m & f[1]) { const nm = f[0] === "push" ? "push" : f[0] === "rst" ? "reset" : f[0]; ps.push("tcp.flags." + nm + " == " + ((rv & f[1]) ? 1 : 0)); } return ps.length ? ps.join(" && ") : null; }
        if (rv === 0) { for (const f of FLAGS) if (m & f[1]) ps.push("tcp.flags." + (f[0] === "rst" ? "reset" : f[0]) + " == 1"); return ps.length > 1 ? "(" + ps.join(" || ") + ")" : ps[0] || null; }
        return null;
      }
      if (mask == null && base.size === 1 && off === 0 && p === "icmp") return "icmp.type " + w + " " + rv;
      if (mask == null && base.size === 1 && off === 0 && p === "icmp6") return "icmpv6.type " + w + " " + rv;
      if (mask == null && base.size === 1 && off === 1 && p === "icmp") return "icmp.code " + w + " " + rv;
      if (mask == null && base.size === 1 && off === 1 && p === "icmp6") return "icmpv6.code " + w + " " + rv;
      if (mask == null && base.size === 1 && off === 8 && p === "ip") return "ip.ttl " + w + " " + rv;
      if (mask == null && base.size === 1 && off === 7 && p === "ip6") return "ipv6.hlim " + w + " " + rv;
      if (p === "ip" && off === 1 && mask === 0xfc && rv % 4 === 0 && (op === "=" || op === "!=")) return "ip.dsfield.dscp " + w + " " + rv / 4;
      if (p === "ip6" && off === 0 && base.size === 2 && mask === 0x0fc0 && rv % 64 === 0 && (op === "=" || op === "!=")) return "ipv6.tclass.dscp " + w + " " + rv / 64;
      if (p === "ip" && off === 6 && base.size === 2 && mask === 0x3fff && op === "!=" && rv === 0) return "(ip.flags.mf == 1 || ip.frag_offset > 0)";
      if (p === "ip" && off === 6 && base.size === 1 && mask === 0x40 && op === "!=" && rv === 0) return "ip.flags.df == 1";
      if (p === "ip" && off === 9 && base.size === 1 && mask == null) return "ip.proto " + w + " " + rv;
      if (p === "ip6" && off === 6 && base.size === 1 && mask == null) return "ipv6.nxt " + w + " " + rv;
    }
    if (base.a === "bin" && base.op === ">>" && base.l.a === "idx" && base.l.proto === "ip" && evalA(base.l.off) === 1 && evalA(base.r) === 2 && (op === "=" || op === "!=")) return "ip.dsfield.dscp " + (op === "=" ? "==" : "!=") + " " + rv;
    return null;
  }
  const KW_WS = { tcp: "tcp", udp: "udp", sctp: "sctp", icmp: "icmp", icmp6: "icmpv6", igmp: "igmp", pim: "pim", ah: "ah", esp: "esp", vrrp: "vrrp", arp: "arp", ip: "ip", ip6: "ipv6", stp: "stp", mpls: "mpls" };
  function display(ast) {
    const missing = [], notes = [];
    function go(n) {
      if (n.disp) return n.disp;
      switch (n.k) {
        case "and": case "or": {
          const a = go(n.l), b = go(n.r); if (a == null || b == null) return null;
          const sym = n.k === "and" ? " && " : " || ";
          const wrap = (c, t) => ((c.k === "and" || c.k === "or") && c.k !== n.k && !c.disp) || (c.k === "or" || c.k === "and") && c === n.r && !c.disp ? "(" + t + ")" : t;
          if (a === b) return a;
          return wrap(n.l, a) + sym + wrap(n.r, b);
        }
        case "not": { const x = go(n.x); return x == null ? null : "!(" + x + ")"; }
        case "q": { const s = wsQ(n); if (s == null) missing.push(print(n)); return s; }
        case "kw": {
          let s = null;
          if (n.name === "broadcast") s = n.proto === "ip" ? "ip.dst == 255.255.255.255" : "eth.dst == ff:ff:ff:ff:ff:ff";
          else if (n.name === "multicast") s = n.proto === "ip" ? "ip.dst >= 224.0.0.0" : n.proto === "ip6" ? "ipv6.dst == ff00::/8" : n.proto === "ether" ? "eth.dst.ig == 1" : "(eth.dst.ig == 1 || ip.dst >= 224.0.0.0 || ipv6.dst == ff00::/8)";
          else if (n.name === "rarp") s = "eth.type == 0x8035";
          else if (n.name === "pppoed") s = "eth.type == 0x8863";
          else if (n.name === "pppoes") s = "eth.type == 0x8864";
          else if (n.name === "vlan") s = n.id ? "vlan.id == " + n.id : "vlan";
          else if (n.name === "mpls") s = n.id ? "mpls.label == " + n.id : "mpls";
          else if (KW_WS[n.name]) s = KW_WS[n.name];
          if (s == null) missing.push(print(n));
          return s;
        }
        case "size": return "frame.len " + (n.op === "less" ? "<=" : ">=") + " " + n.n;
        case "rel": { const s = wsRel(n); if (s == null) missing.push(print(n)); return s; }
      }
      return null;
    }
    const text = go(ast);
    if (missing.length) return { text: null, missing, notes: [{ level: "info", text: "No Wireshark display filter is offered for: " + missing.join("; ") + ". The capture filter above still works in tcpdump and in Wireshark's capture-filter box." }] };
    notes.push({ level: "info", text: "A display filter is applied AFTER capturing (it hides packets); the capture filter above decides what is captured at all. Wireshark reads each protocol itself, so the two can differ at the edges: Wireshark looks inside VLAN tags, follows IPv6 extension headers, puts IP fragments together, and treats ARP separately from IP (a capture-filter host condition also matches ARP)." });
    return { text, missing, notes };
  }

  /* ------------------------------------------------------------------ the builder: choices -> AST */
  const protoNode = v => {
    const kw = { tcp: "tcp", udp: "udp", icmp: "icmp", icmp6: "icmp6", arp: "arp", ip: "ip", ip6: "ip6", esp: "esp", ah: "ah", vrrp: "vrrp", igmp: "igmp", pim: "pim", sctp: "sctp", stp: "stp" };
    if (kw[v]) return { k: "kw", proto: null, name: kw[v] };
    const n = { gre: 47, ospf: 89, eigrp: 88, ipip: 4, l2tp: 115, "ipv6-in-ipv4": 41, rsvp: 46 };
    if (n[v] != null) return { k: "q", proto: null, dir: null, type: "proto", id: String(n[v]) };
    if (/^num:\d+$/.test(v)) return { k: "q", proto: null, dir: null, type: "proto", id: v.slice(4) };
    const e = { lldp: "0x88cc", lacp: "0x8809", "pppoe-discovery": "0x8863", "pppoe-session": "0x8864", mpls: "0x8847" };
    if (e[v]) return { k: "q", proto: "ether", dir: null, type: "proto", id: e[v] };
    return null;
  };
  const chainAst = (op, items) => items.reduce((a, b) => (a ? { k: op, l: a, r: b } : b), null);
  const dirOf = d => (d === "src" || d === "dst" ? d : null);
  function flagNode(spec, ver) {
    let mask = 0, val = 0;
    for (const f of FLAGS) { const s = (spec.flags || {})[f[0]]; if (s === "set") { mask |= f[1]; val |= f[1]; } else if (s === "clear") mask |= f[1]; }
    if (!mask) return { err: "Choose at least one TCP flag that must be set or must be clear." };
    const cname = { 1: "tcp-fin", 2: "tcp-syn", 4: "tcp-rst", 8: "tcp-push", 16: "tcp-ack", 32: "tcp-urg", 64: "tcp-ece", 128: "tcp-cwr" };
    const cexp = m => { const names = FLAGS.filter(f => m & f[1]).map(f => ({ a: "const", name: cname[f[1]], v: f[1] })); return names.reduce((a, b) => (a ? { a: "bin", op: "|", l: a, r: b } : b)); };
    const hexN = v => ({ a: "num", v, raw: "0x" + v.toString(16) });
    const v4 = () => {
      const lhs = { a: "bin", op: "&", l: { a: "idx", proto: "tcp", off: { a: "const", name: "tcpflags", v: 13 }, size: 1 }, r: cexp(mask) };
      if (!val) return { k: "rel", op: "=", l: lhs, r: { a: "num", v: 0, raw: "0" } };
      if (val === mask && FLAGS.filter(f => mask & f[1]).length === 1) return { k: "rel", op: "!=", l: lhs, r: { a: "num", v: 0, raw: "0" } };
      return { k: "rel", op: "=", l: lhs, r: cexp(val) };
    };
    const v6 = () => {
      const lhs = { a: "bin", op: "&", l: { a: "idx", proto: "ip6", off: { a: "num", v: 53, raw: "53" }, size: 1 }, r: hexN(mask) };
      const cmp = !val ? { k: "rel", op: "=", l: lhs, r: { a: "num", v: 0, raw: "0" } } : (val === mask && FLAGS.filter(f => mask & f[1]).length === 1) ? { k: "rel", op: "!=", l: lhs, r: { a: "num", v: 0, raw: "0" } } : { k: "rel", op: "=", l: lhs, r: hexN(val) };
      return { k: "and", l: { k: "rel", op: "=", l: { a: "idx", proto: "ip6", off: { a: "num", v: 6, raw: "6" }, size: 1 }, r: { a: "num", v: 6, raw: "6" } }, r: cmp };
    };
    const on = FLAGS.filter(f => val & f[1]).map(f => f[2]), off = FLAGS.filter(f => (mask & ~val) & f[1]).map(f => f[2]);
    const words = "TCP packets with " + (on.length ? on.join(" + ") + " set" : "") + (on.length && off.length ? " and " : "") + (off.length ? off.join(" + ") + " not set" : "");
    const ws = FLAGS.filter(f => mask & f[1]).map(f => "tcp.flags." + (f[0] === "rst" ? "reset" : f[0]) + " == " + ((val & f[1]) ? 1 : 0)).join(" && ");
    if (ver === "4") return { node: Object.assign(v4(), { desc: words + " (IPv4)" }) };
    if (ver === "6") return { node: Object.assign(v6(), { desc: words + " (IPv6, no extension headers)" }) };
    return { node: { k: "or", l: v4(), r: v6(), desc: words + " (IPv4 and IPv6)", disp: ws } };
  }
  // one row of the builder -> { node } or { err }
  function rowNode(r) {
    const s = x => String(x == null ? "" : x).trim();
    switch (r.t) {
      case "host": {
        const v = s(r.value); if (!v) return { err: "Type an IP address (or a host name)." };
        if (/^[0-9.]+$/.test(v) && !isIPv4(v)) return { err: "\"" + v + "\" is not a valid IPv4 address." };
        if (v.indexOf(":") >= 0 && !isIPv6(v)) return { err: "\"" + v + "\" is not a valid IPv6 address." };
        if (!/^[A-Za-z0-9:.\-]+$/.test(v)) return { err: "That does not look like an address." };
        return { node: { k: "q", proto: null, dir: dirOf(r.dir), type: "host", id: v } };
      }
      case "net": {
        const v = s(r.value); const n = normNet(v); if (!n) return { err: "Write a network like 10.0.0.0/8 or 2001:db8::/32." };
        return { node: { k: "q", proto: null, dir: dirOf(r.dir), type: "net", id: n.text.split("/")[0], plen: n.len }, note: n.changed ? "Host bits were cleared: " + v + " became " + n.text + " (tcpdump refuses a network address with host bits set)." : null };
      }
      case "port": {
        const parts = s(r.value).split(/[,\s]+/).filter(Boolean); if (!parts.length) return { err: "Type one or more ports, such as 443 or 80,443 or 8000-8100." };
        const proto = ["tcp", "udp", "sctp"].includes(r.proto) ? r.proto : null, items = [];
        for (const p of parts) {
          let m;
          if (/^\d+$/.test(p)) { if (+p > 65535) return { err: "Port " + p + " is too big (0 to 65535)." }; items.push({ k: "q", proto, dir: dirOf(r.dir), type: "port", id: p }); }
          else if ((m = /^(\d+)-(\d+)$/.exec(p))) { if (+m[1] > 65535 || +m[2] > 65535 || +m[1] > +m[2]) return { err: "\"" + p + "\" is not a valid port range." }; items.push({ k: "q", proto, dir: dirOf(r.dir), type: "portrange", id: p }); }
          else return { err: "\"" + p + "\" is not a port number or range." };
        }
        return { node: chainAst("or", items) };
      }
      case "proto": { const n = protoNode(s(r.value)); return n ? { node: n } : { err: "Choose a protocol." }; }
      case "mac": {
        let v = s(r.value).toLowerCase().replace(/-/g, ":"); const c = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/.exec(v); if (c) v = (c[1] + c[2] + c[3]).replace(/(..)(?=.)/g, "$1:");
        if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(v)) return { err: "Write a MAC address like aa:bb:cc:dd:ee:ff (aa-bb-... and aabb.ccdd.eeff work too)." };
        return { node: { k: "q", proto: "ether", dir: dirOf(r.dir), type: "host", id: v } };
      }
      case "vlan": { const v = s(r.value); if (v && (!/^\d+$/.test(v) || +v > 4095)) return { err: "A VLAN ID is 0 to 4095 (leave empty for any VLAN-tagged frame)." }; return { node: { k: "kw", proto: null, name: "vlan", id: v || undefined } }; }
      case "tcpflags": return flagNode(r, ["4", "6"].includes(r.ip) ? r.ip : "both");
      case "icmp": {
        const v6 = r.ver === "6", t = s(r.type), c = s(r.code);
        if (t !== "" && (!/^\d+$/.test(t) || +t > 255)) return { err: "An ICMP type is a number from 0 to 255." };
        if (c !== "" && (!/^\d+$/.test(c) || +c > 255)) return { err: "An ICMP code is a number from 0 to 255." };
        if (t === "" && c !== "") return { err: "Choose the type that the code belongs to." };
        if (t === "") return { node: { k: "kw", proto: null, name: v6 ? "icmp6" : "icmp" } };
        const p = v6 ? "icmp6" : "icmp", mk = (off, name, v) => ({ k: "rel", op: "=", l: { a: "idx", proto: p, off: { a: "const", name, v: off }, size: 1 }, r: { a: "num", v: +v, raw: String(+v) } });
        const a = mk(0, v6 ? "icmp6type" : "icmptype", t);
        return { node: c === "" ? a : { k: "and", l: a, r: mk(1, v6 ? "icmp6code" : "icmpcode", c) } };
      }
      case "size": { const v = s(r.value); if (!/^\d+$/.test(v)) return { err: "Type a size in bytes." }; return { node: { k: "size", op: r.op === "less" ? "less" : "greater", n: +v } }; }
      case "dscp": {
        const v = s(r.value); if (!/^\d+$/.test(v) || +v > 63) return { err: "DSCP is a number from 0 to 63 (46 = EF, the voice class)." };
        const d = +v, ver = ["4", "6"].includes(r.ip) ? r.ip : "both";
        const n4 = { k: "rel", op: "=", l: { a: "bin", op: "&", l: { a: "idx", proto: "ip", off: { a: "num", v: 1, raw: "1" }, size: 1 }, r: { a: "num", v: 0xfc, raw: "0xfc" } }, r: { a: "num", v: d * 4, raw: String(d * 4) } };
        const n6 = { k: "rel", op: "=", l: { a: "bin", op: "&", l: { a: "idx", proto: "ip6", off: { a: "num", v: 0, raw: "0" }, size: 2 }, r: { a: "num", v: 0x0fc0, raw: "0x0fc0" } }, r: { a: "num", v: d * 64, raw: "0x" + (d * 64).toString(16).padStart(4, "0") } };
        const w = "DSCP " + d + (DSCP[d] ? " (" + DSCP[d] + ")" : "");
        return { node: ver === "4" ? Object.assign(n4, { desc: w + " (IPv4)" }) : ver === "6" ? Object.assign(n6, { desc: w + " (IPv6)" }) : { k: "or", l: n4, r: n6, desc: w + " (IPv4 and IPv6)", disp: "ip.dsfield.dscp == " + d + " || ipv6.tclass.dscp == " + d } };
      }
      case "ttl": {
        const v = s(r.value); if (!/^\d+$/.test(v) || +v > 255) return { err: "A TTL / hop limit is 0 to 255." };
        const op = ["<", "<=", "=", ">", ">="].includes(r.op) ? r.op : "<", ver = ["4", "6"].includes(r.ip) ? r.ip : "both";
        const mk = (p, off) => ({ k: "rel", op, l: { a: "idx", proto: p, off: { a: "num", v: off, raw: String(off) }, size: 1 }, r: { a: "num", v: +v, raw: v } });
        const wsop = op === "=" ? "==" : op, w = "TTL / hop limit " + OPW[op] + " " + v;
        return { node: ver === "4" ? mk("ip", 8) : ver === "6" ? mk("ip6", 7) : { k: "or", l: mk("ip", 8), r: mk("ip6", 7), desc: w + " (IPv4 TTL or IPv6 hop limit)", disp: "ip.ttl " + wsop + " " + v + " || ipv6.hlim " + wsop + " " + v } };
      }
      case "cast": {
        const m = { broadcast: { k: "kw", proto: "ether", name: "broadcast" }, multicast: { k: "kw", proto: null, name: "multicast" }, "ip-multicast": { k: "kw", proto: "ip", name: "multicast" }, "ip6-multicast": { k: "kw", proto: "ip6", name: "multicast" }, "ip-broadcast": { k: "kw", proto: "ip", name: "broadcast" } }[r.value];
        return m ? { node: m } : { err: "Choose broadcast or multicast." };
      }
      case "frag": {
        const lhs = (off, size, mask) => ({ a: "bin", op: "&", l: { a: "idx", proto: "ip", off: { a: "num", v: off, raw: String(off) }, size }, r: { a: "num", v: mask, raw: "0x" + mask.toString(16) } });
        if (r.value === "df") return { node: { k: "rel", op: "!=", l: lhs(6, 1, 0x40), r: { a: "num", v: 0, raw: "0" } } };
        return { node: { k: "rel", op: "!=", l: lhs(6, 2, 0x3fff), r: { a: "num", v: 0, raw: "0" } } };
      }
      case "raw": {
        const v = s(r.value); if (!v) return { err: "Type a filter expression." };
        const p = parse(v); if (!p.ok) return { err: "That is not a filter I can read: " + p.errors[0].msg };
        return { node: p.ast };
      }
    }
    return { err: "Unknown condition type." };
  }
  // spec: { op: "and"|"or", items: [row | { g: true, op, items, not }] }, a row has t, not and its own fields
  function build(spec) {
    const problems = [], notes = [];
    function make(items, op, path) {
      const nodes = [];
      items.forEach((it, idx) => {
        const p = path.concat(idx);
        let n = null;
        if (it.g) { n = make(it.items || [], it.op === "or" ? "or" : "and", p); }
        else { const r = rowNode(it); if (r.err) problems.push({ path: p, msg: r.err }); else { n = r.node; if (r.note) notes.push({ level: "info", text: r.note }); } }
        if (n && it.not) n = { k: "not", x: n };
        if (n) nodes.push({ n, vlan: !it.g && it.t === "vlan" && !it.not });
      });
      if (!nodes.length) return null;
      if (op === "and") nodes.sort((a, b) => (b.vlan ? 1 : 0) - (a.vlan ? 1 : 0));   // vlan first: it changes how the rest is read
      return chainAst(op, nodes.map(x => x.n));
    }
    const ast = make((spec && spec.items) || [], spec && spec.op === "or" ? "or" : "and", []);
    return { ast, problems, notes };
  }

  /* ------------------------------------------------------------------ command lines */
  const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
  function commands(o, bpf, disp) {
    o = o || {}; const errs = [], out = [];
    const iface = String(o.iface == null ? "any" : o.iface).trim() || "any";
    if (!/^[A-Za-z0-9_.:@\-]{1,40}$/.test(iface)) errs.push("The interface name has characters that are not allowed.");
    const num = (v, name, min, max) => { if (v === "" || v == null) return null; const n = Number(v); if (!/^\d+$/.test(String(v).trim()) || n < min || n > max) { errs.push(name + " must be a whole number from " + min + " to " + max + "."); return null; } return n; };
    const count = num(o.count, "The packet count", 1, 1e9), size = num(o.rotSize, "The file size", 1, 1e6), files = num(o.rotFiles, "The number of files", 1, 1e4), secs = num(o.rotSecs, "The seconds per file", 1, 1e7);
    const file = String(o.file || "").trim(), rd = String(o.read || "").trim();
    for (const [f, nm] of [[file, "The output file name"], [rd, "The input file name"]]) if (f && !/^[A-Za-z0-9_.%\-/]{1,120}$/.test(f)) errs.push(nm + " has characters that are not allowed (letters, digits, . _ - / and % for dates).");
    if (errs.length) return { errors: errs, list: [] };
    const sudo = o.sudo === false ? "" : "sudo ";
    const f = bpf ? " " + shq(bpf) : "";
    // tcpdump
    const t = ["tcpdump"];
    if (rd) t.push("-r " + rd); else t.push("-i " + iface);
    if (o.nn !== false) t.push("-nn");
    if (!rd && o.snap0 !== false) t.push("-s0");
    if (o.verbose === "v" || o.verbose === "vv") t.push("-" + o.verbose);
    if (o.link) t.push("-e");
    if (o.dump === "X") t.push("-X"); else if (o.dump === "A") t.push("-A");
    if (o.time === "tttt") t.push("-tttt");
    if (o.line) t.push("-l");
    if (!rd && ["in", "out"].includes(o.dir)) t.push("-Q " + o.dir);
    if (count != null) t.push("-c " + count);
    if (file && !rd) {
      t.push("-w " + file);
      if (o.rot === "size" && size != null) t.push("-C " + size + (files != null ? " -W " + files : ""));
      else if (o.rot === "time" && secs != null) t.push("-G " + secs + (files != null ? " -W " + files : ""));
    }
    out.push({ label: "tcpdump", text: (rd ? "" : sudo) + t.join(" ") + f, hint: rd ? "Reads a saved capture file and shows only the packets that match." : "Needs root (sudo) to capture. Stop it with Ctrl+C." + (file ? " The capture is written to " + file + "; open that file in Wireshark." : "") + (o.rot === "time" && file && !/%/.test(file) ? " With -G the file name should contain a date, for example capture-%Y%m%d-%H%M%S.pcap, or each new file overwrites the last." : "") });
    // tshark
    const s2 = ["tshark"];
    if (rd) s2.push("-r " + rd); else s2.push("-i " + iface);
    if (!rd && bpf) s2.push("-f " + shq(bpf));
    if (rd && bpf) s2.push("-Y " + shq(disp && disp.text ? disp.text : "<display filter>"));
    if (!rd && disp && disp.text && o.tsharkDisplay) s2.push("-Y " + shq(disp.text));
    if (o.nn !== false) s2.push("-n");
    if (count != null) s2.push("-c " + count);
    if (file && !rd) s2.push("-w " + file + (o.rot === "size" && size != null ? " -b filesize:" + size * 1000 + (files != null ? " -b files:" + files : "") : o.rot === "time" && secs != null ? " -b duration:" + secs + (files != null ? " -b files:" + files : "") : ""));
    out.push({ label: "tshark", text: (rd ? "" : sudo) + s2.join(" "), hint: rd ? "The display filter (-Y) is the Wireshark form, not the capture filter." : "-f is the capture filter (the same text as for tcpdump), -Y would add a display filter on top." });
    return { errors: [], list: out };
  }

  /* ------------------------------------------------------------------ recipes */
  const R = (group, title, desc, bpf, extra) => Object.assign({ group, title, desc, bpf }, extra || {});
  const RECIPES = [
    R("TCP connections", "New TCP connections (SYN only)", "The first packet of every new connection: SYN set and ACK not set. Counts connection attempts, and shows scans. Written for IPv4 and IPv6, because tcp[...] alone sees only IPv4.", "(tcp[tcpflags] & (tcp-syn|tcp-ack) = tcp-syn) or (ip6[6] = 6 and ip6[53] & 0x12 = 0x02)", { display: "tcp.flags.syn == 1 && tcp.flags.ack == 0" }),
    R("TCP connections", "Answers to new connections (SYN-ACK)", "The server's answer to a SYN. If you see SYNs but no SYN-ACKs, the server or something in front of it is not answering.", "(tcp[tcpflags] & (tcp-syn|tcp-ack) = (tcp-syn|tcp-ack)) or (ip6[6] = 6 and ip6[53] & 0x12 = 0x12)", { display: "tcp.flags.syn == 1 && tcp.flags.ack == 1" }),
    R("TCP connections", "Refused or aborted connections (RST)", "TCP resets: a port with nothing listening, a firewall rejecting, or an application that gave up.", "(tcp[tcpflags] & tcp-rst != 0) or (ip6[6] = 6 and ip6[53] & 0x04 != 0)", { display: "tcp.flags.reset == 1" }),
    R("TCP connections", "Connections closing (FIN)", "Packets that close a connection in the normal way.", "(tcp[tcpflags] & tcp-fin != 0) or (ip6[6] = 6 and ip6[53] & 0x01 != 0)", { display: "tcp.flags.fin == 1" }),
    R("TCP connections", "Scan-like packets (no flags, or FIN+PSH+URG)", "The \"null\" and \"Xmas\" packets that port scanners send. Normal programs never do.", "(tcp[tcpflags] = 0) or (tcp[tcpflags] & (tcp-fin|tcp-push|tcp-urg) = (tcp-fin|tcp-push|tcp-urg))"),
    R("Everyday", "Everything except SSH", "Everything but port 22, so that your own SSH session does not fill the capture of the server you are logged in to.", "not port 22"),
    R("Everyday", "Web traffic (HTTP and HTTPS)", "TCP ports 80 and 443. Inherits the keywords: \"tcp port 80 or 443\" means \"tcp port 80 or tcp port 443\".", "tcp port 80 or 443"),
    R("Everyday", "DNS", "Lookups and answers, over UDP and TCP, IPv4 and IPv6.", "port 53"),
    R("Everyday", "DHCP (IPv4 and IPv6)", "Requests and offers for addresses: BOOTP/DHCP on ports 67 and 68, DHCPv6 on 546 and 547.", "udp and (port 67 or port 68 or port 546 or port 547)"),
    R("Everyday", "Time sync (NTP)", "NTP queries and answers.", "udp port 123"),
    R("Everyday", "Large frames (over 1500 bytes)", "Frames bigger than the usual Ethernet payload: jumbo frames, or captures taken on the sending host before the network card splits them.", "greater 1501"),
    R("Everyday", "Fragmented IPv4 packets", "Packets that were cut into pieces (more fragments follow, or this is not the first piece). A sign of an MTU problem or of old tunnels.", "ip[6:2] & 0x3fff != 0", { display: "ip.flags.mf == 1 || ip.frag_offset > 0" }),
    R("Everyday", "Traffic that touches private address space", "Any packet with an RFC 1918 address (10/8, 172.16/12, 192.168/16) as source or destination.", "net 10.0.0.0/8 or net 172.16.0.0/12 or net 192.168.0.0/16"),
    R("Everyday", "Traffic that stays away from private address space", "Neither source nor destination is an RFC 1918 address: the Internet side only.", "not (net 10.0.0.0/8 or net 172.16.0.0/12 or net 192.168.0.0/16)"),
    R("ICMP and troubleshooting", "Ping (echo request and reply, IPv4 and IPv6)", "Pings and their answers.", "icmp[icmptype] = icmp-echo or icmp[icmptype] = icmp-echoreply or icmp6[icmp6type] = icmp6-echo or icmp6[icmp6type] = icmp6-echoreply", { display: "icmp.type == 8 || icmp.type == 0 || icmpv6.type == 128 || icmpv6.type == 129" }),
    R("ICMP and troubleshooting", "ICMP errors (unreachable, time exceeded)", "A router or host telling the sender that a packet could not be delivered or ran out of hops. Traceroute shows time exceeded.", "icmp[icmptype] = 3 or icmp[icmptype] = 11 or icmp6[icmp6type] = 1 or icmp6[icmp6type] = 3", { display: "icmp.type == 3 || icmp.type == 11 || icmpv6.type == 1 || icmpv6.type == 3" }),
    R("ICMP and troubleshooting", "Path MTU problems (fragmentation needed, packet too big)", "The messages that tell a sender to use smaller packets. If a connection hangs after the handshake, look for these (or for their absence: firewalls often drop them).", "(icmp[icmptype] = 3 and icmp[icmpcode] = 4) or icmp6[icmp6type] = 2", { display: "(icmp.type == 3 && icmp.code == 4) || icmpv6.type == 2" }),
    R("ICMP and troubleshooting", "IPv6 neighbor and router discovery", "Neighbor solicitation and advertisement, router solicitation and advertisement: how IPv6 hosts find each other and their router (the IPv6 counterpart of ARP).", "icmp6[icmp6type] >= 133 and icmp6[icmp6type] <= 136", { display: "icmpv6.type >= 133 && icmpv6.type <= 136" }),
    R("ICMP and troubleshooting", "Packets about to run out of hops (TTL 5 or less)", "Low TTL or hop limit: traceroute probes, or routing loops.", "ip[8] <= 5 or ip6[7] <= 5", { display: "ip.ttl <= 5 || ipv6.hlim <= 5" }),
    R("ICMP and troubleshooting", "ARP", "Who-has and is-at questions on the local network.", "arp"),
    R("Link layer", "Broadcast and multicast", "Packets sent to everyone or to a group. A storm of these usually means a loop.", "broadcast or multicast"),
    R("Link layer", "LLDP", "Neighbour announcements from switches and phones.", "ether proto 0x88cc"),
    R("Link layer", "LACP (link aggregation)", "The slow-protocol frames that bundled links use to agree.", "ether proto 0x8809"),
    R("Link layer", "Spanning tree (STP)", "Bridge protocol frames between switches.", "stp"),
    R("Link layer", "CDP (Cisco discovery)", "Cisco neighbour announcements.", "ether dst 01:00:0c:cc:cc:cc"),
    R("Link layer", "VLAN-tagged frames", "Frames that carry an 802.1Q tag. To pick one VLAN use \"vlan 100\" first and join the rest with \"and\".", "vlan"),
    R("Link layer", "PPPoE", "Discovery and session frames of PPPoE connections.", "pppoed or pppoes"),
    R("Routing and tunnels", "BGP", "BGP sessions (TCP port 179).", "tcp port 179"),
    R("Routing and tunnels", "OSPF", "OSPF hellos and updates (IP protocol 89), IPv4 and IPv6.", "proto 89", { display: "ospf" }),
    R("Routing and tunnels", "VRRP", "Router redundancy announcements.", "vrrp"),
    R("Routing and tunnels", "HSRP", "Cisco's router redundancy protocol (UDP port 1985).", "udp port 1985"),
    R("Routing and tunnels", "GRE tunnels", "GRE-encapsulated traffic (IP protocol 47).", "proto 47", { display: "gre" }),
    R("Routing and tunnels", "IPsec: IKE, NAT-T and ESP", "The key exchange (UDP 500), the NAT-traversal port (UDP 4500) and the encrypted packets (ESP). If IKE works but no ESP appears, the tunnel is not carrying traffic.", "udp port 500 or 4500 or esp", { display: "udp.port == 500 || udp.port == 4500 || esp" }),
    R("Routing and tunnels", "WireGuard (default port)", "WireGuard on its default port 51820.", "udp port 51820"),
    R("Services", "RADIUS (authentication, accounting, CoA)", "RADIUS on the current ports 1812 and 1813, the old ports 1645 and 1646, and change-of-authorization on 3799.", "udp port 1812 or 1813 or 1645 or 1646 or 3799", { display: "udp.port == 1812 || udp.port == 1813 || udp.port == 1645 || udp.port == 1646 || udp.port == 3799" }),
    R("Services", "SNMP", "Queries (161) and traps (162).", "udp port 161 or 162", { display: "udp.port == 161 || udp.port == 162" }),
    R("Services", "Syslog", "Log messages sent over the network (UDP 514).", "udp port 514", { display: "udp.port == 514" }),
    R("Services", "SIP (voice calls)", "Call signalling on port 5060 (and 5061 for SIP over TLS).", "port 5060 or 5061"),
    R("Services", "TACACS+", "Device-administration logins (TCP port 49).", "tcp port 49", { display: "tcp.port == 49" }),
    R("Inside the packets", "HTTP requests (GET and POST)", "Plain HTTP requests, found by the first bytes of the TCP data. Only for unencrypted HTTP on IPv4.", "tcp[((tcp[12] & 0xf0) >> 2):4] = 0x47455420 or tcp[((tcp[12] & 0xf0) >> 2):4] = 0x504f5354", { display: "http.request.method == \"GET\" || http.request.method == \"POST\"" }),
    R("Inside the packets", "TLS handshakes starting (ClientHello)", "The first message of an HTTPS or other TLS connection, found by looking inside the TCP data (IPv4 only). Useful to see which connections start, even though everything after it is encrypted.", "tcp[((tcp[12] & 0xf0) >> 2)] = 0x16 and tcp[((tcp[12] & 0xf0) >> 2) + 5] = 0x01", { display: "tls.handshake.type == 1" }),
  ];

  const API = { parse, print, explain, display, build, commands, normNet, isIPv4, isIPv6, RECIPES, CONSTS, FLAGS, ICMP4, ICMP6, PORTS, DSCP, IPPROTO };
  if (typeof window !== "undefined") window.PcapFilter = API;
  if (typeof module !== "undefined") module.exports = API;
})();
