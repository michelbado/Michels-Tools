/* MTU / MSS calculator: the largest packet that fits through a stack of encapsulations (PPPoE, GRE, IPsec, WireGuard, VXLAN ...), and
   the TCP MSS, UDP payload and ping payload that follow from it. Pure arithmetic on numbers the visitor types; it reads nothing from
   the device or the network. Exports window.MtuCalc. */
(() => {
  "use strict";
  const ipHdr = v => (v === 6 ? 40 : 20);
  const roundUp = (n, b) => Math.ceil(n / b) * b;

  // ESP cipher suites: IV size, integrity tag (ICV) size, and the block the encrypted part is padded to.
  const ESP = {
    gcm: { label: "IPsec ESP, AES-GCM (also AES-CCM)", iv: 8, icv: 16, block: 4 },
    chacha: { label: "IPsec ESP, ChaCha20-Poly1305", iv: 8, icv: 16, block: 4 },
    cbc256: { label: "IPsec ESP, AES-CBC + HMAC-SHA-256", iv: 16, icv: 16, block: 16 },
    cbc384: { label: "IPsec ESP, AES-CBC + HMAC-SHA-384", iv: 16, icv: 24, block: 16 },
    cbc512: { label: "IPsec ESP, AES-CBC + HMAC-SHA-512", iv: 16, icv: 32, block: 16 },
    cbc1: { label: "IPsec ESP, AES-CBC + HMAC-SHA-1", iv: 16, icv: 12, block: 16 },
  };

  // Layers a packet can go through, listed outermost first by the visitor. fixed(under) = bytes added; ESP is worked out exactly.
  const LAYERS = {
    pppoe: { label: "PPPoE (DSL and many fibre lines)", add: () => 8, note: "6 bytes PPPoE + 2 bytes PPP" },
    mpls1: { label: "MPLS, 1 label", add: () => 4, note: "4 bytes per label" },
    mpls2: { label: "MPLS, 2 labels", add: () => 8, note: "4 bytes per label" },
    ipip: { label: "IP-in-IP tunnel", add: u => ipHdr(u), note: "one extra outer IP header" },
    gre: { label: "GRE tunnel", add: u => ipHdr(u) + 4, note: "outer IP header + 4-byte GRE header" },
    grekey: { label: "GRE tunnel with key", add: u => ipHdr(u) + 8, note: "outer IP header + 4-byte GRE header + 4-byte key" },
    sit: { label: "6in4 / SIT tunnel (IPv6 inside IPv4)", add: () => 20, note: "outer IPv4 header" },
    dslite: { label: "DS-Lite (IPv4 inside IPv6)", add: () => 40, note: "outer IPv6 header" },
    wg: { label: "WireGuard", add: u => ipHdr(u) + 8 + 32, note: "outer IP header + 8-byte UDP header + 32 bytes of WireGuard header and tag" },
    vxlan: { label: "VXLAN", add: u => ipHdr(u) + 8 + 8 + 14, note: "outer IP header + UDP 8 + VXLAN 8 + the inner Ethernet header 14" },
    esp_gcm: { label: ESP.gcm.label, esp: "gcm" },
    esp_chacha: { label: ESP.chacha.label, esp: "chacha" },
    esp_cbc256: { label: ESP.cbc256.label, esp: "cbc256" },
    esp_cbc384: { label: ESP.cbc384.label, esp: "cbc384" },
    esp_cbc512: { label: ESP.cbc512.label, esp: "cbc512" },
    esp_cbc1: { label: ESP.cbc1.label, esp: "cbc1" },
  };
  const layerIds = () => Object.keys(LAYERS);

  // The largest inner packet P that, wrapped in ESP, still fits in m bytes. inner = IP version of the packet being protected.
  function espInner(m, kind, o) {
    const c = ESP[kind], under = o.under, tunnel = !o.transport, hdrIn = ipHdr(o.inner);
    const total = P => {
      const enc = tunnel ? P + 2 : P - hdrIn + 2;                           // what gets padded: the packet (tunnel) or its payload (transport)
      return (tunnel ? ipHdr(under) : hdrIn) + (o.natt ? 8 : 0) + 8 + c.iv + roundUp(enc, c.block) + c.icv;
    };
    for (let P = m; P >= 40; P--) if (total(P) <= m) return { inner: P, overhead: m - P, total: total(P) };
    return { inner: 0, overhead: m, total: 0 };
  }

  // opts: { link, under (4|6), inner (4|6), layers: [ids, outermost first], extra, natt, transport }
  function compute(opts) {
    const o = { under: opts.under === 6 ? 6 : 4, inner: opts.inner === 6 ? 6 : 4, natt: !!opts.natt, transport: !!opts.transport };
    const link = Math.floor(Number(opts.link));
    if (!Number.isFinite(link) || link < 68 || link > 65535) return { error: "Enter the link MTU as a whole number from 68 to 65535 (Ethernet is 1500)." };
    const extra = Math.floor(Number(opts.extra) || 0);
    if (extra < 0 || extra > 2000) return { error: "Extra overhead must be from 0 to 2000 bytes." };
    const steps = [], notes = [];
    let m = link;
    for (const id of opts.layers || []) {
      if (!id) continue;
      const L = LAYERS[id];
      if (!L) return { error: "Unknown layer: " + id };
      const before = m;
      if (L.esp) {
        const r = espInner(m, L.esp, o);
        m = r.inner;
        steps.push({ id, label: L.label + (o.transport ? ", transport mode" : ", tunnel mode") + (o.natt ? ", in UDP (NAT-T)" : ""), before, after: m, overhead: before - m,
          note: "up to " + (before - m) + " bytes: outer headers, ESP header, IV, padding to " + ESP[L.esp].block + " bytes, trailer and " + ESP[L.esp].icv + "-byte tag (the padding changes with the packet size, so this is the largest packet that fits)" });
      } else {
        const add = L.add(o.under);
        m -= add;
        steps.push({ id, label: L.label, before, after: m, overhead: add, note: L.note });
      }
    }
    if (extra) { const before = m; m -= extra; steps.push({ id: "extra", label: "Extra overhead you entered", before, after: m, overhead: extra, note: "as entered" }); }
    if (m < 1) return { error: "The overhead is larger than the link MTU: nothing fits through." };
    const ip = ipHdr(o.inner), mss = m - ip - 20;
    const r = { link, inner: o.inner, under: o.under, steps, mtu: m, totalOverhead: link - m, ipHeader: ip,
      mss, mssTimestamps: mss - 12, udp: m - ip - 8, ping: m - ip - 8, notes };
    if (o.inner === 6 && m < 1280) notes.push({ level: "bad", text: "IPv6 needs at least 1280 bytes. With " + m + " bytes IPv6 will not work reliably through this path: raise the link MTU or remove a layer." });
    else if (o.inner === 4 && m < 576) notes.push({ level: "bad", text: "Below 576 bytes many IPv4 programs fail. Check the numbers: this is much smaller than normal." });
    else if (m < 1200) notes.push({ level: "warn", text: "Under 1200 bytes QUIC (HTTP/3) cannot be used on this path, and some VPN and video traffic will fragment." });
    if (r.totalOverhead === 0 && !steps.length) notes.push({ level: "", text: "No tunnel layers chosen: the packet size is just the link MTU." });
    if (mss < 536) notes.push({ level: "warn", text: "A TCP MSS under 536 bytes is unusual and slow. Check the numbers." });
    return r;
  }

  // From a ping test: the largest payload that went through with "do not fragment" set -> the path MTU.
  function fromPing(payload, inner) {
    const p = Math.floor(Number(payload));
    if (!Number.isFinite(p) || p < 0 || p > 65000) return { error: "Enter the largest payload size (bytes) that got an answer, a whole number." };
    const v = inner === 6 ? 6 : 4, mtu = p + ipHdr(v) + 8;
    return { payload: p, inner: v, mtu, mss: mtu - ipHdr(v) - 20, ipHeader: ipHdr(v) };
  }

  const pingCommands = (n, v) => [
    ["Windows", "ping " + (v === 6 ? "-6 " : "") + "-f -l " + n + " <host>"],
    ["Linux", "ping " + (v === 6 ? "-6 " : "") + "-M do -s " + n + " <host>"],
  ].concat(v === 6 ? [] : [["macOS", "ping -D -s " + n + " <host>"]]);

  // TCP MSS clamping, one example per common platform (the value is the MSS, not the MTU).
  const clampExamples = mss => [
    ["Linux (iptables)", "iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss " + mss],
    ["Cisco IOS", "ip tcp adjust-mss " + mss + "   (on the tunnel or outgoing interface)"],
    ["MikroTik", "/ip firewall mangle add chain=forward protocol=tcp tcp-flags=syn action=change-mss new-mss=" + mss + " passthrough=yes"],
    ["FortiGate", "config system interface / edit <interface> / set tcp-mss " + mss + " / next / end"],
  ];

  const api = { compute, fromPing, pingCommands, clampExamples, layerIds, LAYERS, ESP, ipHdr };
  if (typeof window !== "undefined") window.MtuCalc = api;
  if (typeof module !== "undefined") module.exports = api;
})();
