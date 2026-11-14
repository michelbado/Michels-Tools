/* SSH tunnel builder: port forwards (-L, -R), a SOCKS proxy (-D), jump hosts, and the same settings as a ~/.ssh/config block, an autossh line and a systemd unit.
   Pure text building; nothing is run and nothing is connected. Needs lib/cmdkit.js for quoting (looked up when used). Exports window.SshTunnel. */
(() => {
  "use strict";
  const K = () => (typeof window !== "undefined" ? window : globalThis).CmdKit;
  const hostOk = h => { const K_ = K(); return K_.isHost(h) || K_.isIPv4(h) || K_.isIPv6(h); };
  const hostFmt = h => (h.includes(":") && !h.startsWith("[") ? "[" + h + "]" : h);
  const bindFmt = b => (b.includes(":") ? "[" + b + "]" : b);

  // one forward per line, plain words: "8080 db.internal 5432" or "8080 db.internal:5432" or "127.0.0.1:8080 -> db.internal:5432"
  function parseForward(line, kind) {
    const s = line.replace(/\s*(->|=>|to)\s*/gi, " ").trim(); const err = m => ({ error: "\"" + line + "\": " + m });
    const parts = s.split(/\s+/);
    let listen, host, port;
    const split = x => { const m = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(x); return m ? { host: m[1] || m[2], port: m[3] } : null; };
    if (parts.length === 3 && /^\d+$/.test(parts[2])) { listen = parts[0]; host = parts[1]; port = parts[2]; }
    else if (parts.length === 2) { listen = parts[0]; const t = split(parts[1]); if (!t) return err("write it as <listen port> <host> <port>, for example 8080 db.internal 5432."); host = t.host; port = t.port; }
    else if (parts.length === 1) { const m = /^(\d+):(.+):(\d+)$/.exec(parts[0]); if (!m) return err("write it as <listen port> <host> <port>, for example 8080 db.internal 5432."); listen = m[1]; host = m[2]; port = m[3]; }
    else return err("write it as <listen port> <host> <port>, for example 8080 db.internal 5432.");
    let bind = "";
    const lm = /^(?:\[([^\]]+)\]|([^:]+)):(\d+)$/.exec(listen); if (lm) { bind = lm[1] || lm[2]; listen = lm[3]; }
    if (!K().isPort(listen)) return err("the listening port must be 1 to 65535.");
    if (!K().isPort(port)) return err("the target port must be 1 to 65535.");
    host = host.replace(/^\[|\]$/g, ""); if (!hostOk(host)) return err("\"" + host + "\" is not a host name or address.");
    if (bind && bind !== "*" && bind !== "localhost" && !hostOk(bind)) return err("\"" + bind + "\" is not an address to listen on.");
    return { listen, bind, host, port, kind };
  }
  const fwdText = f => (f.bind ? bindFmt(f.bind) + ":" : "") + f.listen + ":" + hostFmt(f.host) + ":" + f.port;

  function build(v) {
    const notes = [], outputs = [], explain = [], k = K();
    const host = (v.host || "").trim();
    if (!host) return { outputs: [], notes: [{ level: "info", text: "Type the SSH server you connect to (the gateway the tunnel goes through)." }] };
    if (!hostOk(host)) return { outputs: [], notes: [{ level: "bad", text: "\"" + host + "\" is not a host name or IP address." }] };
    const user = v.user.trim(), port = v.port.trim(), key = v.key.trim(), jump = v.jump.trim();
    if (user && !k.isUser(user)) notes.push({ level: "bad", text: "The user name has characters Linux user names do not use." });
    if (port && !k.isPort(port)) notes.push({ level: "bad", text: "The SSH port must be 1 to 65535." });
    const locals = [], remotes = []; let bad = false;
    for (const l of k.lines(v.locals)) { const f = parseForward(l, "L"); if (f.error) { notes.push({ level: "bad", text: f.error }); bad = true; } else locals.push(f); }
    for (const l of k.lines(v.remotes)) { const f = parseForward(l, "R"); if (f.error) { notes.push({ level: "bad", text: f.error }); bad = true; } else remotes.push(f); }
    const socks = v.socks.trim(); if (socks && !k.isPort(socks)) { notes.push({ level: "bad", text: "The SOCKS port must be 1 to 65535." }); bad = true; }
    const jumps = []; if (jump) for (const j of jump.split(",").map(x => x.trim()).filter(Boolean)) { if (!/^([A-Za-z_][A-Za-z0-9_.-]*@)?[^\s@:]+(:\d+)?$|^([A-Za-z_][A-Za-z0-9_.-]*@)?\[[0-9a-f:]+\](:\d+)?$/i.test(j)) { notes.push({ level: "bad", text: "Jump host \"" + j + "\" must look like user@host or host:port." }); bad = true; } else jumps.push(j); }
    if (key && /[\r\n]/.test(key)) { notes.push({ level: "bad", text: "The key path must be on one line." }); bad = true; }
    if (!locals.length && !remotes.length && !socks && v.mode !== "shell") notes.push({ level: "info", text: "Add at least one forward or a SOCKS port." });
    if (bad) return { outputs: [], notes };
    // ---- the command
    const args = ["ssh"];
    const tgt = (user ? user + "@" : "") + host;
    const add = (flag, val, text) => { args.push(flag); if (val !== undefined && val !== null) args.push(val); explain.push([val !== undefined && val !== null ? flag + " " + val : flag, text]); };
    if (v.mode !== "shell") { add("-N", null, "no remote command: only the tunnel, no login shell"); }
    if (v.background && v.mode !== "shell") add("-f", null, "go to the background after the login (ask for the password first, then detach)");
    if (v.mode === "tunnel") add("-T", null, "do not ask for a terminal");
    for (const f of locals) add("-L", fwdText(f), "connections to " + (f.bind ? f.bind : "localhost") + " port " + f.listen + " on THIS machine are carried through the server to " + f.host + " port " + f.port + (f.bind === "*" || f.bind === "0.0.0.0" ? " (listens on all interfaces: anyone who can reach this machine can use it)" : ""));
    for (const f of remotes) add("-R", fwdText(f), "connections to port " + f.listen + " on the SERVER" + (f.bind ? " (address " + f.bind + ")" : "") + " are carried back to " + f.host + " port " + f.port + " from this machine");
    if (socks) add("-D", socks, "a SOCKS5 proxy on localhost port " + socks + ": point a browser or tool at it and its traffic leaves from the server");
    if (jumps.length) add("-J", jumps.join(","), "go through " + (jumps.length > 1 ? "these jump hosts in order" : "this jump host") + " first (ProxyJump)");
    if (port && k.isPort(port)) add("-p", port, "the server's SSH port");
    if (key) add("-i", key, "use this private key file");
    if (key && v.idonly) add("-o", "IdentitiesOnly=yes", "offer only that key, not every key in the agent");
    if (v.keepalive) { add("-o", "ServerAliveInterval=30", "send a keep-alive every 30 seconds so firewalls do not drop an idle tunnel"); add("-o", "ServerAliveCountMax=3", "give up after 3 unanswered keep-alives (about 90 seconds)"); }
    if (v.exitfail) add("-o", "ExitOnForwardFailure=yes", "end the connection when a forward cannot be set up, instead of carrying on without it");
    if (v.compress) add("-C", null, "compress the traffic (helps on slow links with text, hurts on fast ones)");
    if (v.strict === "new") add("-o", "StrictHostKeyChecking=accept-new", "accept the key of a server seen for the first time, refuse a changed key");
    args.push(tgt);
    const quoted = args.map((a, i) => (a === "ssh" ? a : /^[-@A-Za-z0-9_.:,/=\[\]*]+$/.test(a) ? a : k.shq(a)));
    // forwards with "*" bind: shq not needed beyond; a * is quoted by the regex test above only if outside the set; keep it quoted for the shell
    const cmd = quoted.map(a => (/\*/.test(a) && !a.startsWith("'") ? "'" + a + "'" : a)).join(" ");
    outputs.push({ title: "Command", text: cmd + "\n" });
    // ---- notes
    for (const f of locals) {
      if (!f.bind && Number(f.listen) < 1024) notes.push({ level: "info", text: "Listening on port " + f.listen + " (below 1024) needs root on this machine." });
      if (f.bind === "*" || f.bind === "0.0.0.0") notes.push({ level: "warn", text: "Forward " + f.listen + " listens on every interface of this machine, so other machines can use the tunnel. Leave the address out to listen on localhost only." });
    }
    for (const f of remotes) {
      if (!f.bind || f.bind === "localhost" || f.bind === "127.0.0.1") notes.push({ level: "info", text: "Remote forward " + f.listen + " listens on the server's loopback only. To let other machines reach it the server needs GatewayPorts yes (or clientspecified) in sshd_config, and you must write the listening address." });
      else notes.push({ level: "warn", text: "Remote forward " + f.listen + " asks the server to listen on " + f.bind + ". sshd ignores this unless GatewayPorts is set to yes or clientspecified." });
      if (Number(f.listen) < 1024) notes.push({ level: "info", text: "A remote port below 1024 needs the server user to be root." });
    }
    if (socks) notes.push({ level: "info", text: "SOCKS5 on localhost:" + socks + ". Use socks5h:// in curl (curl --socks5-hostname 127.0.0.1:" + socks + " URL) so DNS names are looked up through the tunnel too." });
    if (v.background && v.mode === "shell") notes.push({ level: "warn", text: "-f was left out: ssh refuses it (Cannot fork into background without a command) when it is not a tunnel-only connection. Choose \"Tunnel only\" to go to the background." });
    if (!key && v.idonly) notes.push({ level: "info", text: "IdentitiesOnly has no effect without a key file." });
    if (jumps.length) notes.push({ level: "info", text: "The jump host only passes your encrypted connection on; the keys and login for the last server are checked end to end. -J needs OpenSSH 7.3 or newer." });
    if (v.mode !== "shell" && (locals.length || remotes.length || socks)) notes.push({ level: "info", text: "Leave this window open (or use -f, or autossh / the systemd unit below): the tunnel ends when the command ends." });
    // ---- config block
    const alias = (v.alias || "").trim() || "tunnel";
    if (!/^[A-Za-z0-9_.-]+$/.test(alias)) notes.push({ level: "bad", text: "The short name for the config block may use letters, digits, . _ - only." });
    else {
      const c = ["Host " + alias, "    HostName " + host];
      if (user) c.push("    User " + user); if (port && k.isPort(port)) c.push("    Port " + port);
      if (key) { c.push("    IdentityFile " + key); if (v.idonly) c.push("    IdentitiesOnly yes"); }
      if (jumps.length) c.push("    ProxyJump " + jumps.join(","));
      for (const f of locals) c.push("    LocalForward " + (f.bind ? bindFmt(f.bind) + ":" : "") + f.listen + " " + hostFmt(f.host) + ":" + f.port);
      for (const f of remotes) c.push("    RemoteForward " + (f.bind ? bindFmt(f.bind) + ":" : "") + f.listen + " " + hostFmt(f.host) + ":" + f.port);
      if (socks) c.push("    DynamicForward " + socks);
      if (v.keepalive) c.push("    ServerAliveInterval 30", "    ServerAliveCountMax 3");
      if (v.exitfail) c.push("    ExitOnForwardFailure yes");
      if (v.compress) c.push("    Compression yes");
      if (v.strict === "new") c.push("    StrictHostKeyChecking accept-new");
      outputs.push({ title: "~/.ssh/config", text: c.join("\n") + "\n", hint: "then connect with: ssh " + (v.mode === "shell" ? "" : "-N ") + alias, file: "ssh_config_" + alias });
      if (v.mode !== "shell") {
        const a = ["autossh -M 0 -N " + (key ? "" : "") + alias].join("");
        outputs.push({ title: "Keep it running (autossh)", text: "# autossh restarts the tunnel when it drops; -M 0 uses ssh's own keep-alives (set in the config block above)\nautossh -M 0 -N " + alias + "\n" });
        if (alias && /^[A-Za-z0-9_.-]+$/.test(alias)) {
          const unit = ["[Unit]", "Description=SSH tunnel " + alias, "After=network-online.target", "Wants=network-online.target", "", "[Service]", "User=" + (user ? "tunnel" : "tunnel"), "ExecStart=/usr/bin/ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes " + alias, "Restart=always", "RestartSec=10", "", "[Install]", "WantedBy=multi-user.target"].join("\n") + "\n";
          outputs.push({ title: "Keep it running (systemd: ssh-tunnel-" + alias + ".service)", text: unit, file: "ssh-tunnel-" + alias + ".service", hint: "The service user needs the ~/.ssh/config block above, the key, and the server's key in its known_hosts." });
        }
      }
    }
    return { outputs, notes, explain };
  }
  const T = (key, label, value, extra) => Object.assign({ key, label, value, type: "text" }, extra || {});
  const FIELDS = [
    T("host", "SSH server (the gateway)", "gw.example.net", { group: "Where you connect", placeholder: "gw.example.net or 192.0.2.10" }),
    T("user", "User name (optional)", "", { group: "Where you connect" }),
    T("port", "SSH port (optional, default 22)", "", { group: "Where you connect" }),
    T("key", "Private key file (optional)", "", { group: "Where you connect", placeholder: "~/.ssh/id_ed25519" }),
    { group: "Where you connect", key: "idonly", label: "Offer only that key (IdentitiesOnly)", type: "check", value: false, showIf: v => !!v.key.trim() },
    T("jump", "Jump host(s) first (optional, comma separated)", "", { group: "Where you connect", placeholder: "admin@bastion.example.net" }),
    { group: "What to carry", key: "mode", label: "Mode", type: "select", value: "tunnel", options: [["tunnel", "Tunnel only (no shell)"], ["shell", "Open a shell as well"]] },
    { group: "What to carry", key: "locals", label: "Local forwards: reach a remote service from this machine", type: "area", rows: 3, value: "8080 intranet.internal 80", hint: "One per line: <port on this machine> <host as the server sees it> <port>. Add an address to the port to listen elsewhere: 0.0.0.0:8080 …" },
    { group: "What to carry", key: "remotes", label: "Remote forwards: make a service here reachable from the server", type: "area", rows: 2, value: "", hint: "One per line: <port on the server> <host as seen from here> <port>, for example 9022 localhost 22." },
    T("socks", "SOCKS proxy on this machine, port (optional)", "", { group: "What to carry", placeholder: "1080" }),
    { group: "Behaviour", key: "background", label: "Go to the background after login (-f)", type: "check", value: false },
    { group: "Behaviour", key: "keepalive", label: "Keep-alives so idle tunnels are not dropped", type: "check", value: true },
    { group: "Behaviour", key: "exitfail", label: "Stop if a forward cannot be set up", type: "check", value: true },
    { group: "Behaviour", key: "compress", label: "Compression", type: "check", value: false },
    { group: "Behaviour", key: "strict", label: "Server keys seen for the first time", type: "select", value: "ask", options: [["ask", "Ask me (default)"], ["new", "Accept new ones, refuse changed ones (accept-new)"]] },
    T("alias", "Short name for the config block", "tunnel", { group: "Behaviour" }),
  ];
  const EXAMPLES = [
    { name: "Reach an internal web page", values: { host: "gw.example.net", locals: "8080 intranet.internal 80", remotes: "", socks: "" } },
    { name: "Database through a jump host", values: { host: "db1.internal", jump: "admin@bastion.example.net", locals: "5432 127.0.0.1 5432", remotes: "", socks: "" } },
    { name: "SOCKS proxy", values: { host: "gw.example.net", locals: "", remotes: "", socks: "1080" } },
    { name: "Reverse tunnel to a device behind NAT", values: { host: "vps.example.net", locals: "", remotes: "2222 localhost 22", socks: "", alias: "reverse" } },
  ];
  const builder = { fields: FIELDS, build, examples: EXAMPLES };
  const api = { build, builder, FIELDS, EXAMPLES, parseForward };
  if (typeof window !== "undefined") window.SshTunnel = api;
  if (typeof module !== "undefined") module.exports = api;
})();
