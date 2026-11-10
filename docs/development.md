# Development

## Layout

- Go server in the repository root: `main.go` (flags, security headers, file serving), `aggregate.go` (the IP/subnet parser and
  aggregation engine), `analytics.go` (visit log), `clientip.go` (real visitor address behind a proxy), `ratelimit.go`, `diag.go` /
  `facts.go` / `hold.go` (the Troubleshooting endpoints), `resources.go` (memory and job sizing), `tools.go` (`tools.conf`).
  Tests are the `*_test.go` files.
- `web/`: the page (`index.html`, `shell.js` = window manager, taskbar and menu, `shell.css`, `xp.css`), `apps/<id>/` (one folder per tool:
  `app.html`, `app.css`, `app.js`, `icon.svg`), `lib/` (shared code, mostly pure functions that run in the browser and in tests),
  `vendor/` (third-party libraries, see below), `brand/` (logo files). The whole folder is embedded in the program.
- `deploy/`: the service file and `tools.conf.example`.
- `docs/`: this guide.

## Build and test

    go build -o michels-tools .
    go vet ./... && go test ./...

`go test` also checks that the documentation and the code agree (see below). The browser-level test suites are not part of this
repository.

## Adding a tool

1. Create `web/apps/<id>/` with `app.html`, `app.css`, `app.js` and `icon.svg`. Prefix every element id in `app.html` with the tool's
   id (ids are document-wide).
2. Register it in `APPS` at the top of `web/shell.js` (the comment there explains the fields) and add its id to `toolFolders` in `tools.go`.
   `go test` fails if the two lists differ.
3. Add it to `deploy/tools.conf.example` (a test checks this too).
4. Describe it in [Tools](tools.md), and in [Server behaviour](server.md) if it adds an endpoint. A test fails if a tool or endpoint is missing there.
5. Bump `VERSION` in `web/shell.js` and the `?v=` numbers in `web/index.html` together (cache busting).

A shared script (`web/lib/`) loaded as a tool's dependency runs in no fixed order relative to the others: it must not touch another
library at load time, only on first use.

## Rules the project keeps

- **Privacy:** the page shows a privacy notice on every visit; it must stay true. Nothing typed, pasted or uploaded is collected; only
  the visitor's IP address and browser string are logged. PDFs never leave the browser.
- **Strict Content-Security-Policy** (`default-src 'self'`): no inline scripts or styles, no `eval`, no outside code, no `data:`/`blob:`
  images. Set styles from CSS classes or `element.style`, draw images on a canvas. Anything from a file, certificate or visitor is shown with `textContent`.
- **Honest wording:** Verify Signatures must keep saying what it does not check; Add Image / Signature must keep saying it is a picture and not a
  digital signature; Redact must keep saying a redacted copy cannot be undone.
- **Original artwork and wording:** no third-party trademarks in the product text.

## Third-party libraries

`sbom.cdx.json` in the repository root is the **only** inventory of vendored libraries, fonts and data (versions, licences, SHA-256).
`web/vendor/README.md` explains how each file was obtained and how to update it. When you replace a vendored file, update its entry in the
SBOM; `go test` fails if a file and its entry disagree, if a licence text is missing, or if `go.mod` gains a dependency.

## Automatic checks (GitHub Actions)

`.github/workflows/ci.yml` runs on every push, every pull request and once a week (new vulnerabilities appear after a release):

- **build and tests:** `go vet` and `go test` (which includes the documentation and SBOM checks);
- **Go vulnerability check:** `govulncheck` against Go's official vulnerability database, including the standard library, using the latest stable Go (build the program with a Go version that still gets security fixes);
- **vendored libraries:** the libraries in `web/vendor` are copied files that dependency tools cannot see, so the SBOM (`sbom.cdx.json`)
  is scanned against the open vulnerability database (osv.dev); `osv-scanner.toml` leaves the Go standard library to `govulncheck`.

The workflow has no secrets and a read-only token, and each action is pinned to an exact commit and the runner image is fixed (`ubuntu-24.04`); update them deliberately.
A failing run emails the repository owner. A vulnerable vendored library means: update the file and its SBOM entry (see above).

## Keeping this guide true

`go test` (`docs_test.go`) fails when: a tool id is missing from [Tools](tools.md); a `tools.conf` setting is missing from
[Configuration](configuration.md); a command-line flag is missing from [Configuration](configuration.md); an endpoint is missing from
[Server behaviour](server.md); or a link inside the documentation points nowhere. Wording still needs a human: when behaviour changes, change the page.
