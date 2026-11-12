/* Shared screen part of the certificate tools: the box where a package is dropped, chosen or pasted, the private-key notice, the password prompts for locked files
   and the "wipe everything" button. Files are read in the browser and kept in memory only: never stored, never sent. Everything reaches the page through textContent.
   CertUI.panel(container, { id, onChange }) -> { items(), notes(), wipe(), hasKeys() }   (needs lib/certkit.js, keyfmt.js, pkcs12.js, derkit.js). Exports window.CertUI. */
(() => {
  "use strict";
  const g = typeof window !== "undefined" ? window : globalThis;
  const MAX_FILES = 40, MAX_BYTES = 5 << 20;
  const NOTICE = "This page does not collect or send what you add: files and text are processed inside this browser tab only and nothing is uploaded to the server. " +
    "Even so, it is generally not advised to ever put a private key into a web page. For real production keys, prefer a tool on your own computer such as openssl " +
    "(the Certificate tools show the matching openssl command for every step). Continue only at your own risk.";
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const kb = n => n < 1024 ? n + " bytes" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB";

  // does a file hold a private key or a PFX (which usually holds one)?
  function sensitive(bytes) {
    const D = g.DerKit, KF = g.KeyFmt, CK = g.CertKit;
    let head = ""; try { head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 100000)); } catch { /* binary */ }
    if (/PRIVATE KEY-----/.test(head)) return true;
    try { if (KF.sniff(bytes)) return true; if (CK.shape(bytes) === "pfx") return true; } catch { /* not DER */ }
    void D;
    return false;
  }

  function panel(container, opts) {
    const id = opts.id, onChange = opts.onChange || (() => {});
    const files = [];          // { name, bytes }
    let acked = false, items = [], notes = [], busy = 0, seq = 0;
    const passwords = new Map();   // file name -> password typed for it (memory only)
    container.textContent = "";
    const q = s => container.querySelector(s);

    /* the notice with its checkbox */
    const box = el("div", "ct-notice");
    const nh = el("strong", null, "About private keys and PFX files"); box.append(nh, el("p", null, NOTICE));
    const lab = el("label", "ct-ack"), cb = el("input"); cb.type = "checkbox"; cb.id = id + "-ack";
    lab.append(cb, document.createTextNode(" I understand, and I want to use private keys and PFX files here")); box.append(lab);

    /* the drop zone */
    const drop = el("div", "ct-drop"); drop.tabIndex = 0; drop.setAttribute("role", "button");
    drop.setAttribute("aria-label", "Add files: drop them here or press Enter to choose");
    drop.append(el("div", "ct-drop-big", "Drop your files here, or choose them"), el("div", "tk-muted", "Certificates, chains and CA bundles (.crt .cer .pem .der .p7b), keys (.key .pem), requests (.csr), PFX files (.pfx .p12). Several files at once is fine; a mix is the point."));
    const pick = el("button", "xp-btn"); pick.type = "button"; pick.textContent = "Choose files...";
    const input = el("input"); input.type = "file"; input.multiple = true; input.hidden = true; input.id = id + "-files";
    drop.append(pick, input);

    /* paste */
    const paste = el("details", "ct-paste"); const sum = el("summary", null, "Or paste text (PEM)");
    const ta = el("textarea", "xp-text tk-in"); ta.id = id + "-paste"; ta.rows = 6; ta.spellcheck = false; ta.autocomplete = "off"; ta.setAttribute("autocapitalize", "off");
    ta.placeholder = "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----";
    const addTxt = el("button", "xp-btn"); addTxt.type = "button"; addTxt.textContent = "Add this text";
    paste.append(sum, ta, el("div", "tk-row"), addTxt);

    const list = el("div", "ct-files"); list.id = id + "-list"; list.setAttribute("aria-live", "polite");
    const bar = el("div", "tk-row"); const wipeBtn = el("button", "xp-btn"); wipeBtn.type = "button"; wipeBtn.textContent = "Wipe everything"; wipeBtn.title = "Remove all files, text and passwords from this page"; bar.append(wipeBtn);
    container.append(box, drop, paste, list, bar);

    /* reading */
    async function addFiles(fl) {
      for (const f of fl) {
        if (files.length >= MAX_FILES) { notes.push({ level: "warn", keep: true, text: "At most " + MAX_FILES + " files are read." }); break; }
        if (f.size > MAX_BYTES) { notes.push({ level: "bad", keep: true, text: f.name + " is too large for a certificate file (" + kb(f.size) + ")." }); continue; }
        files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
      refresh();
    }
    function addText() {
      const t = ta.value; if (!t.trim()) return;
      let n = 1; const base = "pasted"; while (files.some(f => f.name === base + (n > 1 ? " " + n : "") + ".txt")) n++;
      files.push({ name: base + (n > 1 ? " " + n : "") + ".txt", bytes: new TextEncoder().encode(t) }); ta.value = ""; refresh();
    }
    const held = () => files.filter(f => !acked && sensitive(f.bytes));
    async function refresh() {
      const my = ++seq; busy++;
      const usable = files.filter(f => acked || !sensitive(f.bytes));
      let res = { items: [], notes: [] };
      try {
        res = await g.CertKit.classify(usable.map(f => ({ name: f.name, bytes: f.bytes })));
        // passwords typed before apply again after any change
        for (const it of res.items.filter(i => i.kind === "locked")) {
          const pw = passwords.get(it.from); if (pw == null) continue;
          const r = await g.CertKit.unlock(it, pw);
          if (r.ok) { res.items = res.items.filter(x => x !== it).concat(r.items); res.notes.push(...r.notes); }
        }
      } catch (e) { res.notes.push({ level: "bad", text: "Something in these files could not be read." }); }
      busy--;
      if (my !== seq) return;
      items = res.items; notes = notes.filter(n => n.keep).concat(res.notes);
      render(); onChange();
    }
    function render() {
      list.textContent = "";
      const heldNow = held();
      if (!files.length) { list.append(el("p", "tk-muted", "Nothing added yet.")); return; }
      const tb = el("table", "tk-list"); const hd = el("tr"); for (const h of ["File", "What it is", ""]) hd.append(el("th", null, h)); tb.append(hd);
      for (const f of files) {
        const tr = el("tr"), its = items.filter(i => i.from === f.name || (i.from || "").startsWith(f.name + " ")), isHeld = heldNow.includes(f);
        tr.append(el("td", "tk-mono", f.name + "  (" + kb(f.bytes.length) + ")"));
        const td = el("td");
        if (isHeld) td.textContent = "Held back: tick \"I understand\" above to let this page read keys and PFX files.";
        else if (!its.length) td.textContent = "Not recognised (see the notes below).";
        else for (const it of its) {
          const d = g.CertKit.describe(it), row = el("div"); row.textContent = d.what + (d.detail ? ": " + d.detail : ""); td.append(row);
          if (it.kind === "locked") {
            const pw = el("input", "xp-field"); pw.type = "password"; pw.autocomplete = "off"; pw.placeholder = "password for " + f.name; pw.setAttribute("aria-label", "Password for " + f.name); pw.id = id + "-pw-" + files.indexOf(f);
            const go = el("button", "xp-btn small"); go.type = "button"; go.textContent = "Unlock";
            const msg = el("span", "tk-hint"); const doIt = async () => { const r = await g.CertKit.unlock(it, pw.value); if (r.ok) { passwords.set(it.from, pw.value); refresh(); } else { msg.textContent = r.wrong ? "That password is not right." : r.message; } };
            go.addEventListener("click", doIt); pw.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doIt(); } });
            const w = el("div", "ct-unlock"); w.append(pw, go, msg); td.append(w);
          }
        }
        tr.append(td);
        const act = el("td"), rm = el("button", "xp-btn small"); rm.type = "button"; rm.textContent = "Remove"; rm.setAttribute("aria-label", "Remove " + f.name);
        rm.addEventListener("click", () => { const i = files.indexOf(f); if (i >= 0) { files[i].bytes.fill(0); files.splice(i, 1); passwords.delete(f.name); } refresh(); }); act.append(rm); tr.append(act);
        tb.append(tr);
      }
      list.append(tb);
      for (const n of notes) { const p = el("div", "ct-note " + (n.level || ""), n.text); list.append(p); }
    }
    function wipe() {
      for (const f of files) f.bytes.fill(0);
      files.length = 0; passwords.clear(); items = []; notes = []; ta.value = ""; seq++; render(); onChange();
    }

    cb.addEventListener("change", () => { acked = cb.checked; refresh(); });
    pick.addEventListener("click", () => input.click());
    drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
    input.addEventListener("change", () => { addFiles([...input.files]); input.value = ""; });
    for (const ev of ["dragenter", "dragover"]) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); });
    for (const ev of ["dragleave", "drop"]) drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); });
    drop.addEventListener("drop", e => { if (e.dataTransfer && e.dataTransfer.files) addFiles([...e.dataTransfer.files]); });
    addTxt.addEventListener("click", addText);
    ta.addEventListener("paste", () => setTimeout(() => { if (/-----END [A-Z ]+-----\s*$/.test(ta.value)) addText(); }, 0));       // a complete pasted block is added by itself
    wipeBtn.addEventListener("click", wipe);
    render();
    return {
      items: () => items, notes: () => notes, busy: () => busy > 0, wipe, acked: () => acked, files: () => files.length,
      hasKeys: () => items.some(i => i.kind === "key"),
      destroy() { for (const f of files) f.bytes.fill(0); files.length = 0; passwords.clear(); items = []; },
    };
  }

  g.CertUI = { panel, NOTICE, sensitive };
  if (typeof module !== "undefined") module.exports = g.CertUI;
})();
