/* chmod calculator: Unix file permissions as octal numbers (755, 4755), as letters (rwxr-xr-x, an ls -l line) and as chmod expressions
   (u+x,go-w). Works on text/numbers only; reads no files. Exports window.ChmodCalc. */
(() => {
  "use strict";
  // mode = { u: {r,w,x}, g: {...}, o: {...}, setuid, setgid, sticky } or a number 0..07777
  const N = m => m & 0o7777;
  const fromNum = n => ({ u: { r: !!(n & 0o400), w: !!(n & 0o200), x: !!(n & 0o100) }, g: { r: !!(n & 0o040), w: !!(n & 0o020), x: !!(n & 0o010) }, o: { r: !!(n & 0o004), w: !!(n & 0o002), x: !!(n & 0o001) }, setuid: !!(n & 0o4000), setgid: !!(n & 0o2000), sticky: !!(n & 0o1000) });
  const toNum = m => (m.u.r ? 0o400 : 0) | (m.u.w ? 0o200 : 0) | (m.u.x ? 0o100 : 0) | (m.g.r ? 0o040 : 0) | (m.g.w ? 0o020 : 0) | (m.g.x ? 0o010 : 0) | (m.o.r ? 0o004 : 0) | (m.o.w ? 0o002 : 0) | (m.o.x ? 0o001 : 0) | (m.setuid ? 0o4000 : 0) | (m.setgid ? 0o2000 : 0) | (m.sticky ? 0o1000 : 0);
  const octal = (n, four) => { const s = N(n).toString(8); return four || n > 0o777 ? s.padStart(4, "0") : s.padStart(3, "0"); };
  // the nine-letter form, with s/S and t/T for the special bits
  function symbolic(n) {
    n = N(n); const t = (bit, ch, special, sl, su) => (n & bit ? (special ? sl : ch) : (special ? su : "-"));
    const u = (n & 0o400 ? "r" : "-") + (n & 0o200 ? "w" : "-") + (n & 0o4000 ? (n & 0o100 ? "s" : "S") : (n & 0o100 ? "x" : "-"));
    const g = (n & 0o040 ? "r" : "-") + (n & 0o020 ? "w" : "-") + (n & 0o2000 ? (n & 0o010 ? "s" : "S") : (n & 0o010 ? "x" : "-"));
    const o = (n & 0o004 ? "r" : "-") + (n & 0o002 ? "w" : "-") + (n & 0o1000 ? (n & 0o001 ? "t" : "T") : (n & 0o001 ? "x" : "-"));
    return u + g + o;
  }
  // "rwxr-xr-x", "-rwxr-xr-x", "drwxrwxrwt", "rwsr-xr-x" -> number
  function fromSymbolic(s) {
    s = String(s).trim(); if (/^[-dlcbpsD]/.test(s) && s.length === 10) s = s.slice(1);
    if (!/^[-r][-w][-xsS][-r][-w][-xsS][-r][-w][-xtT]$/.test(s)) return null;
    let n = 0; const bit = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
    for (let i = 0; i < 9; i++) { const c = s[i]; if ("rwxst".includes(c) && c !== "-") { if (c === "s" || c === "t") n |= bit[i]; else n |= bit[i]; } }
    if (s[2] === "s" || s[2] === "S") n |= 0o4000; if (s[5] === "s" || s[5] === "S") n |= 0o2000; if (s[8] === "t" || s[8] === "T") n |= 0o1000;
    if (s[2] === "S") n &= ~0o100; if (s[5] === "S") n &= ~0o010; if (s[8] === "T") n &= ~0o001;
    return n;
  }
  // chmod "u+x,g-w,o=r", "a+rX", "go-rwx", "u=rwx,go=u" applied to a starting mode, following GNU chmod. isDir matters for X and for the special
  // bits (on a directory "=" keeps setuid and setgid). With no class letter, the umask decides which bits change (default 022).
  function applySymbolic(expr, start, isDir, umaskValue) {
    let n = N(start); if (!String(expr).trim()) return null;
    const um = umaskValue == null ? 0o022 : umaskValue & 0o777;
    for (const clause of String(expr).trim().split(",")) {
      const m = /^([ugoa]*)(([-+=][rwxXstugo]*)+)$/.exec(clause.trim()); if (!m) return null;
      const explicit = m[1] !== "", who = m[1], wm = { u: 0o700, g: 0o070, o: 0o007 };
      let classes = 0; for (const c of who) classes |= c === "a" ? 0o777 : wm[c];
      if (!explicit) classes = 0o777;
      const filter = explicit ? classes : classes & ~um;            // bits an operation may set or clear
      const hasU = !explicit || who.includes("u") || who.includes("a"), hasG = !explicit || who.includes("g") || who.includes("a"), hasO = !explicit || who.includes("o") || who.includes("a");
      for (const op of clause.trim().slice(m[1].length).match(/[-+=][rwxXstugo]*/g)) {
        const sign = op[0]; let bits = 0, special = 0; const before = n;
        for (const p of op.slice(1)) {
          if (p === "r") bits |= 0o444; else if (p === "w") bits |= 0o222; else if (p === "x") bits |= 0o111;
          else if (p === "X") { if (isDir || (before & 0o111)) bits |= 0o111; }
          else if (p === "s") special |= (hasU ? 0o4000 : 0) | (hasG ? 0o2000 : 0);
          else if (p === "t") special |= 0o1000;
          else if (p === "u" || p === "g" || p === "o") { const tri = (before >> { u: 6, g: 3, o: 0 }[p]) & 7; bits |= (tri << 6) | (tri << 3) | tri; }
        }
        const set = bits & filter;
        if (sign === "+") n |= set | special;
        else if (sign === "-") n &= ~(set | special);
        else {
          const clearSpecial = isDir ? (hasO ? 0o1000 : 0) : (hasU ? 0o4000 : 0) | (hasG ? 0o2000 : 0) | (hasO ? 0o1000 : 0);
          n = (n & ~(classes | clearSpecial)) | set | special;
        }
      }
    }
    return N(n);
  }
  // Reads whatever the visitor typed: 755, 0755, 4755, rwxr-xr-x, -rw-r--r--, u+x,g-w (needs a start mode).
  function read(text, start, isDir) {
    const t = String(text == null ? "" : text).trim();
    if (!t) return { empty: true };
    if (/^[0-7]{3,4}$/.test(t)) return { mode: parseInt(t, 8), how: "octal number" };
    if (/^[0-9]+$/.test(t)) return { error: "Octal digits are 0 to 7. \"" + t + "\" contains an 8 or a 9." };
    const sy = fromSymbolic(t); if (sy !== null) return { mode: sy, how: "letters, as shown by ls -l" };
    const ap = applySymbolic(t, start == null ? 0o644 : start, isDir); if (ap !== null) return { mode: ap, how: "chmod expression, applied to " + octal(start == null ? 0o644 : start), relative: true };
    return { error: "This is not a permission I can read. Try an octal number (755), letters (rwxr-xr-x) or a chmod expression (u+x,go-w)." };
  }
  const WHO = { u: "owner (user)", g: "group", o: "everyone else (other)" };
  function describe(n, isDir) {
    const m = fromNum(n), rows = [], notes = [];
    for (const c of ["u", "g", "o"]) {
      const p = m[c], parts = [];
      parts.push(p.r ? (isDir ? "list the contents" : "read") : null); parts.push(p.w ? (isDir ? "create, rename and delete entries" : "change") : null); parts.push(p.x ? (isDir ? "enter it (cd) and reach what is inside" : "run it as a program") : null);
      const got = parts.filter(Boolean); rows.push([WHO[c], (p.r ? "r" : "-") + (p.w ? "w" : "-") + (p.x ? "x" : "-"), got.length ? "can " + got.join(", ") : "no access"]);
    }
    if (m.setuid) rows.push(["setuid", "4000", isDir ? "has no effect on directories on Linux" : "the program runs with the OWNER'S rights, whoever starts it"]);
    if (m.setgid) rows.push(["setgid", "2000", isDir ? "new files inside inherit the directory's group" : "the program runs with the GROUP'S rights"]);
    if (m.sticky) rows.push(["sticky", "1000", isDir ? "only a file's owner (or the directory's owner or root) can delete or rename it: used on /tmp" : "no effect on files on modern systems"]);
    const num = N(n);
    if (m.o.w && !(m.sticky && isDir)) notes.push({ level: "bad", text: "Anyone on the system can change this" + (isDir ? " directory's contents" : " file") + ". Remove the other-write permission unless that is really intended." });
    if ((num & 0o777) === 0o777) notes.push({ level: "bad", text: "777 gives everyone full access. It is almost never the right fix: find which user needs access and give just that." });
    if (m.setuid && !isDir && (m.o.w || m.g.w)) notes.push({ level: "bad", text: "A setuid program that others can modify lets them run their own code with the owner's rights." });
    else if ((m.setuid || m.setgid) && !isDir) notes.push({ level: "warn", text: "setuid/setgid programs run with extra rights. Keep their number small and never use them on shell scripts (they are ignored on most systems and risky on others)." });
    if (m.o.r && !m.o.x && !m.u.x && !isDir && num === 0o644) notes.push({ level: "good", text: "644 is the usual mode for ordinary files: the owner can edit, everyone can read." });
    if (num === 0o755) notes.push({ level: "good", text: "755 is the usual mode for programs and directories: the owner can change, everyone can read and run." });
    if (num === 0o600) notes.push({ level: "good", text: "600 keeps the file private to its owner: right for SSH keys and secrets (ssh refuses a private key that others can read)." });
    if (num === 0o700) notes.push({ level: "good", text: "700 keeps it private to its owner, and lets them enter or run it." });
    if (isDir) notes.push({ level: "", text: "On a directory, chmod with a plain 3 or 4 digit number keeps the directory's existing setuid and setgid bits (it can set them but not clear them). To clear them use g-s, or write the number with five digits (00755)." });
    if (isDir && !m.u.x) notes.push({ level: "warn", text: "A directory without the x permission cannot be entered even by its owner." });
    if (isDir && m.u.r && !m.u.x) notes.push({ level: "", text: "Without x the names can be listed but nothing inside can be reached." });
    if (m.u.w && !m.u.r) notes.push({ level: "", text: "Write without read is unusual: the owner can overwrite the file but not read it." });
    if (m.o.w === false && m.o.r === false && m.o.x === false && (m.g.r || m.g.w || m.g.x)) { /* group only: fine */ }
    return { rows, notes };
  }
  // A umask removes bits from the default mode of new files (666) and new directories (777).
  function umask(text) {
    const t = String(text == null ? "" : text).trim(); if (!/^[0-7]{3,4}$/.test(t)) return { error: "A umask is 3 or 4 octal digits, like 022 or 077." };
    const u = parseInt(t, 8) & 0o777;
    return { umask: u.toString(8).padStart(3, "0"), file: (0o666 & ~u).toString(8).padStart(3, "0"), dir: (0o777 & ~u).toString(8).padStart(3, "0") };
  }
  const api = { fromNum, toNum, symbolic, fromSymbolic, applySymbolic, read, describe, umask, octal };
  if (typeof window !== "undefined") window.ChmodCalc = api;
  if (typeof module !== "undefined") module.exports = api;
})();
