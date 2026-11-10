/* MAC addresses: reading the usual writings, the flags in the first byte, the other ways to write it, and the manufacturer from the
   IEEE lists (vendor/oui.json: name index "n" and the MA-L "l", MA-M "m" and MA-S "s" blocks). Pure; exports window.MacLib. */
(() => {
  "use strict";
  // text -> { hex: "AABBCCDDEEFF" } for a whole MAC, { hex: "AABBCC", partial: true } for a bare manufacturer prefix (3 to 5 bytes), or null
  function parse(text) {
    const s = String(text == null ? "" : text).trim();
    if (!s) return null;
    let h = null;
    if (/^([0-9A-Fa-f]{1,2}[:-]){2,5}[0-9A-Fa-f]{1,2}$/.test(s)) h = s.split(/[:-]/).map(x => x.padStart(2, "0")).join("");
    else if (/^([0-9A-Fa-f]{4}\.){1,2}[0-9A-Fa-f]{4}$/.test(s)) h = s.replace(/\./g, "");
    else if (/^[0-9A-Fa-f]{6,12}$/.test(s) && s.length % 2 === 0) h = s;
    if (!h) return null;
    h = h.toUpperCase();
    if (h.length === 12) return { hex: h, partial: false };
    if (h.length >= 6 && h.length < 12 && h.length % 2 === 0 && h.length <= 10) return { hex: h, partial: true };
    return null;
  }
  const pairs = h => h.match(/.{2}/g);
  const formats = hex => {
    const p = pairs(hex), up = hex.toUpperCase(), lo = hex.toLowerCase();
    return [
      ["Colons (Linux, macOS)", p.join(":").toLowerCase()], ["Colons, capitals", p.join(":")], ["Hyphens (Windows)", p.join("-")],
      ["Dots (Cisco)", lo.match(/.{4}/g).join(".")], ["No separator", up],
      ["EUI-64 (inserts FF:FE)", [...p.slice(0, 3), "FF", "FE", ...p.slice(3)].join(":").toLowerCase()],
    ];
  };
  function linkLocal(hex) {   // the IPv6 link-local address a device builds from this MAC (modified EUI-64)
    const b = pairs(hex).map(x => parseInt(x, 16)); b[0] ^= 2;
    const g = [b[0] << 8 | b[1], b[2] << 8 | 0xff, 0xfe00 | b[3], b[4] << 8 | b[5]];
    return "fe80::" + g.map(x => x.toString(16)).join(":");
  }
  const SPECIAL = [
    ["FFFFFFFFFFFF", 12, "Broadcast: every device on the local network"],
    ["01005E", 6, "IPv4 multicast (the rest of the address is built from the group address)"],
    ["3333", 4, "IPv6 multicast (the rest is built from the group address)"],
    ["0180C2", 6, "Reserved bridge protocols (spanning tree, LLDP, link aggregation)"],
    ["01000C", 6, "Cisco protocols (CDP, VTP)"],
    ["CF0000", 6, "Ethernet loopback test frames"],
  ];
  function flags(hex) {
    const b0 = parseInt(hex.slice(0, 2), 16), out = { multicast: !!(b0 & 1), local: !!(b0 & 2), special: "" };
    for (const [pre, len, label] of SPECIAL) if (hex.length >= len && hex.startsWith(pre)) out.special = label;
    return out;
  }
  // the manufacturer: the most specific block wins (MA-S 36 bit, then MA-M 28 bit, then MA-L 24 bit). Returns { name, block } or null.
  function vendor(db, hex) {
    if (!db) return null;
    hex = hex.toUpperCase();
    const tries = [["s", 9, "MA-S (36-bit block)"], ["m", 7, "MA-M (28-bit block)"], ["l", 6, "MA-L (24-bit block)"]];
    for (const [k, len, label] of tries) {
      if (hex.length < len) continue;
      const i = db[k] && db[k][hex.slice(0, len)];
      if (i !== undefined) return { name: db.n[i], block: label, code: hex.slice(0, len) };
    }
    return null;
  }
  // everything for one line of input
  function describe(db, text) {
    const r = parse(text);
    if (!r) return { input: String(text).trim(), error: "Not a MAC address. Use six bytes like 00:1A:2B:3C:4D:5E, 00-1A-2B-3C-4D-5E, 001A.2B3C.4D5E or 001A2B3C4D5E (or just the first 3 bytes to look up a maker)." };
    const f = flags(r.hex), v = vendor(db, r.hex), rows = [];
    const shown = pairs(r.hex).join(":") + (r.partial ? ":..." : "");
    rows.push(["Address", shown]);
    const note = [];
    if (v) rows.push(["Manufacturer", v.name, "Registered in the IEEE " + v.block + " block " + v.code + "."]);
    else if (f.local && !f.multicast) rows.push(["Manufacturer", "none (locally assigned address)", "The second bit of the first byte is set: this address was made up by software, not burned in by a maker."]);
    else if (f.special) rows.push(["Manufacturer", "none (" + f.special + ")", ""]);
    else rows.push(["Manufacturer", "not in the IEEE lists", "The block may be unassigned, or the list in this tool is out of date."]);
    if (f.special) rows.push(["Special address", f.special]);
    rows.push(["Kind", f.multicast ? "Group (multicast or broadcast)" : "Single device (unicast)"]);
    rows.push(["Administered", f.local ? "Locally (made up by software)" : "Universally (assigned by the maker)"]);
    if (f.local && !f.multicast) note.push("Locally administered: phones and laptops use random addresses like this on Wi-Fi for privacy, and virtual machines and containers use them too. A maker lookup cannot work.");
    if (r.partial) note.push("Only the first " + r.hex.length / 2 + " bytes were given, so only the manufacturer is shown.");
    if (!r.partial) {
      for (const [k, val] of formats(r.hex)) rows.push([k, val]);
      if (!f.multicast) rows.push(["IPv6 link-local address built from it", linkLocal(r.hex)]);
    }
    return { input: shown, rows, vendor: v ? v.name : "", local: f.local, notes: note };
  }
  const api = { parse, formats, linkLocal, flags, vendor, describe };
  if (typeof window !== "undefined") window.MacLib = api;
  if (typeof module !== "undefined") module.exports = api;
})();
