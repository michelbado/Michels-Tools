# Third-party libraries (vendored)

**What is in here, with versions, licences and SHA-256 checksums: see `sbom.cdx.json` in the repository root** (the only inventory;
`go test` fails if it and these files disagree). Licence texts are in `licenses/` (and `pdfjs/standard_fonts/LICENSE_*`).
This file only says HOW the files were obtained and how to update them.

Everything is served from this server, so the strict Content-Security-Policy (`default-src 'self'`) needs no outside sources.

## Downloaded libraries (pdf.js, pdf-lib, fflate)

Each npm tarball was downloaded from registry.npmjs.org and checked against the sha512 integrity value the registry publishes for
that exact version before the files were copied out of it. pdf.js also ships its worker and its `standard_fonts/` folder (unmodified).
pdf-lib's file is a bundle: it contains pako, tslib, @pdf-lib/upng and @pdf-lib/standard-fonts (listed in the SBOM).

To update one: download the new tarball, verify its integrity against the registry, replace the files, update `sbom.cdx.json`
(version, hash, licence if it changed), run `go test` and the PDF tests.

pdf.js is always used with eval disabled (`isEvalSupported: false`) and scripting off.

## pkijs.bundle.js (signature checking)

One file that defines `window.pkijs` and `window.asn1js`. It is NOT a download: it was built from the npm packages listed in the SBOM
(each downloaded and integrity-checked as above) with esbuild 0.28.2 (also integrity-checked; a build tool only, it does not ship).
Entry file:

    import * as pkijs from "pkijs";
    import * as asn1js from "asn1js";
    globalThis.pkijs = pkijs;
    globalThis.asn1js = asn1js;

Command (packages unpacked in ./node_modules):

    esbuild entry.js --bundle --format=iife --minify --target=es2020 --legal-comments=none --outfile=pkijs.bundle.js

pkijs needs the browser's WebCrypto (crypto.subtle), which browsers only provide on https pages and on localhost.

## oui.json (MAC Lookup)

Built from the manufacturer lists of the IEEE Registration Authority (public data; the three download addresses and the download day are
in the SBOM): MA-L (24-bit blocks), MA-M (28-bit) and MA-S (36-bit).
Only the assignment code and the organisation name are kept (street addresses are dropped); names are stored once in `n` and the three
blocks `l`, `m`, `s` point to them by index; `date` is the download day.
To update: download the three CSV files again and rebuild the JSON (a few lines: read the CSV, keep the code and the name, store each
name once); update the SBOM hash and date; run maclib-test.js.
