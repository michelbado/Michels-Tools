# Server behaviour

What the program does on the server, what it stores and what it refuses. Everything not listed here happens in the visitor's browser.

## Endpoints

| Path | Used by | What it does |
|---|---|---|
| `GET /` and the web files | the page | Serves the embedded web files. No folder listings. |
| `GET /tools-config.js` | the page | Tells the page which tools are switched off (from `tools.conf`). Never cached. |
| `POST /api/aggregate` | IP Aggregator | Reads the pasted text and returns the shortest CIDR list. Input up to `-max-mb`; processed in memory, not kept. `413` if too large, `503` if the server is busy, `429` over the visitor's limit. |
| `GET /api/facts` | Connection Facts | Returns the visitor's address, the server clock and an allow-list of request headers (below). |
| `GET /edge-probe.txt` | Connection Quality, Connection Facts | A tiny page with a fresh time stamp, marked `Cache-Control: public, max-age=300`, used to find a CDN. |
| `GET /cdn-cgi/trace` | Connection Quality | Cloudflare answers this itself and it never reaches the program. Without Cloudflare the program answers a plain "no Cloudflare trace here" so the page can tell there is no edge. |
| `GET /api/ping` | Connection Quality | Answered with the server's receive and send times. |
| `GET /api/seen` | Connection Quality | Asks whether an earlier probe reached the server. |
| `GET /api/monitor`, `POST /api/monitor` | Connection Quality | Monitor mode's exclusive claim ("lease"): GET says whether monitoring is possible now; POST takes or releases the claim. |
| `GET /api/download` | Connection Quality | Random bytes, at most 100 MB, for the speed test. The page cancels the transfer as soon as the speed is steady. |
| `POST /api/upload?run=ID` | Connection Quality | Read and thrown away, at most 50 MB. The bytes received so far are counted per test run (memory only) and returned in the `u` field of `/api/ping`, so the page measures the upload speed from what the server received. |
| `GET /api/hold` | Idle-timeout Finder | Holds a request open (see below). |
| `POST /api/unlock` | Locked tools | Only exists when `tools.conf` locks something. Body `{"code": "..."}`. A correct code answers `200` and sets the `mt_unlock` cookie (`HttpOnly`, `SameSite=Strict`, `Secure` over https, valid `lock.hours` hours); a wrong one answers `403` after a short delay; too many wrong ones answer `429` with `Retry-After`. See [Locking tools](configuration.md#locking-tools). |
| `POST /api/lock` | Locked tools | Clears the cookie ("lock again"). Only exists when something is locked. |

A tool that is switched off answers `404` for its endpoints and files.

## The visit log

For page analytics only, the program writes one line per event to a daily file `visits-YYYY-MM-DD.jsonl` in `-data-dir`
(mode `0600`, folder `0700`). Each line has: the time, the visitor's **IP address**, the **browser string** (user agent), the event
(`visit` = the page was opened, `app` = a tool's files were requested, `aggregate` = the aggregator was used) and the tool id.

Not logged: anything the visitor typed, pasted or opened (the logger never receives request bodies), the probe endpoints above, style
sheets, scripts and icons. Files older than `-retention-days` (default 90) are deleted automatically. `-data-dir ""` turns logging off.
The page shows a privacy notice on every visit that says exactly this; if you change what is logged, change the notice too.

## Connection Quality: what it uses

Small endpoints, none of them entered in the visit log: `/api/ping`, `/api/seen`, `/api/monitor`, `/api/download`, `/api/upload`.
A test run is remembered **in memory only**, for at most 3 minutes after its last probe, so the page can later ask whether a lost
probe had reached the server. Nothing is written to disk.

- **Monitor mode** keeps probing until Stop. By default one visitor at a time (`netquality.monitor_exclusive`); the claim is kept alive by the
  probes themselves and ends by itself 20 seconds after they stop (for example a closed tab), or after `netquality.monitor_minutes` plus one minute.
- **Fine detail** (Monitor mode only) probes every 50 ms instead of 200 ms; at most 24 probes may be unanswered at a time.
- Limits per visitor: `-rate-diag` and `-rate-heavy` (see [Configuration](configuration.md#per-visitor-limits)).

### CDN detection

To tell trouble between the visitor and a CDN from trouble beyond it, the page also probes the CDN's nearest data centre (the "edge").
Cloudflare is found through `/cdn-cgi/trace`. For any other CDN the page requests `/edge-probe.txt` twice, 0.7 seconds apart: the
same time stamp in both answers means something between the visitor and the server kept the first answer, and that is the edge. Without a
CDN every answer is new, so the page knows there is none. The CDN's name and data centre come from well-known response headers
(Cloudflare, Bunny CDN, Amazon CloudFront, Fastly, Akamai, Azure Front Door, KeyCDN); an unrecognised cache is called "the CDN". This needs
the CDN to cache `/edge-probe.txt`; if yours does not, the edge comparison is skipped.

## Connection Facts: what it returns

`GET /api/facts` returns the visitor's address (as resolved by `-real-ip-header`), a clock reading and an allow-list of request headers
that proxies and CDNs add (`Via`, `X-Forwarded-*`, `Forwarded`, `CF-Ray` and a few more). Cookies, authorisation and every other header are
never returned, values are cut at 200 characters, and addresses that belong to the inside of the hosting setup (private, loopback,
link-local) are replaced by `[internal address]`. It reads nothing from the operating system, starts no program and opens no raw
sockets. Nothing is logged or stored. It is switched off with `connfacts = false` (the edge probe and `/cdn-cgi/trace` stay while
Connection Quality is on).

## Idle-timeout Finder: what it uses

`GET /api/hold?secs=N` keeps a request open for N seconds without sending a single byte, then answers; with `&beat=15` it sends the
headers at once and one dot every 15 seconds. The page runs one of each at the same time and reports when something between the visitor
and the server cuts them (a proxy, CDN, load balancer or firewall timer). A repeated request (browsers quietly resend a request whose
connection was cut) is recognised by its random id and answered at once with how long ago the first one began. Nothing is read, logged
or stored beyond those random ids, which are forgotten after 15 minutes. Limits: at most `idletest.max_seconds` per request, 4 held
requests per visitor and 40 on the whole server; a held request costs one sleeping goroutine.

## Security measures

- **Headers on every answer:** `Content-Security-Policy: default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- **No outside code:** the page loads only its own files. Third-party libraries are vendored (see [`sbom.cdx.json`](../sbom.cdx.json)).
  There is no inline script, no `eval`, no `data:` or `blob:` image; text from files, certificates or visitors is shown with `textContent` only.
- **Limits:** per-visitor rate limits and parallel-job limits (see [Configuration](configuration.md)); refused requests never create limiter entries.
  Visitors are told apart by their real address, and a whole IPv6 /48 shares a bigger common budget.
- **The service file** runs the program as a throwaway user with a read-only system, no privileges, a private temporary folder and a
  system-call filter ([`deploy/michels-tools.service`](../deploy/michels-tools.service)).
- **What it does not do:** no TLS, no login, no reading of the TCP stack, no server-side ping or traceroute, no website or certificate checks
  of other hosts. The program never contacts another machine.

To report a vulnerability, see [`SECURITY.md`](../SECURITY.md).
