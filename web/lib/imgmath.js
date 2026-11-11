/* Picture geometry for Resize / Crop: crop boxes (with an optional fixed shape), output sizes and limits. Pure arithmetic. Exports window.ImgMath. */
(() => {
  "use strict";
  const MAX_SIDE = 16384, MAX_PIXELS = 64e6;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // "4:3" -> 1.333, "free" -> null, "orig" -> w/h of the picture
  function ratio(kind, w, h) {
    if (kind === "free" || !kind) return null;
    if (kind === "orig") return w / h;
    const m = /^(\d+):(\d+)$/.exec(kind); return m ? +m[1] / +m[2] : null;
  }
  // keep a rectangle inside 0..W x 0..H with whole-pixel values and at least 1 x 1
  function fit(r, W, H) {
    let w = clamp(Math.round(r.w), 1, W), h = clamp(Math.round(r.h), 1, H);
    return { x: clamp(Math.round(r.x), 0, W - w), y: clamp(Math.round(r.y), 0, H - h), w, h };
  }
  // The box made by dragging from a fixed corner (ax, ay) to the pointer (px, py). With a ratio the box keeps that shape and is
  // shortened until it fits inside the picture.
  function drag(ax, ay, px, py, r, W, H) {
    px = clamp(px, 0, W); py = clamp(py, 0, H);
    let dx = px - ax, dy = py - ay; const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    let w = Math.abs(dx), h = Math.abs(dy);
    if (r) {
      if (h === 0 || w / h > r) w = h * r; else h = w / r;           // the smaller of the two
      const roomW = sx > 0 ? W - ax : ax, roomH = sy > 0 ? H - ay : ay;
      if (w > roomW) { w = roomW; h = w / r; }
      if (h > roomH) { h = roomH; w = h * r; }
    }
    const x = sx > 0 ? ax : ax - w, y = sy > 0 ? ay : ay - h;
    return fit({ x, y, w: Math.max(1, w), h: Math.max(1, h) }, W, H);
  }
  // largest centred box of the given shape inside the picture
  function biggest(r, W, H) {
    if (!r) return { x: 0, y: 0, w: W, h: H };
    let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
    return fit({ x: (W - w) / 2, y: (H - h) / 2, w, h }, W, H);
  }
  // set one side of a box; with a ratio the other side follows, always staying inside the picture
  function setSide(rect, side, value, r, W, H) {
    let { x, y, w, h } = rect; value = Math.max(1, Math.round(value));
    if (side === "w") { w = Math.min(value, W - 0); if (r) h = w / r; }
    else if (side === "h") { h = Math.min(value, H); if (r) w = h * r; }
    if (r) { if (w > W) { w = W; h = w / r; } if (h > H) { h = H; w = h * r; } }
    return fit({ x, y, w, h }, W, H);
  }
  // output size from the cropped size cw x ch.
  // mode: none | exact (w, h; lock keeps the shape) | pct | long. Returns { w, h } or { error }.
  function outSize(mode, cw, ch, o) {
    o = o || {}; let w = cw, h = ch;
    if (mode === "exact") {
      const iw = +o.w, ih = +o.h;
      if (o.lock) { if (iw > 0) { w = iw; h = ch * iw / cw; } else if (ih > 0) { h = ih; w = cw * ih / ch; } else return { error: "Type a width or a height." }; }
      else { if (!(iw > 0) || !(ih > 0)) return { error: "Type both a width and a height." }; w = iw; h = ih; }
    } else if (mode === "pct") {
      const p = +o.pct; if (!(p > 0)) return { error: "Type a percent above 0." };
      w = cw * p / 100; h = ch * p / 100;
    } else if (mode === "long") {
      const L = +o.long; if (!(L > 0)) return { error: "Type the length of the longest side." };
      const k = L / Math.max(cw, ch); w = cw * k; h = ch * k;
    }
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    if (w > MAX_SIDE || h > MAX_SIDE) return { error: "The result would be wider or taller than " + MAX_SIDE + " pixels, which browsers cannot draw reliably." };
    if (w * h > MAX_PIXELS) return { error: "The result would have more than " + (MAX_PIXELS / 1e6) + " million pixels, which may run out of memory." };
    return { w, h, enlarged: w > cw || h > ch };
  }
  // steps for shrinking by a large factor in halves (looks much better than one jump)
  function steps(sw, sh, dw, dh) {
    const out = []; let w = sw, h = sh;
    while (w / 2 >= dw && h / 2 >= dh) { w = Math.round(w / 2); h = Math.round(h / 2); out.push([w, h]); }
    out.push([dw, dh]); return out;
  }
  function outName(name, ext) { return (name.replace(/\.[^.]*$/, "") || "picture") + "-edited." + ext; }
  // ---------- watermark placement ----------
  // pos: tl tc tr / ml mc mr / bl bc br. (bw, bh) is the size of the (turned) mark, m the margin. Returns the centre of the mark.
  function wmPlace(pos, W, H, bw, bh, m) {
    const row = pos[0], col = pos[1];
    let x = col === "l" ? m + bw / 2 : col === "r" ? W - m - bw / 2 : W / 2, y = row === "t" ? m + bh / 2 : row === "b" ? H - m - bh / 2 : H / 2;
    if (bw <= W) x = clamp(x, bw / 2, W - bw / 2); else x = W / 2;
    if (bh <= H) y = clamp(y, bh / 2, H - bh / 2); else y = H / 2;
    return { x, y };
  }
  // centres of a repeating pattern covering the whole picture (every second row shifted by half a step); never more than 3000 marks
  function wmTiles(W, H, bw, bh, gapX, gapY) {
    let sx = Math.max(4, bw + gapX), sy = Math.max(4, bh + gapY);
    while ((Math.ceil(W / sx) + 2) * (Math.ceil(H / sy) + 2) > 3000) { sx *= 1.25; sy *= 1.25; }
    const out = []; let row = 0;
    for (let y = -sy / 2; y < H + sy; y += sy, row++) for (let x = (row % 2 ? sx / 2 : 0) - sx; x < W + sx; x += sx) out.push({ x, y });
    return out;
  }

  // ---------- hiding parts of a picture: all work on RGBA bytes (ImageData.data), inside a rectangle ----------
  const R = (r, W, H) => { const x0 = clamp(Math.floor(r.x), 0, W), y0 = clamp(Math.floor(r.y), 0, H), x1 = clamp(Math.ceil(r.x + r.w), 0, W), y1 = clamp(Math.ceil(r.y + r.h), 0, H); return { x0, y0, x1, y1 }; };
  // block size from a strength of 1 (mild) to 10 (very strong): never below 8 pixels, so even text is hopeless to read
  function blockSize(rw, rh, strength, minBlock) { const d = 13 - clamp(Math.round(strength), 1, 10); return Math.max(minBlock || 8, Math.ceil(Math.min(rw, rh) / d)); }
  function pixelate(data, W, H, rect, block) {
    const q = R(rect, W, H); block = Math.max(1, Math.round(block));
    for (let by = q.y0; by < q.y1; by += block) for (let bx = q.x0; bx < q.x1; bx += block) {
      const ex = Math.min(bx + block, q.x1), ey = Math.min(by + block, q.y1); let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * W + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3]; n++; }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n); a = Math.round(a / n);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a; }
    }
  }
  function blackout(data, W, H, rect) { const q = R(rect, W, H); for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) { const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255; } }
  // box blur inside the rectangle, repeated (3 passes look like a Gaussian); edges repeat their border pixel
  function boxBlur(data, W, H, rect, radius, passes) {
    const q = R(rect, W, H), w = q.x1 - q.x0, h = q.y1 - q.y0, r = Math.max(1, Math.round(radius)); if (w < 1 || h < 1) return;
    const buf = new Float32Array(w * h * 4), tmp = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + q.y0) * W + x + q.x0) * 4, j = (y * w + x) * 4; buf[j] = data[i]; buf[j + 1] = data[i + 1]; buf[j + 2] = data[i + 2]; buf[j + 3] = data[i + 3]; }
    for (let p = 0; p < (passes || 3); p++) {
      for (let y = 0; y < h; y++) for (let c = 0; c < 4; c++) { // horizontal
        let sum = 0; for (let k = -r; k <= r; k++) sum += buf[(y * w + clamp(k, 0, w - 1)) * 4 + c];
        for (let x = 0; x < w; x++) { tmp[(y * w + x) * 4 + c] = sum / (2 * r + 1); sum += buf[(y * w + clamp(x + r + 1, 0, w - 1)) * 4 + c] - buf[(y * w + clamp(x - r, 0, w - 1)) * 4 + c]; }
      }
      for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) { // vertical
        let sum = 0; for (let k = -r; k <= r; k++) sum += tmp[(clamp(k, 0, h - 1) * w + x) * 4 + c];
        for (let y = 0; y < h; y++) { buf[(y * w + x) * 4 + c] = sum / (2 * r + 1); sum += tmp[(clamp(y + r + 1, 0, h - 1) * w + x) * 4 + c] - tmp[(clamp(y - r, 0, h - 1) * w + x) * 4 + c]; }
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + q.y0) * W + x + q.x0) * 4, j = (y * w + x) * 4; data[i] = Math.round(buf[j]); data[i + 1] = Math.round(buf[j + 1]); data[i + 2] = Math.round(buf[j + 2]); data[i + 3] = Math.round(buf[j + 3]); }
  }
  // mode: "pixelate" | "blur" | "black". Returns what to check afterwards.
  function hide(data, W, H, rect, mode, strength, scale) {
    const q = R(rect, W, H), w = q.x1 - q.x0, h = q.y1 - q.y0; if (w < 1 || h < 1) return null;
    const block = blockSize(w, h, strength, Math.max(2, Math.round(8 * (scale || 1))));
    if (mode === "black") { blackout(data, W, H, rect); return { mode, block: 0 }; }
    pixelate(data, W, H, rect, block);
    if (mode === "blur") boxBlur(data, W, H, rect, Math.max(2, block / 2), 2);
    return { mode, block };
  }
  // after hiding: black must be black everywhere; pixelated must be flat inside every block
  function checkHidden(data, W, H, rect, info) {
    const q = R(rect, W, H);
    if (info.mode === "black") { for (let y = q.y0; y < q.y1; y++) for (let x = q.x0; x < q.x1; x++) { const i = (y * W + x) * 4; if (data[i] || data[i + 1] || data[i + 2]) return false; } return true; }
    if (info.mode === "pixelate") {
      for (let by = q.y0; by < q.y1; by += info.block) for (let bx = q.x0; bx < q.x1; bx += info.block) {
        const ex = Math.min(bx + info.block, q.x1), ey = Math.min(by + info.block, q.y1), i0 = (by * W + bx) * 4;
        for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const i = (y * W + x) * 4; if (data[i] !== data[i0] || data[i + 1] !== data[i0 + 1] || data[i + 2] !== data[i0 + 2]) return false; }
      }
      return true;
    }
    return true;
  }

  const api = { wmPlace, wmTiles, blockSize, pixelate, blackout, boxBlur, hide, checkHidden, MAX_SIDE, MAX_PIXELS, ratio, fit, drag, biggest, setSide, outSize, steps, outName };
  if (typeof window !== "undefined") window.ImgMath = api;
  if (typeof module !== "undefined") module.exports = api;
})();
