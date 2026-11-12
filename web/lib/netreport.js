/* Connection Quality: the report as ONE self-contained HTML file (inline styles, graphs as embedded pictures, no scripts, no
   outside files), so it can be mailed, printed or archived. Pure function: NetReport.build(result, meta) -> a string.

   result  what NetAnalysis.analyze returned
   meta    { when, host, protocol, colo, seconds, mode, images: { graph, dir } (PNG data addresses), load }
   Everything that is not written here is escaped before it goes into the page. */
(() => {
  "use strict";
  const NA = () => window.NetAnalysis;
  const up = v => String(v).charAt(0).toUpperCase() + String(v).slice(1);
  const esc = v => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const LEVELS = ["Excellent", "Good", "Unstable", "Poor"];
  const ms = x => (Number.isFinite(x) ? NA().ms(x) : "-");
  const pill = level => (level === null || level === undefined ? "" : `<span class="pill l${level}">${LEVELS[level]}</span>`);
  const dur = (a, b) => `${(Math.max(0, b - a) / 1000).toFixed(1)} s`;

  const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: #ECE9D8; color: #111; font: 15px/1.5 Tahoma, Verdana, "Segoe UI", system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 22px 18px 40px; background: #FCFCFE; box-shadow: 0 0 12px rgba(0,0,0,.25); }
header h1 { margin: 0 0 4px; font-size: 26px; }
.meta { color: #555; font-size: 13px; margin: 0 0 14px; }
.meta span + span::before { content: " | "; color: #999; }
h2 { font-size: 18px; margin: 26px 0 8px; padding-bottom: 4px; border-bottom: 2px solid #316AC5; }
.verdict { font-size: 22px; font-weight: 700; padding: 14px 16px; border: 1px solid #000; background: #FFFFE1; line-height: 1.3; }
.verdict.good { background: #EAF6E8; border-color: #2F7D2F; color: #17501A; }
.verdict.warn { background: #FFF6DC; border-color: #8A6D00; color: #5A4500; }
.verdict.bad { background: #FFF1EC; border-color: #C23A14; color: #7A1F06; }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-top: 12px; }
.card { border: 1px solid #919B9C; background: #fff; padding: 12px 14px; }
.card h3 { margin: 0 0 4px; font-size: 14px; }
.card h3 small { font-weight: 400; color: #666; margin-left: 6px; }
.big { font-size: 28px; font-weight: 700; line-height: 1.2; }
.big.l0 { color: #1E7A28; } .big.l1 { color: #3A7D1E; } .big.l2 { color: #A2620A; } .big.l3 { color: #B0301A; }
.card p { margin: 6px 0 0; font-size: 13px; }
img.graph { display: block; width: 100%; height: auto; border: 1px solid #919B9C; background: #fff; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12px; color: #333; margin: 6px 0 0; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
.ok { background: #2A9D3A; } .spike { background: #E08A00; } .lost { background: #D12D1A; } .dev { background: #A0A0A0; } .edge { background: #3B78D8; border-radius: 1px !important; transform: rotate(45deg); }
.up { background: #3B78D8; } .down { background: #E08A00; } .mk { width: 0 !important; height: 12px !important; border-left: 2px dashed #7A2E9E; border-radius: 0 !important; background: none; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #E4E2D8; vertical-align: top; }
th { background: #F1EFE2; font-weight: 700; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.pill { display: inline-block; padding: 1px 9px; border-radius: 10px; font-size: 12px; font-weight: 700; color: #fff; white-space: nowrap; }
.pill.l0 { background: #2A9D3A; } .pill.l1 { background: #6BA32A; } .pill.l2 { background: #E08A00; } .pill.l3 { background: #D12D1A; }
ul.findings { list-style: none; margin: 0; padding: 0; }
ul.findings li { padding: 7px 8px 7px 30px; position: relative; border-bottom: 1px solid #EFEDE4; }
ul.findings li::before { content: ""; position: absolute; left: 8px; top: 12px; width: 12px; height: 12px; border-radius: 50%; background: #8888A8; }
ul.findings li.good::before { background: #2A9D3A; } ul.findings li.warn::before { background: #E08A00; } ul.findings li.bad::before { background: #D12D1A; } ul.findings li.info::before { background: #3B78D8; }
.at { color: #666; font-variant-numeric: tabular-nums; margin-right: 6px; }
.note { color: #555; font-size: 13px; }
footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #C9C6B8; color: #555; font-size: 12px; }
@media (max-width: 640px) { .cards { grid-template-columns: 1fr; } main { padding: 14px 10px 30px; } }
@media print { body { background: #fff; } main { box-shadow: none; max-width: none; padding: 0; } h2 { break-after: avoid; } img.graph, table, .card { break-inside: avoid; } }
`;

  function card(title, what, label, cls, lines) {
    return `<section class="card"><h3>${esc(title)}<small>${esc(what)}</small></h3><div class="big ${cls}">${esc(label)}</div>${lines.map(l => `<p>${esc(l)}</p>`).join("")}</section>`;
  }

  function build(r, meta = {}) {
    const m = r.origin, latCls = { veryclose: "l0", close: "l0", moderate: "l1", far: "l2", veryfar: "l3" }[r.latency.key] || "", sh = NA().speedHeadline(r.speed);
    const vcls = r.qualityLevel === null ? "" : ["good", "good", "warn", "bad"][r.qualityLevel];
    const parts = [];
    const title = `Connection Quality report${meta.when ? " - " + meta.when : ""}`;

    parts.push(`<header><h1>Connection Quality report</h1><p class="meta">${[
      meta.host && `Server: ${esc(meta.host)}`, meta.when && esc(meta.when), meta.mode && esc(meta.mode),
      meta.seconds ? `${Math.round(meta.seconds)} s, ${r.counts.sent} probes` : `${r.counts.sent} probes`,
      meta.protocol && `Protocol ${esc(meta.protocol)}`, meta.colo && `${esc(up(meta.edgeName || "CDN"))} data centre ${esc(meta.colo)}`,
    ].filter(Boolean).map(x => `<span>${x}</span>`).join("")}</p></header>`);
    parts.push(`<div class="verdict ${vcls}" role="status">${esc(r.sentence)}</div>`);

    const lt = [];
    if (Number.isFinite(r.latency.median)) lt.push(`Typical answer time ${ms(r.latency.median)}.`, `Best ${ms(r.latency.min)}, 95% of answers under ${ms(r.latency.p95)}, worst ${ms(r.latency.max)}.`);
    if (r.edge && Number.isFinite(r.edge.median)) lt.push(`${up(meta.edgeName || "the CDN")}'s nearest data centre${meta.colo ? " (" + meta.colo + ")" : ""}: ${ms(r.edge.median)}.`);
    const sp = r.speed.measured ? NA().speedLines(r.speed) : ["No data was transferred (the speed test was switched off or could not run)."];
    const ql = [];
    if (m.n) ql.push(`Answered ${m.answered} of ${m.n} probes${m.timeouts ? ` (${m.timeoutPct.toFixed(1)}% got no answer)` : ""}.`);
    if (m.answered) ql.push(`${m.spikes} slow probes (${m.spikePct.toFixed(0)}%). Jitter ${ms(m.jitter)}. Longest silence ${ms(m.longestStall)}.`);
    parts.push(`<div class="cards">${card("Latency", "how long answers take (distance)", r.latency.label, latCls, lt)}${card("Speed", "download and upload", sh.label, sh.cls, sp)}${card("Quality", "how steady and complete", r.quality.label, r.qualityLevel === null ? "" : "l" + r.qualityLevel, ql)}</div>`);
    parts.push(`<p class="note">Latency, speed and quality are separate on purpose: a link that always answers in 200 ms is far away but excellent; one that answers in 40 ms but sometimes needs a second, or not at all, is close but poor. Speed is measured over one connection to Michel's Tools.</p>`);

    const img = meta.images || {};
    if (img.graph) {
      parts.push(`<h2>Every probe, over time</h2><img class="graph" alt="Delay of every probe over time. ${esc(r.sentence)}" src="${esc(img.graph)}">`);
      parts.push(`<p class="legend"><span><i class="ok"></i>normal</span><span><i class="spike"></i>slow</span><span><i class="lost"></i>no answer</span><span><i class="dev"></i>device busy (not counted)</span><span><i class="edge"></i>CDN edge</span><span><i class="mk"></i>your mark</span></p>`);
    }
    if (img.dir && r.direction && r.direction.available) {
      parts.push(`<h2>Which way: to the server or back</h2><img class="graph" alt="Extra delay on the way to the server (above the line) and on the way back (below the line)" src="${esc(img.dir)}">`);
      const d = r.direction;
      parts.push(`<p class="legend"><span><i class="up"></i>extra delay on the way TO Michel's Tools (above the line)</span><span><i class="down"></i>on the way BACK (below the line)</span></p>`);
      parts.push(`<p class="note">${d.significant ? `Share of the extra delay on the way there: ${Math.round(d.upShare * 100)}%, on the way back: ${Math.round((1 - d.upShare) * 100)}%.` : "Extra delay in both directions is small, so no direction stands out."} Measured from the server's receive and send times; the two clocks do not need to agree.</p>`);
    }

    parts.push(`<h2>What we found</h2><ul class="findings">${r.findings.length ? r.findings.map(f => `<li class="${esc(f.level)}">${f.at !== undefined ? `<span class="at">${esc(NA().mmss(f.at))}</span>` : ""}${esc(f.text)}</li>`).join("") : "<li class=\"info\">Nothing to report yet.</li>"}</ul>`);

    if (r.incidents.length) {
      parts.push(`<h2>Incidents</h2><table><thead><tr><th>At</th><th>What</th><th>How long</th><th>Details</th></tr></thead><tbody>${r.incidents.map(i => `<tr><td class="num">${esc(NA().mmss(i.start))}</td><td>${esc(i.title)}</td><td class="num">${i.end > i.start ? esc(dur(i.start, i.end)) : "lasting"}</td><td>${esc(i.text)}</td></tr>`).join("")}</tbody></table>`);
    }
    if (r.marks.length) {
      parts.push(`<h2>Your marks ("I notice a problem now")</h2><table><thead><tr><th>At</th><th>What the network did</th></tr></thead><tbody>${r.marks.map(k => `<tr><td class="num">${esc(NA().mmss(k.t))}</td><td>${esc(k.text)}</td></tr>`).join("")}</tbody></table>`);
    }

    const lv = m.levels || {};
    const rows = [
      ["Probes counted", `${m.n}`, null, "Probes left out (device busy, tab hidden) are not counted."],
      ["No answer within 3 s", `${m.timeouts} of ${m.n} (${(m.timeoutPct || 0).toFixed(1)}%)`, lv.timeouts, "A lost request or reply. Even a few matter for calls and downloads."],
      ["Slow probes", `${m.spikes || 0} (${(m.spikePct || 0).toFixed(1)}%), very slow: ${m.bigSpikes || 0}`, lv.spikes, `Answers more than ${m.spikeFloor || 40} ms (and at least 50%) above this link's own normal delay.`],
      ["Jitter", `${ms(m.jitter)} (${Math.round((m.jitterRel || 0) * 100)}% of normal)`, lv.jitter, "How much the delay changes from one answer to the next."],
      ["Longest silence", ms(m.longestStall), lv.stall, "The longest time with no answer arriving."],
      ["Change over the test", `${Math.round((m.drift || 0) * 100)}%`, lv.drift, "Delay at the end compared with the start."],
      ["Typical delay (median)", ms(m.median), null, "Speed: the distance to the server."],
      ["Best / 95% / worst", [m.min, m.p95, m.max].map(ms).join(" / "), null, ""],
    ];
    if (m.device) rows.push(["Probes left out: device busy", `${m.device}`, null, "The device (or a hidden tab) paused the test; not blamed on the network."]);
    if (r.direction && r.direction.available) {
      rows.push(["Extra delay TO the server", [r.direction.up.median, r.direction.up.p95, r.direction.up.max].map(ms).join(" / "), null, "Median / 95% / worst."], ["Extra delay BACK", [r.direction.down.median, r.direction.down.p95, r.direction.down.max].map(ms).join(" / "), null, "Median / 95% / worst."]);
    }
    if (r.edge) rows.push(["CDN edge", `median ${ms(r.edge.median)}, answered ${r.edge.answered}, no answer ${r.edge.timeouts}`, r.edge.level, "Probes to the CDN's nearest data centre."]);
    if (r.underLoad) for (const [k, n] of [["down", "While downloading"], ["up", "While uploading"]]) { const p = r.underLoad.phases[k]; if (p) rows.push([n, `median ${ms(p.median)}, 95% ${ms(p.p95)}, ${p.delta >= 0 ? "+" : ""}${Math.round(p.delta)} ms vs idle, no answer ${p.timeouts}`, p.level, "Delay while the line is busy (bufferbloat)."]); }
    parts.push(`<h2>Indicators</h2><table><thead><tr><th>Indicator</th><th>Value</th><th>Rating</th><th>What it means</th></tr></thead><tbody>${rows.map(([a, b, l, c]) => `<tr><td>${esc(a)}</td><td class="num">${esc(b)}</td><td>${pill(l)}</td><td>${esc(c)}</td></tr>`).join("")}</tbody></table>`);

    parts.push(`<h2>How to read this</h2>
<p><b>Speed</b> is the delay itself: very close under 30 ms, close under 80 ms, moderate distance under 150 ms, far under 300 ms, very far beyond. <b>Quality</b> is judged on how steady and complete the answers are, whatever the delay. The rating of the link is that of its worst indicator.</p>
<table><thead><tr><th>Indicator</th><th>Excellent</th><th>Good</th><th>Unstable</th><th>Poor</th></tr></thead><tbody>
<tr><td>No answer</td><td>none</td><td>up to 0.5%</td><td>up to 3%</td><td>more</td></tr>
<tr><td>Slow probes</td><td>up to 2%</td><td>up to 8%</td><td>up to 25%</td><td>more</td></tr>
<tr><td>Jitter</td><td>under 4 ms, or up to 10% of normal</td><td>up to 25%</td><td>up to 60%</td><td>more</td></tr>
<tr><td>Longest silence</td><td>up to 0.6 s (or 4x normal)</td><td>up to 1.5 s (or 8x)</td><td>up to 4 s</td><td>longer</td></tr>
<tr><td>Change over the test</td><td colspan="2">up to 20%</td><td colspan="2">more</td></tr></tbody></table>
<p class="note">What this can and cannot see: probes are small web requests (layer 7), about five a second. Lost packets cannot be counted directly; they show up as delay jumps and missing answers, which is what a person feels. A delay jump of about 0.2 to 0.5 s or 1 s is typical of one packet that had to be sent again. The direction (to the server or back) is derived from the server's own timestamps. Probes are sent only to this server and, if a CDN is in front, to the CDN's nearest data centre; nothing typed or uploaded is used.</p>`);
    parts.push(`<footer>Created in the browser by Michel's Tools on ${esc(meta.when || "")}. This file is complete in itself: nothing was uploaded, and it contains no scripts.</footer>`);

    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${parts.join("\n")}</main></body></html>\n`;
  }

  window.NetReport = { build, esc };
})();
