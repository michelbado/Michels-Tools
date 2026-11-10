# Security policy

## Reporting a vulnerability

Use **GitHub private vulnerability reporting**: open the **Security** tab of this repository and click **Report a vulnerability**. Only the maintainer (Michel Bado) can read the report. Please do not open a public issue for a security problem.

Useful things to include:

- what the problem is and where (file, tool or endpoint);
- how to reproduce it (steps, a sample input, the version or commit you tested);
- what you think an attacker could do with it.

This is a one-person project: I will read every report and answer as soon as I can, but I cannot promise a fixed response time.
Please give me reasonable time to fix a problem before you publish it, and I will say in the changelog when it is fixed.

## Supported versions

Only the latest release (the newest tag, and `main`) receives fixes.

## What is in scope

- The Go server in this repository and its web files (`web/`, except `web/vendor/`).
- The default configuration in `deploy/`.

Examples: bypassing the per-visitor limits, reading something the server should not return, a cross-site scripting hole, a way to make the
server run out of memory with a small request, a tool that sends data it says it keeps in the browser.

## What is out of scope

- Problems in third-party libraries under `web/vendor/` (see [`sbom.cdx.json`](sbom.cdx.json)): please report them to the library's own maintainers.
  I will update the vendored copy once a fix exists.
- Missing TLS, or exposing the program directly to the internet: it speaks plain HTTP by design and must run behind a reverse proxy or
  tunnel of your own (see [Installation](docs/installation.md)).
- Heavy traffic from many machines that no per-visitor limit can stop, and problems that need access to the server itself.
- Findings that need an unusual or outdated browser, or the visitor's own cooperation (for example pasting hostile text and then ignoring a warning).

## What the project does for security

See [Server behaviour: security measures](docs/server.md#security-measures).
