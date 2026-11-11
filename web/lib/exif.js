/* Photo metadata: reads the hidden data inside a JPEG, PNG or WebP (EXIF camera and GPS data, plus a list of the other kinds of data present),
   and writes a copy with chosen parts removed or changed WITHOUT re-compressing the picture (the picture bytes are copied unchanged).
   Pure code on bytes (Uint8Array). Exports window.Exif. Nothing here touches the page or the network. */
(() => {
  "use strict";
  const u16 = (b, o, le) => le ? b[o] | b[o + 1] << 8 : b[o] << 8 | b[o + 1];
  const u32 = (b, o, le) => (le ? (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) : (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3])) >>> 0;
  const ascii = (b, o, n) => { let s = ""; for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]); return s; };
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const TYPE_NAME = { 1: "BYTE", 2: "ASCII", 3: "SHORT", 4: "LONG", 5: "RATIONAL", 6: "SBYTE", 7: "UNDEFINED", 8: "SSHORT", 9: "SLONG", 10: "SRATIONAL", 11: "FLOAT", 12: "DOUBLE" };

  // name; "p" = personal or identifying (see PERSONAL below); text = may be edited as text
  const T = {
    ifd0: { 0x010E: "Picture description", 0x010F: "Camera make", 0x0110: "Camera model", 0x0112: "Orientation", 0x011A: "Horizontal resolution", 0x011B: "Vertical resolution", 0x0128: "Resolution unit", 0x0131: "Software", 0x0132: "Date and time", 0x013B: "Artist (photographer)", 0x8298: "Copyright", 0x0213: "YCbCr positioning", 0x9C9B: "Title (Windows)", 0x9C9C: "Comment (Windows)", 0x9C9D: "Author (Windows)", 0x9C9E: "Keywords (Windows)", 0x9C9F: "Subject (Windows)" },
    exif: { 0x829A: "Exposure time", 0x829D: "Aperture (f-number)", 0x8822: "Exposure program", 0x8827: "ISO speed", 0x9000: "Exif version", 0x9003: "Date taken", 0x9004: "Date digitised", 0x9010: "Time zone (taken)", 0x9201: "Shutter speed (APEX)", 0x9202: "Aperture (APEX)", 0x9203: "Brightness", 0x9204: "Exposure compensation", 0x9205: "Maximum aperture", 0x9207: "Metering mode", 0x9208: "Light source", 0x9209: "Flash", 0x920A: "Focal length", 0x927C: "Maker note (camera-specific data)", 0x9286: "User comment", 0x9290: "Sub-second time", 0xA000: "FlashPix version", 0xA001: "Colour space", 0xA002: "Width (pixels)", 0xA003: "Height (pixels)", 0xA20E: "Focal-plane X resolution", 0xA20F: "Focal-plane Y resolution", 0xA210: "Focal-plane resolution unit", 0xA217: "Sensing method", 0xA300: "File source", 0xA301: "Scene type", 0xA401: "Custom rendered", 0xA402: "Exposure mode", 0xA403: "White balance", 0xA404: "Digital zoom", 0xA405: "Focal length (35 mm equivalent)", 0xA406: "Scene capture type", 0xA407: "Gain control", 0xA408: "Contrast", 0xA409: "Saturation", 0xA40A: "Sharpness", 0xA40C: "Subject distance range", 0xA420: "Unique picture ID", 0xA430: "Camera owner name", 0xA431: "Camera serial number", 0xA432: "Lens specification", 0xA433: "Lens make", 0xA434: "Lens model", 0xA435: "Lens serial number", 0x9101: "Components configuration", 0x9102: "Compressed bits per pixel" },
    gps: { 0: "GPS version", 1: "Latitude reference", 2: "Latitude", 3: "Longitude reference", 4: "Longitude", 5: "Altitude reference", 6: "Altitude", 7: "GPS time (UTC)", 8: "Satellites", 9: "GPS status", 10: "Measure mode", 11: "Precision (DOP)", 12: "Speed unit", 13: "Speed", 14: "Direction reference", 15: "Direction of travel", 16: "Image direction reference", 17: "Image direction", 18: "Map datum", 19: "Destination latitude reference", 20: "Destination latitude", 21: "Destination longitude reference", 22: "Destination longitude", 23: "Destination bearing reference", 24: "Destination bearing", 25: "Destination distance reference", 26: "Destination distance", 27: "Processing method", 28: "Area name", 29: "GPS date", 30: "Differential correction", 31: "Horizontal position error" },
  };
  // tags that say something about the person, the place or the specific device (kind -> plain reason)
  const PERSONAL = {
    gps: ["place", "where the picture was taken"],
    ifd0: { 0x010E: ["person", "a description someone typed"], 0x013B: ["person", "the photographer's name"], 0x8298: ["person", "a copyright line, often a name"], 0x9C9B: ["person", "a title typed on a computer"], 0x9C9C: ["person", "a comment typed on a computer"], 0x9C9D: ["person", "an author name"], 0x9C9E: ["person", "keywords typed on a computer"], 0x9C9F: ["person", "a subject typed on a computer"], 0x0131: ["device", "the program or firmware version"], 0x0110: ["device", "the exact camera model"], 0x010F: ["device", "the camera brand"] },
    exif: { 0x9286: ["person", "a comment typed in"], 0xA420: ["device", "a unique picture ID"], 0xA430: ["person", "the camera owner's name"], 0xA431: ["device", "the camera's serial number"], 0xA435: ["device", "the lens serial number"], 0x927C: ["device", "private camera data (can hold serial numbers)"] },
  };
  const ENUM = {
    "ifd0:274": ["", "Normal", "Mirrored", "Upside down", "Mirrored and upside down", "Mirrored, turned left", "Turned right", "Mirrored, turned right", "Turned left"],
    "ifd0:296": ["", "", "inch", "centimetre"],
    "exif:34850": ["Not defined", "Manual", "Normal", "Aperture priority", "Shutter priority", "Creative", "Action", "Portrait", "Landscape"],
    "exif:37383": ["Unknown", "Average", "Centre-weighted", "Spot", "Multi-spot", "Pattern", "Partial"],
    "exif:40961": { 1: "sRGB", 65535: "Uncalibrated" },
    "exif:41986": ["Auto", "Manual"], "exif:41987": ["Auto", "Manual"],
    "exif:41990": ["Standard", "Landscape", "Portrait", "Night"],
  };
  // Windows XP-style tags hold UTF-16 text
  const UCS2 = new Set([0x9C9B, 0x9C9C, 0x9C9D, 0x9C9E, 0x9C9F]);

  // ---------- TIFF (the container EXIF uses) ----------
  function parseTiff(b, start, len) {
    const end = Math.min(b.length, start + len);
    if (end - start < 8) return null;
    const le = b[start] === 0x49 && b[start + 1] === 0x49;
    if (!le && !(b[start] === 0x4D && b[start + 1] === 0x4D)) return null;
    if (u16(b, start + 2, le) !== 42) return null;
    const out = { le, ifds: {}, problems: [] };
    const seen = new Set();
    function ifd(name, off, depth) {
      if (depth > 4 || off < 8 || start + off + 2 > end || seen.has(off)) return;
      seen.add(off);
      const n = u16(b, start + off, le);
      if (n > 600) { out.problems.push("A table in the metadata claims " + n + " entries; ignored."); return; }
      const entries = [];
      for (let i = 0; i < n; i++) {
        const p = start + off + 2 + i * 12;
        if (p + 12 > end) { out.problems.push("A metadata table is cut short."); break; }
        const tag = u16(b, p, le), type = u16(b, p + 2, le), count = u32(b, p + 4, le), size = (TYPE_SIZE[type] || 0) * count;
        if (!TYPE_SIZE[type]) continue;
        let vo = p + 8;
        if (size > 4) { vo = start + u32(b, p + 8, le); if (vo < start || vo + size > end || size > 1 << 24) { out.problems.push("Entry 0x" + tag.toString(16) + " points outside the data; skipped."); continue; } }
        entries.push({ tag, type, count, raw: b.slice(vo, vo + size) });
      }
      out.ifds[name] = entries;
      const sub = (tg, nm) => { const e = entries.find(x => x.tag === tg); if (e && e.raw.length >= 4) ifd(nm, u32(e.raw, 0, le), depth + 1); };
      if (name === "ifd0") { sub(0x8769, "exif"); sub(0x8825, "gps"); }
      if (name === "exif") sub(0xA005, "interop");
      if (name === "ifd0") { const nx = start + off + 2 + n * 12; if (nx + 4 <= end) { const o1 = u32(b, nx, le); if (o1) ifd("ifd1", o1, depth + 1); } }
    }
    ifd("ifd0", u32(b, start + 4, le), 0);
    return out;
  }
  // decode an entry's value to an array of numbers / a string
  function decode(e, le) {
    const r = e.raw, t = e.type, out = [];
    if (t === 2) { let s = ascii(r, 0, r.length); const z = s.indexOf("\0"); if (z >= 0) s = s.slice(0, z); return s; }
    for (let i = 0; i < e.count && i < 64; i++) {
      const o = i * TYPE_SIZE[t];
      if (t === 1 || t === 7) out.push(r[o]);
      else if (t === 6) out.push(r[o] << 24 >> 24);
      else if (t === 3) out.push(u16(r, o, le));
      else if (t === 8) out.push(u16(r, o, le) << 16 >> 16);
      else if (t === 4) out.push(u32(r, o, le));
      else if (t === 9) out.push(u32(r, o, le) | 0);
      else if (t === 5) out.push({ n: u32(r, o, le), d: u32(r, o + 4, le) });
      else if (t === 10) { const d = u32(r, o + 4, le) | 0; out.push({ n: u32(r, o, le) | 0, d }); }
      else if (t === 11) { out.push(new DataView(r.buffer, r.byteOffset + o, 4).getFloat32(0, le)); }
      else if (t === 12) { out.push(new DataView(r.buffer, r.byteOffset + o, 8).getFloat64(0, le)); }
    }
    return out;
  }
  const num = x => typeof x === "object" ? (x.d ? x.n / x.d : NaN) : x;
  const fmtNum = (x, d = 4) => { if (!isFinite(x)) return "?"; const s = x.toFixed(d); return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s; };
  function fmtValue(ifdName, e, le) {
    const v = decode(e, le), key = ifdName + ":" + e.tag;
    if (e.type === 2) return v;
    if (UCS2.has(e.tag) && e.type === 1) { let s = ""; for (let i = 0; i + 1 < e.raw.length; i += 2) { const c = e.raw[i] | e.raw[i + 1] << 8; if (!c) break; s += String.fromCharCode(c); } return s; }
    if (e.tag === 0x9286 && e.type === 7) { const pre = ascii(e.raw, 0, 8).replace(/\0/g, ""), body = e.raw.slice(8); let s = ""; if (pre === "UNICODE") { for (let i = 0; i + 1 < body.length; i += 2) { const c = le ? body[i] | body[i + 1] << 8 : body[i] << 8 | body[i + 1]; if (c) s += String.fromCharCode(c); } } else s = ascii(body, 0, body.length).replace(/\0+$/, ""); return s.trim(); }
    if (e.type === 7 && (e.tag === 0x9000 || e.tag === 0xA000 || e.tag === 0x8000)) return ascii(e.raw, 0, e.raw.length).replace(/\0/g, "");
    if (e.tag === 0x927C) return e.raw.length + " bytes of camera-specific data";
    if (e.type === 7) return e.raw.length > 24 ? e.raw.length + " bytes" : Array.from(e.raw).map(x => x.toString(16).padStart(2, "0")).join(" ");
    if (ENUM[key] && v.length === 1) { const t = ENUM[key][v[0]]; if (t) return t + " (" + v[0] + ")"; }
    if (key === "exif:37385") return (v[0] & 1 ? "Flash fired" : "Flash did not fire") + " (" + v[0] + ")";
    if (key === "exif:33434" && v.length === 1) { const x = num(v[0]); return x >= 1 || !x ? fmtNum(x) + " s" : "1/" + Math.round(1 / x) + " s"; }
    if (key === "exif:33437") return "f/" + fmtNum(num(v[0]), 1);
    if (key === "exif:37386" || key === "exif:41989") return fmtNum(num(v[0]), 1) + " mm";
    if (ifdName === "gps" && (e.tag === 2 || e.tag === 4 || e.tag === 20 || e.tag === 22) && v.length === 3) return fmtNum(num(v[0]), 0) + "° " + fmtNum(num(v[1]), 0) + "′ " + fmtNum(num(v[2]), 3) + "″";
    if (ifdName === "gps" && e.tag === 6) return fmtNum(num(v[0]), 1) + " m";
    if (ifdName === "gps" && e.tag === 7 && v.length === 3) return v.map(x => String(Math.round(num(x))).padStart(2, "0")).join(":");
    if (v.length === 1) return typeof v[0] === "object" ? (v[0].d ? fmtNum(num(v[0])) + (v[0].d !== 1 && v[0].d <= 100000 ? " (" + v[0].n + "/" + v[0].d + ")" : "") : "undefined") : String(v[0]);
    return v.map(x => typeof x === "object" ? fmtNum(num(x)) : x).join(", ") + (e.count > 64 ? " ..." : "");
  }

  // ---------- containers ----------
  function detect(b) {
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8) return "jpeg";
    if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
    if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
    if (b.length > 12 && ascii(b, 4, 4) === "ftyp") return "heic";
    if (b.length > 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4D && b[1] === 0x4D && b[3] === 42))) return "tiff";
    return null;
  }
  // JPEG: list segments up to the picture data
  function jpegSegments(b) {
    const segs = []; let p = 2, size = null;
    while (p + 4 <= b.length) {
      if (b[p] !== 0xFF) break;
      let m = b[p + 1];
      if (m === 0xFF) { p++; continue; }
      if (m === 0xDA || m === 0xD9) { segs.push({ m, start: p, end: b.length, scan: true }); break; }
      if ((m >= 0xD0 && m <= 0xD7) || m === 0x01) { p += 2; continue; }
      const L = u16(b, p + 2, false); if (L < 2 || p + 2 + L > b.length) { segs.push({ m, start: p, end: b.length, broken: true }); break; }
      const s = { m, start: p, end: p + 2 + L, data: p + 4 };
      if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC && L >= 8) size = { h: u16(b, p + 5, false), w: u16(b, p + 7, false) };
      segs.push(s); p = s.end;
    }
    return { segs, size };
  }
  function pngChunks(b) {
    const ch = []; let p = 8;
    while (p + 12 <= b.length) { const L = u32(b, p, false), name = ascii(b, p + 4, 4); if (p + 12 + L > b.length) break; ch.push({ name, start: p, end: p + 12 + L, data: p + 8, len: L }); p += 12 + L; if (name === "IEND") break; }
    return ch;
  }
  function webpChunks(b) {
    const ch = []; let p = 12;
    while (p + 8 <= b.length) { const L = u32(b, p + 4, true), name = ascii(b, p, 4); const e = Math.min(b.length, p + 8 + L + (L & 1)); ch.push({ name, start: p, end: e, data: p + 8, len: L }); p = e; }
    return ch;
  }

  // ---------- read ----------
  const GROUPS = { ifd0: "Camera and picture", exif: "Exposure and settings", gps: "Location (GPS)", ifd1: "Embedded thumbnail", interop: "Interoperability" };
  function gpsDecimal(entries, le) {
    const get = t => entries.find(e => e.tag === t);
    const la = get(2), lo = get(4), lr = get(1), or = get(3);
    if (!la || !lo || la.count !== 3 || lo.count !== 3) return null;
    const dms = e => { const v = decode(e, le).map(num); return v[0] + v[1] / 60 + v[2] / 3600; };
    let lat = dms(la), lon = dms(lo);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (lr && decode(lr, le)[0] === "S") lat = -lat;
    if (or && decode(or, le)[0] === "W") lon = -lon;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const al = get(6); let alt = null; if (al) { alt = num(decode(al, le)[0]); const ar = get(5); if (ar && ar.raw[0] === 1) alt = -alt; }
    return { lat, lon, alt: isFinite(alt) ? alt : null };
  }
  function exifBlock(b, fmt) {
    if (fmt === "jpeg") {
      const { segs, size } = jpegSegments(b);
      for (const s of segs) if (s.m === 0xE1 && ascii(b, s.data, 6) === "Exif\0\0") return { start: s.data + 6, len: s.end - s.data - 6, size };
      return { size };
    }
    if (fmt === "png") { for (const c of pngChunks(b)) if (c.name === "eXIf") return { start: c.data, len: c.len }; return {}; }
    if (fmt === "webp") { for (const c of webpChunks(b)) if (c.name === "EXIF") { let s = c.data, l = c.len; if (ascii(b, s, 6) === "Exif\0\0") { s += 6; l -= 6; } return { start: s, len: l }; } return {}; }
    return {};
  }
  function otherData(b, fmt) {
    const o = [];
    if (fmt === "jpeg") {
      for (const s of jpegSegments(b).segs) {
        if (s.scan || s.broken) continue;
        const n = s.end - s.start;
        if (s.m === 0xE1 && ascii(b, s.data, 6) === "Exif\0\0") continue;
        if (s.m === 0xE1 && ascii(b, s.data, 28).startsWith("http://ns.adobe.com/xap/1.0/")) o.push({ id: "xmp", name: "XMP data (editing history, ratings, sometimes names and places)", size: n, personal: true });
        else if (s.m === 0xE1 && ascii(b, s.data, 29).startsWith("http://ns.adobe.com/xmp/extens")) o.push({ id: "xmp", name: "More XMP data", size: n, personal: true });
        else if (s.m === 0xE2 && ascii(b, s.data, 11) === "ICC_PROFILE") o.push({ id: "icc", name: "Colour profile (needed for correct colours)", size: n, keep: true });
        else if (s.m === 0xED) o.push({ id: "iptc", name: "Photoshop / IPTC data (captions, credits, keywords)", size: n, personal: true });
        else if (s.m === 0xFE) o.push({ id: "comment", name: "Comment: " + JSON.stringify(ascii(b, s.data, Math.min(60, n - 4))).slice(0, 70), size: n, personal: true });
        else if (s.m === 0xE0 && ascii(b, s.data, 4) === "JFIF") o.push({ id: "jfif", name: "JFIF header (basic picture header)", size: n, keep: true });
        else if (s.m === 0xEE) o.push({ id: "adobe", name: "Adobe colour header", size: n, keep: true });
        else if (s.m >= 0xE0 && s.m <= 0xEF) o.push({ id: "app" + (s.m & 15), name: "Application data (APP" + (s.m & 15) + ", " + ascii(b, s.data, 12).replace(/[^\x20-\x7e]/g, "").slice(0, 12) + ")", size: n, personal: true });
      }
    } else if (fmt === "png") {
      for (const c of pngChunks(b)) {
        if (c.name === "tEXt" || c.name === "zTXt" || c.name === "iTXt") { let k = ascii(b, c.data, Math.min(c.len, 80)); k = k.slice(0, k.indexOf("\0") < 0 ? 40 : k.indexOf("\0")); o.push({ id: "text", name: (k === "XML:com.adobe.xmp" ? "XMP data" : "Text note \"" + k + "\""), size: c.end - c.start, personal: true }); }
        else if (c.name === "tIME") o.push({ id: "time", name: "Last-modified time", size: c.end - c.start, personal: true });
        else if (c.name === "iCCP") o.push({ id: "icc", name: "Colour profile (needed for correct colours)", size: c.end - c.start, keep: true });
      }
    } else if (fmt === "webp") {
      for (const c of webpChunks(b)) { if (c.name === "XMP ") o.push({ id: "xmp", name: "XMP data", size: c.end - c.start, personal: true }); else if (c.name === "ICCP") o.push({ id: "icc", name: "Colour profile (needed for correct colours)", size: c.end - c.start, keep: true }); }
    }
    return o;
  }
  function dimensions(b, fmt, tiff) {
    if (fmt === "jpeg") { const s = jpegSegments(b).size; return s ? { w: s.w, h: s.h } : null; }
    if (fmt === "png" && b.length >= 24) return { w: u32(b, 16, false), h: u32(b, 20, false) };
    if (fmt === "webp") {
      for (const c of webpChunks(b)) {
        if (c.name === "VP8X" && c.len >= 10) return { w: 1 + (b[c.data + 4] | b[c.data + 5] << 8 | b[c.data + 6] << 16), h: 1 + (b[c.data + 7] | b[c.data + 8] << 8 | b[c.data + 9] << 16) };
        if (c.name === "VP8L" && c.len >= 5) { const v = u32(b, c.data + 1, true); return { w: 1 + (v & 0x3FFF), h: 1 + ((v >> 14) & 0x3FFF) }; }
        if (c.name === "VP8 " && c.len >= 10) return { w: u16(b, c.data + 6, true) & 0x3FFF, h: u16(b, c.data + 8, true) & 0x3FFF };
      }
    }
    return null;
  }

  function read(bytes) {
    const fmt = detect(bytes);
    const res = { format: fmt, size: bytes.length, groups: [], other: [], problems: [], gps: null, le: true, dims: null, hasExif: false };
    if (!fmt) { res.problems.push("This is not a JPEG, PNG or WebP picture."); return res; }
    if (fmt === "heic") { res.problems.push("HEIC/HEIF pictures (iPhone originals) are not supported yet. Share or export the picture as JPEG first."); return res; }
    if (fmt === "tiff") { res.problems.push("TIFF files are not supported yet."); return res; }
    const blk = exifBlock(bytes, fmt);
    res.other = otherData(bytes, fmt);
    res.dims = dimensions(bytes, fmt) || (blk.size ? { w: blk.size.w, h: blk.size.h } : null);
    if (blk.start === undefined) return res;
    const tiff = parseTiff(bytes, blk.start, blk.len);
    if (!tiff) { res.problems.push("The EXIF block in this picture is damaged and could not be read."); res.hasExif = true; return res; }
    res.hasExif = true; res.le = tiff.le; res.problems.push(...tiff.problems);
    for (const name of ["ifd0", "exif", "gps", "ifd1", "interop"]) {
      const list = tiff.ifds[name]; if (!list) continue;
      const g = { id: name, title: GROUPS[name], entries: [] };
      for (const e of list.slice().sort((x, y) => x.tag - y.tag)) {
        if ((name === "ifd0" && (e.tag === 0x8769 || e.tag === 0x8825)) || (name === "exif" && e.tag === 0xA005)) continue;
        if (name === "ifd1") { if (e.tag === 0x0201 || e.tag === 0x0202) continue; }
        const label = (T[name] && T[name][e.tag]) || "Tag 0x" + e.tag.toString(16).toUpperCase().padStart(4, "0");
        let p = null;
        if (name === "gps") p = PERSONAL.gps; else if (PERSONAL[name] && PERSONAL[name][e.tag]) p = PERSONAL[name][e.tag];
        const known = !!(T[name] && T[name][e.tag]);
        g.entries.push({ ifd: name, tag: e.tag, label, known, type: e.type, typeName: TYPE_NAME[e.type], count: e.count, raw: e.raw, value: fmtValue(name, e, tiff.le), text: e.type === 2, personal: p ? { kind: p[0], why: p[1] } : null });
      }
      if (name === "ifd1") g.entries.push({ ifd: "ifd1", tag: 0, label: "A small preview picture is stored inside the metadata", known: true, type: 0, typeName: "", count: 0, raw: new Uint8Array(0), value: "it can show the ORIGINAL, uncropped picture", text: false, personal: { kind: "place", why: "a thumbnail often keeps the original even if the main picture was cropped" }, thumbnail: true });
      if (g.entries.length) res.groups.push(g);
    }
    if (tiff.ifds.gps) res.gps = gpsDecimal(tiff.ifds.gps, tiff.le);
    const o = tiff.ifds.ifd0 && tiff.ifds.ifd0.find(e => e.tag === 0x0112);
    res.orientation = o ? decode(o, tiff.le)[0] : 1;
    return res;
  }

  // ---------- write ----------
  // Build a new EXIF block (TIFF) from entries {ifd, tag, type, count, raw} in the byte order `le`. MakerNote, interoperability and the thumbnail are never written.
  function buildTiff(entries, le) {
    const w16 = (a, v) => { if (le) a.push(v & 255, v >> 8 & 255); else a.push(v >> 8 & 255, v & 255); };
    const w32 = (a, v) => { if (le) a.push(v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255); else a.push(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255); };
    const by = n => entries.filter(e => e.ifd === n && e.tag !== 0x927C).sort((a, b) => a.tag - b.tag);
    const sets = { ifd0: by("ifd0"), exif: by("exif"), gps: by("gps") };
    if (sets.exif.length) sets.ifd0.push({ tag: 0x8769, type: 4, count: 1, ptr: "exif" });
    if (sets.gps.length) sets.ifd0.push({ tag: 0x8825, type: 4, count: 1, ptr: "gps" });
    sets.ifd0.sort((a, b) => a.tag - b.tag);
    const out = [le ? 0x49 : 0x4D, le ? 0x49 : 0x4D]; w16(out, 42); w32(out, 8);
    const order = ["ifd0"].concat(sets.exif.length ? ["exif"] : [], sets.gps.length ? ["gps"] : []);
    // first compute where each IFD starts
    const sizeOf = n => { let s = 2 + sets[n].length * 12 + 4; for (const e of sets[n]) { const L = e.ptr ? 4 : e.raw.length; if (L > 4) s += L + (L & 1); } return s; };
    const at = {}; let pos = 8; for (const n of order) { at[n] = pos; pos += sizeOf(n); }
    for (const n of order) {
      const list = sets[n]; let dataAt = at[n] + 2 + list.length * 12 + 4; const hdr = [], data = [];
      w16(hdr, list.length);
      for (const e of list) {
        w16(hdr, e.tag); w16(hdr, e.type); w32(hdr, e.count);
        if (e.ptr) { w32(hdr, at[e.ptr]); continue; }
        if (e.raw.length <= 4) { for (let i = 0; i < 4; i++) hdr.push(e.raw[i] || 0); }
        else { w32(hdr, dataAt); for (const x of e.raw) data.push(x); if (e.raw.length & 1) data.push(0); dataAt += e.raw.length + (e.raw.length & 1); }
      }
      w32(hdr, 0);
      for (const x of hdr) out.push(x); for (const x of data) out.push(x);
    }
    return Uint8Array.from(out);
  }
  // EXIF text is plain 7-bit ASCII: accents are dropped (é -> e) and anything else becomes "?"
  const toAscii = t => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const asciiEntry = (ifd, tag, text) => { const t = toAscii(text), raw = new Uint8Array(t.length + 1); for (let i = 0; i < t.length; i++) raw[i] = t.charCodeAt(i); return { ifd, tag, type: 2, count: raw.length, raw }; };
  const ratBytes = (pairs, le) => { const o = new Uint8Array(pairs.length * 8), dv = new DataView(o.buffer); pairs.forEach(([n, d], i) => { dv.setUint32(i * 8, n, le); dv.setUint32(i * 8 + 4, d, le); }); return o; };
  // GPS entries for a decimal position; returns { error } for impossible numbers
  function gpsEntries(lat, lon, le) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: "Latitude must be between -90 and 90 and longitude between -180 and 180." };
    const dms = v => { v = Math.abs(v); let d = Math.floor(v), m = Math.floor((v - d) * 60), sc = Math.round(((v - d) * 60 - m) * 60 * 10000); if (sc >= 600000) { sc -= 600000; m++; } if (m >= 60) { m -= 60; d++; } return [[d, 1], [m, 1], [sc, 10000]]; };
    return { entries: [
      { ifd: "gps", tag: 0, type: 1, count: 4, raw: Uint8Array.of(2, 3, 0, 0) },
      asciiEntry("gps", 1, lat < 0 ? "S" : "N"), { ifd: "gps", tag: 2, type: 5, count: 3, raw: ratBytes(dms(lat), le) },
      asciiEntry("gps", 3, lon < 0 ? "W" : "E"), { ifd: "gps", tag: 4, type: 5, count: 3, raw: ratBytes(dms(lon), le) },
    ] };
  }
  // "2024:05:06 07:08:09" shifted by a number of minutes (null when the text is not a date)
  function shiftDate(text, minutes) {
    const m = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(String(text).trim()); if (!m) return null;
    const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + minutes * 60000); if (isNaN(t)) return null;
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return p(t.getUTCFullYear(), 4) + ":" + p(t.getUTCMonth() + 1) + ":" + p(t.getUTCDate()) + " " + p(t.getUTCHours()) + ":" + p(t.getUTCMinutes()) + ":" + p(t.getUTCSeconds());
  }
  function shortEntry(ifd, tag, v, le) { const raw = new Uint8Array(2); if (le) { raw[0] = v & 255; raw[1] = v >> 8; } else { raw[1] = v & 255; raw[0] = v >> 8; } return { ifd, tag, type: 3, count: 1, raw }; }

  function cat(parts) { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let q = 0; for (const p of parts) { o.set(p, q); q += p.length; } return o; }
  const be32 = v => Uint8Array.of(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
  const le32 = v => Uint8Array.of(v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255);

  /* rewrite(bytes, plan): returns a new Uint8Array.
     plan = { exif: [entries to write, may be empty], le, drop: Set of other-data ids to remove ("xmp","iptc","comment","text","time","app7"...), keepIcc }
     "other" data with keep:true (colour profile, JFIF, Adobe header) is kept unless listed in drop. */
  function rewrite(bytes, plan) {
    const fmt = detect(bytes), drop = plan.drop || new Set();
    const exifBytes = plan.exif && plan.exif.length ? buildTiff(plan.exif, plan.le) : null;
    if (fmt === "jpeg") {
      const { segs } = jpegSegments(bytes), parts = [bytes.slice(0, 2)]; let wrote = false;
      const mk = () => { const body = cat([new TextEncoder().encode("Exif\0\0"), exifBytes]); const L = body.length + 2; if (L > 65535) throw new Error("The new metadata is too large for a JPEG."); return cat([Uint8Array.of(0xFF, 0xE1, L >> 8, L & 255), body]); };
      let scanAt = bytes.length;
      for (const s of segs) {
        if (s.scan) { scanAt = s.start; break; }
        if (s.broken) { scanAt = s.start; break; }
        const isExif = s.m === 0xE1 && ascii(bytes, s.data, 6) === "Exif\0\0";
        let id = null;
        if (isExif) id = "exif";
        else if (s.m === 0xE1) id = "xmp";
        else if (s.m === 0xE2 && ascii(bytes, s.data, 11) === "ICC_PROFILE") id = "icc";
        else if (s.m === 0xED) id = "iptc";
        else if (s.m === 0xFE) id = "comment";
        else if (s.m === 0xE0 && ascii(bytes, s.data, 4) === "JFIF") id = "jfif";
        else if (s.m === 0xEE) id = "adobe";
        else if (s.m >= 0xE0 && s.m <= 0xEF) id = "app" + (s.m & 15);
        if (id === "exif") continue;
        if (id && drop.has(id)) continue;
        parts.push(bytes.slice(s.start, s.end));
        if (id === "jfif") { if (exifBytes && !wrote) { parts.push(mk()); wrote = true; } }
      }
      if (exifBytes && !wrote) { parts.splice(1, 0, mk()); }
      parts.push(bytes.slice(scanAt));
      return cat(parts);
    }
    if (fmt === "png") {
      const ch = pngChunks(bytes), parts = [bytes.slice(0, 8)]; let wrote = false;
      const crcTab = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTab[n] = c >>> 0; }
      const crc = a => { let c = 0xFFFFFFFF; for (const x of a) c = crcTab[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
      const mkChunk = () => { const type = new TextEncoder().encode("eXIf"), body = cat([type, exifBytes]); return cat([be32(exifBytes.length), body, be32(crc(body))]); };
      for (const c of ch) {
        if (c.name === "eXIf") continue;
        if ((c.name === "tEXt" || c.name === "zTXt" || c.name === "iTXt") && drop.has("text")) continue;
        if (c.name === "tIME" && drop.has("time")) continue;
        if (c.name === "iCCP" && drop.has("icc")) continue;
        if (c.name === "IDAT" && exifBytes && !wrote) { parts.push(mkChunk()); wrote = true; }
        parts.push(bytes.slice(c.start, c.end));
      }
      return cat(parts);
    }
    if (fmt === "webp") {
      const ch = webpChunks(bytes), parts = []; let hasX = false, wrote = false;
      const mkChunk = (name, body) => cat([new TextEncoder().encode(name), le32(body.length), body, body.length & 1 ? Uint8Array.of(0) : new Uint8Array(0)]);
      for (const c of ch) if (c.name === "VP8X") hasX = true;
      if (!hasX && exifBytes) { // a plain WebP cannot carry EXIF: give it the extended header first
        const d = dimensions(bytes, "webp"); if (!d) throw new Error("Could not read this WebP's size.");
        const x = new Uint8Array(10); x[0] = ch.some(c => c.name === "ALPH") ? 0x10 : 0; const w1 = d.w - 1, h1 = d.h - 1;
        x[4] = w1 & 255; x[5] = w1 >> 8 & 255; x[6] = w1 >> 16 & 255; x[7] = h1 & 255; x[8] = h1 >> 8 & 255; x[9] = h1 >> 16 & 255;
        parts.push(mkChunk("VP8X", x));
      }
      for (const c of ch) {
        if (c.name === "EXIF") continue;
        if (c.name === "XMP " && drop.has("xmp")) continue;
        if (c.name === "ICCP" && drop.has("icc")) continue;
        let chunk = bytes.slice(c.start, c.end);
        if (c.name === "VP8X") {
          chunk = chunk.slice();
          const f = chunk[8]; let nf = f;
          if (drop.has("xmp")) nf &= ~0x04; if (drop.has("icc")) nf &= ~0x20;
          nf = exifBytes ? nf | 0x08 : nf & ~0x08;
          chunk[8] = nf;
          parts.push(chunk); continue;
        }
        if (exifBytes && !wrote && (c.name === "ALPH" || c.name === "VP8 " || c.name === "VP8L" || c.name === "ANIM" || c.name === "ANMF")) { /* EXIF goes after the picture data: placed below */ }
        parts.push(chunk);
      }
      if (exifBytes) parts.push(mkChunk("EXIF", exifBytes));
      const body = cat(parts);
      return cat([new TextEncoder().encode("RIFF"), le32(body.length + 4), new TextEncoder().encode("WEBP"), body]);
    }
    throw new Error("Unsupported picture type.");
  }

  /* plan from the read result: `keep(entry) -> bool`, `texts` {"ifd:tag": new text}, plus options.
     keepOrientation: write a minimal EXIF with only the rotation when everything else is removed. */
  function makePlan(info, opts) {
    const keep = opts.keep || (() => true), texts = opts.texts || {}, entries = [];
    for (const g of info.groups) for (const e of g.entries) {
      if (e.thumbnail || g.id === "ifd1" || g.id === "interop") continue;
      if (e.tag === 0x927C && g.id === "exif" && !opts.keepMakerNote) continue;
      const k = g.id + ":" + e.tag;
      if (e.tag === 0x0112 && g.id === "ifd0" && opts.keepOrientation && info.orientation > 1) { entries.push({ ifd: "ifd0", tag: 0x0112, type: e.type, count: e.count, raw: e.raw }); continue; }
      if (!keep(e)) continue;
      if (e.text && Object.prototype.hasOwnProperty.call(texts, k)) { if (texts[k] === "") continue; entries.push(asciiEntry(g.id, e.tag, texts[k])); continue; }
      entries.push({ ifd: g.id, tag: e.tag, type: e.type, count: e.count, raw: e.raw });
    }
    const gone = new Set(opts.dropIfd || []);
    let list = entries.filter(e => !gone.has(e.ifd));
    for (const st of opts.set || []) { list = list.filter(e => !(e.ifd === st.ifd && e.tag === st.tag)); if (st.entry) list.push(st.entry); }
    const drop = new Set(opts.drop || []);
    return { exif: list, le: info.le, drop };
  }

  // the bytes that make up the picture itself (JPEG scan data, PNG IDAT chunks, WebP image chunks): the self-check compares these before and after
  function pictureBytes(bytes) {
    const fmt = detect(bytes);
    if (fmt === "jpeg") { const sg = jpegSegments(bytes).segs, s = sg.find(x => x.scan || x.broken); return s ? bytes.slice(s.start) : new Uint8Array(0); }
    if (fmt === "png") return cat(pngChunks(bytes).filter(c => c.name === "IDAT" || c.name === "IHDR" || c.name === "PLTE" || c.name === "tRNS").map(c => bytes.slice(c.start, c.end)));
    if (fmt === "webp") return cat(webpChunks(bytes).filter(c => c.name === "VP8 " || c.name === "VP8L" || c.name === "ALPH" || c.name === "ANMF").map(c => bytes.slice(c.start, c.end)));
    return new Uint8Array(0);
  }

  const api = { asciiEntry, toAscii, gpsEntries, shiftDate, pictureBytes, read, rewrite, makePlan, detect, buildTiff, decode, parseTiff, fmtValue, PERSONAL, GROUPS };
  if (typeof window !== "undefined") window.Exif = api;
  if (typeof module !== "undefined") module.exports = api;
})();
