# Installation

## What you need

- A Linux (or any) machine with **Go 1.24 or newer** to build the program. The built program is one file; the web pages are inside it.
- Nothing else: the server uses only Go's standard library and needs no database.

## Before you run it: choose your tools and assess the risk

> **Warning.** Out of the box **every tool is switched on**. Before you make the program reachable by anyone other than yourself,
> review `tools.conf` and decide, tool by tool, whether you want to offer it. Every tool you offer costs something (bandwidth, memory,
> open connections, your attention) and gives you more to defend. Switch off what you do not need.

Take ten minutes for a short risk assessment first:

1. **Who can reach it?** Only you, your own network or VPN, or the whole internet? The wider the audience, the fewer tools and the
   stricter the limits should be.
2. **What can your machine and your internet line afford?** Most tools run in the visitor's browser and cost you only the files they are
   served from (a few MB on a first visit). A few tools deliberately use the server:

   | Tool (id) | What it costs the server | How to reduce it |
   |---|---|---|
   | Connection Quality (`netquality`) | A speed test that downloads and uploads data (at most 15 MB on the default Light level, 150 MB on Full; the visitor chooses, and it stops as soon as the speed is steady), plus a steady stream of small probes. One transfer at a time per visitor, 6 a minute at the defaults (`-rate-heavy`), up to 1,800 probes a minute. Monitor mode keeps one visitor probing for up to 10 minutes. | `netquality = false`, or keep the tool and set `netquality.monitor = false`, `netquality.monitor_fine = false`, a lower `-rate-heavy` and `-rate-diag` |
   | Idle-timeout Finder (`idletest`) | Holds connections open, up to 300 seconds each by default (at most 600), 4 per visitor and 40 in total. Almost no bandwidth, but every held request occupies a connection on your proxy, CDN or firewall. | `idletest = false`, or a lower `idletest.max_seconds` |
   | IP Aggregator (`aggregator`) | The only tool that sends text to the server: up to `-max-mb` (50) per request, processed in memory, several at once. Costs CPU and memory. | `aggregator = false`, or a lower `-max-mb`, `-rate-api` and `-jobs` |
   | Connection Facts (`connfacts`) | Almost nothing: one small answer showing the visitor's own address and proxy headers. | `connfacts = false` if you do not want to show those |

   **Rule of thumb:** if the machine has little bandwidth (a home or metered line, a small virtual server) or cannot afford busy connections,
   **do not offer the connection-testing tools** (`netquality`, `idletest`). They exist to push traffic over the visitor's connection and to your server, so
   they will crowd out the real users of the same line. Lower the aggregator limits as well.
3. **Limits are per visitor, not per crowd.** The built-in rate limits stop one visitor from using too much; they cannot stop many
   visitors at the same time. For that, use the limits of your reverse proxy or CDN (see below).
4. **What will you log, and are you allowed to?** The visit log stores each visitor's IP address and browser string, which is personal data in
   many places (for example under the GDPR). It is off when you run the program by hand and on in the systemd service. Decide whether you want it,
   for how long (`-retention-days`), or turn it off (`-data-dir ""`). The page shows a privacy notice on every visit; it says that IP address and
   browser type are collected, so if your setup logs something else, edit the notice in `web/index.html` before you build. Servers that lock tools also note the address and browser string of every wrong access code in the system log (never the code); the notice says so too.
5. **Nothing here reaches other machines.** No tool makes the server contact anything else: no scanning, no proxying, no outgoing requests. The
   tools cannot be turned into a relay against a third party.

Then act on the result:

