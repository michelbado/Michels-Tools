/* Throughput calculator: what limits a transfer, how long it takes, how much of the line is real data, and how much data a rate adds up to.
   Pure arithmetic on numbers the visitor types; nothing is measured and nothing is sent. Rates are bits per second; sizes are bytes.
   Decimal units (kilo = 1000) are the default, binary ones (KiB, MiB ...) are named as such. Exports window.TputCalc. */
(() => {
  "use strict";
  const RATE = { "kbit/s": 1e3, "Mbit/s": 1e6, "Gbit/s": 1e9, "KB/s": 8e3, "MB/s": 8e6, "GB/s": 8e9, "MiB/s": 8 * 1048576 };
  const SIZE = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KiB: 1024, MiB: 1048576, GiB: 1073741824, TiB: 1099511627776 };
  const num = v => { const s = String(v == null ? "" : v).trim().replace(/,/g, ""); return /^\d*\.?\d+(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN; };

  function rateToBps(v, unit) { const n = num(v); return RATE[unit] && n >= 0 ? n * RATE[unit] : NaN; }
  function sizeToBytes(v, unit) { const n = num(v); return SIZE[unit] && n >= 0 ? n * SIZE[unit] : NaN; }

  function sig(n) { return n >= 100 ? String(Math.round(n)) : n >= 10 ? (Math.round(n * 10) / 10).toString() : (Math.round(n * 100) / 100).toString(); }
  function fmtRate(bps) {
    if (!isFinite(bps)) return "-";
    const a = Math.abs(bps);
    if (a >= 1e9) return sig(bps / 1e9) + " Gbit/s";
    if (a >= 1e6) return sig(bps / 1e6) + " Mbit/s";
    if (a >= 1e3) return sig(bps / 1e3) + " kbit/s";
    return sig(bps) + " bit/s";
  }
  const fmtMBs = bps => { const B = bps / 8; return B >= 1e9 ? sig(B / 1e9) + " GB/s" : B >= 1e6 ? sig(B / 1e6) + " MB/s" : sig(B / 1e3) + " kB/s"; };
  function fmtBytes(b) {
    if (!isFinite(b)) return "-";
    return b >= 1e12 ? sig(b / 1e12) + " TB" : b >= 1e9 ? sig(b / 1e9) + " GB" : b >= 1e6 ? sig(b / 1e6) + " MB" : b >= 1e3 ? sig(b / 1e3) + " kB" : Math.round(b) + " bytes";
  }
  function fmtDuration(s) {
    if (!isFinite(s)) return "-";
    if (s < 1) return sig(s * 1000) + " ms";
    if (s < 60) return sig(s) + " seconds";
    const t = Math.round(s), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60, out = [];
    if (d) out.push(d + " d"); if (h) out.push(h + " h"); if (m) out.push(m + " min"); if (sec && !d) out.push(sec + " s");
    return out.join(" ");
  }

  // One TCP connection: what is the most it can carry?
  // o: { rttMs, windowBytes, mss, lossPct, linkBps }  (lossPct and linkBps optional)
  function tcp(o) {
    const rtt = num(o.rttMs) / 1000, win = num(o.windowBytes), mss = num(o.mss == null || o.mss === "" ? 1460 : o.mss);
    const loss = o.lossPct == null || String(o.lossPct).trim() === "" ? 0 : num(o.lossPct) / 100;
    const link = o.linkBps == null || String(o.linkBps).trim() === "" ? Infinity : Number(o.linkBps);
    if (!(rtt > 0)) return { error: "The round-trip time must be more than 0 ms." };
    if (!(win >= 1)) return { error: "The window must be at least 1 byte." };
    if (!(mss >= 1 && mss <= 65535)) return { error: "The MSS must be between 1 and 65535 bytes." };
    if (!(loss >= 0 && loss < 1)) return { error: "Loss must be from 0 up to (not including) 100 %." };
    if (!(link > 0)) return { error: "The line speed must be more than 0." };
    const windowBps = win * 8 / rtt;
    const mathisBps = loss > 0 ? mss * 8 / rtt * 1.22 / Math.sqrt(loss) : Infinity;
    const best = Math.min(link, windowBps, mathisBps);
    const limit = best === link ? "line" : windowBps <= mathisBps ? "window" : "loss";
    const bdp = isFinite(link) ? link * rtt / 8 : null;
    const out = { rttS: rtt, windowBps, mathisBps, linkBps: link, bps: best, limit, bdpBytes: bdp, needScaling: win > 65535, notes: [] };
    if (isFinite(link) && windowBps < link) out.notes.push({ level: "warn", text: "The window is the limit: " + fmtBytes(win) + " in flight per round trip of " + sig(rtt * 1000) + " ms allows at most " + fmtRate(windowBps) + ", however fast the line is. A window of about " + fmtBytes(bdp) + " would fill the line." });
    if (loss > 0 && mathisBps < Math.min(windowBps, link)) out.notes.push({ level: "warn", text: "Loss is the limit: with " + sig(loss * 100) + " % of packets lost, a single TCP connection settles near " + fmtRate(mathisBps) + " (Mathis formula, an estimate for long-running transfers with classic loss-based congestion control). Several connections in parallel each get that much; newer algorithms such as BBR do better on lossy paths." });
    if (win > 65535) out.notes.push({ level: "info", text: "A window above 65,535 bytes needs TCP window scaling (RFC 7323) on both ends. It is on by default in current systems, but some firewalls and old devices strip it, which brings the window back to 64 KiB." });
    if (win <= 65535 && isFinite(link) && link * rtt / 8 > 65535) out.notes.push({ level: "info", text: "Without window scaling a connection can have at most 65,535 bytes in flight: " + fmtRate(65535 * 8 / rtt) + " at this round-trip time." });
    return out;
  }

  // Window needed to fill a line
  function windowFor(linkBps, rttMs) { return linkBps * (num(rttMs) / 1000) / 8; }

  // How long a transfer takes; efficiency in percent (the share of the line that is real data)
  function transfer(o) {
    const bytes = Number(o.bytes), bps = Number(o.bps), eff = o.efficiency == null || o.efficiency === "" ? 100 : num(o.efficiency);
    if (!(bytes >= 0)) return { error: "Enter the size." };
    if (!(bps > 0)) return { error: "Enter the speed." };
    if (!(eff > 0 && eff <= 100)) return { error: "Efficiency must be above 0 and at most 100 %." };
    const seconds = bytes * 8 / (bps * eff / 100);
    return { seconds, goodputBps: bps * eff / 100 };
  }
  function rateNeeded(o) {
    const bytes = Number(o.bytes), seconds = Number(o.seconds);
    if (!(bytes > 0) || !(seconds > 0)) return { error: "Enter the size and the time." };
    return { bps: bytes * 8 / seconds };
  }

  // Share of the line that is data. o: { ipMtu, ipVersion (4|6), vlan, pppoe, extra, timestamps, proto: "tcp"|"udp" }
  // On the wire each frame also carries: Ethernet header 14, FCS 4, preamble + start 8, gap 12 (= 38 bytes), plus VLAN tag 4 / PPPoE 8 / other.
  function efficiency(o) {
    const mtu = num(o.ipMtu), v = Number(o.ipVersion) === 6 ? 6 : 4, extra = o.extra === "" || o.extra == null ? 0 : num(o.extra);
    if (!(mtu >= 68 && mtu <= 65535)) return { error: "The IP packet size (MTU) must be between 68 and 65535." };
    if (!(extra >= 0)) return { error: "Other overhead must be 0 or more." };
    const ip = v === 6 ? 40 : 20, l4 = o.proto === "udp" ? 8 : 20 + (o.timestamps ? 12 : 0);
    const payload = mtu - ip - l4;
    if (payload < 1) return { error: "The packet is too small to carry any data after the headers." };
    const frame = 14 + 4 + (o.vlan ? 4 : 0) + (o.pppoe ? 8 : 0) + extra + mtu, wire = frame + 20;
    return { payload, ipHeader: ip, l4Header: l4, frameBytes: frame, wireBytes: wire, efficiency: payload / wire * 100 };
  }

  // Frames per second at full speed for a frame of F bytes (counted from the Ethernet destination to the FCS, 64..1518 normally)
  function pps(bps, frameBytes) { return bps / ((frameBytes + 20) * 8); }
  const FRAME_SIZES = [64, 128, 256, 512, 1024, 1280, 1518];

  // Rate <-> monthly data. A month is 30 days.
  function volume(bps, seconds) { return bps / 8 * seconds; }
  function avgRateFor(bytes, seconds) { return bytes * 8 / seconds; }
  const MONTH = 30 * 86400;

  // Round-trip time of light in fibre: about 5 microseconds per km each way (refractive index ~1.47), with the real cable route about 1.2 to 1.5 times the straight line
  function fibreRtt(km) { const k = num(km); return k >= 0 ? { minMs: 2 * k * 0.005, typicalMs: 2 * k * 1.3 * 0.005 } : { error: "Enter the distance in kilometres." }; }

  const api = { RATE, SIZE, num, rateToBps, sizeToBytes, fmtRate, fmtMBs, fmtBytes, fmtDuration, tcp, windowFor, transfer, rateNeeded, efficiency, pps, FRAME_SIZES, volume, avgRateFor, MONTH, fibreRtt };
  if (typeof window !== "undefined") window.TputCalc = api;
  if (typeof module !== "undefined") module.exports = api;
})();
