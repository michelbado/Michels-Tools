/* DHCP options: a reference of the IPv4 options, encoders (value text -> the bytes that go on the wire), decoders (bytes -> words), a reader for
   a whole DHCP message, and configuration lines for common servers. Pure functions on bytes (Uint8Array) and text; nothing is sent anywhere.
   Exports window.DhcpOpt. The DHCPv6 list at the end is a reference only. */
(() => {
  "use strict";
  const O = (n, t, d, rfc) => ({ n, t, d, rfc });
  // t: the kind of value (see encode / decode below)
  const OPTIONS = {
    1: O("Subnet Mask", "ip", "Netmask of the client's network.", "RFC 2132"), 2: O("Time Offset", "i32", "Offset from UTC in seconds. Obsolete: use 100 and 101.", "RFC 2132"),
    3: O("Router", "ips", "Default gateway(s), most preferred first.", "RFC 2132"), 4: O("Time Server", "ips", "RFC 868 time servers.", "RFC 2132"), 5: O("Name Server (IEN 116)", "ips", "Old IEN 116 name servers, not DNS: use 6.", "RFC 2132"),
    6: O("Domain Name Server", "ips", "DNS resolvers, most preferred first.", "RFC 2132"), 7: O("Log Server", "ips", "MIT-LCS UDP log servers.", "RFC 2132"), 8: O("Cookie Server", "ips", "RFC 865 cookie servers.", "RFC 2132"),
    9: O("LPR Server", "ips", "RFC 1179 line printer servers.", "RFC 2132"), 10: O("Impress Server", "ips", "Imagen Impress servers.", "RFC 2132"), 11: O("Resource Location Server", "ips", "RFC 887 resource location servers.", "RFC 2132"),
    12: O("Host Name", "text", "Name the client should use.", "RFC 2132"), 13: O("Boot File Size", "u16", "Size of the boot file in 512-byte blocks.", "RFC 2132"), 14: O("Merit Dump File", "text", "Path for a core dump.", "RFC 2132"),
    15: O("Domain Name", "text", "DNS domain the client belongs to.", "RFC 2132"), 16: O("Swap Server", "ip", "Client's swap server.", "RFC 2132"), 17: O("Root Path", "text", "Path to the client's root disk (diskless boot).", "RFC 2132"),
    18: O("Extensions Path", "text", "File with more options, fetched by TFTP.", "RFC 2132"), 19: O("IP Forwarding", "bool", "Enable or disable IP forwarding.", "RFC 2132"), 20: O("Non-Local Source Routing", "bool", "Enable or disable source routing.", "RFC 2132"),
    21: O("Policy Filter", "pairs", "Address and mask pairs for source-routed packets.", "RFC 2132"), 22: O("Maximum Datagram Reassembly Size", "u16", "Largest datagram the client must be able to reassemble.", "RFC 2132"), 23: O("Default IP TTL", "u8", "TTL for outgoing packets.", "RFC 2132"),
    24: O("Path MTU Aging Timeout", "secs", "Seconds before path MTU values are tried again.", "RFC 2132"), 25: O("Path MTU Plateau Table", "u16list", "Sizes to try when discovering the path MTU.", "RFC 2132"), 26: O("Interface MTU", "u16", "MTU of the client's interface (minimum 68).", "RFC 2132"),
    27: O("All Subnets Are Local", "bool", "Treat every subnet as having the same MTU.", "RFC 2132"), 28: O("Broadcast Address", "ip", "Broadcast address of the client's subnet.", "RFC 2132"), 29: O("Perform Mask Discovery", "bool", "Use ICMP to find the mask.", "RFC 2132"),
    30: O("Mask Supplier", "bool", "Answer ICMP mask requests.", "RFC 2132"), 31: O("Perform Router Discovery", "bool", "Use ICMP router discovery.", "RFC 2132"), 32: O("Router Solicitation Address", "ip", "Where to send router solicitations.", "RFC 2132"),
    33: O("Static Route (classful)", "pairs", "Destination and router pairs. Classful only: use 121 for anything else.", "RFC 2132"), 34: O("Trailer Encapsulation", "bool", "Use ARP trailers.", "RFC 2132"), 35: O("ARP Cache Timeout", "secs", "Seconds an ARP entry lives.", "RFC 2132"),
    36: O("Ethernet Encapsulation", "bool", "0 = Ethernet II, 1 = IEEE 802.3.", "RFC 2132"), 37: O("TCP Default TTL", "u8", "TTL for TCP segments.", "RFC 2132"), 38: O("TCP Keepalive Interval", "secs", "Seconds between keepalives.", "RFC 2132"),
    39: O("TCP Keepalive Garbage", "bool", "Send a garbage byte in keepalives.", "RFC 2132"), 40: O("NIS Domain", "text", "NIS domain name.", "RFC 2132"), 41: O("NIS Servers", "ips", "NIS servers.", "RFC 2132"),
    42: O("NTP Servers", "ips", "Time servers (NTP).", "RFC 2132"), 43: O("Vendor-Specific Information", "vendor", "Device-specific settings in sub-options (for example the controller address for wireless access points).", "RFC 2132"),
    44: O("NetBIOS Name Server (WINS)", "ips", "WINS servers.", "RFC 2132"), 45: O("NetBIOS Datagram Distribution Server", "ips", "NetBIOS datagram servers.", "RFC 2132"), 46: O("NetBIOS Node Type", "nbnt", "1 = B, 2 = P, 4 = M, 8 = H.", "RFC 2132"),
    47: O("NetBIOS Scope", "text", "NetBIOS scope parameter.", "RFC 2132"), 48: O("X Window Font Server", "ips", "", "RFC 2132"), 49: O("X Window Display Manager", "ips", "", "RFC 2132"),
    50: O("Requested IP Address", "ip", "Client asks for this address.", "RFC 2132"), 51: O("IP Address Lease Time", "secs", "Lease length in seconds (4294967295 = infinite).", "RFC 2132"), 52: O("Option Overload", "overload", "The sname and/or file fields carry options.", "RFC 2132"),
    53: O("DHCP Message Type", "msgtype", "DISCOVER, OFFER, REQUEST, ACK ...", "RFC 2132"), 54: O("Server Identifier", "ip", "The server that answered; the client names it in a REQUEST.", "RFC 2132"), 55: O("Parameter Request List", "prl", "Options the client wants in the answer.", "RFC 2132"),
    56: O("Message", "text", "Reason, for example in a NAK.", "RFC 2132"), 57: O("Maximum DHCP Message Size", "u16", "Largest DHCP message the client accepts.", "RFC 2132"), 58: O("Renewal Time (T1)", "secs", "Seconds until the client starts renewing.", "RFC 2132"),
    59: O("Rebinding Time (T2)", "secs", "Seconds until the client asks any server.", "RFC 2132"), 60: O("Vendor Class Identifier", "text", "What kind of device the client is (for example MSFT 5.0, or a PXE or phone name).", "RFC 2132"), 61: O("Client Identifier", "clientid", "How the client identifies itself: usually 01 and its MAC address.", "RFC 2132"),
    62: O("NetWare/IP Domain Name", "text", "", "RFC 2242"), 63: O("NetWare/IP Information", "hex", "", "RFC 2242"), 64: O("NIS+ Domain", "text", "", "RFC 2132"), 65: O("NIS+ Servers", "ips", "", "RFC 2132"),
    66: O("TFTP Server Name", "text", "Boot server name (phones and PXE). 'sname' field when the option is not used.", "RFC 2132"), 67: O("Bootfile Name", "text", "File to boot from (PXE, phones, routers).", "RFC 2132"), 68: O("Mobile IP Home Agent", "ips", "", "RFC 2132"),
    69: O("SMTP Server", "ips", "", "RFC 2132"), 70: O("POP3 Server", "ips", "", "RFC 2132"), 71: O("NNTP Server", "ips", "", "RFC 2132"), 72: O("WWW Server", "ips", "", "RFC 2132"), 73: O("Finger Server", "ips", "", "RFC 2132"), 74: O("IRC Server", "ips", "", "RFC 2132"),
    75: O("StreetTalk Server", "ips", "", "RFC 2132"), 76: O("StreetTalk Directory Assistance Server", "ips", "", "RFC 2132"), 77: O("User Class", "hex", "Administrator-defined class of the client.", "RFC 3004"), 80: O("Rapid Commit", "empty", "The client accepts a two-message exchange.", "RFC 4039"),
    81: O("Client FQDN", "fqdn", "The client's name and who updates DNS.", "RFC 4702"), 82: O("Relay Agent Information", "agent", "Added by a switch or relay: which port or circuit the client is on (circuit ID, remote ID).", "RFC 3046"), 85: O("NDS Servers", "ips", "", "RFC 2241"),
    90: O("Authentication", "hex", "", "RFC 3118"), 93: O("Client System Architecture", "arch", "What the PXE client is (BIOS, UEFI ...).", "RFC 4578"), 94: O("Client Network Interface Identifier", "hex", "", "RFC 4578"), 97: O("Client Machine Identifier (UUID)", "hex", "", "RFC 4578"),
    100: O("PCode (POSIX time zone)", "text", "", "RFC 4833"), 101: O("TCode (time zone name)", "text", "", "RFC 4833"), 108: O("IPv6-Only Preferred", "secs", "Seconds the client may switch off IPv4 (V6ONLY_WAIT).", "RFC 8925"),
    114: O("Captive Portal URI", "text", "Address of the captive portal API.", "RFC 8910"), 119: O("Domain Search List", "domains", "Domains tried when a short name is looked up.", "RFC 3397"), 121: O("Classless Static Route", "routes", "Routes in any prefix length (replaces 33). When present, clients ignore option 3.", "RFC 3442"),
    124: O("Vendor-Identifying Vendor Class", "hex", "", "RFC 3925"), 125: O("Vendor-Identifying Vendor-Specific", "vendor125", "Vendor settings with an enterprise number (for example TR-069 / CWMP, enterprise 3561).", "RFC 3925"),
    138: O("CAPWAP Access Controller", "ips", "Controller addresses for CAPWAP wireless access points.", "RFC 5417"), 150: O("TFTP Server Address (Cisco)", "ips", "Cisco phones and devices: TFTP server list.", "RFC 5859 (TFTP server address)"),
    209: O("PXELINUX Configuration File", "text", "", "RFC 5071"), 210: O("PXELINUX Path Prefix", "text", "", "RFC 5071"), 211: O("PXELINUX Reboot Time", "secs", "", "RFC 5071"), 212: O("OPTION_6RD", "hex", "IPv6 rapid deployment parameters.", "RFC 5969"),
    249: O("Microsoft Classless Static Route", "routes", "Same format as 121, for older Windows clients.", "Microsoft"), 252: O("WPAD (proxy auto-config URL)", "text", "", "Informal"), 255: O("End", "empty", "Ends the options.", "RFC 2132"),
  };
  OPTIONS[0] = O("Pad", "empty", "One byte of padding.", "RFC 2132");

  const MSGTYPES = { 1: "DISCOVER", 2: "OFFER", 3: "REQUEST", 4: "DECLINE", 5: "ACK", 6: "NAK", 7: "RELEASE", 8: "INFORM", 9: "FORCERENEW", 10: "LEASEQUERY", 11: "LEASEUNASSIGNED", 12: "LEASEUNKNOWN", 13: "LEASEACTIVE", 14: "BULKLEASEQUERY", 15: "LEASEQUERYDONE" };
  const AGENT_SUB = { 1: "Agent Circuit ID", 2: "Agent Remote ID", 4: "DOCSIS Device Class", 5: "Link Selection", 6: "Subscriber ID", 7: "RADIUS Attributes", 8: "Authentication", 9: "Vendor-Specific Information", 10: "Relay Agent Flags", 11: "Server Identifier Override", 151: "Virtual Subnet Selection", 152: "Virtual Subnet Selection Control" };
  const ARCH = { 0: "Intel x86 PC (BIOS)", 1: "NEC/PC98", 2: "EFI Itanium", 3: "DEC Alpha", 4: "Arc x86", 5: "Intel Lean Client", 6: "EFI IA32", 7: "EFI BC (x64)", 8: "EFI Xscale", 9: "EFI x86-64" };
  const NBNT = { 1: "B-node (broadcast)", 2: "P-node (peer)", 4: "M-node (mixed)", 8: "H-node (hybrid)" };
  const ENTERPRISE = { 3561: "Broadband Forum (TR-069 / CWMP)", 9: "Cisco", 311: "Microsoft", 4491: "CableLabs" };
  const BBF_SUB = { 1: "DeviceManufacturerOUI", 2: "DeviceSerialNumber", 3: "DeviceProductClass", 4: "GatewayManufacturerOUI", 5: "GatewaySerialNumber", 6: "GatewayProductClass" };

  const name = c => (OPTIONS[c] ? OPTIONS[c].n : "Option " + c);
  const h2 = n => (n < 16 ? "0" : "") + n.toString(16);
  const bytesToHex = (b, sep) => Array.from(b, h2).join(sep == null ? " " : sep);
  const ipText = (b, o) => b[o] + "." + b[o + 1] + "." + b[o + 2] + "." + b[o + 3];
  const parseIp = s => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim()); if (!m) return null; const a = m.slice(1).map(Number); return a.every(x => x < 256) ? a : null; };
  const u32 = (b, o) => ((b[o] * 16777216) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3]);
  const be = n => [Math.floor(n / 16777216) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const dec = b => new TextDecoder("utf-8").decode(Uint8Array.from(b));
  const enc = s => Array.from(new TextEncoder().encode(s));
  const printable = b => b.length > 0 && Array.from(b).every(x => x >= 32 && x < 127);

  // Hex typed by people: "f1 04 c0", "f1:04:c0", "0xf104c0", "f104.c0a8" (Cisco style), a C array "0xf1, 0x04"
  function hexToBytes(text) {
    const s = String(text).replace(/0x/gi, " ").replace(/[\s:.,;-]+/g, "");
    if (!s) return { bytes: [] };
    if (!/^[0-9a-f]*$/i.test(s)) return { error: "That is not hexadecimal text (use 0-9 and a-f)." };
    if (s.length % 2) return { error: "An odd number of hex digits: bytes come in pairs." };
    const out = []; for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 16));
    return { bytes: out };
  }

  // ---- durations: "3600", "1h", "30m", "1d 12h", "infinite" ----
  function parseSecs(text) {
    const s = String(text).trim().toLowerCase();
    if (/^(inf|infinite|forever)$/.test(s)) return 4294967295;
    if (/^\d+$/.test(s)) { const n = Number(s); return n <= 4294967295 ? n : NaN; }
    if (!/^(\d+\s*[dhms]\s*)+$/.test(s)) return NaN;
    let t = 0; for (const m of s.matchAll(/(\d+)\s*([dhms])/g)) t += Number(m[1]) * { d: 86400, h: 3600, m: 60, s: 1 }[m[2]];
    return t <= 4294967295 ? t : NaN;
  }
  function fmtSecs(n) {
    if (n === 4294967295) return "4294967295 (infinite)";
    if (n < 60) return n + " s";
    const d = Math.floor(n / 86400), h = Math.floor(n % 86400 / 3600), m = Math.floor(n % 3600 / 60), s = n % 60, o = [];
    if (d) o.push(d + " d"); if (h) o.push(h + " h"); if (m) o.push(m + " min"); if (s) o.push(s + " s");
    return n + " s (" + o.join(" ") + ")";
  }

  // ---- DNS names (option 119) ----
  function encodeDomains(text) {
    const names = String(text).split(/[\s,;]+/).filter(Boolean), out = [];
    if (!names.length) return { error: "Enter at least one domain name." };
    for (let nm of names) {
      nm = nm.replace(/\.$/, "");
      if (!nm || nm.length > 253) return { error: "A name must be 1 to 253 characters: " + nm };
      for (const l of nm.split(".")) {
        if (!l || l.length > 63) return { error: "Each label must be 1 to 63 characters: " + nm };
        if (/[^\x21-\x7e]/.test(l)) return { error: "Plain ASCII only, no spaces: " + nm };
        out.push(l.length, ...enc(l));
      }
      out.push(0);
    }
    return { bytes: out };
  }
  function decodeDomains(b) {
    const names = []; let i = 0;
    while (i < b.length) {
      const labels = []; let p = i, jumped = false, guard = 0, end = -1;
      for (;;) {
        if (p >= b.length || guard++ > 130) return { error: "The name list is cut short or loops." };
        const l = b[p];
        if (l === 0) { if (!jumped) end = p + 1; break; }
        if ((l & 0xc0) === 0xc0) { if (p + 1 >= b.length) return { error: "A name pointer is cut short." }; const ptr = ((l & 0x3f) << 8) | b[p + 1]; if (!jumped) end = p + 2; jumped = true; if (ptr >= b.length) return { error: "A name pointer points outside the option." }; p = ptr; continue; }
        if (l > 63 || p + 1 + l > b.length) return { error: "A label is cut short." };
        labels.push(dec(b.slice(p + 1, p + 1 + l))); p += 1 + l;
      }
      names.push(labels.join(".")); i = end;
    }
    return { names };
  }

  // ---- classless routes (121 / 249): width, significant octets of the destination, router ----
  function encodeRoutes(text) {
    const out = [], lines = String(text).split(/[\n;,]+/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return { error: "Enter at least one route, for example 10.1.2.0/24 via 192.168.1.1." };
    for (const ln of lines) {
      const m = /^(default|[\d.]+\/\d{1,2}|[\d.]+)\s*(?:via|->|=>|gw|gateway)?\s*([\d.]+)$/i.exec(ln.replace(/\s+/g, " "));
      if (!m) return { error: "Cannot read this route: \"" + ln + "\". Write it as 10.1.2.0/24 via 192.168.1.1 or default via 192.168.1.1." };
      let dst, len;
      if (/^default$/i.test(m[1])) { dst = [0, 0, 0, 0]; len = 0; } else {
        const [a, l] = m[1].split("/"); dst = parseIp(a); len = l == null ? 32 : Number(l);
        if (!dst || len > 32) return { error: "Not a valid network: " + m[1] };
      }
      const gw = parseIp(m[2]); if (!gw) return { error: "Not a valid gateway: " + m[2] };
      const n = Math.ceil(len / 8), masked = dst.map((x, i) => { const keep = Math.max(0, Math.min(8, len - 8 * i)); return x & ((255 << (8 - keep)) & 255); });
      if (masked.some((x, i) => x !== dst[i])) return { error: "The network " + m[1] + " has bits set after the prefix length; use the network address (" + masked.join(".") + "/" + len + ")." };
      out.push(len, ...dst.slice(0, n), ...gw);
    }
    return { bytes: out };
  }
  function decodeRoutes(b) {
    const routes = []; let i = 0;
    while (i < b.length) {
      const len = b[i++]; if (len > 32) return { error: "A route has prefix length " + len + ", more than 32." };
      const n = Math.ceil(len / 8); if (i + n + 4 > b.length) return { error: "The last route is cut short." };
      const d = [0, 0, 0, 0]; for (let k = 0; k < n; k++) d[k] = b[i + k]; i += n;
      routes.push({ dest: d.join("."), len, gw: ipText(b, i) }); i += 4;
    }
    return { routes };
  }

  // ---- sub-option lists (TLV): "code kind value" per line ----
  function encodeTlv(text) {
    const out = [], lines = String(text).split(/\n+/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
    if (!lines.length) return { error: "Enter at least one sub-option, for example: 241 ips 192.168.10.5" };
    for (const ln of lines) {
      const m = /^(\d{1,3})\s+(text|ips|ip|u8|u16|u32|hex)\b\s*(.*)$/i.exec(ln);
      if (!m) return { error: "Cannot read \"" + ln + "\". Write: code kind value, for example 1 ip 10.0.0.5 (kinds: text, ip, ips, u8, u16, u32, hex)." };
      const code = Number(m[1]), kind = m[2].toLowerCase(), v = m[3].trim(); let data;
      if (code < 1 || code > 254) return { error: "A sub-option code must be 1 to 254: " + code };
      if (kind === "text") data = enc(v);
      else if (kind === "ip") { const a = parseIp(v); if (!a) return { error: "Not an IPv4 address: " + v }; data = a; }
      else if (kind === "ips") { data = []; for (const x of v.split(/[\s,]+/).filter(Boolean)) { const a = parseIp(x); if (!a) return { error: "Not an IPv4 address: " + x }; data.push(...a); } if (!data.length) return { error: "Enter at least one address on: " + ln }; }
      else if (kind === "hex") { const h = hexToBytes(v); if (h.error) return { error: h.error }; data = h.bytes; }
      else { const n = /^\d+$/.test(v) ? Number(v) : NaN, max = { u8: 255, u16: 65535, u32: 4294967295 }[kind]; if (!(n <= max)) return { error: "A " + kind + " is a number from 0 to " + max + ": " + v }; data = kind === "u8" ? [n] : kind === "u16" ? [n >> 8, n & 255] : be(n); }
      if (data.length > 255) return { error: "A sub-option holds at most 255 bytes." };
      out.push(code, data.length, ...data);
    }
    return { bytes: out };
  }
  function splitTlv(b) {
    const subs = []; let i = 0;
    while (i < b.length) { if (i + 2 > b.length) return null; const l = b[i + 1]; if (i + 2 + l > b.length) return null; subs.push({ code: b[i], data: b.slice(i + 2, i + 2 + l) }); i += 2 + l; }
    return subs;
  }
  const textOrHex = d => (printable(d) ? JSON.stringify(dec(d)) + "  (" + bytesToHex(d) + ")" : bytesToHex(d));

  // ---- encode: value text -> bytes ----
  function encode(code, text) {
    const opt = OPTIONS[code]; if (!opt) return { error: "Unknown option; use the hex form." };
    const t = opt.t, s = String(text == null ? "" : text).trim();
    let bytes;
    const fail = e => ({ error: e });
    if (t === "empty") bytes = [];
    else if (t === "ip") { const a = parseIp(s); if (!a) return fail("Not an IPv4 address: " + s); bytes = a; }
    else if (t === "ips" || t === "pairs") {
      const parts = s.split(/[\s,;]+/).filter(Boolean); bytes = [];
      if (!parts.length) return fail("Enter at least one address.");
      for (const x of parts) { const a = parseIp(x); if (!a) return fail("Not an IPv4 address: " + x); bytes.push(...a); }
      if (t === "pairs" && parts.length % 2) return fail("Pairs need an even number of addresses.");
    }
    else if (t === "text") { if (!s) return fail("Enter the text."); bytes = enc(String(text).replace(/^\s+|\s+$/g, "")); }
    else if (t === "bool") { if (/^(1|yes|true|on)$/i.test(s)) bytes = [1]; else if (/^(0|no|false|off)$/i.test(s)) bytes = [0]; else return fail("Enter yes or no."); }
    else if (t === "u8" || t === "u16") { const n = /^\d+$/.test(s) ? Number(s) : NaN, max = t === "u8" ? 255 : 65535; if (!(n <= max)) return fail("Enter a whole number from 0 to " + max + "."); bytes = t === "u8" ? [n] : [n >> 8, n & 255]; }
    else if (t === "i32") { const n = /^-?\d+$/.test(s) ? Number(s) : NaN; if (!(n >= -2147483648 && n <= 2147483647)) return fail("Enter a whole number of seconds."); bytes = be(n < 0 ? n + 4294967296 : n); }
    else if (t === "secs") { const n = parseSecs(s); if (isNaN(n)) return fail("Enter seconds, or a time such as 12h, 30m, 1d 12h, or infinite."); bytes = be(n); }
    else if (t === "u16list") { const parts = s.split(/[\s,;]+/).filter(Boolean); if (!parts.length) return fail("Enter at least one size."); bytes = []; for (const x of parts) { const n = /^\d+$/.test(x) ? Number(x) : NaN; if (!(n <= 65535)) return fail("Not a number from 0 to 65535: " + x); bytes.push(n >> 8, n & 255); } }
    else if (t === "msgtype") { let n = /^\d+$/.test(s) ? Number(s) : Number(Object.keys(MSGTYPES).find(k => MSGTYPES[k] === s.toUpperCase())); if (!MSGTYPES[n]) return fail("Enter a message type: a number or a name such as DISCOVER."); bytes = [n]; }
    else if (t === "nbnt") { const n = Number(s); if (!NBNT[n]) return fail("Enter 1, 2, 4 or 8."); bytes = [n]; }
    else if (t === "overload") { const n = Number(s); if (![1, 2, 3].includes(n)) return fail("Enter 1 (file), 2 (sname) or 3 (both)."); bytes = [n]; }
    else if (t === "arch") { const n = /^\d+$/.test(s) ? Number(s) : NaN; if (!(n <= 65535)) return fail("Enter the architecture number."); bytes = [n >> 8, n & 255]; }
    else if (t === "prl") { const parts = s.split(/[\s,;]+/).filter(Boolean); if (!parts.length) return fail("Enter option numbers."); bytes = []; for (const x of parts) { const n = /^\d+$/.test(x) ? Number(x) : NaN; if (!(n >= 1 && n <= 254)) return fail("Option numbers are 1 to 254: " + x); bytes.push(n); } }
    else if (t === "domains") { const r = encodeDomains(s); if (r.error) return r; bytes = r.bytes; }
    else if (t === "routes") { const r = encodeRoutes(s); if (r.error) return r; bytes = r.bytes; }
    else if (t === "vendor" || t === "agent") { const r = encodeTlv(s); if (r.error) return r; bytes = r.bytes; }
    else if (t === "vendor125") {
      bytes = []; const blocks = String(text).split(/^\s*enterprise\s+/im).slice(1);
      if (!blocks.length) return fail("Start with a line such as: enterprise 3561");
      for (const bl of blocks) { const nl = bl.indexOf("\n"), num = Number((nl < 0 ? bl : bl.slice(0, nl)).trim()), r = nl < 0 ? { error: "Add at least one sub-option line after the enterprise number." } : encodeTlv(bl.slice(nl)); if (!(num >= 0 && num <= 4294967295) || r.error) return fail(r.error || "The enterprise number must be a number."); if (r.bytes.length > 255) return fail("One enterprise block holds at most 255 bytes."); bytes.push(...be(num), r.bytes.length, ...r.bytes); }
    }
    else if (t === "clientid") { const m = /^(?:mac\s+)?([0-9a-f]{2}([:.-]?[0-9a-f]{2}){5})$/i.exec(s); if (m) { bytes = [1, ...hexToBytes(m[1]).bytes]; } else { const h = hexToBytes(s); if (h.error || h.bytes.length < 2) return fail("Enter a MAC address, or the identifier type and value in hex (for example 01:aa:bb:cc:dd:ee:ff)."); bytes = h.bytes; } }
    else if (t === "fqdn") { if (!s) return fail("Enter the name."); bytes = [0, 0, 0, ...enc(s)]; }
    else if (t === "hex") { const h = hexToBytes(s); if (h.error) return fail(h.error); bytes = h.bytes; }
    else return fail("Cannot build this option.");
    const notes = [];
    if (bytes.length > 255) notes.push({ level: "warn", text: "This option is " + bytes.length + " bytes; one option holds at most 255. A longer one is sent in pieces (RFC 3396); many servers do this for you, others do not support it." });
    if (code === 121 || code === 249) notes.push({ level: "info", text: "Clients that understand option 121 ignore option 3 (Router) when it is present: include a default route (default via ...) if the client still needs one." });
    if (code === 6 && bytes.length === 0) notes.push({ level: "warn", text: "No DNS servers given." });
    return { bytes, notes };
  }

  // ---- decode: bytes -> words ----
  function decode(code, b) {
    const opt = OPTIONS[code], t = opt ? opt.t : "hex", notes = []; b = Array.from(b);
    const need = (n, exact) => (exact ? b.length !== n : b.length < n);
    const bad = m => ({ text: bytesToHex(b), notes: [{ level: "bad", text: m }] });
    let text, lines;
    if (t === "ip") { if (b.length !== 4) return bad("An address is 4 bytes; this has " + b.length + "."); text = ipText(b, 0); }
    else if (t === "ips" || t === "pairs") { if (!b.length || b.length % 4) return bad("A list of addresses is a multiple of 4 bytes; this has " + b.length + "."); const a = []; for (let i = 0; i < b.length; i += 4) a.push(ipText(b, i)); if (t === "pairs") { if (a.length % 2) return bad("Pairs need an even number of addresses."); const p = []; for (let i = 0; i < a.length; i += 2) p.push(a[i] + " -> " + a[i + 1]); text = p.join(", "); } else text = a.join(", "); }
    else if (t === "text") { text = dec(b); if (/[\x00-\x08\x0e-\x1f]/.test(text)) notes.push({ level: "warn", text: "Contains control characters." }); if (b.length && b[b.length - 1] === 0) notes.push({ level: "info", text: "Ends with a zero byte: some clients add one, others reject it." }); }
    else if (t === "bool") { if (b.length !== 1) return bad("A yes/no value is 1 byte."); text = b[0] === 1 ? "yes (1)" : b[0] === 0 ? "no (0)" : "invalid (" + b[0] + ")"; }
    else if (t === "u8") { if (b.length !== 1) return bad("This value is 1 byte."); text = String(b[0]); }
    else if (t === "u16") { if (b.length !== 2) return bad("This value is 2 bytes."); text = String(b[0] * 256 + b[1]); }
    else if (t === "i32") { if (b.length !== 4) return bad("This value is 4 bytes."); const n = u32(b, 0); text = (n >= 2147483648 ? n - 4294967296 : n) + " s"; }
    else if (t === "secs") { if (b.length !== 4) return bad("This value is 4 bytes."); text = fmtSecs(u32(b, 0)); }
    else if (t === "u16list") { if (!b.length || b.length % 2) return bad("A list of 2-byte numbers."); const a = []; for (let i = 0; i < b.length; i += 2) a.push(b[i] * 256 + b[i + 1]); text = a.join(", "); }
    else if (t === "msgtype") { if (b.length !== 1) return bad("The message type is 1 byte."); text = (MSGTYPES[b[0]] || "unknown") + " (" + b[0] + ")"; }
    else if (t === "nbnt") { if (b.length !== 1) return bad("1 byte."); text = (NBNT[b[0]] || "unknown") + " (" + b[0] + ")"; }
    else if (t === "overload") { if (b.length !== 1) return bad("1 byte."); text = ({ 1: "options also in the file field", 2: "options also in the sname field", 3: "options in both fields" })[b[0]] || "unknown (" + b[0] + ")"; }
    else if (t === "arch") { if (b.length !== 2) return bad("2 bytes."); const n = b[0] * 256 + b[1]; text = (ARCH[n] || "unknown") + " (" + n + ")"; }
    else if (t === "empty") text = b.length ? "(should be empty, has " + b.length + " bytes)" : "(present, no value)";
    else if (t === "prl") text = b.map(x => x + " " + name(x)).join(", ");
    else if (t === "domains") { const r = decodeDomains(b); if (r.error) return bad(r.error); text = r.names.join(", "); }
    else if (t === "routes") { const r = decodeRoutes(b); if (r.error) return bad(r.error); lines = r.routes.map(x => (x.len === 0 ? "default" : x.dest + "/" + x.len) + " via " + x.gw); text = lines.join("; "); if (!r.routes.some(x => x.len === 0)) notes.push({ level: "info", text: "No default route in the list: a client that obeys option 121 will not use option 3 (Router) either." }); }
    else if (t === "clientid") { if (b.length < 2) return bad("Too short."); text = b[0] === 1 && b.length === 7 ? "Ethernet MAC " + bytesToHex(b.slice(1), ":") : b[0] === 0 ? "type 0 (a name): " + textOrHex(b.slice(1)) : "type " + b[0] + ": " + bytesToHex(b.slice(1), ":"); }
    else if (t === "fqdn") { if (b.length < 3) return bad("Too short."); const fl = b[0]; text = dec(b.slice(3)); lines = ["flags " + h2(fl) + (fl & 1 ? " S (client asks the server to update the A record)" : "") + (fl & 2 ? " O (server overrode S)" : "") + (fl & 4 ? " E (name is in DNS wire format)" : "") + (fl & 8 ? " N (no server updates)" : "")]; if (fl & 4) { const r = decodeDomains(b.slice(3)); text = r.names ? r.names.join(", ") : bytesToHex(b.slice(3)); } }
    else if (t === "agent") {
      const subs = splitTlv(b); if (!subs) return bad("The sub-options do not add up to the length of the option.");
      lines = subs.map(s => { let v = textOrHex(s.data); const d = s.data; if (s.code === 1 && d.length === 6 && d[0] === 0 && d[1] === 4) v += "   (often: vlan " + (d[2] * 256 + d[3]) + ", module " + d[4] + ", port " + d[5] + ")"; if (s.code === 2 && d.length === 8 && d[0] === 0 && d[1] === 6) v += "   (often: type 0, length 6, MAC " + bytesToHex(d.slice(2), ":") + ")"; else if (s.code === 2 && d.length === 6) v += "   (looks like a MAC address)"; if (s.code === 5 || s.code === 11) if (d.length === 4) v = ipText(d, 0); return (AGENT_SUB[s.code] || "Sub-option " + s.code) + " (" + s.code + "): " + v; });
      text = lines.join("; ");
    }
    else if (t === "vendor") {
      const subs = splitTlv(b);
      if (b.length >= 6 && b[0] === 0xf1 && b[1] % 4 === 0 && b[1] + 2 === b.length) { const a = []; for (let i = 2; i < b.length; i += 4) a.push(ipText(b, i)); text = "Cisco wireless controller address(es): " + a.join(", "); lines = ["f1 = Cisco lightweight access point controller list"]; }
      else if (subs && subs.length) { lines = subs.map(s => "Sub-option " + s.code + ": " + (s.data.length === 4 ? ipText(s.data, 0) + "  (" + bytesToHex(s.data) + ")" : textOrHex(s.data))); text = lines.join("; "); notes.push({ level: "info", text: "The meaning of each sub-option belongs to the device's maker; check their guide." }); }
      else { text = bytesToHex(b); notes.push({ level: "info", text: "Not a list of sub-options: the format is the device maker's own." }); }
    }
    else if (t === "vendor125") {
      lines = []; let i = 0;
      while (i < b.length) {
        if (i + 5 > b.length) return bad("An enterprise block is cut short."); const ent = u32(b, i), l = b[i + 4]; if (i + 5 + l > b.length) return bad("An enterprise block is longer than the option.");
        const subs = splitTlv(b.slice(i + 5, i + 5 + l)); lines.push("Enterprise " + ent + (ENTERPRISE[ent] ? " (" + ENTERPRISE[ent] + ")" : ""));
        if (subs) for (const s of subs) lines.push("  sub-option " + s.code + (ent === 3561 && BBF_SUB[s.code] ? " " + BBF_SUB[s.code] : "") + ": " + textOrHex(s.data)); else lines.push("  " + bytesToHex(b.slice(i + 5, i + 5 + l)));
        i += 5 + l;
      }
      text = lines.join("; ");
    }
    else { text = bytesToHex(b); if (printable(Uint8Array.from(b)) && b.length > 3) text += "   (text: " + JSON.stringify(dec(Uint8Array.from(b))) + ")"; }
    return { text, lines, notes };
  }

  // ---- a list of options (the part of a DHCP message after the magic cookie) ----
  function decodeOptions(b) {
    const out = [], notes = []; let i = 0, ended = false;
    while (i < b.length) {
      const c = b[i];
      if (c === 0) { i++; continue; }
      if (c === 255) { ended = true; i++; break; }
      if (i + 1 >= b.length) { notes.push({ level: "bad", text: "The options stop in the middle of option " + c + "." }); break; }
      const l = b[i + 1]; if (i + 2 + l > b.length) { notes.push({ level: "bad", text: "Option " + c + " says " + l + " bytes but only " + (b.length - i - 2) + " are left (capture cut short?)." }); out.push({ code: c, len: l, data: Array.from(b.slice(i + 2)), truncated: true }); break; }
      const data = Array.from(b.slice(i + 2, i + 2 + l)), prev = out.find(o => o.code === c && !o.truncated);
      if (prev) { prev.data = prev.data.concat(data); prev.len = prev.data.length; prev.pieces = (prev.pieces || 1) + 1; } else out.push({ code: c, len: l, data });
      i += 2 + l;
    }
    if (!ended && !notes.length) notes.push({ level: "warn", text: "No End option (255) found." });
    for (const o of out) { o.name = name(o.code); if (!o.truncated) { const d = decode(o.code, o.data); o.text = d.text; o.lines = d.lines; o.notes = d.notes; if (o.pieces) (o.notes = o.notes || []).push({ level: "info", text: "Sent in " + o.pieces + " pieces and joined (RFC 3396)." }); } }
    return { options: out, notes, rest: Array.from(b.slice(i)) };
  }

  // ---- a whole DHCP / BOOTP message (the UDP payload) ----
  function decodeMessage(b) {
    b = Array.from(b);
    if (b.length < 240) return { error: "A DHCP message is at least 240 bytes (236 fixed bytes and the 4-byte cookie); this has " + b.length + "." };
    const cookie = b[236] === 0x63 && b[237] === 0x82 && b[238] === 0x53 && b[239] === 0x63;
    const hlen = Math.min(b[2], 16), htype = b[1];
    const mac = bytesToHex(b.slice(28, 28 + hlen), ":");
    const cstr = (s, e) => { const x = b.slice(s, e); const z = x.indexOf(0); const y = z < 0 ? x : x.slice(0, z); return dec(Uint8Array.from(y)); };
    const fields = [
      { name: "Message (op)", value: b[0] === 1 ? "1 BOOTREQUEST (client to server)" : b[0] === 2 ? "2 BOOTREPLY (server to client)" : String(b[0]), start: 0, len: 1 },
      { name: "Hardware type", value: htype + (htype === 1 ? " Ethernet" : ""), start: 1, len: 1 }, { name: "Hardware address length", value: String(b[2]), start: 2, len: 1 }, { name: "Hops", value: String(b[3]), start: 3, len: 1 },
      { name: "Transaction ID", value: "0x" + bytesToHex(b.slice(4, 8), ""), start: 4, len: 4 }, { name: "Seconds elapsed", value: String(b[8] * 256 + b[9]), start: 8, len: 2 },
      { name: "Flags", value: "0x" + bytesToHex(b.slice(10, 12), "") + (b[10] & 0x80 ? " (BROADCAST: the client asks for a broadcast answer)" : " (unicast)"), start: 10, len: 2 },
      { name: "Client IP (ciaddr)", value: ipText(b, 12), start: 12, len: 4 }, { name: "Your IP (yiaddr)", value: ipText(b, 16) + (ipText(b, 16) === "0.0.0.0" ? "" : "   (the address offered or given)"), start: 16, len: 4 },
      { name: "Server IP (siaddr)", value: ipText(b, 20), start: 20, len: 4 }, { name: "Relay IP (giaddr)", value: ipText(b, 24) + (ipText(b, 24) === "0.0.0.0" ? "   (no relay)" : "   (came through a relay)"), start: 24, len: 4 },
      { name: "Client hardware address", value: mac, start: 28, len: hlen },
    ];
    const sname = cstr(44, 108), file = cstr(108, 236);
    if (sname) fields.push({ name: "Server name (sname)", value: sname, start: 44, len: 64 });
    if (file) fields.push({ name: "Boot file (file)", value: file, start: 108, len: 128 });
    fields.push({ name: "Magic cookie", value: bytesToHex(b.slice(236, 240)) + (cookie ? " (DHCP)" : " (not 63 82 53 63: this is not DHCP)"), start: 236, len: 4 });
    const o = decodeOptions(b.slice(240)); let overload = 0;
    const ov = o.options.find(x => x.code === 52); if (ov && ov.data.length === 1) overload = ov.data[0];
    const extra = [];
    if (overload & 1) extra.push(...decodeOptions(b.slice(108, 236)).options);
    if (overload & 2) extra.push(...decodeOptions(b.slice(44, 108)).options);
    const mt = o.options.find(x => x.code === 53), type = mt && mt.data.length === 1 ? MSGTYPES[mt.data[0]] || String(mt.data[0]) : null;
    return { cookie, fields, options: o.options.concat(extra), notes: o.notes, type, mac, op: b[0], xid: bytesToHex(b.slice(4, 8), ""), yiaddr: ipText(b, 16), giaddr: ipText(b, 24) };
  }

  // ---- configuration lines for common servers ----
  const ISC = { 1: "subnet-mask", 3: "routers", 6: "domain-name-servers", 12: "host-name", 15: "domain-name", 26: "interface-mtu", 28: "broadcast-address", 40: "nis-domain", 41: "nis-servers", 42: "ntp-servers", 44: "netbios-name-servers", 46: "netbios-node-type", 66: "tftp-server-name", 67: "bootfile-name", 119: "domain-search" };
  function configFor(code, bytes, valueText) {
    const b = Array.from(bytes), opt = OPTIONS[code], t = opt ? opt.t : "hex", hex = bytesToHex(b, ":"), hexNoSep = bytesToHex(b, ""), out = [];
    const ips = []; if ((t === "ip" || t === "ips") && b.length % 4 === 0) for (let i = 0; i < b.length; i += 4) ips.push(ipText(b, i));
    const q = s => '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    const txt = (t === "text") ? dec(Uint8Array.from(b)) : null;
    // ISC dhcpd
    { let l;
      if (ISC[code] && t === "ip") l = "option " + ISC[code] + " " + ips[0] + ";";
      else if (ISC[code] && t === "ips") l = "option " + ISC[code] + " " + ips.join(", ") + ";";
      else if (ISC[code] && t === "text") l = "option " + ISC[code] + " " + q(txt) + ";";
      else if (ISC[code] === "domain-search") { const r = decodeDomains(b); l = "option domain-search " + r.names.map(q).join(", ") + ";"; }
      else if ((code === 121 || code === 249) && t === "routes") { const r = decodeRoutes(b); l = "option " + (code === 121 ? "rfc3442-classless-static-routes" : "ms-classless-static-routes") + " " + r.routes.map(x => [x.len].concat(x.dest.split(".").slice(0, Math.ceil(x.len / 8)), x.gw.split(".")).join(", ")).join(", ") + ";"; }
      else if (code === 43) l = "option vendor-encapsulated-options " + hex + ";";
      else if (t === "ip" || t === "ips") l = "option option-" + code + " code " + code + " = " + (t === "ips" ? "array of " : "") + "ip-address;\noption option-" + code + " " + ips.join(", ") + ";";
      else if (t === "text") l = "option option-" + code + " code " + code + " = text;\noption option-" + code + " " + q(txt) + ";";
      else l = "option option-" + code + " code " + code + " = string;\noption option-" + code + " " + (hex || "00") + ";";
      out.push({ name: "ISC dhcpd", text: l });
    }
    // dnsmasq
    { let l;
      if ((t === "ip" || t === "ips") && ips.length) l = "dhcp-option=" + code + "," + ips.join(",");
      else if (t === "text") l = "dhcp-option=" + code + "," + txt.replace(/,/g, "\\,");
      else if (t === "routes") { const r = decodeRoutes(b); l = "dhcp-option=" + code + "," + r.routes.map(x => (x.len === 0 ? "0.0.0.0/0" : x.dest + "/" + x.len) + "," + x.gw).join(","); }
      else if (t === "domains") { const r = decodeDomains(b); l = "dhcp-option=119," + r.names.join(","); }
      else l = "dhcp-option=" + code + "," + (hex || "00");
      out.push({ name: "dnsmasq", text: l });
    }
    // Kea
    out.push({ name: "Kea (JSON)", text: '{ "code": ' + code + ', "data": "' + hexNoSep.toUpperCase() + '", "csv-format": false }' });
    // MikroTik
    out.push({ name: "MikroTik RouterOS", text: "/ip dhcp-server option add name=opt" + code + " code=" + code + " value=0x" + (hexNoSep || "00") + "\n# then name it in the network: /ip dhcp-server network set [find] dhcp-option=opt" + code });
    // Cisco IOS
    { let l;
      if (code === 3 && ips.length) l = "default-router " + ips.join(" ");
      else if (code === 6 && ips.length) l = "dns-server " + ips.join(" ");
      else if (code === 15 && txt != null) l = "domain-name " + txt;
      else if (code === 44 && ips.length) l = "netbios-name-server " + ips.join(" ");
      else if ((t === "ip" || t === "ips") && ips.length) l = "option " + code + " ip " + ips.join(" ");
      else if (t === "text" && /^[\x21-\x7e ]*$/.test(txt)) l = "option " + code + " ascii " + q(txt);
      else { const g = []; for (let i = 0; i < hexNoSep.length; i += 4) g.push(hexNoSep.slice(i, i + 4)); l = "option " + code + " hex " + (g.join(".") || "00"); }
      out.push({ name: "Cisco IOS (inside ip dhcp pool)", text: "ip dhcp pool NAME\n " + l.replace(/\n/g, "\n ") });
    }
    return out;
  }

  // ---- DHCPv6 (reference only) ----
  const V6 = [[1, "Client Identifier (DUID)", "Who the client is.", "RFC 8415"], [2, "Server Identifier (DUID)", "Who the server is.", "RFC 8415"], [3, "IA_NA", "A set of addresses (non-temporary).", "RFC 8415"], [4, "IA_TA", "Temporary addresses.", "RFC 8415"],
    [5, "IA Address", "One address with its lifetimes, inside an IA.", "RFC 8415"], [6, "Option Request", "Options the client wants (like option 55 in v4).", "RFC 8415"], [7, "Preference", "Server preference 0-255; 255 = take this server at once.", "RFC 8415"], [8, "Elapsed Time", "Hundredths of a second since the exchange began.", "RFC 8415"],
    [9, "Relay Message", "The original message, inside a relay message.", "RFC 8415"], [11, "Authentication", "", "RFC 8415"], [12, "Server Unicast", "The server allows unicast requests.", "RFC 8415"], [13, "Status Code", "Success or the reason for failure.", "RFC 8415"],
    [14, "Rapid Commit", "Two-message exchange.", "RFC 8415"], [15, "User Class", "", "RFC 8415"], [16, "Vendor Class", "Like v4 option 60.", "RFC 8415"], [17, "Vendor-specific Information", "Like v4 option 43, with an enterprise number.", "RFC 8415"],
    [18, "Interface-ID", "Relay's name for the interface the client is on.", "RFC 8415"], [19, "Reconfigure Message", "", "RFC 8415"], [20, "Reconfigure Accept", "", "RFC 8415"], [23, "DNS Recursive Name Servers", "DNS resolvers (like v4 option 6).", "RFC 3646"],
    [24, "Domain Search List", "Like v4 option 119.", "RFC 3646"], [25, "IA_PD", "A delegated prefix set (the customer's /56 or /48).", "RFC 8415"], [26, "IA Prefix", "One delegated prefix with its lifetimes.", "RFC 8415"], [31, "SNTP Servers", "", "RFC 4075"],
    [32, "Information Refresh Time", "Seconds before an information-only client asks again.", "RFC 8415"], [37, "Relay-Agent Remote-ID", "Like v4 option 82 remote ID.", "RFC 4649"], [38, "Relay-Agent Subscriber-ID", "", "RFC 4580"], [39, "Client FQDN", "", "RFC 4704"],
    [56, "NTP Server", "", "RFC 5908"], [59, "Boot File URL", "", "RFC 5970"], [64, "AFTR-Name", "DS-Lite tunnel end.", "RFC 6334"], [79, "Client Link-Layer Address", "Added by a relay.", "RFC 6939"], [82, "SOL_MAX_RT", "", "RFC 8415"], [83, "INF_MAX_RT", "", "RFC 8415"]];

  const api = { OPTIONS, MSGTYPES, AGENT_SUB, V6, name, hexToBytes, bytesToHex, encode, decode, decodeOptions, decodeMessage, configFor, encodeRoutes, decodeRoutes, encodeDomains, decodeDomains, encodeTlv, parseSecs, fmtSecs };
  if (typeof window !== "undefined") window.DhcpOpt = api;
  if (typeof module !== "undefined") module.exports = api;
})();
