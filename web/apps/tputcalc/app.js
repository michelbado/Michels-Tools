/* Throughput Calculator. The arithmetic is in lib/tputcalc.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).tputcalc = (() => {
  function init(root) {
    const $ = id => root.querySelector("#tputcalc-" + id);
    const T = window.TputCalc, TK = window.TK, setStatus = m => { $("status").textContent = m; };
    const fill = (id, list, sel) => { const s = $(id); for (const k of list) { const o = document.createElement("option"); o.value = k; o.textContent = k; if (k === sel) o.selected = true; s.append(o); } };
    for (const id of ["linku", "speedu", "lineu", "vrateu"]) fill(id, Object.keys(T.RATE), id === "linku" || id === "lineu" ? "Gbit/s" : "Mbit/s");
    fill("sizeu", ["B", "KB", "MB", "GB", "TB", "KiB", "MiB", "GiB", "TiB"], "GB"); fill("vdatau", ["GB", "TB", "MB"], "GB");
    const msg = (box, text) => TK.notes(box, text ? [{ level: "bad", text }] : []);

    function tcp() {
      const sum = $("tcpsum"), out = $("tcpout"); out.textContent = ""; sum.textContent = "";
      const win = T.num($("win").value) * Number($("winu").value), linkBlank = $("link").value.trim() === "", link = linkBlank ? NaN : T.rateToBps($("link").value, $("linku").value);
      const r = T.tcp({ rttMs: $("rtt").value, windowBytes: win, mss: $("mss").value, lossPct: $("loss").value, linkBps: linkBlank ? null : link });
      if (r.error) { msg($("tcpnotes"), r.error); return; }
      if (!linkBlank && isNaN(link)) { msg($("tcpnotes"), "Enter the line speed as a number, or leave it empty."); return; }
      TK.notes($("tcpnotes"), r.notes);
      sum.textContent = "One connection reaches about " + T.fmtRate(r.bps) + " (" + T.fmtMBs(r.bps) + "), limited by " + ({ window: "the window", loss: "packet loss", line: "the line speed" })[r.limit] + ".";
      const rows = [["Most the window allows", T.fmtRate(r.windowBps), "window ÷ round-trip time"]];
      if (isFinite(r.mathisBps)) rows.push(["Most that loss allows", T.fmtRate(r.mathisBps), "MSS ÷ round-trip time × 1.22 ÷ √loss (Mathis)"]);
      if (!linkBlank) rows.push(["Line speed", T.fmtRate(link)]);
      rows.push(["Result", T.fmtRate(r.bps) + "   (" + T.fmtMBs(r.bps) + ")"]);
      const secs = [{ title: "Numbers", rows, mono: true }];
      if (r.bdpBytes != null) secs.push({ title: "To fill the line", rows: [["Data in flight needed (bandwidth-delay product)", T.fmtBytes(r.bdpBytes) + "   (" + Math.ceil(r.bdpBytes) + " bytes)", "Set the window or buffer at least this large, on both ends."], ["Parallel connections with the current window", String(Math.max(1, Math.ceil(link / r.windowBps))), "Each one gets about the window limit above; downloads with several connections add up."]], mono: true });
      TK.render(out, secs, { status: setStatus });
    }
    function km() {
      const v = $("km").value.trim(), box = $("kmout"); box.textContent = ""; $("usekm").disabled = true;
      if (!v) return;
      const r = T.fibreRtt(v); if (r.error) { box.textContent = r.error; return; }
      box.textContent = "Light in fibre: at best " + Math.round(r.minMs * 10) / 10 + " ms round trip for the cable length you typed; cable routes are usually longer than the straight line, and every router and device on the way adds more.";
      $("usekm").disabled = false; $("usekm").dataset.ms = String(Math.round(r.minMs * 10) / 10);
    }
    function transfer() {
      const sum = $("trsum"), out = $("trout"); out.textContent = ""; sum.textContent = "";
      const bytes = T.sizeToBytes($("size").value, $("sizeu").value), bps = T.rateToBps($("speed").value, $("speedu").value);
      if (isNaN(bytes) || isNaN(bps)) { sum.textContent = "Enter the size and the speed as numbers."; return; }
      const r = T.transfer({ bytes, bps, efficiency: $("eff").value });
      if (r.error) { sum.textContent = r.error; return; }
      sum.textContent = T.fmtBytes(bytes) + " at " + T.fmtRate(bps) + " takes about " + T.fmtDuration(r.seconds) + ".";
      const rows = [["Time", T.fmtDuration(r.seconds), (Math.round(r.seconds * 10) / 10) + " seconds"], ["Speed of the data itself", T.fmtRate(r.goodputBps) + "   (" + T.fmtMBs(r.goodputBps) + ")"]];
      const tv = T.num($("time").value);
      if ($("time").value.trim()) {
        if (!(tv > 0)) rows.push(["Speed needed", "Enter the time as a number above 0."]);
        else { const need = T.rateNeeded({ bytes, seconds: tv * Number($("timeu").value) }); const eff = T.num($("eff").value) / 100; rows.push(["Speed needed to finish in " + $("time").value.trim() + " " + $("timeu").selectedOptions[0].textContent, T.fmtRate(need.bps) + "   (" + T.fmtMBs(need.bps) + ")", eff > 0 && eff < 1 ? "as a line speed: about " + T.fmtRate(need.bps / eff) + " at " + $("eff").value.trim() + " % efficiency" : ""]); }
      }
      TK.render(out, [{ title: "Result", rows, mono: true }], { status: setStatus });
    }
    function eff() {
      const sum = $("effsum"), out = $("effout"); out.textContent = ""; sum.textContent = "";
      const e = T.efficiency({ ipMtu: $("mtu").value, ipVersion: $("ipv").value, proto: $("proto").value, vlan: $("vlan").checked, pppoe: $("pppoe").checked, timestamps: $("ts").checked && $("proto").value === "tcp", extra: $("extra").value.trim() });
      if (e.error) { msg($("effnotes"), e.error); return; }
      TK.notes($("effnotes"), $("pppoe").checked && T.num($("mtu").value) > 1492 ? [{ level: "warn", text: "PPPoE normally limits the IP packet to 1492 bytes on an Ethernet link; check the MTU." }] : []);
      const line = T.rateToBps($("line").value, $("lineu").value);
      sum.textContent = Math.round(e.efficiency * 10) / 10 + " % of the line is data: " + e.payload + " bytes of every " + e.wireBytes + " bytes on the wire" + (isNaN(line) ? "." : ", so " + T.fmtRate(line) + " carries about " + T.fmtRate(line * e.efficiency / 100) + " of data.");
      const secs = [{ title: "Per packet", rows: [["Data in a packet", e.payload + " bytes", "IP packet " + $("mtu").value.trim() + " − " + e.ipHeader + " (IP header) − " + e.l4Header + " (" + ($("proto").value === "udp" ? "UDP" : "TCP") + " header)"], ["Frame on the link", e.frameBytes + " bytes", "14 Ethernet header + 4 check sequence" + ($("vlan").checked ? " + 4 VLAN" : "") + ($("pppoe").checked ? " + 8 PPPoE" : "") + " + the IP packet"], ["On the wire", e.wireBytes + " bytes", "plus 8 preamble and 12 gap between frames"], ["Share that is data", Math.round(e.efficiency * 100) / 100 + " %"]], mono: true }];
      if (!isNaN(line)) {
        const rows = T.FRAME_SIZES.map(f => { const p = T.pps(line, f); return [f + " byte frames", Math.round(p).toLocaleString("en-US") + " packets/s", T.fmtRate(line * f / (f + 20)) + " of frame bytes"]; });
        secs.push({ title: "Packets per second at full speed " + T.fmtRate(line), rows, mono: true, foot: "Small packets are the hard case for routers and firewalls: the load comes from the packets per second, not the megabits. The 64-byte row is the figure equipment makers quote." });
      }
      TK.render(out, secs, { status: setStatus });
    }
    function vol() {
      const out = $("vout"); out.textContent = "";
      const rows = [], bps = T.rateToBps($("vrate").value, $("vrateu").value), d = T.sizeToBytes($("vdata").value, $("vdatau").value);
      if ($("vrate").value.trim()) {
        if (isNaN(bps)) rows.push(["Data from the speed", "Enter the speed as a number."]);
        else { rows.push(["Per hour", T.fmtBytes(T.volume(bps, 3600))], ["Per day", T.fmtBytes(T.volume(bps, 86400))], ["Per month (30 days)", T.fmtBytes(T.volume(bps, T.MONTH))]); }
      }
      if ($("vdata").value.trim()) {
        if (isNaN(d)) rows.push(["Speed from the data", "Enter the data as a number."]);
        else { const r = T.avgRateFor(d, T.MONTH); rows.push([T.fmtBytes(d) + " per month averages", T.fmtRate(r) + "   (" + T.fmtMBs(r) + ")"]); }
      }
      if (rows.length) TK.render(out, [{ title: "Result", rows, mono: true }], { status: setStatus });
    }
    function all() { tcp(); transfer(); eff(); vol(); km(); }
    const again = TK.debounce(all, 120);
    for (const el of root.querySelectorAll("input.xp-field")) el.addEventListener("input", again);
    for (const el of root.querySelectorAll("select, input.xp-check")) el.addEventListener("change", all);
    $("usekm").addEventListener("click", () => { $("rtt").value = $("usekm").dataset.ms; all(); });
    all();
    return { destroy() {} };
  }
  return { init };
})();
