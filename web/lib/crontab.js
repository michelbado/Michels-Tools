/* Crontab helper: reads a standard 5-field cron expression (or an @daily style shortcut, or a whole crontab line), says what it means in
   plain words, lists the next run times, and warns about the usual traps. It follows Vixie/cronie cron. It reads nothing from the machine.
   Exports window.CronTab. */
(() => {
  "use strict";
  const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const FIELDS = [{ id: "minute", min: 0, max: 59 }, { id: "hour", min: 0, max: 23 }, { id: "dom", min: 1, max: 31 }, { id: "month", min: 1, max: 12, names: MON, off: 1 }, { id: "dow", min: 0, max: 7, names: DOW, off: 0 }];
  const SPECIAL = { "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *" };
  const pad = n => String(n).padStart(2, "0");

  function parseField(text, f) {
    const notes = [];
    if (/[?LW#]/i.test(text) && !/^[a-z]{3}/i.test(text.replace(/[,\-\/*0-9]/g, "")) || /[?#]|\d[LW]|^[LW]$/i.test(text)) return { error: "\"" + text + "\" uses L, W, # or ? which are Quartz/Spring/AWS cron extras. Standard cron (crontab) does not understand them." };
    const set = new Set(); const star = text.startsWith("*");
    const val = (s, what) => {
      let n; if (/^\d+$/.test(s)) n = +s; else if (f.names && f.names.includes(s.toLowerCase())) n = f.names.indexOf(s.toLowerCase()) + f.off; else return { error: "\"" + s + "\" is not a valid " + what + (f.names ? " (use a number or a name like " + f.names[1] + ")" : "") + "." };
      if (n < f.min || n > f.max) return { error: n + " is outside " + f.min + " to " + f.max + " for the " + f.id.replace("dom", "day of month").replace("dow", "day of week") + " field." };
      return { n };
    };
    for (const item of text.split(",")) {
      if (!item) return { error: "The " + f.id + " field has an empty item (a stray comma)." };
      const m = /^(\*|[^\/*]+?(?:-[^\/*]+?)?)(?:\/(\d+))?$/.exec(item); if (!m) return { error: "\"" + item + "\" is not a valid " + f.id + " expression." };
      const step = m[2] === undefined ? 1 : +m[2]; if (m[2] !== undefined && step < 1) return { error: "A step of 0 is not allowed (\"" + item + "\")." };
      let lo, hi;
      if (m[1] === "*") { lo = f.min; hi = f.id === "dow" ? 6 : f.max; }
      else if (m[1].includes("-") && !/^-/.test(m[1])) { if (m[1].split("-").length !== 2) return { error: "\"" + m[1] + "\" is not a valid range: a range has two ends, like 1-5." }; const [a, b] = m[1].split("-"); const x = val(a, "value"), y = val(b, "value"); if (x.error) return x; if (y.error) return y; lo = x.n; hi = y.n; if (lo > hi) return { error: "The range \"" + m[1] + "\" runs backwards. Write it as two ranges, for example 22-23,0-5." }; }
      else { const x = val(m[1], "value"); if (x.error) return x; lo = x.n; hi = m[2] !== undefined ? (f.id === "dow" ? 6 : f.max) : x.n; if (m[2] !== undefined) notes.push("\"" + item + "\" (a start with a step) is not accepted by every cron; write " + m[1] + "-" + hi + "/" + step + " to be safe."); }
      for (let v = lo; v <= hi; v += step) set.add(f.id === "dow" && v === 7 ? 0 : v);
    }
    return { set: [...set].sort((a, b) => a - b), star, text, notes };
  }

  // Reads "30 2 * * 1", "@daily", "*/5 * * * * /usr/bin/job", or "mon-fri". Returns { kind, fields, command, notes } or { error }.
  function parse(text) {
    let t = String(text == null ? "" : text).trim(); if (!t) return { empty: true };
    t = t.replace(/\s+/g, " ");
    const notes = [];
    const tok = t.split(" ");
    if (tok[0][0] === "@") {
      const sp = tok[0].toLowerCase();
      if (sp === "@reboot") return { kind: "reboot", command: tok.slice(1).join(" "), notes: [{ level: "", text: "@reboot runs once, when the cron service starts (at boot). It has no schedule, so there are no run times to list." }], text: "@reboot" };
      if (!SPECIAL[sp]) return { error: "\"" + tok[0] + "\" is not a cron shortcut. Valid shortcuts: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly, @reboot." };
      const r = parse(SPECIAL[sp] + (tok.length > 1 ? " " + tok.slice(1).join(" ") : "")); if (r.error) return r; r.shortcut = sp; r.notes.unshift({ level: "", text: sp + " means \"" + SPECIAL[sp] + "\"." }); r.text = sp; return r;
    }
    if (tok.length < 5) return { error: "A cron schedule has five fields: minute hour day-of-month month day-of-week. This has " + tok.length + "." };
    const parsed = [];
    for (let i = 0; i < 5; i++) { const r = parseField(tok[i], FIELDS[i]); if (r.error) return { error: r.error }; parsed.push(r); for (const n of r.notes) notes.push({ level: "warn", text: n }); }
    const rest = tok.slice(5).join(" ");
    if (tok.length === 6 && /^[\d*,\-\/a-z?]+$/i.test(tok[5]) && !/[\/.]/.test(tok[5].replace(/\*\/\d+|\d+-\d+|,/g, "")) && /^(\*|\d)/.test(tok[5])) notes.push({ level: "warn", text: "There is a sixth field (" + tok[5] + "). Standard cron has FIVE fields. Spring, Quartz and some other schedulers put SECONDS first, so this may be meant for one of those; here the sixth item is read as the command." });
    const dom = parsed[2], dow = parsed[4];
    if (!dom.star && !dow.star) notes.push({ level: "warn", text: "Both the day of the month and the day of the week are set. Cron then runs the job when EITHER matches, not both. For \"the first Monday\" you need a check inside the command." });
    if (dom.set.some(d => d > 28) && !parsed[3].star === false && dom.set.every(d => d >= 29)) notes.push({ level: "", text: "Day " + dom.set.join(", ") + " does not exist in every month: the job is skipped in shorter months." });
    if (parsed[3].set.length && dom.set.every(d => d === 31) && parsed[3].set.every(m => [2, 4, 6, 9, 11].includes(m))) notes.push({ level: "bad", text: "Day 31 never occurs in those months, so this job never runs." });
    if (parsed[3].set.length === 1 && parsed[3].set[0] === 2 && dom.set.every(d => d >= 30)) notes.push({ level: "bad", text: "February never has day " + dom.set.join(" or ") + ", so this job never runs." });
    if (parsed[3].set.length === 1 && parsed[3].set[0] === 2 && dom.set.includes(29) && !dom.set.some(d => d < 29)) notes.push({ level: "", text: "February 29th exists only in leap years, so this job runs once every four years." });
    if (rest && /(^|[^\\])%/.test(rest)) notes.push({ level: "warn", text: "In a crontab line an unescaped % means a new line (everything after the first % is sent to the command as input). Write \\% for a literal percent sign, for example in date +\\%F." });
    return { kind: "fields", fields: parsed, command: rest, notes, text: tok.slice(0, 5).join(" ") };
  }

  // ---------- plain words ----------
  const list = a => a.length === 1 ? a[0] : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
  const contiguous = a => a.length > 1 && a.every((v, i) => i === 0 || v === a[i - 1] + 1);
  const stepOf = (set, f) => { if (set.length < 3) return 0; const d = set[1] - set[0]; if (d < 2) return 0; for (let i = 2; i < set.length; i++) if (set[i] - set[i - 1] !== d) return 0; const full = []; for (let v = set[0]; v <= (f.id === "dow" ? 6 : f.max); v += d) full.push(v); return full.length === set.length ? d : 0; };
  const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  const isAll = (p, f) => p.set.length === (f.id === "dow" ? 7 : f.max - f.min + 1) || (f.id === "dow" && p.set.length === 7);
  function explain(p) {
    if (!p || p.kind !== "fields") return p && p.kind === "reboot" ? "Once, when the cron service starts (at boot)." : "";
    const [mi, ho, dm, mo, dw] = p.fields, F = FIELDS;
    const allMin = isAll(mi, F[0]), allHour = isAll(ho, F[1]);
    let when;
    const hhmm = (h, m) => pad(h) + ":" + pad(m);
    if (allMin && allHour) when = "every minute";
    else if (allHour && !allMin) {
      const st = stepOf(mi.set, F[0]);
      if (st && mi.set[0] === 0) when = "every " + st + " minutes";
      else if (st) when = "every " + st + " minutes, starting at minute " + mi.set[0] + " of each hour";
      else if (mi.set.length === 1) when = mi.set[0] === 0 ? "at the start of every hour" : "at minute " + mi.set[0] + " of every hour";
      else when = "at minutes " + list(mi.set.map(String)) + " of every hour";
    } else if (allMin && !allHour) {
      when = (ho.set.length === 1 || contiguous(ho.set)) ? "every minute from " + hhmm(ho.set[0], 0) + " through " + hhmm(ho.set[ho.set.length - 1], 59) : "every minute during the hours " + list(ho.set.map(String));
    } else {
      const stm = stepOf(mi.set, F[0]);
      if (stm && mi.set[0] === 0 || (mi.set.length > 1 && stm)) when = "every " + stm + " minutes, " + ((ho.set.length === 1 || contiguous(ho.set)) ? "from " + hhmm(ho.set[0], mi.set[0]) + " to " + hhmm(ho.set[ho.set.length - 1], mi.set[mi.set.length - 1]) : "during the hours " + list(ho.set.map(String)));
      else if (mi.set.length * ho.set.length <= 8) { const ts = []; for (const h of ho.set) for (const m of mi.set) ts.push(hhmm(h, m)); when = "at " + list(ts); }
      else if (mi.set.length === 1 && contiguous(ho.set) && ho.set.length > 2) when = "every hour from " + hhmm(ho.set[0], mi.set[0]) + " through " + hhmm(ho.set[ho.set.length - 1], mi.set[0]);
      else when = "at minute" + (mi.set.length > 1 ? "s " : " ") + list(mi.set.map(String)) + " of the hours " + list(ho.set.map(String));
    }
    // days
    const dowSet = dw.set, domAll = isAll(dm, F[2]), dowAll = isAll(dw, F[4]), monAll = isAll(mo, F[3]);
    const dowWords = () => { const s = dowSet; if (s.join() === "1,2,3,4,5") return "on weekdays (Monday to Friday)"; if (s.join() === "0,6") return "on weekends (Saturday and Sunday)"; if (contiguous(s) && s.length > 2) return "from " + DAY_NAMES[s[0]] + " to " + DAY_NAMES[s[s.length - 1]]; const sd = stepOf(s, F[4]); return "on " + list(s.map(d => DAY_NAMES[d])); };
    const domWords = () => { const s = dm.set, st = stepOf(s, F[2]); if (st && s[0] === 1) return "on every " + ord(st) + " day of the month"; return "on " + (s.length === 1 ? "day " : "days ") + list(s.map(String)) + " of the month"; };
    let days;
    if (domAll && dowAll) days = "every day"; else if (dowAll) days = domWords(); else if (domAll) days = dowWords();
    else days = domWords() + ", and also " + dowWords() + " (cron runs the job when either matches)";
    let months = "";
    if (!monAll) { const s = mo.set, st = stepOf(s, F[3]); months = st ? ", every " + st + " months (" + list(s.map(m => MONTH_NAMES[m - 1])) + ")" : contiguous(s) && s.length > 2 ? ", from " + MONTH_NAMES[s[0] - 1] + " to " + MONTH_NAMES[s[s.length - 1] - 1] : ", in " + list(s.map(m => MONTH_NAMES[m - 1])); }
    const sentence = (days === "every day" ? (/^at \d\d:\d\d/.test(when) ? "every day " + when : when) : when + ", " + days) + months + ".";
    return sentence.charAt(0).toUpperCase() + sentence.slice(1);
  }

  // ---------- next run times ----------
  function dayMatches(p, y, m, d, wd) {
    const [, , dm, mo, dw] = p.fields;
    if (!mo.set.includes(m + 1)) return false;
    const domOk = dm.set.includes(d), dowOk = dw.set.includes(wd);
    return (dm.star || dw.star) ? (domOk && dowOk) : (domOk || dowOk);
  }
  // from: Date; utc: compute in UTC, otherwise in the visitor's local time. Returns up to n Dates after `from`.
  function nextRuns(p, from, n, utc) {
    if (!p || p.kind !== "fields") return [];
    const out = [], [mi, ho] = p.fields, g = utc ? { y: d => d.getUTCFullYear(), m: d => d.getUTCMonth(), d: d => d.getUTCDate() } : { y: d => d.getFullYear(), m: d => d.getMonth(), d: d => d.getDate() };
    const mk = (y, m, d, h, mm) => utc ? new Date(Date.UTC(y, m, d, h, mm)) : new Date(y, m, d, h, mm);
    const same = (dt, y, m, d, h, mm) => utc ? true : (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d && dt.getHours() === h && dt.getMinutes() === mm);
    let day = mk(g.y(from), g.m(from), g.d(from), 12, 0);       // noon: safe from daylight-saving edges when stepping days
    for (let i = 0; i < 366 * 9 && out.length < n; i++) {
      const y = g.y(day), m = g.m(day), d = g.d(day), wd = utc ? day.getUTCDay() : day.getDay();
      if (dayMatches(p, y, m, d, wd)) for (const h of ho.set) for (const mm of mi.set) { const dt = mk(y, m, d, h, mm); if (same(dt, y, m, d, h, mm) && dt > from && out.length < n) out.push(dt); }
      day = utc ? new Date(Date.UTC(y, m, d + 1, 12, 0)) : new Date(y, m, d + 1, 12, 0);
    }
    return out;
  }
  const PRESETS = [
    ["Every minute", "* * * * *"], ["Every 5 minutes", "*/5 * * * *"], ["Every 15 minutes", "*/15 * * * *"], ["Every hour, on the hour", "0 * * * *"], ["Every day at 02:30", "30 2 * * *"],
    ["Weekdays at 08:00", "0 8 * * 1-5"], ["Every Monday at 09:00", "0 9 * * 1"], ["Every Sunday at 03:00", "0 3 * * 0"], ["First day of the month, midnight", "0 0 1 * *"], ["Every 6 hours", "0 */6 * * *"], ["Twice a day (08:00 and 20:00)", "0 8,20 * * *"], ["January 1st, midnight", "0 0 1 1 *"],
  ];
  const build = f => [f.minute, f.hour, f.dom, f.month, f.dow].map(x => (String(x == null ? "" : x).trim() || "*")).join(" ");
  const api = { parse, explain, nextRuns, build, PRESETS, FIELDS, SPECIAL };
  if (typeof window !== "undefined") window.CronTab = api;
  if (typeof module !== "undefined") module.exports = api;
})();
