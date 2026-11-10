(window.DesktopApps = window.DesktopApps || {}).aggregator = (() => {

  /* ---------- output formats (pure; also used by the tests) ---------- */

  const FORMATS = [
    { id: "cidr",         label: "CIDR list",                          ext: "txt",  named: false },
    { id: "fortigate",    label: "FortiGate address objects + group",  ext: "conf", named: true },
    { id: "mikrotik",     label: "MikroTik address-list",              ext: "rsc",  named: true },
    { id: "cisco-prefix", label: "Cisco IOS prefix-list",              ext: "txt",  named: true },
    { id: "cisco-asa",    label: "Cisco ASA object-group",             ext: "txt",  named: true },
    { id: "juniper",      label: "Juniper prefix-list",                ext: "txt",  named: true },
    { id: "paloalto",     label: "Palo Alto address objects + group",  ext: "txt",  named: true },
    { id: "ipset",        label: "Linux ipset",                        ext: "sh",   named: true },
    { id: "nft",          label: "Linux nftables set",                 ext: "nft",  named: true },
  ];

  function cleanName(raw, max = 30) {
    return (String(raw).replace(/[^A-Za-z0-9_.-]/g, "_") || "AGGREGATED").slice(0, max);
  }

  function mask4(len) {
    const m = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0;
    return [m >>> 24, (m >>> 16) & 255, (m >>> 8) & 255, m & 255].join(".");
  }

  const chunks = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // data = { v4: ["10.0.0.0/8", ...], v6: [...] }
  function formatOutput(data, kind, rawName) {
    const v4 = data.v4 || [], v6 = data.v6 || [], out = [];
    const name = cleanName(rawName);
    const split = c => c.split("/");

    switch (kind) {
      case "cidr":
        return v4.concat(v6).join("\n");

      case "fortigate": {
        // address objects, then one address group per family containing all of them
        const group = (cmd, names) => {
          out.push(`config firewall ${cmd}`, `    edit "${name}"`);
          chunks(names, 50).forEach((c, i) => out.push(`        ${i === 0 ? "set" : "append"} member ${c.map(n => `"${n}"`).join(" ")}`));
          out.push("    next", "end");
        };
        if (v4.length) {
          const names = [];
          out.push("config firewall address");
          for (const c of v4) {
            const [ip, len] = split(c);
            const n = `${name}_${ip}_${len}`;
            names.push(n);
            out.push(`    edit "${n}"`, `        set subnet ${ip} ${mask4(+len)}`, "    next");
          }
          out.push("end");
          group("addrgrp", names);
        }
        if (v6.length) {
          const names = [];
          out.push("config firewall address6");
          for (const c of v6) {
            const [ip, len] = split(c);
            const n = `${name}_${ip.replace(/:/g, "_")}_${len}`;
            names.push(n);
            out.push(`    edit "${n}"`, `        set ip6 ${c}`, "    next");
          }
          out.push("end");
          group("addrgrp6", names);
        }
        return out.join("\n");
      }

      case "mikrotik":
        if (v4.length) {
          out.push("/ip firewall address-list");
          for (const c of v4) out.push(`add list=${name} address=${c}`);
        }
        if (v6.length) {
          out.push("/ipv6 firewall address-list");
          for (const c of v6) out.push(`add list=${name} address=${c}`);
        }
        return out.join("\n");

      case "cisco-prefix":
        v4.forEach((c, i) => out.push(`ip prefix-list ${name} seq ${(i + 1) * 5} permit ${c}`));
        v6.forEach((c, i) => out.push(`ipv6 prefix-list ${name} seq ${(i + 1) * 5} permit ${c}`));
        return out.join("\n");

      case "cisco-asa":
        if (v4.length || v6.length) {
          out.push(`object-group network ${name}`);
          for (const c of v4) { const [ip, len] = split(c); out.push(` network-object ${ip} ${mask4(+len)}`); }
          for (const c of v6) out.push(` network-object ${c}`);
        }
        return out.join("\n");

      case "juniper":
        for (const c of v4.concat(v6)) out.push(`set policy-options prefix-list ${name} ${c}`);
        return out.join("\n");

      case "paloalto": {
        // object names may not contain "/" or ":"
        const names = [];
        for (const c of v4.concat(v6)) {
          const [ip, len] = split(c);
          const n = `${name}_${ip.replace(/:/g, "_")}_${len}`;
          names.push(n);
          out.push(`set address ${n} ip-netmask ${c}`);
        }
        chunks(names, 50).forEach(c => out.push(`set address-group ${name} static [ ${c.join(" ")} ]`));
        return out.join("\n");
      }

      case "ipset": {
        // set names are limited to 31 characters; leave room for "_v6"
        const base = cleanName(rawName, 28);
        const emit = (setName, family, list) => {
          if (!list.length) return;
          out.push(`ipset create -exist ${setName} hash:net family ${family} maxelem ${Math.max(65536, list.length)}`);
          for (const c of list) out.push(`ipset add -exist ${setName} ${c}`);
        };
        emit(base, "inet", v4);
        emit(base + "_v6", "inet6", v6);
        return out.join("\n");
      }

      case "nft": {
        const emit = (setName, type, list) => {
          if (!list.length) return;
          out.push(`add set inet filter ${setName} { type ${type}; flags interval; }`);
          chunks(list, 100).forEach(c => out.push(`add element inet filter ${setName} { ${c.join(", ")} }`));
        };
        if (v4.length || v6.length) out.push("# nftables script. Load with: nft -f <file>. Change the table (inet filter) if yours is named differently.");
        emit(name, "ipv4_addr", v4);
        emit(name + "_v6", "ipv6_addr", v6);
        return out.join("\n");
      }
    }
    return "";
  }

  const formatInfo = id => FORMATS.find(f => f.id === id) || FORMATS[0];

  /* ---------- the window ---------- */

  function init(root, shell) {
    const $ = id => root.querySelector("#" + id);
    const PREVIEW_LINES = 5000;
    let data = null;       // last server response
    let fullText = "";     // complete formatted output (Copy / Download use this)
    let outLines = 0;
    let lineTimer = 0;
    let inflight = null;   // AbortController of the running request

    const fmt = n => n.toLocaleString();
    const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;
    const getFormat = () => $("format").value;
    FORMATS.forEach(f => {
      const o = document.createElement("option");
      o.value = f.id;
      o.textContent = f.label;
      $("format").append(o);
    });

    /* ---------- status bar ---------- */

    function setStatus(msg) { $("statusText").textContent = msg; }

    function setCounts(found, out, skipped) {
      $("sFound").textContent = fmt(found);
      $("sOut").textContent = fmt(out);
      $("sSkipped").textContent = fmt(skipped);
      $("sReduced").textContent = (found > 0 ? Math.max(0, Math.round((1 - out / found) * 100)) : 0) + "%";
    }

    function render() {
      const kind = getFormat();
      $("nameWrap").hidden = !formatInfo(kind).named;
      if (!data) return;
      fullText = formatOutput(data, kind, $("name").value);
      const has = fullText.length > 0;
      const lines = has ? fullText.split("\n") : [];
      outLines = lines.length;
      let shown = fullText;
      if (lines.length > PREVIEW_LINES) {
        shown = lines.slice(0, PREVIEW_LINES).join("\n")
              + `\n\n# ... preview: first ${fmt(PREVIEW_LINES)} of ${fmt(lines.length)} lines. Copy and Download contain everything.`;
        $("outNote").textContent = "Preview only. Copy has all lines.";
      } else {
        $("outNote").textContent = "";
      }
      $("output").value = shown;
      $("outMeta").textContent = plural(lines.length, "line", "lines");
      $("copy").disabled = !has;
      $("download").disabled = !has;
    }

    function showSkipped(d) {
      const box = $("skipped");
      if (!d.invalid) { box.hidden = true; return; }
      $("skippedCount").textContent = `${fmt(d.invalid)} skipped:`;
      $("skippedList").textContent = d.invalidSamples.join(", ") + (d.invalid > d.invalidSamples.length ? ", ..." : "");
      box.hidden = false;
    }

    /* ---------- running an aggregation ---------- */

    async function run() {
      const file = $("file").files[0];
      const body = file || $("input").value;
      if (!file && !body.trim()) {
        shell.alert("Nothing to aggregate. Paste a list or load a file first.");
        return;
      }
      if (inflight) return;
      inflight = new AbortController();
      $("go").disabled = true;
      setStatus("Working...");
      try {
        const r = await fetch("/api/aggregate", { method: "POST", body, signal: inflight.signal });
        if (!r.ok) throw new Error((await r.text()).trim() || r.statusText);
        data = await r.json();
        data.v4 = data.v4 || [];
        data.v6 = data.v6 || [];
        const found = data.found4 + data.found6;
        const out = data.v4.length + data.v6.length;
        setCounts(found, out, data.invalid);
        showSkipped(data);
        if (found === 0) {
          data = null; fullText = ""; outLines = 0;
          $("output").value = "";
          $("outMeta").textContent = "0 lines";
          $("outNote").textContent = "";
          $("copy").disabled = $("download").disabled = true;
          setStatus("No IP addresses found.");
          shell.alert("No IP addresses found. Check the input and try again.");
        } else {
          render();
          setStatus(`Done. ${plural(found, "entry", "entries")} merged into ${plural(out, "prefix", "prefixes")}.`);
        }
      } catch (e) {
        if (e.name === "AbortError") return; // window was closed
        setStatus("Failed.");
        shell.alert(String(e.message || e));
      } finally {
        inflight = null;
        $("go").disabled = false;
      }
    }

    /* ---------- input side ---------- */

    function countLines() {
      const v = $("input").value;
      if (!v) return 0;
      let n = 1, i = -1;
      while ((i = v.indexOf("\n", i + 1)) !== -1) n++;
      return n;
    }
    function updateInputMeta() {
      if ($("file").files[0]) return;
      $("inputMeta").textContent = plural(countLines(), "line", "lines");
    }
    function markDirty() {
      if (data) setStatus("Input changed. Press Aggregate to update.");
    }

    function setFile(f) {
      const meta = $("inputMeta");
      meta.textContent = "";
      if (f) {
        const name = document.createElement("span");
        name.className = "fname";
        name.textContent = f.name;
        name.title = f.name;
        const size = document.createElement("span");
        size.textContent = `${fmt(f.size)} bytes`;
        const back = document.createElement("button");
        back.type = "button";
        back.className = "xp-btn small";
        back.textContent = "Use text box";
        back.onclick = () => { $("file").value = ""; setFile(null); markDirty(); };
        meta.append(name, size, back);
      } else {
        updateInputMeta();
      }
      $("input").disabled = !!f;
    }

    $("go").onclick = run;
    $("pick").onclick = () => $("file").click();
    $("file").onchange = () => { setFile($("file").files[0] || null); markDirty(); };
    $("input").addEventListener("input", () => {
      markDirty();
      clearTimeout(lineTimer);
      lineTimer = setTimeout(updateInputMeta, 200);
    });
    $("input").addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run(); });

    $("clear").onclick = () => {
      $("file").value = ""; setFile(null);
      $("input").value = ""; $("output").value = "";
      data = null; fullText = ""; outLines = 0;
      $("skipped").hidden = true;
      $("outMeta").textContent = "0 lines";
      $("outNote").textContent = "";
      $("copy").disabled = $("download").disabled = true;
      setCounts(0, 0, 0);
      updateInputMeta();
      setStatus("Cleared");
    };

    /* ---------- output side ---------- */

    $("format").addEventListener("change", render);
    $("name").addEventListener("input", render);

    $("copy").onclick = async () => {
      const done = () => setStatus(`Copied ${plural(outLines, "line", "lines")} to clipboard`);
      const blocked = () => setStatus("Copy blocked by the browser. Select the output and press Ctrl+C.");
      try {
        await navigator.clipboard.writeText(fullText);
        done();
      } catch {
        try {
          const o = $("output");
          o.value = fullText; o.select();
          document.execCommand("copy") ? done() : blocked();
          render();
        } catch { blocked(); }
      }
    };

    $("download").onclick = () => {
      const ext = formatInfo(getFormat()).ext;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([fullText + "\n"], { type: "text/plain" }));
      a.download = `ip-aggregated.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setStatus(`Downloaded ip-aggregated.${ext}`);
    };

    render();
    updateInputMeta();

    return {
      destroy() {
        clearTimeout(lineTimer);
        if (inflight) inflight.abort();
      },
    };
  }

  return { init, formatOutput, FORMATS };
})();
