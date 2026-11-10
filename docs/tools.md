# Tools

Everything opens from three folders on the desktop (or from the **Michel's Tools** menu at the bottom left). Each tool has an **id**;
that is the name you use in [`tools.conf`](configuration.md#choosing-which-tools-to-offer-toolsconf) to switch it off. The folder ids are
`network`, `pdf` and `trouble`.

**Where the work happens.** Except where it says "uses the server", a tool runs **inside the visitor's browser**: nothing typed, pasted
or opened is sent anywhere. The server only serves the files. What the server does see and store is described in
[Server behaviour](server.md).

## Network Tools (`network`)

| id | Tool | What it does |
|---|---|---|
| `aggregator` | IP Aggregator | Paste anything that contains IPv4/IPv6 addresses or subnets (a list, a routing table, a firewall export, a log; text is ignored) and get the **shortest list of CIDR blocks** that covers exactly the same addresses. Output formats: plain CIDR list, FortiGate address objects + group, MikroTik address-list, Juniper prefix-list, Palo Alto address objects + group, Linux ipset, Linux nftables set. Large inputs can be loaded from a file (up to `-max-mb`). **Uses the server** (`POST /api/aggregate`); the text is processed in memory and not kept. |
| `subnet` | Subnet Calculator | Network, broadcast, mask, wildcard, first/last usable address, host counts and address type for an address and mask (or `10.0.0.5/24`), plus the list of usable addresses. |
| `splitter` | Subnet Splitter | Split a network into subnets of a chosen size, into a number of equal parts, or by the hosts each subnet needs (VLSM, largest first). |
| `checker` | IP Checker | Check which addresses or subnets are covered by your list of subnets (a subnet counts as covered only if it fits completely inside one of yours); also converts between ranges and CIDR and merges overlapping or touching ranges. |
| `ipv6calc` | IPv6 Calculator | IPv6 prefixes and addresses: expanded and compressed forms, address type, splitting a prefix, reverse DNS names. |
| `ipconv` | IP & Number Converter | Converts an address or number between decimal, hexadecimal, binary and the unusual forms some tools accept; reverse DNS names. |
| `maclookup` | MAC Lookup | Manufacturer of a MAC address from the IEEE lists (MA-L, MA-M, MA-S), the address in every common format, and whether it is a random (privacy) address. Fetches one static list, `web/vendor/oui.json`. |
| `portref` | Port Reference | What a port number is used for, and which ports are cleartext, often attacked or unofficial. A hand-written list. |
| `certdecode` | Certificate Decoder | Reads certificates, chains and certificate requests (CSRs) and checks the signatures in the browser. **Private keys are refused.** |
| `mailhdr` | Email Header Analyser | Route and delay per hop of a pasted e-mail header, SPF/DKIM/DMARC results, hints of a forged sender. |

## PDF Tools (`pdf`)

All of these work on the file in the visitor's browser. The original file is never changed: the result is a new download.

| id | Tool | What it does |
|---|---|---|
| `pdfinfo` | PDF Info | Who made the file and with which program, when it was created and changed, whether it was edited after it was first saved, and what it contains (signatures, attachments, scripts, forms). |
| `pdfverify` | Verify Signatures | Checks that each digital signature is mathematically valid and that the document has not changed since signing. It **does not** check whether the signer's certificate is trusted or revoked, and the page says so. |
| `pdfmeta` | Metadata | Read, change or remove the details stored in a PDF (title, author, program, dates, hidden properties, older saved versions). |
| `pdfstamp` | Add Image / Signature | Places a picture (for example a scanned signature) on a page. It is a picture, **not a digital signature**, and the page says so. |
| `pdfwatermark` | Watermark & Page Numbers | Adds a text or picture watermark, page numbers, or a header and footer (any language). |
| `pdfpages` | Split / Extract Pages | Keep only some pages, or split into several files (every N pages, each page, or at chosen ranges). |
| `pdfmerge` | Merge PDFs | Join several PDFs, optionally choosing pages from each. |
| `pdforganize` | Organize Pages | Reorder, rotate, delete, duplicate and insert blank pages. |
| `pdfcrop` | Crop / Resize Pages | Cut margins by dragging a box, trim empty edges automatically, or change the page size (A4, Letter and others). Cropping hides but does not erase. |
| `pdfredact` | Redact | Blacks out parts of a PDF **for good**. Draw boxes by hand or search the text (a word or phrase, e-mail addresses, phone numbers, long numbers). Every page with a box is drawn to a picture with the boxes burned in and put into a new file, so the hidden text no longer exists in it. The new file is checked with the PDF reader itself (a changed page must hold no text) and nothing is downloaded if it fails; a searched word that still appears on a page without a box is reported. Pages without boxes are copied unchanged. A found match is covered together with the whole piece of text it is in, to be safe. Scanned pages have no text to search, so draw their boxes by hand. Bookmarks, attachments and the document properties are not carried over unless asked. Password-protected or restricted PDFs are refused. Keep your original: a redacted copy cannot be undone. |
| `pdfimages` | Images / PDF Converter | Pictures to PDF (one per page, with page size, direction and border choices) and PDF pages to pictures (results are kept in browser memory, capped at 600 MB; saved as a ZIP). |
| `pdfextract` | Extract Content | Take out the text, the pictures and the attached files of a PDF. |

Known limits: merging, organising and resizing can drop links, bookmarks and form fields; changing a signed PDF makes its signature show as
changed (the tools warn about this).

## Troubleshooting (`trouble`)

| id | Tool | What it does |
|---|---|---|
| `netquality` | Connection Quality | Judges the link between the visitor's device and this server. **Speed** (how long answers take) and **quality** (how steady and complete) are scored separately. It finds each hiccup, says which direction it happened in (to the server or back), what it looks like (a re-sent packet, a repeating schedule, a lasting change, an outage), whether the device or the network was responsible, and what happens to delay while the line is busy. A button marks the moment the visitor notices a problem. A quick test (about 30 seconds) and **Monitor mode** (until Stop, see [settings](configuration.md#tool-settings)); results can be saved as a text or HTML report. **Uses the server** (small probe endpoints, see [Server behaviour](server.md)). |
| `connfacts` | Connection Facts | What the site sees of the visitor and how they reach it: public address (IPv4 or IPv6), which CDN and data centre answered, web protocol, encryption, the headers a proxy or CDN added, the browser's network estimate, a clock check against the server, and where the time goes (DNS, connecting, handshake, waiting). Can be copied or saved as text. It does **not** show the visitor's country. **Uses the server** (`GET /api/facts`). |
| `idletest` | Idle-timeout Finder | Keeps two quiet requests open (one with a small heartbeat) and shows how long the path lets a quiet connection live, and whether a heartbeat avoids the limit. **Uses the server** (`GET /api/hold`); see the limits in [Server behaviour](server.md). |
| `pathread` | Ping & Traceroute Reader | Explains pasted output of ping, tracert/traceroute, mtr/WinMTR and pathping: which loss is real and which is only a router declining to answer, where the delay jumps, a routing loop, whether the target was reached. Sends nothing. |
| `browsercaps` | Browser Capability Report | Lists what the browser and device can do and whether the tools here will work. Makes no request. |
