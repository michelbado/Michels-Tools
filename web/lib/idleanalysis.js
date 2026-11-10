/* Idle-timeout finder: turns the two measured outcomes (a silent held request, and one with a heartbeat) into a plain-language verdict.
   Pure; exports window.IdleAnalysis. An outcome: { planned, elapsed (seconds), ok: bool, status?: number (HTTP status when the path answered), stopped?: bool, error?: string }. */
(() => {
  "use strict";
  const STATUS = {
    524: "Cloudflare gave up waiting for the server (HTTP 524)", 504: "a gateway timed out (HTTP 504)", 502: "a gateway lost the connection (HTTP 502)",
    503: "a gateway or the server was unavailable (HTTP 503)", 408: "a request timeout (HTTP 408)", 499: "the proxy closed the request (HTTP 499)",
    522: "Cloudflare could not connect to the server (HTTP 522)", 523: "Cloudflare could not reach the server (HTTP 523)", 520: "an unexpected answer from the server (HTTP 520)",
    429: "this server refused because too many tests were running (HTTP 429)", 400: "this server refused the request (HTTP 400)", 404: "the test is switched off on this server (HTTP 404)",
  };
  // Well-known defaults near a measured time, to help the reader guess WHO cut the connection. Only widely documented defaults.
  const DEFAULTS = [
    [[55, 66], "about 60 seconds: the default of nginx (proxy_read_timeout) and of Amazon's Application Load Balancer"],
    [[95, 105], "about 100 seconds: Cloudflare's limit for a server that has not answered yet (HTTP 524)"],
    [[236, 246], "about 4 minutes: the default of Azure's load balancer"],
    [[345, 356], "about 350 seconds: the default of Amazon's Network Load Balancer"],
    [[28, 33], "about 30 seconds: common in proxies, firewalls and some Google Cloud load balancers"],
  ];
  const near = t => { const d = DEFAULTS.find(([r]) => t >= r[0] && t <= r[1]); return d ? d[1] : ""; };
  const sec = x => (Math.round(x * 10) / 10).toString().replace(/\.0$/, "") + " s";
  const statusText = s => STATUS[s] || "HTTP " + s;

  function describe(o, what) {
    if (!o) return "not run";
    if (o.stopped) return "stopped after " + sec(o.elapsed);
    if (o.ok) return "survived the whole " + sec(o.planned);
    if (o.status) return "cut after " + sec(o.elapsed) + ": " + statusText(o.status);
    return "connection dropped after " + sec(o.elapsed) + (o.error ? " (" + o.error + ")" : "");
  }
  const failedAtOnce = o => !o.ok && !o.stopped && o.elapsed < 3 && o.planned >= 10;
  const refusal = o => !o.ok && o.status && [400, 404, 429].includes(o.status);

  // q: the silent test, b: the heartbeat test (either may be null)
  function interpret(q, b, ctx) {
    ctx = ctx || {};
    const notes = [], rows = [];
    const planned = (q || b || {}).planned || 0;
    rows.push(["Silent connection", describe(q)]);
    rows.push(["With a heartbeat byte every " + (ctx.beat || 15) + " s", describe(b)]);
    rows.push(["Longest wait tried", sec(planned)]);
    if (ctx.protocol) rows.push(["Web protocol", ctx.protocol]);
    const res = { rows, notes, summary: "", kind: "" };
    const tests = [q, b].filter(Boolean);
    if (!tests.length) { res.summary = "No result."; return res; }
    if (tests.some(t => t.stopped)) { res.summary = "Stopped before the end, so there is no verdict."; res.kind = "stopped"; return res; }
    const ref = tests.find(refusal);
    if (ref) { res.summary = "The test could not run: " + statusText(ref.status) + "."; res.kind = "refused"; notes.push({ level: "warn", text: ref.status === 429 ? "Wait a few seconds and try again." : "Nothing about your connection was measured." }); return res; }
    if (tests.every(failedAtOnce)) { res.summary = "Both tests failed at once, so nothing was measured."; res.kind = "failed"; notes.push({ level: "warn", text: "Something blocked the long request right away (a content filter, an antivirus, a VPN or a proxy that dislikes long requests). Try again, or from another network." }); return res; }
    const t1 = q && !q.ok ? q.elapsed : null, t2 = b && !b.ok ? b.elapsed : null;
    if (q && q.ok && (!b || b.ok)) {
      res.kind = "none";
      res.summary = "No idle limit found: a silent connection survived " + sec(planned) + ".";
      notes.push({ level: "good", text: "Nothing between you and this server cut a quiet connection in " + sec(planned) + ". Limits longer than that may still exist." + (planned < 300 ? " Run the 5 minute test to look further." : "") });
    } else if (t1 != null && b && b.ok) {
      res.kind = "idle";
      res.summary = "A silent connection is cut after about " + sec(t1) + ", but a heartbeat keeps it alive.";
      notes.push({ level: "warn", text: "Anything on this path that waits quietly for longer than " + sec(t1) + " (a report that takes a while to build, a long download that starts late, a chat or live-update connection) will break." });
      notes.push({ level: "good", text: "Sending a small piece of data regularly avoids it. Send a heartbeat (a WebSocket ping, a server-sent-events comment, a keep-alive byte) well within " + sec(t1) + ", for example every " + sec(Math.max(5, Math.floor(t1 / 3))) + "." });
    } else if (t1 != null && t2 != null && Math.abs(t1 - t2) < 6) {
      res.kind = "total";
      res.summary = "Every request is cut after about " + sec((t1 + t2) / 2) + ", whether it is quiet or not.";
      notes.push({ level: "warn", text: "This is a limit on the total time of one request, not on silence, so a heartbeat does not help. Anything that takes longer must be split into shorter requests or moved to a connection that is allowed to live longer." });
    } else if (t1 != null && t2 != null) {
      res.kind = "idle+total";
      res.summary = "Silence is cut after about " + sec(t1) + ", and even a heartbeat connection after " + sec(t2) + ".";
      notes.push({ level: "warn", text: "Two limits: a quiet connection dies after " + sec(t1) + ", and no single request lives longer than " + sec(t2) + ". Heartbeats help only up to the second limit." });
    } else if (q && q.ok && t2 != null) {
      res.kind = "stream";
      res.summary = "The heartbeat connection was cut after " + sec(t2) + ", although the silent one survived.";
      notes.push({ level: "warn", text: "Something between you and the server dislikes streamed answers (a proxy or antivirus that holds back or limits streaming). Silent waiting is fine on this path; streaming is not." });
    } else { res.summary = "The result is mixed; see the table."; res.kind = "mixed"; }
    for (const [t, label] of [[t1, "The silent connection"], [t2, "The heartbeat connection"]]) {
      if (t != null) { const n = near(t); if (n) notes.push({ level: "", text: label + " was cut at " + sec(t) + ", which matches " + n + ". Values like this are often settings, so this is a hint, not proof." }); }
    }
    for (const o of tests) if (!o.ok && o.status === 524) { notes.push({ level: "", text: "HTTP 524 comes from Cloudflare itself: your path goes through Cloudflare, which waits at most 100 seconds for the server to start answering. A server that needs longer must send something (headers) earlier." }); break; }
    if (ctx.slept) notes.push({ level: "warn", text: "The computer or the browser tab seems to have gone to sleep during the test, so the times are not reliable. Run it again with the screen awake." });
    return res;
  }

  function toText(res, ctx) {
    const out = ["Idle-timeout finder (Michel's Tools)", ctx && ctx.when ? "Taken " + ctx.when + (ctx.host ? " against " + ctx.host : "") : "", "", res.summary, ""];
    for (const n of res.notes) out.push("* " + n.text);
    out.push("");
    for (const [k, v] of res.rows) out.push(k + ": " + v);
    return out.join("\n").replace(/\n{3,}/g, "\n\n") + "\n";
  }

  const api = { interpret, describe, statusText, near, toText, sec };
  if (typeof window !== "undefined") window.IdleAnalysis = api;
  if (typeof module !== "undefined") module.exports = api;
})();
