/* Regex Tester. Pattern work is in lib/regextest.js, run in a worker (lib/regexworker.js) that is stopped after 2 seconds. Text from the visitor reaches the page only through textContent. */
(window.DesktopApps = window.DesktopApps || {}).regextest = (() => {
  function init(root) {
    const $ = id => root.querySelector("#regextest-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const R = window.RegexTest, TK = window.TK;
    let worker = null, token = 0, timer = 0, lastReplaced = "";
    const TIMEOUT = 2000;
    // flags
    const fbox = $("flags"), FL = { g: "g", i: "i", m: "m", s: "s", u: "u", y: "y" };
    for (const [f, tip] of Object.entries(R.FLAGS)) { if (f === "v") continue; const l = document.createElement("label"), c = document.createElement("input"); c.type = "checkbox"; c.className = "xp-check"; c.value = f; c.checked = f === "g"; c.id = "regextest-f-" + f; l.title = tip; l.append(c, document.createTextNode(" " + f + " "), Object.assign(document.createElement("span"), { className: "tk-muted", textContent: "(" + tip.split(":")[0] + ")" })); fbox.append(l); c.addEventListener("change", run); }
    const flags = () => [...fbox.querySelectorAll("input")].filter(c => c.checked).map(c => c.value).join("");
    for (const ex of R.EXAMPLES) { const o = document.createElement("option"); o.value = ex.name; o.textContent = ex.name; $("ex").append(o); }
    $("ex").addEventListener("change", () => { const ex = R.EXAMPLES.find(e => e.name === $("ex").value); if (!ex) return; $("pat").value = ex.pattern; $("text").value = ex.text; $("rep").value = ex.replacement || ""; for (const c of fbox.querySelectorAll("input")) c.checked = ex.flags.includes(c.value); run(); });
    // cheat sheet
    { const t = document.createElement("table"); t.className = "tk-table"; for (const [a, b] of R.CHEAT) { const tr = document.createElement("tr"), th = document.createElement("th"), td = document.createElement("td"); th.textContent = a; th.className = "tk-mono"; td.textContent = b; tr.append(th, td); t.append(tr); } $("cheat").append(t); }
    function startWorker() { if (worker) worker.terminate(); try { worker = new Worker("lib/regexworker.js"); } catch { worker = null; } }
    function solve(job, done) {
      const my = ++token; clearTimeout(timer);
      if (!worker) { startWorker(); }
      if (!worker) { // no workers available: run here (cannot be stopped)
        try { done(R.run(job), my); } catch (e) { done({ ok: false, error: String(e.message || e) }, my); } return; }
      worker.onmessage = e => { clearTimeout(timer); if (my === token) done(e.data, my); };
      worker.onerror = () => { clearTimeout(timer); if (my === token) done({ ok: false, error: "The matcher failed." }, my); };
      timer = setTimeout(() => { if (my !== token) return; worker.terminate(); worker = null; done({ ok: false, timeout: true, error: "The pattern took longer than 2 seconds on this text, so it was stopped. This is usually catastrophic backtracking: a repeat inside a repeat, like (a+)+ . Make the pattern more specific." }, my); }, TIMEOUT);
      worker.postMessage(job);
    }
    function mark(text, matches) {
      const hl = $("hl"); hl.textContent = ""; let pos = 0, k = 0;
      for (const m of matches) { if (m.index < pos) continue; if (m.index > pos) hl.append(document.createTextNode(text.slice(pos, m.index))); const mk = document.createElement("mark"); mk.className = m.text === "" ? "empty" : "m" + (k++ % 2); mk.textContent = m.text === "" ? "​" : m.text; mk.title = m.text === "" ? "an empty match at position " + m.index : "match at " + m.index; hl.append(mk); pos = m.end; }
      if (pos < text.length) hl.append(document.createTextNode(text.slice(pos)));
    }
    function run() {
      const pat = $("pat").value, text = $("text").value, rep = $("rep").value; $("summary").textContent = ""; $("table").textContent = ""; $("repout").textContent = ""; $("repcopy").disabled = true; lastReplaced = "";
      const notes = []; const rk = pat ? R.risky(pat) : null; if (rk) notes.push({ level: "warn", text: rk });
      if (!pat) { TK.notes($("notes"), []); $("hl").textContent = text; setStatus("Type a pattern."); return; }
      setStatus("Matching…");
      solve({ pattern: pat, flags: flags(), text, replacement: rep === "" ? undefined : rep }, r => {
        if (!r.ok) { TK.notes($("notes"), notes.concat([{ level: "bad", text: r.error }])); $("hl").textContent = text; setStatus(r.timeout ? "Stopped: too slow." : "Pattern error."); return; }
        TK.notes($("notes"), notes.concat(r.truncated ? [{ level: "warn", text: "Only the first " + R.MAXMATCHES + " matches are shown." }] : []));
        const n = r.matches.length; $("summary").textContent = r.emptyPattern ? "The pattern is empty." : n === 0 ? "No match." : n + " match" + (n === 1 ? "" : "es") + (r.truncated ? " (stopped at " + R.MAXMATCHES + ")" : "") + ".";
        mark(text, r.matches);
        if (n) {
          const rows = r.matches.slice(0, 200).map((m, i) => ["#" + (i + 1) + "  at " + m.index + "–" + m.end, JSON.stringify(m.text).slice(0, 300), m.groups.length ? m.groups.map(g => (g.name ? g.name : "group " + g.n) + ": " + (g.text === undefined ? "(did not match)" : JSON.stringify(g.text).slice(0, 80)) + (g.start !== undefined ? " [" + g.start + "–" + g.end + "]" : "")).join("\n") : undefined]);
          TK.render($("table"), [{ title: "Match details" + (n > 200 ? " (first 200)" : ""), rows, mono: true }], { copy: true, status: setStatus });
        }
        if (rep !== "" ) { if (r.replaceError) $("repout").textContent = r.replaceError; else { lastReplaced = r.replaced; $("repout").textContent = r.replaced + (r.replaceNote ? "\n\n(" + r.replaceNote + ")" : ""); $("repcopy").disabled = false; } }
        setStatus(n + " match" + (n === 1 ? "" : "es") + ".");
      });
    }
    const go = TK.debounce(run, 250);
    for (const id of ["pat", "text", "rep"]) $(id).addEventListener("input", go);
    $("repcopy").addEventListener("click", () => TK.copy(lastReplaced, setStatus));
    run();
    return { destroy() { clearTimeout(timer); token++; if (worker) worker.terminate(); } };
  }
  return { init };
})();