1. Copy [`deploy/tools.conf.example`](../deploy/tools.conf.example) to `tools.conf` next to the program.
2. Go through it line by line and set every tool you do not want to offer to `false` (or to `locked`, to keep it visible but behind an access code: see [Locking tools](configuration.md#locking-tools)) (and a whole folder with `network`, `pdf`, `trouble`, `engineering`, `images` or `reference`).
3. Decide the limits and the log (see [Configuration](configuration.md)).
4. Start the program. A tool that is off is really gone: its files and API answer `404 Not Found`.

## Build and run

    go build -o michels-tools .
    ./michels-tools

By default it listens on `127.0.0.1:8080`, which means **only this machine can reach it**. Open `http://127.0.0.1:8080/`.
Every setting is a command-line flag; see [Configuration](configuration.md) (or run `./michels-tools -h`).

## Run it as a service (systemd)

`deploy/michels-tools.service` is a ready-made unit. It runs the program as a throwaway user in a hardened sandbox, listens on
`127.0.0.1:8080`, keeps the visit log in `/var/lib/michels-tools` (readable by root and the service only) and limits memory to a
percentage of the machine's RAM.

1. Put the program at `/opt/michels-tools/michels-tools` (or change the path in the file).
2. Install and start it:

       cp deploy/michels-tools.service /etc/systemd/system/
       systemctl daemon-reload
       systemctl enable --now michels-tools

3. After building a new version: `systemctl restart michels-tools`.

Change flags on the `ExecStart=` line, or use `systemctl edit michels-tools`.

## Use a reverse proxy or tunnel of your own (strongly advised)

**The program speaks plain HTTP only. It does no TLS (https) and has no login.** Do not expose its port directly to the internet.
Put a reverse proxy or a tunnel that you run and trust in front of it, and let that component:

- **terminate TLS** (certificates, https, HTTP/2 or HTTP/3);
- apply whatever access control, firewall or abuse protection you need;
- pass the visitor's real address on (see below).

Which product you use is your choice; this guide does not recommend one. Things to know when you set it up:

1. **Keep the program on the loopback address** (the default) when the proxy is on the same machine, and make sure nobody can
   reach port 8080 directly. Otherwise a visitor could invent an address and dodge the per-visitor limits.
2. **Tell the program how to find the real visitor address.** Behind a proxy every connection comes from the proxy. Use
   `-real-ip-header` to name the header that carries the visitor's address (for example `X-Forwarded-For`, or `CF-Connecting-IP`
   behind Cloudflare). The program believes that header **only** when the connection comes from an address in `-trusted-proxies`
   (default: this machine). If the proxy runs on another machine, list its address there. When several values are present the
   last one, the one your own proxy added, is used.
3. **Let the proxy set or append that header itself** and never pass through a value the visitor sent.
4. **Request size:** the IP Aggregator accepts input up to `-max-mb` (default 50). A proxy limit below that cuts large uploads off.
5. **Timeouts:** the Idle-timeout Finder deliberately holds a request open for up to `idletest.max_seconds` (default 300, at most 600).
   A proxy that closes quiet connections sooner will be reported by the tool, which is its purpose; if you want the tool to measure
   the path beyond your proxy, allow longer timeouts or accept the proxy's limit as the answer.
6. **Do not buffer** responses of `/api/hold` if your proxy has such an option (the program sends `X-Accel-Buffering: no`).
7. **CDN caching:** if a CDN sits in front, the Connection Quality tool identifies it through `/cdn-cgi/trace` (Cloudflare) or by
   caching `/edge-probe.txt`; see [Server behaviour](server.md#cdn-detection).

Without HTTPS everything still works: Verify Signatures normally uses the browser's WebCrypto, which browsers only offer on https
and on localhost, and falls back to its own built-in code (same results, slower) on a plain http address.

## Updating

Pull or copy the new source, `go build -o michels-tools .`, then restart the service. Your `tools.conf` and the visit log are
not touched. Read the [changelog](../CHANGELOG.md) first if you changed settings.

## Uninstalling

    systemctl disable --now michels-tools
    rm /etc/systemd/system/michels-tools.service /opt/michels-tools/michels-tools
    rm -r /var/lib/michels-tools      # the visit log: delete only if you no longer need it
