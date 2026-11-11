/* chmod Calculator. All the permission maths is in lib/chmodcalc.js; this file only shows it. Text only reaches the page through textContent. */
(window.DesktopApps = window.DesktopApps || {}).chmodcalc = (() => {
  function init(root) {
    const $ = id => root.querySelector("#chmodcalc-" + id);
    const setStatus = m => { $("status").textContent = m; };
    const CC = window.ChmodCalc, TK = window.TK; let mode = 0o644;
    const BOXES = { ur: 0o400, uw: 0o200, ux: 0o100, gr: 0o040, gw: 0o020, gx: 0o010, or: 0o004, ow: 0o002, ox: 0o001, suid: 0o4000, sgid: 0o2000, sticky: 0o1000 };
    const isDir = () => $("dir").checked;
    function render(keepInput) {
      for (const [id, bit] of Object.entries(BOXES)) $(id).checked = !!(mode & bit);
      if (keepInput !== "octal") $("octal").value = CC.octal(mode, mode > 0o777); if (keepInput !== "letters") $("letters").value = CC.symbolic(mode);
      const d = CC.describe(mode, isDir()), oct = CC.octal(mode, true), oct3 = CC.octal(mode, false), sym = CC.symbolic(mode);
      const u = CC.fromNum(mode), part = (c, p) => (p.r ? "r" : "") + (p.w ? "w" : "") + (p.x ? "x" : "");
      const exprs = "u=" + part("u", u.u) + ",g=" + part("g", u.g) + ",o=" + part("o", u.o);
      $("summary").textContent = oct + "  " + (isDir() ? "d" : "-") + sym;
      TK.notes($("notes"), d.notes);
      const f = isDir() ? "folder" : "file";
      const letters = exprs + (mode & 0o4000 ? ",u+s" : "") + (mode & 0o2000 ? ",g+s" : "") + (mode & 0o1000 ? ",+t" : "");
      const cmds = [["Octal", "chmod " + (mode > 0o777 ? oct : oct3) + " " + f]];
      if (isDir()) cmds.push(["Octal, five digits (also clears setuid and setgid)", "chmod 0" + oct + " " + f]);
      cmds.push(["Letters", "chmod " + letters + " " + f], ["Recursive (everything inside)", "chmod -R " + (mode > 0o777 ? oct : oct3) + " " + f], ["ls -l shows", (isDir() ? "d" : "-") + sym + "  1 owner group  size  date  name"]);
      const holder = $("out"); holder.textContent = "";
      TK.render(holder, [{ title: "Who can do what", rows: d.rows }, { title: "Commands", rows: cmds, mono: true, foot: "Replace \"" + f + "\" with the real name." }, { title: "Forms", rows: [["Octal (4 digits)", oct], ["Octal (short)", oct3], ["Letters", sym], ["As numbers per class", "owner " + ((mode >> 6) & 7) + ", group " + ((mode >> 3) & 7) + ", other " + (mode & 7)]], mono: true }], { copy: true, status: setStatus });
      setStatus("Done.");
    }
    function msg(text, bad) { $("msg").textContent = text; }
    function fromBoxes() { let m = 0; for (const [id, bit] of Object.entries(BOXES)) if ($(id).checked) m |= bit; mode = m; msg(""); render(); }
    for (const id of Object.keys(BOXES)) $(id).addEventListener("change", fromBoxes);
    $("file").addEventListener("change", () => render()); $("dir").addEventListener("change", () => render());
    $("octal").addEventListener("input", () => { const r = CC.read($("octal").value.trim(), mode, isDir()); if (r.mode !== undefined && /^[0-7]{3,4}$/.test($("octal").value.trim())) { mode = r.mode; msg(""); render("octal"); } else msg(r.error || ""); });
    $("letters").addEventListener("input", () => { const t = $("letters").value.trim(); const m = CC.fromSymbolic(t); if (m !== null) { mode = m; msg(""); render("letters"); } else if (t.length >= 9) msg("Letters look like rwxr-xr-x (nine characters, or ten with the file type in front)."); });
    $("apply").addEventListener("click", () => { const r = CC.read($("expr").value, mode, isDir()); if (r.error) { msg(r.error); return; } if (r.empty) return; mode = r.mode; msg("Applied: " + r.how + "."); render(); });
    $("umask").addEventListener("input", () => { const u = CC.umask($("umask").value); const out = $("uout"); out.textContent = ""; if (u.error) { const p = document.createElement("p"); p.className = "tk-muted"; p.textContent = u.error; out.append(p); return; } TK.render(out, [{ title: "With umask " + u.umask, rows: [["New files", u.file, "the default 666 minus the umask"], ["New directories", u.dir, "the default 777 minus the umask"]], mono: true }], { copy: true, status: setStatus }); });
    render(); $("umask").dispatchEvent(new Event("input"));
    return { destroy() {} };
  }
  return { init };
})();
