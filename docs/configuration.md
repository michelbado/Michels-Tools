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
- **Folders:** `network`, `pdf` and `trouble` switch a whole folder. If a folder says `false`, every tool inside it is off whatever the
  tool's own line says. A folder whose tools are all off disappears from the desktop.
- **A typo stops the program at startup** with the line number, so a misspelled name can never leave a tool switched on by accident.

Example, turning off the PDF folder's image converter and the whole Troubleshooting folder:

    pdfimages = false
    trouble = false

The tool names (ids) are listed in [Tools](tools.md); the example file has every one of them, all `true`.

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
