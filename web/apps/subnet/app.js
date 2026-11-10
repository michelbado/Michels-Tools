/* Subnet Calculator. Everything runs in the browser; nothing is sent to the server. */
(window.DesktopApps = window.DesktopApps || {}).subnet = (() => {
  const LIST_LIMIT = 1024;   // list every usable address up to this many

  /* ---------- pure helpers (also used by the tests) ---------- */

  const { ipToInt, intToIp, maskInt, maskToPrefix, parseInput } = window.IPv4;

  const TYPES = [
    // [network, prefix, label]  (first match wins)
    ["0.0.0.0", 8, "This network (0.0.0.0/8)"],
    ["10.0.0.0", 8, "Private network (RFC 1918, 10.0.0.0/8)"],
    ["100.64.0.0", 10, "Shared address space for carrier-grade NAT (RFC 6598)"],
    ["127.0.0.0", 8, "Loopback (127.0.0.0/8)"],
    ["169.254.0.0", 16, "Link-local, self-assigned (169.254.0.0/16)"],
    ["172.16.0.0", 12, "Private network (RFC 1918, 172.16.0.0/12)"],
    ["192.0.0.0", 24, "IETF protocol assignments (192.0.0.0/24)"],
    ["192.0.2.0", 24, "Documentation (TEST-NET-1)"],
    ["192.168.0.0", 16, "Private network (RFC 1918, 192.168.0.0/16)"],
    ["198.18.0.0", 15, "Network benchmarking (198.18.0.0/15)"],
    ["198.51.100.0", 24, "Documentation (TEST-NET-2)"],
    ["203.0.113.0", 24, "Documentation (TEST-NET-3)"],
    ["224.0.0.0", 4, "Multicast (224.0.0.0/4)"],
    ["255.255.255.255", 32, "Limited broadcast"],
    ["240.0.0.0", 4, "Reserved for future use (240.0.0.0/4)"],
  ];
  function addressType(ip) {
    for (const [net, p, label] of TYPES) {
      const m = maskInt(p);
      if (((ip & m) >>> 0) === ((ipToInt(net) & m) >>> 0)) return label;
    }
    return "Public";
  }

  // everything for one IP + prefix
  function calc(ip, prefix) {
    return Object.assign(window.IPv4.subnetInfo(ip, prefix), { type: addressType(ip) });
  }

  function listUsable(r) {
    if (r.hosts > LIST_LIMIT) return null;
    const out = [];
    for (let i = r.firstInt; i <= r.lastInt; i++) out.push(intToIp(i));
    return out;
  }

  /* ---------- the window ---------- */

  function init(root) {
    const $ = id => root.querySelector("#subnet-" + id);
    const fmt = n => n.toLocaleString();
    const sel = $("mask");

    for (let p = 0; p <= 32; p++) {
      const o = document.createElement("option");
      o.value = String(p);
      o.textContent = `/${p} - ${intToIp(maskInt(p))}`;
      sel.append(o);
    }
    sel.value = "24";

    let list = [];

    function clearResults(status) {
      ["net", "bc", "maskout", "wild", "first", "last", "total", "hosts", "type"].forEach(id => { $(id).textContent = "-"; });
      $("list").value = "";
      $("listmeta").textContent = "0 addresses";
      $("copylist").disabled = true;
      list = [];
      root.querySelectorAll("[data-copy]").forEach(b => { b.disabled = true; });
      $("status").textContent = status;
    }

    function update() {
      const field = $("ip");
      const text = field.value;
      if (!text.trim()) { field.classList.remove("invalid"); clearResults("Enter an IPv4 address."); return; }
      const parsed = parseInput(text);
      if (!parsed) { field.classList.add("invalid"); clearResults("That is not a valid IPv4 address or mask."); return; }
      field.classList.remove("invalid");

      if (parsed.prefix !== null) sel.value = String(parsed.prefix);
      const prefix = parsed.prefix !== null ? parsed.prefix : Number(sel.value);
      const r = calc(parsed.ip, prefix);

      $("net").textContent = r.network;
      $("bc").textContent = r.broadcast;
      $("maskout").textContent = `${r.mask}  (/${r.prefix})`;
      $("wild").textContent = r.wildcard;
      $("first").textContent = r.first;
      $("last").textContent = r.last;
      $("total").textContent = fmt(r.total);
      $("hosts").textContent = fmt(r.hosts);
      $("type").textContent = r.type;
      $("prefix").textContent = "/" + r.prefix;
      root.querySelectorAll("[data-copy]").forEach(b => { b.disabled = $(b.dataset.copy.replace("subnet-", "")).textContent === "n/a"; });

      list = listUsable(r);
      if (list) {
        $("list").value = list.join("\n");
        $("listmeta").textContent = `${fmt(list.length)} address${list.length === 1 ? "" : "es"}`;
        $("copylist").disabled = false;
      } else {
        $("list").value = `Too many to list (${fmt(r.hosts)}).\nListing is available for up to ${fmt(LIST_LIMIT)} usable addresses.\n\nRange:\n${r.first}\n${r.last}`;
        $("listmeta").textContent = `${fmt(r.hosts)} addresses (range shown)`;
        $("copylist").disabled = true;
      }
      $("status").textContent = r.note || `${r.network}/${r.prefix} - ${fmt(r.hosts)} usable host${r.hosts === 1 ? "" : "s"}.`;
    }

    async function copy(text, what) {
      try {
        await navigator.clipboard.writeText(text);
        $("status").textContent = `Copied ${what}.`;
      } catch {
        const t = document.createElement("textarea");
        t.value = text;
        t.style.position = "fixed";
        t.style.opacity = "0";
        document.body.append(t);
        t.select();
        let ok = false;
        try { ok = document.execCommand("copy"); } catch { /* ignore */ }
        t.remove();
        $("status").textContent = ok ? `Copied ${what}.` : "Copy blocked by the browser. Select the text and press Ctrl+C.";
      }
    }

    $("ip").addEventListener("input", update);
    sel.addEventListener("change", () => {
      // an inline mask typed in the IP box would override the list, so drop it
      const parsed = parseInput($("ip").value);
      if (parsed && parsed.prefix !== null) $("ip").value = parsed.ipText;
      update();
    });
    root.querySelectorAll("[data-copy]").forEach(b => {
      b.addEventListener("click", () => {
        const id = b.dataset.copy.replace("subnet-", "");
        copy($(id).textContent.split("  ")[0], b.closest(".item").querySelector(".k").textContent.toLowerCase());
      });
    });
    $("copylist").addEventListener("click", () => copy(list.join("\n"), `${fmt(list.length)} addresses`));

    update();
    return { destroy() {} };
  }

  return { init, ipToInt, intToIp, maskToPrefix, parseInput, calc, listUsable, addressType };
})();
