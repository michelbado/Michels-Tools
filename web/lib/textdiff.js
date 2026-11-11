/* Text compare: finds the smallest set of line changes between two texts (Myers' algorithm), pairs changed lines and marks the words that differ, and writes a
   unified diff. Pure code on text. Exports window.TextDiff. */
(() => {
  "use strict";
  const MAXD = 4000;   // beyond this many differences the exact search is dropped and the middle is shown as one replaced block

  const splitLines = t => { t = String(t); if (t === "") return []; const l = t.split(/\r\n|\r|\n/); if (l.length && l[l.length - 1] === "" && /(\r\n|\r|\n)$/.test(t)) l.pop(); return l; };
  const normFn = o => {
    o = o || {};
    return s => { if (o.ignoreCase) s = s.toLowerCase(); if (o.ignoreSpace === "all") s = s.replace(/\s+/g, ""); else if (o.ignoreSpace === "trim") s = s.replace(/^\s+|\s+$/g, ""); else if (o.ignoreSpace === "collapse") s = s.replace(/\s+/g, " ").replace(/^ | $/g, ""); return s; };
  };

  // Myers O(ND). a, b: arrays of comparable strings. Returns ops [{t:"eq"|"del"|"add", i (index in a), j (index in b)}] and d (number of edits), or exact:false when too different.
  function myers(a, b) {
    const n = a.length, m = b.length;
    let s = 0; while (s < n && s < m && a[s] === b[s]) s++;
    let e = 0; while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
    const A = a.slice(s, n - e), B = b.slice(s, m - e), N = A.length, M = B.length, ops = [];
    for (let k = 0; k < s; k++) ops.push({ t: "eq", i: k, j: k });
    let mid = null, exact = true;
    if (N === 0 || M === 0) { mid = []; for (let k = 0; k < N; k++) mid.push({ t: "del", i: s + k }); for (let k = 0; k < M; k++) mid.push({ t: "add", j: s + k }); }
    else {
      const max = Math.min(N + M, MAXD), off = max + 1, V = new Int32Array(2 * max + 3), trace = []; let found = -1;
      outer: for (let d = 0; d <= max; d++) {
        for (let k = -d; k <= d; k += 2) {
          let x = (k === -d || (k !== d && V[off + k - 1] < V[off + k + 1])) ? V[off + k + 1] : V[off + k - 1] + 1, y = x - k;
          while (x < N && y < M && A[x] === B[y]) { x++; y++; }
          V[off + k] = x;
          if (x >= N && y >= M) { trace.push(V.slice()); found = d; break outer; }
        }
        trace.push(V.slice());
      }
      if (found < 0) { exact = false; mid = []; for (let k = 0; k < N; k++) mid.push({ t: "del", i: s + k }); for (let k = 0; k < M; k++) mid.push({ t: "add", j: s + k }); }
      else {
        const back = []; let x = N, y = M;
        for (let d = found; d > 0; d--) {
          const Vp = trace[d - 1], k = x - y;
          const down = (k === -d || (k !== d && Vp[off + k - 1] < Vp[off + k + 1])), prevK = down ? k + 1 : k - 1, px = Vp[off + prevK], py = px - prevK;
          const mx = down ? px : px + 1, my = down ? py + 1 : py;       // the point right after the single step, before the diagonal run
          while (x > mx && y > my) { back.push({ t: "eq", i: s + x - 1, j: s + y - 1 }); x--; y--; }
          if (down) { back.push({ t: "add", j: s + y - 1 }); y--; } else { back.push({ t: "del", i: s + x - 1 }); x--; }
        }
        while (x > 0 && y > 0) { back.push({ t: "eq", i: s + x - 1, j: s + y - 1 }); x--; y--; }
        mid = back.reverse();
      }
    }
    for (const o of mid) ops.push(o);
    for (let k = 0; k < e; k++) ops.push({ t: "eq", i: n - e + k, j: m - e + k });
    let d = 0; for (const o of ops) if (o.t !== "eq") d++;
    return { ops, d, exact };
  }

  // word level: split into words, spaces and single symbols, then the same algorithm
  const tokens = s => s.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) || [];
  function diffWords(x, y) {
    const a = tokens(x), b = tokens(y); if (a.length * b.length > 4e6) return { a: [{ t: "del", s: x }], b: [{ t: "add", s: y }] };
    const r = myers(a, b), sa = [], sb = [];
    const push = (arr, t, s) => { if (arr.length && arr[arr.length - 1].t === t) arr[arr.length - 1].s += s; else arr.push({ t, s }); };
    for (const o of r.ops) { if (o.t === "eq") { push(sa, "eq", a[o.i]); push(sb, "eq", b[o.j]); } else if (o.t === "del") push(sa, "del", a[o.i]); else push(sb, "add", b[o.j]); }
    return { a: sa, b: sb };
  }

  /* compare(textA, textB, opts) -> { rows, stats, exact }
     rows: { type: "eq"|"del"|"add"|"chg", a: { n, text, segs? } | null, b: { ... } | null }  (n = line number from 1) */
  function compare(ta, tb, opts) {
    opts = opts || {}; const la = splitLines(ta), lb = splitLines(tb), nf = normFn(opts);
    const r = myers(la.map(nf), lb.map(nf)), rows = []; let k = 0;
    while (k < r.ops.length) {
      const o = r.ops[k];
      if (o.t === "eq") { rows.push({ type: "eq", a: { n: o.i + 1, text: la[o.i] }, b: { n: o.j + 1, text: lb[o.j] } }); k++; continue; }
      const dels = [], adds = []; while (k < r.ops.length && r.ops[k].t !== "eq") { (r.ops[k].t === "del" ? dels : adds).push(r.ops[k]); k++; }
      const pairs = Math.min(dels.length, adds.length);
      for (let p = 0; p < pairs; p++) { const x = la[dels[p].i], y = lb[adds[p].j], w = opts.words === false ? null : diffWords(x, y); rows.push({ type: "chg", a: { n: dels[p].i + 1, text: x, segs: w && w.a }, b: { n: adds[p].j + 1, text: y, segs: w && w.b } }); }
      for (let p = pairs; p < dels.length; p++) rows.push({ type: "del", a: { n: dels[p].i + 1, text: la[dels[p].i] }, b: null });
      for (let p = pairs; p < adds.length; p++) rows.push({ type: "add", a: null, b: { n: adds[p].j + 1, text: lb[adds[p].j] } });
    }
    const st = { same: 0, changed: 0, removed: 0, added: 0, linesA: la.length, linesB: lb.length };
    for (const row of rows) { if (row.type === "eq") st.same++; else if (row.type === "chg") st.changed++; else if (row.type === "del") st.removed++; else st.added++; }
    st.identical = st.changed + st.removed + st.added === 0;
    return { rows, stats: st, exact: r.exact };
  }

  // unified diff text from compare() rows (context lines around each change)
  function unified(rows, nameA, nameB, context) {
    context = context === undefined ? 3 : context;
    const flat = []; for (const r of rows) { if (r.type === "eq") flat.push({ c: " ", r }); else if (r.type === "chg") { flat.push({ c: "-", r, side: "a" }); flat.push({ c: "+", r, side: "b" }); } else if (r.type === "del") flat.push({ c: "-", r, side: "a" }); else flat.push({ c: "+", r, side: "b" }); }
    // regroup: all "-" of a change block before "+" (rows from chg are interleaved above, so sort each run)
    const lines = []; let i = 0;
    while (i < flat.length) { if (flat[i].c === " ") { lines.push(flat[i]); i++; continue; } const dels = [], adds = []; while (i < flat.length && flat[i].c !== " ") { (flat[i].c === "-" ? dels : adds).push(flat[i]); i++; } for (const x of dels) lines.push(x); for (const x of adds) lines.push(x); }
    const changeAt = []; lines.forEach((l, idx) => { if (l.c !== " ") changeAt.push(idx); });
    if (!changeAt.length) return "";
    const hunks = []; let start = Math.max(0, changeAt[0] - context), end = Math.min(lines.length, changeAt[0] + context + 1);
    for (let c = 1; c < changeAt.length; c++) { const s = Math.max(0, changeAt[c] - context), e = Math.min(lines.length, changeAt[c] + context + 1); if (s <= end) end = e; else { hunks.push([start, end]); start = s; end = e; } }
    hunks.push([start, end]);
    const preA = [0], preB = [0]; for (const l of lines) { preA.push(preA[preA.length - 1] + (l.c !== "+" ? 1 : 0)); preB.push(preB[preB.length - 1] + (l.c !== "-" ? 1 : 0)); }
    const out = ["--- " + (nameA || "a"), "+++ " + (nameB || "b")];
    for (const [s0, e0] of hunks) {
      const na = preA[e0] - preA[s0], nb = preB[e0] - preB[s0], aStart = na > 0 ? preA[s0] + 1 : preA[s0], bStart = nb > 0 ? preB[s0] + 1 : preB[s0];
      out.push("@@ -" + aStart + (na === 1 ? "" : "," + na) + " +" + bStart + (nb === 1 ? "" : "," + nb) + " @@");
      for (let k = s0; k < e0; k++) { const l = lines[k]; out.push(l.c + (l.c === "+" ? l.r.b.text : l.r.a.text)); }
    }
    return out.join("\n") + "\n";
  }

  const api = { compare, unified, myers, splitLines, diffWords, MAXD };
  if (typeof window !== "undefined") window.TextDiff = api;
  if (typeof module !== "undefined") module.exports = api;
})();
