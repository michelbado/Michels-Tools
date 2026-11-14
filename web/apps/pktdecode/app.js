/* Packet Header Decoder. The reading is done by lib/pktdecode.js (and lib/dhcpopt.js for DHCP); this file only shows it.
   Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).pktdecode = (() => {
  const MAX_BYTES = 65535, HEX_SHOWN = 1536;
  const EXAMPLES = {
    "tcp syn with options": "aa bb cc 00 00 02 aa bb cc 00 00 01 08 00 45 00" +
      " " + "00 3c 12 34 00 00 40 06 9c 7e 0a 00 00 01 c0 00" +
      " " + "02 09 c7 38 01 bb 00 00 03 e8 00 00 00 00 a0 02" +
      " " + "20 00 dd 11 00 00 02 04 05 b4 04 02 08 0a 00 01" +
      " " + "b2 07 00 00 00 00 01 03 03 07",
    "dns query": "aa bb cc 00 00 02 aa bb cc 00 00 01 08 00 45 00" +
      " " + "00 3d 12 34 00 00 40 11 54 47 0a 00 00 01 0a 00" +
      " " + "00 35 cf 77 00 35 00 29 12 6e be ef 01 00 00 01" +
      " " + "00 00 00 00 00 00 03 77 77 77 07 65 78 61 6d 70" +
      " " + "6c 65 03 63 6f 6d 00 00 01 00 01",
    "dhcp discover": "ff ff ff ff ff ff aa bb cc 00 00 01 08 00 45 00" +
      " " + "01 26 12 34 00 00 40 11 67 94 00 00 00 00 ff ff" +
      " " + "ff ff 00 44 00 43 01 12 5b 90 01 01 06 00 39 03" +
      " " + "f3 26 00 00 80 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 aa bb cc dd ee 01 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 00 63 82 53 63 35 01 01 3d 07 01" +
      " " + "aa bb cc dd ee 01 37 04 01 03 06 79 3c 05 4d 53" +
      " " + "46 54 20 ff",
    "icmp frag needed": "aa bb cc 00 00 02 aa bb cc 00 00 01 08 00 45 00" +
      " " + "00 3c 12 34 00 00 40 01 53 8f 0a 00 00 fe 0a 00" +
      " " + "00 01 03 04 2a a8 00 00 05 78 45 00 00 20 12 34" +
      " " + "40 00 40 06 5c 9a 0a 00 00 01 c0 00 02 09 c7 38" +
      " " + "01 bb 00 00 03 e8 00 00 00 00",
    "icmp6 neighbor solicitation": "33 33 ff 00 00 02 aa bb cc 00 00 01 86 dd 60 00" +
      " " + "00 00 00 20 3a ff 20 01 0d b8 00 00 00 00 00 00" +
      " " + "00 00 00 00 00 01 ff 02 00 00 00 00 00 00 00 00" +
      " " + "00 01 ff 00 00 02 87 00 a7 6a 00 00 00 00 20 01" +
      " " + "0d b8 00 00 00 00 00 00 00 00 00 00 00 02 01 01" +
      " " + "aa bb cc 00 00 01",
    "pppoe session ipv4": "aa bb cc 00 00 02 aa bb cc 00 00 01 88 64 11 00" +
      " " + "12 34 00 20 00 21 45 00 00 1e 12 34 00 00 40 11" +
      " " + "da 17 64 40 00 09 c6 33 64 07 0f a0 00 35 00 0a" +
      " " + "f1 10 70 70 00 00 00 00 00 00 00 00",
  };
  function init(root) {
    const $ = id => root.querySelector("#pktdecode-" + id);
    const PD = window.PktDecode, TK = window.TK, setStatus = m => { $("status").textContent = m; };
    let text = "";
    for (const [v, t] of [["", "(choose an example)"], ["tcp syn with options", "A TCP SYN with options"], ["dns query", "A DNS query"], ["dhcp discover", "A DHCP DISCOVER"], ["icmp frag needed", "ICMP: fragmentation needed"], ["icmp6 neighbor solicitation", "IPv6 neighbor solicitation"], ["pppoe session ipv4", "PPPoE session carrying IPv4"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; $("example").append(o);
    }
    const byte2 = n => (n < 16 ? "0" : "") + n.toString(16);
    function textOf(d, bytes) {
      const out = ["Packet decoded by Michel's Tools (" + bytes.length + " bytes)", d.summary, ""];
      for (const n of d.notes) out.push("* " + n.text);
      if (d.notes.length) out.push("");
      for (const l of d.layers) { out.push(l.title + "  [bytes " + l.start + " to " + l.end + "]"); for (const f of l.fields) out.push("  " + f.name + ": " + f.value); out.push(""); }
      return out.join("\n");
    }
    function hexView(bytes, d) {
      const pre = document.createElement("div"); pre.className = "pd-hex"; pre.setAttribute("role", "group"); pre.setAttribute("aria-label", "The packet bytes, coloured by header");
      const shown = Math.min(bytes.length, HEX_SHOWN), cls = new Array(shown).fill(-1);
      d.layers.forEach((l, i) => { if (l.name === "trailer") return; for (let k = l.start; k < Math.min(l.end, shown); k++) cls[k] = i % 6; });
      const spans = [];
      for (let o = 0; o < shown; o += 16) {
        const off = document.createElement("span"); off.className = "pd-off"; off.textContent = o.toString(16).padStart(4, "0") + "  "; pre.append(off);
        for (let k = o; k < Math.min(shown, o + 16); k++) {
          const s = document.createElement("span"); s.className = "pd-b" + (cls[k] >= 0 ? " l" + cls[k] : ""); s.textContent = byte2(bytes[k]); spans[k] = s; pre.append(s, k === o + 15 || k === shown - 1 ? "" : " ");
        }
        pre.append("\n");
      }
      if (bytes.length > shown) pre.append("... " + (bytes.length - shown) + " more bytes not shown (all of them are decoded)");
      return { pre, spans };
    }
    function run() {
      const out = $("out"); out.textContent = ""; text = ""; $("copy").disabled = $("save").disabled = true; $("chain").textContent = "";
      const src = $("in").value;
      if (!src.trim()) { $("summary").textContent = ""; TK.notes($("notes"), []); return; }
      const h = PD.parseHex(src);
      if (h.error) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: h.error }]); return; }
      if (h.bytes.length > MAX_BYTES) { $("summary").textContent = ""; TK.notes($("notes"), [{ level: "bad", text: "That is " + h.bytes.length + " bytes; a packet is at most " + MAX_BYTES + ". Paste one packet." }]); return; }
      const d = PD.decode(h.bytes, { link: $("link").value });
      $("summary").textContent = d.summary || "";
      const notes = d.notes.slice();
      if (h.more) notes.unshift({ level: "info", text: "The paste holds more than one dump; only the first one is decoded." });
      TK.notes($("notes"), notes);
      $("chain").textContent = d.chain;
      const { pre, spans } = hexView(h.bytes, d); out.append(pre);
      let selRows = [], selBytes = [];
      const clearSel = () => { selRows.forEach(r => r.classList.remove("sel")); selBytes.forEach(s => s.classList.remove("sel")); selRows = []; selBytes = []; };
      d.layers.forEach((l, i) => {
        const fs = document.createElement("fieldset"), lg = document.createElement("legend"), tb = document.createElement("table"); fs.className = "pd-layer"; tb.className = "pd-table";
        const sw = document.createElement("span"); sw.className = "pd-sw" + (l.name === "trailer" ? "" : " l" + (i % 6)); lg.append(sw, document.createTextNode(l.title + "   (bytes " + l.start + "-" + (l.end - 1) + ")"));
        for (const f of l.fields) {
          const tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td"), tdb = document.createElement("td");
          th.textContent = f.name; td.textContent = f.value; td.className = "tk-mono";
          tdb.className = "pd-bytes"; tdb.textContent = f.len ? (f.len === 1 ? "byte " + f.start : "bytes " + f.start + "-" + (f.start + f.len - 1)) : "";
          tr.append(th, td, tdb);
          if (f.len) { tr.className = "pd-row"; tr.addEventListener("click", () => { clearSel(); tr.classList.add("sel"); selRows = [tr]; for (let k = f.start; k < f.start + f.len && k < spans.length; k++) if (spans[k]) { spans[k].classList.add("sel"); selBytes.push(spans[k]); } }); }
          tb.append(tr);
        }
        fs.append(lg, tb); out.append(fs);
      });
      text = textOf(d, h.bytes); $("copy").disabled = $("save").disabled = false;
      setStatus((h.format ? "Read as " + h.format + ": " : "") + h.bytes.length + " bytes.");
    }
    const again = TK.debounce(run, 200);
    $("in").addEventListener("input", again); $("link").addEventListener("change", run);
    $("example").addEventListener("change", () => { const v = $("example").value; if (!v) return; $("in").value = EXAMPLES[v]; $("link").value = "auto"; run(); });
    $("clear").addEventListener("click", () => { $("in").value = ""; $("example").value = ""; run(); $("in").focus(); });
    $("copy").addEventListener("click", () => TK.copy(text, setStatus));
    $("save").addEventListener("click", () => TK.save("packet-decoded.txt", text));
    run();
    return { destroy() {} };
  }
  return { init };
})();
