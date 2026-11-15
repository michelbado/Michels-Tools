/* A small, safe Markdown reader for the files on the desktop (.md). It understands: headings (# and underlined), paragraphs, bold, italic, strikethrough,
   inline and fenced code, block quotes, bullet / numbered / task lists (nested), horizontal rules, links, and tables.
   Safety: the text is turned into a tree first, and the tree is drawn with textContent only. HTML in the text is never interpreted, it is shown as the characters
   it is; images are never loaded (they appear as a link to the picture); a link is made only for http, https and mailto addresses.
   A line break inside a paragraph is kept (so a plain text file saved as .md still looks like plain text).
   Pure code: parse() also runs in Node (tests); render() needs a document. Exports window.MiniMd. */
(() => {
  "use strict";
  const MAX_CHARS = 200000, MAX_PARA = 20000, WINDOW = 2000, MAX_DEPTH = 10;
  const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
  const decode = s => s.replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENT[m]);
  const safeHref = u => { const t = String(u || "").trim(); return /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(t) ? t : null; };
  const isPunct = c => /[!-\/:-@\[-`{-~]/.test(c);
  const wordChar = c => !!c && /[0-9A-Za-zÀ-￿]/.test(c);
  const spaceChar = c => c === undefined || c === "" || /\s/.test(c);

  // ---- inline ----------------------------------------------------------------------------------------------------------
  function inline(s, depth) {
    depth = depth || 0;
    const out = [];
    let buf = "";
    const flush = () => { if (buf) { out.push({ t: "text", s: decode(buf) }); buf = ""; } };
    if (depth > 8 || s.length > MAX_PARA) { return [{ t: "text", s }]; }
    for (let i = 0; i < s.length;) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length) {
        if (s[i + 1] === "\n") { flush(); out.push({ t: "br" }); i += 2; continue; }
        if (isPunct(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      }
      if (c === "\n") { // a line break is kept as a break (two spaces before it are dropped)
        buf = buf.replace(/ +$/, ""); flush(); out.push({ t: "br" }); i++; continue;
      }
      if (c === "`") {
        let n = 1; while (s[i + n] === "`") n++;
        const fence = "`".repeat(n); let j = i + n, found = -1;
        for (let k = i + n; k <= Math.min(s.length - n, i + n + WINDOW); k++) { if (s.startsWith(fence, k) && s[k + n] !== "`" && s[k - 1] !== "`") { found = k; break; } }
        if (found > 0) { flush(); let code = s.slice(j, found).replace(/\n/g, " "); if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1); out.push({ t: "code", s: code }); i = found + n; continue; }
        buf += fence; i += n; continue;
      }
      if (c === "!" && s[i + 1] === "[") { const l = link(s, i + 1, depth); if (l) { flush(); const href = l.href; out.push(href ? { t: "link", href, title: l.title, c: [{ t: "text", s: "[image" + (l.text ? ": " + l.text : "") + "]" }] } : { t: "text", s: "[image" + (l.text ? ": " + l.text : "") + "]" }); i = l.end; continue; } }
      if (c === "[") { const l = link(s, i, depth); if (l) { flush(); if (l.href) out.push({ t: "link", href: l.href, title: l.title, c: inline(l.text, depth + 1) }); else out.push(...inline(l.text, depth + 1)); i = l.end; continue; } }
      if (c === "<") {
        const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i, i + 2000));
        if (m && safeHref(m[1])) { flush(); out.push({ t: "link", href: m[1], c: [{ t: "text", s: m[1] }] }); i += m[0].length; continue; }
      }
      if ((c === "h" || c === "H") && /^https?:\/\//i.test(s.slice(i, i + 8)) && !wordChar(s[i - 1])) {
        const m = /^https?:\/\/[^\s<>"]+/i.exec(s.slice(i, i + 2000));
        if (m) { let u = m[0]; while (/[.,;:!?)\]'"]$/.test(u) && !(u.endsWith(")") && u.includes("("))) u = u.slice(0, -1); if (safeHref(u)) { flush(); out.push({ t: "link", href: u, c: [{ t: "text", s: u }] }); i += u.length; continue; } }
      }
      // emphasis: the closing mark is searched only a short way ahead (keeps odd input fast)
      if (c === "*" || c === "_" || c === "~") {
        const dbl = s[i + 1] === c, mark = dbl ? c + c : c;
        if (c === "~" && !dbl) { buf += c; i++; continue; }
        const after = s[i + mark.length], before = s[i - 1];
        const leftOk = !spaceChar(after) && (c !== "_" || !wordChar(before));
        if (leftOk) {
          let j = -1; const stop = Math.min(s.length, i + mark.length + WINDOW);
          for (let k = i + mark.length; k < stop; k++) {
            if (s[k] === "\\") { k++; continue; }
            if (s.startsWith(mark, k) && !spaceChar(s[k - 1]) && (c !== "_" || !wordChar(s[k + mark.length])) && !(!dbl && s[k + 1] === c) && !(!dbl && s[k - 1] === c)) { j = k; break; }
          }
          if (j > 0 && j > i + mark.length) { flush(); out.push({ t: c === "~" ? "del" : dbl ? "strong" : "em", c: inline(s.slice(i + mark.length, j), depth + 1) }); i = j + mark.length; continue; }
        }
      }
      buf += c; i++;
    }
    flush();
    return out;
  }
  // [text](url "title") starting at the "[": returns { text, href (or null), title, end }
  function link(s, i, depth) {
    let d = 0, j = i;
    for (; j < Math.min(s.length, i + WINDOW); j++) { if (s[j] === "\\") { j++; continue; } if (s[j] === "[") d++; else if (s[j] === "]" && --d === 0) break; }
    if (s[j] !== "]" || s[j + 1] !== "(") return null;
    let k = j + 2, p = 0;
    for (; k < Math.min(s.length, j + 2 + WINDOW); k++) { if (s[k] === "\\") { k++; continue; } if (s[k] === "(") p++; else if (s[k] === ")") { if (p === 0) break; p--; } else if (s[k] === "\n") return null; }
    if (s[k] !== ")") return null;
    const inner = s.slice(j + 2, k).trim(), m = /^<?([^\s>]*)>?(?:\s+["'(](.*?)["')])?$/.exec(inner);
    if (!m) return null;
    return { text: s.slice(i + 1, j), href: safeHref(m[1]), title: m[2] || "", end: k + 1 };
  }

  // ---- blocks ----------------------------------------------------------------------------------------------------------
  const reFence = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/, reAtx = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*#*\s*$/, reHr = /^ {0,3}([-*_])(?: *\1){2,} *$/;
  const reList = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/, reQuote = /^ {0,3}>/, reSep = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
  const cells = line => { let t = line.trim(); if (t.startsWith("|")) t = t.slice(1); if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1); return t.split(/(?<!\\)\|/).map(x => x.trim().replace(/\\\|/g, "|")); };
  const startsBlock = line => reFence.test(line) || reAtx.test(line) || reHr.test(line) || reQuote.test(line) || (reList.test(line) && !/^\s*$/.test(line) && /^( {0,3})([-*+]|1[.)])( +)\S/.test(line));

  function blocks(lines, depth) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) { i++; continue; }
      let m;
      if ((m = reFence.exec(line))) {
        const ch = m[1][0], len = m[1].length, body = []; i++;
        while (i < lines.length && !(new RegExp("^ {0,3}\\" + ch + "{" + len + ",}\\s*$").test(lines[i]))) body.push(lines[i++]);
        i++; out.push({ t: "code", lang: m[2] || "", text: body.join("\n") }); continue;
      }
      if ((m = reAtx.exec(line))) { out.push({ t: "h", n: m[1].length, inl: inline((m[2] || "").trim()) }); i++; continue; }
      if (reHr.test(line)) { out.push({ t: "hr" }); i++; continue; }
      if (reQuote.test(line) && depth < MAX_DEPTH) {
        const q = []; while (i < lines.length && reQuote.test(lines[i])) q.push(lines[i++].replace(/^ {0,3}> ?/, ""));
        out.push({ t: "quote", blocks: blocks(q, depth + 1) }); continue;
      }
      if (i + 1 < lines.length && line.includes("|") && reSep.test(lines[i + 1]) && lines[i + 1].includes("-") && cells(line).length === cells(lines[i + 1]).length && /[|]/.test(lines[i + 1] + line)) {
        const head = cells(line), al = cells(lines[i + 1]).map(c => (/^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : /^:-+$/.test(c) ? "left" : ""));
        i += 2; const rows = [];
        while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) { const r = cells(lines[i++]); while (r.length < head.length) r.push(""); rows.push(r.slice(0, head.length).map(x => inline(x))); }
        out.push({ t: "table", head: head.map(x => inline(x)), align: al, rows }); continue;
      }
      if ((m = reList.exec(line)) && depth < MAX_DEPTH) {
        const ordered = /\d/.test(m[2][0]), baseIndent = m[1].length, items = []; let start = ordered ? parseInt(m[2], 10) : 1;
        while (i < lines.length) {
          const lm = reList.exec(lines[i]);
          if (!lm || lm[1].length > baseIndent + 3 || /\d/.test(lm[2][0]) !== ordered) break;
          if (lm[1].length > baseIndent + 1 && items.length) break;
          const content = lm[4], cw = lm[1].length + lm[2].length + Math.max(1, Math.min(4, lm[3].length)), item = [content]; i++;
          while (i < lines.length) {
            const l = lines[i];
            if (/^\s*$/.test(l)) { // a blank line stays inside the item only when more indented text follows
              let k = i; while (k < lines.length && /^\s*$/.test(lines[k])) k++;
              if (k < lines.length && /^ +/.test(lines[k]) && lines[k].match(/^ */)[0].length >= cw) { while (i < k) { item.push(""); i++; } continue; }
              break;
            }
            const lead = l.match(/^ */)[0].length;
            if (lead >= cw) { item.push(l.slice(cw)); i++; continue; }
            if (reList.test(l) && lead <= baseIndent + 1) break;
            if (startsBlock(l)) break;
            item.push(l.trim()); i++; // a lazy continuation line
          }
          let task = null; const tm = /^\[([ xX])\]\s+/.exec(item[0]);
          if (tm) { task = tm[1] !== " "; item[0] = item[0].slice(tm[0].length); }
          items.push({ task, blocks: blocks(item, depth + 1) });
          while (i < lines.length && /^\s*$/.test(lines[i]) && i + 1 < lines.length && reList.test(lines[i + 1]) && (reList.exec(lines[i + 1])[1].length <= baseIndent + 1)) i++;
        }
        out.push({ t: ordered ? "ol" : "ul", start, items }); continue;
      }
      // a paragraph (or a heading underlined with === or ---)
      const para = [line]; i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^ {0,3}(=+|-+)\s*$/.test(lines[i]) && !startsBlock(lines[i])) para.push(lines[i++]);
      if (i < lines.length && /^ {0,3}(=+|-{2,})\s*$/.test(lines[i])) { // an underline: === makes a heading 1, --- a heading 2
        const lvl = /^ *=/.test(lines[i]) ? 1 : 2; i++; out.push({ t: "h", n: lvl, inl: inline(para.map(x => x.trim()).join("\n")) }); continue;
      }
      out.push({ t: "p", inl: inline(para.map(x => x.replace(/^\s+/, "")).join("\n")) });
    }
    return out;
  }

  // parse(text) -> { tree, plain }: plain = true when the text is too large to format (it is then shown as plain text)
  function parse(text) {
    const t = String(text == null ? "" : text).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(/\u0000/g, "�");
    if (t.length > MAX_CHARS) return { tree: [], plain: true };
    return { tree: blocks(t.split("\n"), 0), plain: false };
  }

  // ---- drawing ----------------------------------------------------------------------------------------------------------
  function drawInline(parent, nodes, doc) {
    for (const n of nodes) {
      let e;
      switch (n.t) {
        case "text": parent.append(doc.createTextNode(n.s)); break;
        case "br": parent.append(doc.createElement("br")); break;
        case "code": e = doc.createElement("code"); e.textContent = n.s; parent.append(e); break;
        case "em": case "strong": case "del": e = doc.createElement(n.t === "em" ? "em" : n.t === "strong" ? "strong" : "del"); drawInline(e, n.c, doc); parent.append(e); break;
        case "link": e = doc.createElement("a"); e.setAttribute("href", n.href); e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener noreferrer"); if (n.title) e.setAttribute("title", n.title); drawInline(e, n.c, doc); parent.append(e); break;
      }
    }
  }
  function drawBlocks(parent, list, doc) {
    for (const b of list) {
      let e;
      switch (b.t) {
        case "h": e = doc.createElement("h" + b.n); drawInline(e, b.inl, doc); break;
        case "p": e = doc.createElement("p"); drawInline(e, b.inl, doc); break;
        case "hr": e = doc.createElement("hr"); break;
        case "code": e = doc.createElement("pre"); { const c = doc.createElement("code"); c.textContent = b.text; e.append(c); } break;
        case "quote": e = doc.createElement("blockquote"); drawBlocks(e, b.blocks, doc); break;
        case "ul": case "ol":
          e = doc.createElement(b.t); if (b.t === "ol" && b.start !== 1) e.setAttribute("start", String(b.start));
          for (const it of b.items) {
            const li = doc.createElement("li");
            if (it.task !== null) { li.className = "dmd-task"; const box = doc.createElement("span"); box.className = "dmd-box"; box.textContent = it.task ? "☑" : "☐"; li.append(box, doc.createTextNode(" ")); }
            // a list item with one paragraph is shown without the paragraph's spacing
            // a list item whose first block is a paragraph shows that text without the paragraph's spacing (also when a nested list follows)
            if (it.blocks.length && it.blocks[0].t === "p") { drawInline(li, it.blocks[0].inl, doc); drawBlocks(li, it.blocks.slice(1), doc); } else drawBlocks(li, it.blocks, doc);
            e.append(li);
          }
          break;
        case "table": {
          e = doc.createElement("table"); e.className = "dmd-table";
          const thead = doc.createElement("thead"), tr = doc.createElement("tr");
          b.head.forEach((h, i) => { const th = doc.createElement("th"); if (b.align[i]) th.className = "dmd-" + b.align[i]; drawInline(th, h, doc); tr.append(th); });
          thead.append(tr); e.append(thead);
          const tb = doc.createElement("tbody");
          for (const r of b.rows) { const row = doc.createElement("tr"); r.forEach((c, i) => { const td = doc.createElement("td"); if (b.align[i]) td.className = "dmd-" + b.align[i]; drawInline(td, c, doc); row.append(td); }); tb.append(row); }
          e.append(tb); break;
        }
      }
      if (e) parent.append(e);
    }
  }
  // render(text, document) -> a <div class="dmd"> with the formatted text
  function render(text, doc) {
    const root = doc.createElement("div"); root.className = "dmd";
    const r = parse(text);
    if (r.plain) { const pre = doc.createElement("pre"); pre.className = "dmd-plain"; pre.textContent = String(text); root.append(pre); return root; }
    drawBlocks(root, r.tree, doc);
    return root;
  }

  const api = { parse, render, inline, safeHref };
  if (typeof window !== "undefined") window.MiniMd = api;
  if (typeof module !== "undefined") module.exports = api;
})();
