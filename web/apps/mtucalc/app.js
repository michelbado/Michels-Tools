/* MTU & MSS Calculator. All arithmetic is in lib/mtucalc.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).mtucalc = (() => {
  function init(root) {
    const $ = id => root.querySelector("#mtucalc-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const MC = window.MtuCalc, TK = window.TK;
    for (const id of ["l1", "l2", "l3"]) {
      const sel = $(id), none = document.createElement("option"); none.value = ""; none.textContent = "(none)"; sel.append(none);
      for (const k of MC.layerIds()) { const o = document.createElement("option"); o.value = k; o.textContent = MC.LAYERS[k].label; sel.append(o); }
    }
    const state = () => ({ link: $("link").value.trim(), inner: Number($("inner").value), under: Number($("under").value), layers: [$("l1").value, $("l2").value, $("l3").value],
      extra: $("extra").value.trim() || 0, natt: $("natt").checked, transport: $("transport").checked });
    function run() {
      const r = MC.compute(state()), sec = $("sections");
      sec.textContent = "";
      if (r.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: r.error }]); } else {
        $("summary").textContent = "Largest packet: " + r.mtu + " bytes. Set the TCP MSS to " + r.mss + ".";
        TK.notes($("notes"), r.notes);
        const rows = [["Link", r.link + " bytes"]];
        for (const s of r.steps) rows.push([s.label, s.before + " → " + s.after + " bytes (−" + s.overhead + ")", s.note]);
        const nums = [
          ["Largest packet (MTU)", String(r.mtu), "Set this as the MTU of the tunnel interface."],
          ["TCP MSS to announce or clamp", String(r.mss), "MTU minus " + r.ipHeader + " (" + (r.inner === 6 ? "IPv6" : "IPv4") + " header) minus 20 (TCP header)."],
          ["Data in a TCP packet with timestamps on", String(r.mssTimestamps), "Most systems use the 12-byte TCP timestamp option, so each packet carries 12 bytes less than the MSS."],
          ["Largest UDP payload without splitting", String(r.udp), "MTU minus " + r.ipHeader + " minus 8 (UDP header). DNS, QUIC and VPN-in-VPN traffic care about this."],
          ["Largest ping payload without splitting", String(r.ping), "MTU minus " + r.ipHeader + " minus 8 (ICMP header). Use it to verify the path: the commands are below."],
        ];
        const ping = MC.pingCommands(r.ping, r.inner).map(([k, v]) => [k, v]);
        const clamp = MC.clampExamples(r.mss);
        TK.render(sec, [
          { title: "Step by step", rows },
          { title: "Numbers to use", rows: nums, mono: true },
          { title: "Check it with ping (\"do not fragment\", payload " + r.ping + " must work, " + (r.ping + 1) + " must fail)", rows: ping, mono: true },
          { title: "Clamp the TCP MSS (examples; check your own platform's manual)", rows: clamp, mono: true, foot: "Clamping rewrites the MSS in the TCP handshake so both ends choose packets that fit. It cannot help UDP or ICMP traffic." },
        ], { copy: true, status: setStatus });
        setStatus("Done.");
      }
      const po = $("pingout"); po.textContent = "";
      if ($("ping").value.trim()) {
        const f = MC.fromPing($("ping").value.trim(), Number($("pingv").value));
        if (f.error) TK.notes($("notes"), [{ level: "bad", text: f.error }]);
        else TK.render(po, [{ title: "From your ping test", rows: [["Path MTU", String(f.mtu), "payload " + f.payload + " + " + f.ipHeader + " (IP header) + 8 (ICMP header)"], ["TCP MSS", String(f.mss)]], mono: true }], { copy: true, status: setStatus });
      }
    }
    function reference() {
      const base = { link: 1500, inner: 4 }, rows4 = [], rows6 = [];
      for (const id of ["pppoe", "ipip", "gre", "wg", "vxlan", "esp_gcm", "esp_cbc256"]) {
        const a = MC.compute(Object.assign({ layers: [id], under: 4 }, base)), b = MC.compute(Object.assign({ layers: [id], under: 6 }, base));
        rows4.push([MC.LAYERS[id].label, a.mtu + " bytes   (MSS " + a.mss + ")"]); rows6.push([MC.LAYERS[id].label, b.mtu + " bytes   (MSS " + b.mss + ")"]);
      }
      TK.render($("ref"), [{ title: "Quick reference: one layer on a 1500-byte link, IPv4 traffic, tunnels over IPv4", rows: rows4, mono: true },
        { title: "The same, tunnels over IPv6", rows: rows6, mono: true, foot: "IPsec figures are for tunnel mode without NAT-T. The tool above works out your exact stack." }]);
    }
    const again = TK.debounce(run, 150);
    for (const id of ["link", "extra", "ping"]) $(id).addEventListener("input", again);
    for (const id of ["inner", "under", "l1", "l2", "l3", "natt", "transport", "pingv"]) $(id).addEventListener("change", run);
    $("l1").value = ""; reference(); run();
    return { destroy() {} };
  }
  return { init };
})();
