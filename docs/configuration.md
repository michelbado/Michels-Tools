# Configuration

There are two places to configure Michel's Tools:

- **Command-line flags** for the server itself (address, limits, logging, memory). Run `./michels-tools -h` for the same list.
- **`tools.conf`**, a small text file that switches tools on or off and sets a few tool options.

## Choosing which tools to offer (`tools.conf`)

Every tool is on by default. To change that:

1. Copy [`deploy/tools.conf.example`](../deploy/tools.conf.example) to `tools.conf` **next to the program** (or keep it anywhere and
   start the program with `-tools-config /path/to/file`).
2. Edit it. One setting per line, `name = true` or `name = false`; `#` starts a comment.
3. Restart the service (`systemctl restart michels-tools`). The file is read once at startup.

Rules:

- **A tool you do not list is on.** With no `tools.conf` at all, everything is on.
- **Off means gone:** no icon, no menu entry, and the tool's files and server API answer `404 Not Found`.
- **Folders:** `network`, `pdf`, `trouble`, `certs`, `engineering`, `images`, `reference` and `games` switch a whole folder. If a folder says `false`, every tool inside it is off whatever the
  tool's own line says. A folder whose tools are all off disappears from the desktop.
- **A typo stops the program at startup** with the line number, so a misspelled name can never leave a tool switched on by accident.
- **A third choice, `locked`:** see [Locking tools](#locking-tools) below.

Example, turning off the PDF folder's image converter and the whole Troubleshooting folder:

    pdfimages = false
    trouble = false

The tool names (ids) are listed in [Tools](tools.md); the example file has every one of them, all `true`.

### Locking tools

Write `locked` instead of `true` for a tool, or for a whole folder, to keep it visible but out of casual hands:

    qrcode = locked
    pdf = locked
    lock.code = a code of your own

- The icon stays on the desktop and in the menu, with a padlock. Clicking it opens a small window that asks for the **access code**. One code is shared by every locked tool.
- The check is made **by the server**: a locked tool's files and its server calls (for example `/api/aggregate` for the IP Aggregator) answer `401` until the code has been entered. Its icon stays public.
- A correct code sets a cookie that lasts `lock.hours` hours (12 by default). The cookie is signed with a key made from the code, so **changing the code logs everybody out**, while restarting the program does not.
- A folder that says `locked` locks every tool in it (for example `games = locked`, or just `pool = locked` for one game). A tool that is switched off stays off.
- **A locked tool with no `lock.code`, or a code shorter than 4 characters, stops the program at startup**, so a tool can never end up open by mistake.
- **A short code is easy to guess.** A 4-digit PIN has only 10,000 possibilities. The limit on wrong codes (8 per address in 10 minutes) slows guessing a lot, but it does not make a short PIN strong; use 8 or more characters for anything that matters. The limit works both ways: someone who keeps entering wrong codes from many addresses can make the server refuse everybody for a while.
- The code is plain text in `tools.conf`: keep that file readable by the service account only (`chmod 600`). It may contain spaces and `#`, so **no comment may follow it on its line**.
- Wrong codes are counted: 8 wrong codes from one address in 10 minutes, or 120 from all addresses together, make the server answer `429` ("try again in ...") until the window has passed, and every wrong code is slowed down.
- Use https (a reverse proxy or tunnel in front of the program), or the code and the cookie travel in clear text. Behind a proxy that does not forward `X-Forwarded-Proto`, the cookie is not marked `Secure`.

What this is **not**: there are no user accounts, nobody can be locked out individually, and it does not protect secrets. Tools run in the visitor's browser and the shared libraries under `/lib` stay public (as does this source code), so the lock keeps people from *using* the tool, not from reading how it works.

### Tool settings

Some tools have options, written `tool.setting = value`. The value shown is the default; a value outside its range stops the
program at startup.

| Setting | Default | Range | What it does |
|---|---|---|---|
| `netquality.monitor` | `true` | true/false | Offer Monitor mode in Connection Quality (it keeps probing the link until the visitor presses Stop). `false`: only the 30-second quick test. |
| `netquality.monitor_exclusive` | `true` | true/false | Only one visitor may monitor at a time; for everyone else the option is greyed out until they press Stop. |
| `netquality.monitor_minutes` | `10` | 1 to 60 | The longest a monitoring run may last. |
| `netquality.monitor_fine` | `true` | true/false | Allow "fine detail" (20 probes a second instead of 5). It catches 50 ms hiccups but sends four times the requests. |
| `idletest.max_seconds` | `300` | 30 to 600 | The longest a single held request of the Idle-timeout Finder may last. |
| `lock.code` | empty | 4 or more characters | The shared access code for tools marked `locked` (see [Locking tools](#locking-tools)). Required when anything is locked. No comment may follow it on its line. |
| `lock.hours` | `12` | 1 to 168 | How long an entered code stays valid in the visitor's browser. |

## Flags

Flags go on the command line, or on the `ExecStart=` line of the service file.

### Network and proxy

| Flag | Default | Meaning |
|---|---|---|
| `-addr` | `127.0.0.1:8080` | Address and port to listen on. Use `0.0.0.0:8080` only if something else protects it. |
| `-real-ip-header` | (none) | Header that carries the visitor's real address when you run behind a proxy or tunnel, e.g. `X-Forwarded-For` or `CF-Connecting-IP`. See [Installation](installation.md#use-a-reverse-proxy-or-tunnel-of-your-own-strongly-advised). |
| `-trusted-proxies` | this machine | Addresses or CIDR ranges allowed to set that header (comma separated). Default: `127.0.0.0/8` and `::1`. |

### Tools

| Flag | Default | Meaning |
|---|---|---|
| `-tools-config` | `tools.conf` next to the program | Where to read the tool switches from. Missing file: everything on. |

### Visit log

| Flag | Default | Meaning |
|---|---|---|
| `-data-dir` | `$STATE_DIRECTORY` | Folder for the visit log. Empty turns logging off. systemd sets `STATE_DIRECTORY` for you. |
| `-retention-days` | `90` | Days to keep daily log files; older files are deleted automatically. |

What is logged is described in [Server behaviour](server.md#the-visit-log).

### Size, memory and parallel work

| Flag | Default | Meaning |
|---|---|---|
| `-max-mb` | `50` | Largest input the IP Aggregator accepts, in MB. |
| `-jobs` | `0` (automatic) | Aggregations running at the same time. `0` = about one per 200 MB of available memory, between 1 and 16. |
| `-queue` | `20` | Requests allowed to wait for a free slot; beyond that the answer is "Server busy". |
| `-queue-wait` | `60s` | How long a request may wait for a slot. |
| `-mem-percent` | `80` | Soft memory limit for the program as a percent of the memory available to it. `0` = leave it to the Go runtime or `GOMEMLIMIT`. |

### Per-visitor limits

Visitors are told apart by their real address (see `-real-ip-header`). `0` turns a limit off. A visitor over a limit gets `429 Too Many Requests`.

| Flag | Default | Meaning |
|---|---|---|
| `-rate-api` | `30` | Aggregations per visitor per minute. |
| `-rate-page` | `600` | Page and file requests per visitor per minute. |
| `-ip-jobs` | `2` | Aggregations one visitor may run at the same time. |
| `-rate-diag` | `1800` | Connection Quality probes per visitor per minute. Fine-detail Monitor mode sends 1200 a minute. |
| `-rate-heavy` | `6` | Connection Quality download/upload transfers per visitor per minute, one at a time. |
| `-rate-net-scale` | `50` | How many times one visitor's budget a whole IPv6 /48 network may use together. A /48 is normally one site; raise it for big shared networks. |

## Sizing: memory and parallel jobs

Nothing needs editing for a bigger or smaller machine:

- The service file limits memory to a **percentage of the machine's RAM** (`MemoryMax=70%`). Change it with `systemctl edit michels-tools`.
- The program reads the memory limit that systemd gives it (or the machine's RAM if there is none) at startup, keeps below
  `-mem-percent` of it (80%), and runs about one aggregation per 200 MB at once (`-jobs`, 1 to 16; give a number to override).
- On a 1 GB machine this means about 3 parallel jobs and a ceiling of roughly 700 MB; on a 64 GB server it scales up by itself.
- The other limits above (`-max-mb`, `-queue`, `-rate-*`) are fixed numbers: raise them if many visitors share one address (an office,
  a mobile network).

## Settings and the public repository

`tools.conf` is machine-specific and is not part of the repository (it is git-ignored); only the commented example is.
