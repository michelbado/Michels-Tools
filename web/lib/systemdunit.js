/* systemd unit builder: a service file, an optional timer, and the commands to install and check them. Pure text building; nothing is run.
   Needs lib/cmdkit.js only for quoting (looked up when used). Exports window.SystemdUnit. */
(() => {
  "use strict";
  const K = () => (typeof window !== "undefined" ? window : globalThis).CmdKit;
  const SHORT = ["minutely", "hourly", "daily", "weekly", "monthly", "quarterly", "semiannually", "yearly"];
  const SCHEDULES = [
    ["daily", "Every day at 00:00"], ["*-*-* 03:30:00", "Every day at 03:30"], ["hourly", "Every hour"], ["*:0/15", "Every 15 minutes"], ["*:0/5", "Every 5 minutes"],
    ["Mon..Fri *-*-* 08:00:00", "Weekdays at 08:00"], ["Sun *-*-* 02:00:00", "Every Sunday at 02:00"], ["weekly", "Every Monday at 00:00"], ["monthly", "First of the month at 00:00"], ["*-*-01 04:00:00", "First of the month at 04:00"], ["custom", "My own OnCalendar text…"],
  ];
  const HARDEN = {
    none: [],
    basic: ["NoNewPrivileges=true", "PrivateTmp=true", "ProtectSystem=full", "ProtectHome=true"],
    strict: ["NoNewPrivileges=true", "PrivateTmp=true", "PrivateDevices=true", "ProtectSystem=strict", "ProtectHome=true", "ProtectKernelTunables=true", "ProtectKernelModules=true", "ProtectControlGroups=true", "RestrictSUIDSGID=true", "RestrictNamespaces=true", "LockPersonality=true", "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX", "CapabilityBoundingSet="],
  };
  const unitName = s => /^[A-Za-z0-9:_.\\-]{1,200}$/.test(s) && !/\.(service|timer|socket|target|mount)$/.test(s) && !/^[.-]/.test(s);
  const esc = s => String(s).replace(/%/g, "%%");           // % starts a specifier in unit files
  const quoteVal = s => /[\s"'\\]/.test(s) ? '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' : s;
  const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], LONG = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const dayOk = d => { const k = d.toLowerCase(); return DAYS.includes(k) || LONG.includes(k); };
  const partOk = (s, lo, hi, frac) => s.split(",").every(it => { const m = /^(\*|(\d+)(\.\.(\d+))?)(\/(\d+))?$/.exec(it); if (!m) return !!(frac && /^\d+\.\d+$/.test(it)); const a = m[2] === undefined ? null : +m[2], b = m[4] === undefined ? null : +m[4]; return (a === null || (a >= lo && a <= hi)) && (b === null || (b >= lo && b <= hi && b >= a)) && (m[6] === undefined || +m[6] > 0); });
  function calOk(str) {
    str = String(str).trim(); if (SHORT.includes(str.toLowerCase())) return true;
    const toks = str.split(/\s+/); if (toks.length > 1 && /^(UTC|[A-Z][a-z]+\/[A-Za-z_]+)$/.test(toks[toks.length - 1])) toks.pop();
    if (!toks.length || toks.length > 3 || !toks[0]) return false;
    let wd = null, date = null, time = null;
    for (const t of toks) {
      if (/^[A-Za-z]/.test(t) && t.split(",").every(x => x.split("..").every(dayOk))) { if (wd || date || time) return false; wd = t; }
      else if (t.includes(":")) { if (time) return false; time = t; }
      else if (/^[\d*~]/.test(t) && t.includes("-")) { if (date || time) return false; date = t; }
      else return false;
    }
    if (!wd && !date && !time) return false;
    if (date) { const d = date.split("-"); if (d.length < 2 || d.length > 3) return false; const y = d.length === 3 ? d[0] : null, mo = d[d.length - 2], da = d[d.length - 1]; if (y !== null && !partOk(y, 1970, 2199)) return false; if (!partOk(mo, 1, 12)) return false; if (!partOk(da.replace(/^\*?~/, ""), 1, 31)) return false; }
    if (time) { const t = time.split(":"); if (t.length < 2 || t.length > 3) return false; if (!partOk(t[0], 0, 23) || !partOk(t[1], 0, 59)) return false; if (t[2] !== undefined && !partOk(t[2], 0, 59, true)) return false; }
    return true;
  }
  const spanOk = s => /^(\d+(\.\d+)?\s*(us|usec|ms|msec|s|sec|second|seconds|m|min|minute|minutes|h|hr|hour|hours|d|day|days|w|week|weeks)?\s*)+$/.test(s.trim());

  function build(v) {
    const notes = [], outputs = [], name = (v.name || "").trim(), cmd = (v.exec || "").trim();
    if (!name) return { outputs: [], notes: [{ level: "info", text: "Type a name for the unit (for example backup) and the command to run." }] };
    if (!unitName(name)) return { outputs: [], notes: [{ level: "bad", text: "The name may use letters, digits and : _ . - only, without .service or .timer (those are added for you)." }] };
    if (!cmd) return { outputs: [], notes: [{ level: "info", text: "Type the command to run, starting with its full path, for example /usr/local/bin/backup.sh --daily." }] };
    if (!/^[-@:+!]*\//.test(cmd)) notes.push({ level: "bad", text: "systemd needs the full path of the program: start the command with / (for example /usr/bin/rsync, not rsync). Use `command -v <program>` to find it." });
    if (/[|<>;&`]|\$\(|&&|\|\|/.test(cmd)) notes.push({ level: "warn", text: "systemd does not run a shell: pipes, redirects, && and ; are passed to the program as plain text. To use them, start the command with /bin/sh -c '...' (or put it in a script)." });
    if (/\$[A-Za-z_{]/.test(cmd)) notes.push({ level: "info", text: "$NAME in a command is replaced by systemd from the unit's Environment= lines (not from a login shell); $$ gives a literal dollar sign." });
    const oneshot = v.type === "oneshot", timer = v.timer !== "none";
    const svc = ["[Unit]", "Description=" + (v.desc || "").trim().replace(/[\r\n]/g, " ") || "Description=" + name];
    if (!/Description=\S/.test(svc[1])) svc[1] = "Description=" + name;
    if (v.network) svc.push("After=network-online.target", "Wants=network-online.target");
    if (v.after && /^[A-Za-z0-9:_.@\\ -]+$/.test(v.after.trim())) svc.push("After=" + v.after.trim());
    svc.push("", "[Service]", "Type=" + v.type);
    if (v.user.trim()) { if (!/^[A-Za-z_][A-Za-z0-9_.-]*\$?$/.test(v.user.trim())) notes.push({ level: "bad", text: "The user name has characters that Linux user names do not use." }); else svc.push("User=" + v.user.trim()); }
    if (v.group.trim()) { if (!/^[A-Za-z_][A-Za-z0-9_.-]*\$?$/.test(v.group.trim())) notes.push({ level: "bad", text: "The group name has characters that Linux group names do not use." }); else svc.push("Group=" + v.group.trim()); }
    if (/^(nobody|nogroup)$/.test(v.user.trim())) notes.push({ level: "warn", text: "The special user nobody is shared by many things and systemd warns about it. Make a dedicated user instead (sudo useradd --system --no-create-home myapp)." });
    if (!v.user.trim()) notes.push({ level: "info", text: "No user is set, so the service runs as root. If it does not need root, give it a dedicated user (useradd --system) so a bug or a stolen script has less reach." });
    if (v.workdir.trim()) { if (!v.workdir.trim().startsWith("/")) notes.push({ level: "bad", text: "The working directory must be a full path starting with /." }); else svc.push("WorkingDirectory=" + esc(v.workdir.trim())); }
    const env = K().lines(v.env);
    for (const e of env) { if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(e)) notes.push({ level: "bad", text: "Environment line \"" + e + "\" must look like NAME=value." }); else svc.push("Environment=" + quoteVal(esc(e))); }
    if (v.envfile.trim()) svc.push("EnvironmentFile=" + (v.envfileOpt ? "-" : "") + esc(v.envfile.trim()));
    svc.push("ExecStart=" + esc(cmd).replace(/\r?\n/g, " "));
    if (v.type === "forking" && !v.pidfile.trim()) notes.push({ level: "info", text: "Type=forking works best with a PIDFile= line; without one systemd guesses the main process." });
    if (v.type === "forking" && v.pidfile.trim()) svc.push("PIDFile=" + v.pidfile.trim());
    if (oneshot && v.restart !== "no") notes.push({ level: "warn", text: "A one-shot job normally uses Restart=no (the timer starts it again). Restart=always is refused by systemd for one-shot services." });
    if (!oneshot && v.restart !== "no") { svc.push("Restart=" + v.restart); const rs = v.restartSec.trim(); if (rs) { if (!spanOk(rs)) notes.push({ level: "bad", text: "RestartSec must be a time such as 5 or 30s." }); else svc.push("RestartSec=" + rs); } }
    if (oneshot && timer) notes.push({ level: "good", text: "A one-shot service run by a timer is the usual replacement for a cron job." });
    if (!oneshot && timer) notes.push({ level: "info", text: "A timer starts the service on schedule; a service that keeps running (Type=" + v.type + ") makes little sense with a timer unless it exits when finished." });
    if (v.timeout.trim()) { if (!spanOk(v.timeout)) notes.push({ level: "bad", text: "TimeoutStartSec must be a time such as 90 or 10min." }); else svc.push("TimeoutStartSec=" + v.timeout.trim()); }
    if (v.nice.trim()) { if (!/^-?\d+$/.test(v.nice.trim()) || +v.nice < -20 || +v.nice > 19) notes.push({ level: "bad", text: "Nice must be a whole number from -20 to 19." }); else svc.push("Nice=" + v.nice.trim()); }
    if (v.idle) svc.push("IOSchedulingClass=idle", "CPUSchedulingPolicy=idle");
    for (const l of HARDEN[v.harden] || []) svc.push(l);
    const rw = K().lines(v.rw);
    if (v.harden === "strict" && rw.length) { for (const p of rw) if (!p.startsWith("/")) notes.push({ level: "bad", text: "\"" + p + "\": paths must start with /." }); svc.push("ReadWritePaths=" + rw.filter(p => p.startsWith("/")).join(" ")); }
    if (v.harden === "strict" && !rw.length && !oneshot) notes.push({ level: "info", text: "With the strict set the whole file system is read-only for this service. List the folders it must write to under \"Folders it may write to\", or it will fail with 'Read-only file system'." });
    if (v.harden === "strict" && !rw.length && oneshot) notes.push({ level: "info", text: "With the strict set the whole file system is read-only for this service; add the folders it must write to." });
    if (v.harden !== "none") notes.push({ level: "info", text: "These hardening lines can stop a program that needs more access. Test with: systemd-analyze security " + name + ".service" });
    // [Install]: a service started by a timer is not enabled itself; the timer is
    if (!timer) svc.push("", "[Install]", "WantedBy=multi-user.target");
    const svcText = svc.join("\n") + "\n";
    outputs.push({ title: "/etc/systemd/system/" + name + ".service", text: svcText, file: name + ".service" });
    let tmrText = "";
    if (timer) {
      const t = ["[Unit]", "Description=Run " + name + (v.timer === "calendar" ? " on a schedule" : " after boot and then repeatedly"), "", "[Timer]"];
      if (v.timer === "calendar") {
        const cal = (v.schedule === "custom" ? v.calendar : v.schedule).trim();
        if (!cal) notes.push({ level: "bad", text: "Type the OnCalendar schedule, for example Mon..Fri *-*-* 08:00:00." });
        else if (!calOk(cal)) notes.push({ level: "bad", text: "\"" + cal + "\" does not look like an OnCalendar time. Examples: daily, *-*-* 03:30:00, Mon..Fri 08:00, *:0/15. Check one with: systemd-analyze calendar \"" + cal + "\"" });
        else t.push("OnCalendar=" + cal);
        if (v.persistent) t.push("Persistent=true");
        if (v.persistent && cal && /^\*:0\/\d+$|minutely/.test(cal)) notes.push({ level: "info", text: "Persistent=true only makes up one missed run, not every missed one." });
      } else {
        const boot = v.bootsec.trim(), rep = v.repeat.trim();
        if (!boot && !rep) notes.push({ level: "bad", text: "Give the delay after boot, the repeat interval, or both." });
        if (boot) { if (!spanOk(boot)) notes.push({ level: "bad", text: "\"" + boot + "\" is not a time. Use for example 5min or 1h." }); else t.push("OnBootSec=" + boot); }
        if (rep) { if (!spanOk(rep)) notes.push({ level: "bad", text: "\"" + rep + "\" is not a time. Use for example 15min or 1d." }); else t.push("OnUnitActiveSec=" + rep); }
        if (rep && !boot) { t.push("OnBootSec=1min"); notes.push({ level: "info", text: "OnBootSec=1min was added: a timer with only OnUnitActiveSec would never start the first run." }); }
      }
      if (v.random.trim()) { if (!spanOk(v.random)) notes.push({ level: "bad", text: "The random delay must be a time such as 10min." }); else t.push("RandomizedDelaySec=" + v.random.trim()); }
      if (v.accuracy.trim()) { if (!spanOk(v.accuracy)) notes.push({ level: "bad", text: "The accuracy must be a time such as 1s." }); else t.push("AccuracySec=" + v.accuracy.trim()); }
      t.push("Unit=" + name + ".service", "", "[Install]", "WantedBy=timers.target");
      tmrText = t.join("\n") + "\n";
      outputs.push({ title: "/etc/systemd/system/" + name + ".timer", text: tmrText, file: name + ".timer" });
    }
    const cmds = ["# put the file" + (timer ? "s" : "") + " in place, then:", "sudo cp " + name + ".service " + (timer ? name + ".timer " : "") + "/etc/systemd/system/", "sudo systemctl daemon-reload", timer ? "sudo systemctl enable --now " + name + ".timer" : "sudo systemctl enable --now " + name + ".service"];
    const chk = ["# check the files before you start them", "systemd-analyze verify /etc/systemd/system/" + name + ".service" + (timer ? " /etc/systemd/system/" + name + ".timer" : "")];
    if (timer && v.timer === "calendar") { const cal = (v.schedule === "custom" ? v.calendar : v.schedule).trim(); if (cal && calOk(cal)) chk.push("systemd-analyze calendar " + K().shq(cal) + " --iterations=5   # shows the next 5 run times"); }
    chk.push("systemctl status " + name + (timer ? ".timer" : ".service"), timer ? "systemctl list-timers " + name + ".timer" : "journalctl -u " + name + ".service -f", timer ? "journalctl -u " + name + ".service    # the output of the runs" : "systemctl cat " + name + ".service");
    if (timer) chk.push("sudo systemctl start " + name + ".service    # run it once now, to test");
    outputs.push({ title: "Install and start", text: cmds.join("\n") + "\n", hint: "needs root (sudo)" });
    outputs.push({ title: "Check and watch", text: chk.join("\n") + "\n" });
    return { outputs, notes };
  }
  const FIELDS = [
    { group: "The job", key: "name", label: "Name of the unit", value: "backup", placeholder: "backup", hint: "Becomes backup.service (and backup.timer)." },
    { group: "The job", key: "desc", label: "Description", value: "Nightly backup", placeholder: "What it does" },
    { group: "The job", key: "exec", label: "Command (full path first)", value: "/usr/local/bin/backup.sh --daily", type: "area", rows: 2, hint: "No shell is used: no pipes or &&. Start with /." },
    { group: "The job", key: "type", label: "How it behaves", type: "select", value: "oneshot", options: [["oneshot", "Runs once and ends (a job)"], ["simple", "Keeps running (a daemon)"], ["exec", "Keeps running, reports when started"], ["notify", "Keeps running, tells systemd when ready"], ["forking", "Starts itself in the background (old style)"]] },
    { group: "Who and where", key: "user", label: "Run as user (empty = root)", value: "" },
    { group: "Who and where", key: "group", label: "Group (optional)", value: "" },
    { group: "Who and where", key: "workdir", label: "Working directory (optional)", value: "" },
    { group: "Who and where", key: "env", label: "Environment, one NAME=value per line", type: "area", rows: 2, value: "" },
    { group: "Who and where", key: "envfile", label: "Environment file (optional)", value: "", placeholder: "/etc/default/backup" },
    { group: "Who and where", key: "envfileOpt", label: "It is fine if the file does not exist", type: "check", value: false, showIf: v => !!v.envfile.trim() },
    { group: "Who and where", key: "pidfile", label: "PID file", value: "", showIf: v => v.type === "forking" },
    { group: "Start and stop", key: "network", label: "Start only after the network is up", type: "check", value: false },
    { group: "Start and stop", key: "after", label: "Also start after this unit (optional)", value: "", placeholder: "postgresql.service" },
    { group: "Start and stop", key: "restart", label: "Restart it when it stops", type: "select", value: "no", options: [["no", "No"], ["on-failure", "Only when it fails"], ["always", "Always"]] },
    { group: "Start and stop", key: "restartSec", label: "Wait before restarting", value: "5", showIf: v => v.restart !== "no" && v.type !== "oneshot" },
    { group: "Start and stop", key: "timeout", label: "Give up starting after (optional)", value: "", placeholder: "10min" },
    { group: "Start and stop", key: "nice", label: "Priority (Nice, -20 to 19, optional)", value: "" },
    { group: "Start and stop", key: "idle", label: "Run only when the disk and CPU are idle", type: "check", value: false },
    { group: "Safety", key: "harden", label: "Limit what the service can reach", type: "select", value: "basic", options: [["none", "No limits"], ["basic", "Basic (no new privileges, private /tmp, read-only /usr and /etc, no home folders)"], ["strict", "Strict (whole file system read-only, no devices, no kernel settings)"]] },
    { group: "Safety", key: "rw", label: "Folders it may write to, one per line", type: "area", rows: 2, value: "", showIf: v => v.harden === "strict" },
    { group: "Schedule (timer)", key: "timer", label: "Run it", type: "select", value: "calendar", options: [["none", "Now and at boot (no timer)"], ["calendar", "On a schedule (like cron)"], ["boot", "After boot, then repeatedly"]] },
    { group: "Schedule (timer)", key: "schedule", label: "When", type: "select", value: "*-*-* 03:30:00", options: SCHEDULES, showIf: v => v.timer === "calendar" },
    { group: "Schedule (timer)", key: "calendar", label: "OnCalendar text", value: "", placeholder: "Mon..Fri *-*-* 08:00:00", showIf: v => v.timer === "calendar" && v.schedule === "custom" },
    { group: "Schedule (timer)", key: "persistent", label: "If the machine was off at that time, run it at the next boot", type: "check", value: true, showIf: v => v.timer === "calendar" },
    { group: "Schedule (timer)", key: "bootsec", label: "Delay after boot", value: "5min", showIf: v => v.timer === "boot" },
    { group: "Schedule (timer)", key: "repeat", label: "Repeat every", value: "1h", showIf: v => v.timer === "boot" },
    { group: "Schedule (timer)", key: "random", label: "Random extra delay (optional, spreads many machines out)", value: "", placeholder: "10min", showIf: v => v.timer !== "none" },
    { group: "Schedule (timer)", key: "accuracy", label: "Accuracy (optional, default 1min)", value: "", placeholder: "1s", showIf: v => v.timer !== "none" },
  ];
  const EXAMPLES = [
    { name: "Nightly job (timer)", values: { name: "backup", desc: "Nightly backup", exec: "/usr/local/bin/backup.sh --daily", type: "oneshot", timer: "calendar", schedule: "*-*-* 03:30:00", harden: "basic" } },
    { name: "A daemon that restarts", values: { name: "myapp", desc: "My application", exec: "/opt/myapp/bin/myapp --config /etc/myapp.conf", type: "simple", user: "myapp", restart: "on-failure", network: true, timer: "none", harden: "strict", rw: "/var/lib/myapp" } },
    { name: "Every 15 minutes", values: { name: "poll", desc: "Poll the API", exec: "/usr/bin/curl -fsS https://example.net/health", type: "oneshot", timer: "calendar", schedule: "*:0/15", network: true, harden: "basic" } },
    { name: "After boot, then hourly", values: { name: "cleanup", desc: "Clean old files", exec: "/usr/bin/find /var/tmp/uploads -mtime +7 -delete", type: "oneshot", timer: "boot", bootsec: "10min", repeat: "1h", harden: "none" } },
  ];
  const builder = { fields: FIELDS.map(f => Object.assign({ type: "text" }, f)), build, examples: EXAMPLES };
  const api = { build, builder, FIELDS, EXAMPLES, SCHEDULES, unitName, calOk };
  if (typeof window !== "undefined") window.SystemdUnit = api;
  if (typeof module !== "undefined") module.exports = api;
})();
