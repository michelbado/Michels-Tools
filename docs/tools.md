# Tools

Everything opens from six folders on the desktop (or from the **Michel's Tools** menu at the bottom left). Each tool has an **id**;
that is the name you use in [`tools.conf`](configuration.md#choosing-which-tools-to-offer-toolsconf) to switch it off. The folder ids are
`network`, `pdf`, `trouble`, `engineering`, `images` and `reference`.

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
| `certdecode` | Certificate Decoder | Reads certificates, chains and certificate requests (CSRs) and checks the signatures in the browser. **Private keys are refused.** |
| `mailhdr` | Email Header Analyser | Route and delay per hop of a pasted e-mail header, SPF/DKIM/DMARC results, hints of a forged sender. |
| `mailauth` | SPF, DKIM & DMARC Reader | Paste DNS text records and get them explained in plain words, with the mistakes marked. **SPF:** every term and what it allows, the 10-lookup limit (counted from the record itself, since nothing is looked up), `+all`/`?all`/missing `all`, `ptr`, invalid addresses, terms after `all`. **DMARC:** policy, subdomain policy, percentage, alignment, report addresses, missing or invalid tags. **DKIM:** the key type and real key size read from the key itself (RSA 1024 or less flagged, 2048 recommended; Ed25519 length), revoked keys, testing mode. Quotes, split strings and zone-file lines are accepted. It looks nothing up and sends nothing. |
| `mtucalc` | MTU & MSS Calculator | The largest packet that fits through a stack of up to three layers (PPPoE, MPLS, IP-in-IP, GRE, 6in4, DS-Lite, WireGuard, VXLAN, IPsec ESP with AES-GCM, ChaCha20-Poly1305 or AES-CBC with HMAC-SHA-1, -256, -384 or -512, with NAT-T and transport mode) on a link of your MTU, over IPv4 or IPv6. Gives the TCP MSS to announce or clamp, the largest UDP and ping payloads, ready-made ping commands for testing, MSS clamping examples (Linux, Cisco, MikroTik, FortiGate), and turns a ping test result back into a path MTU. Pure arithmetic: it reads nothing from your device or network. |

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
| `httphdr` | HTTP Header Reader | Paste the response headers of a web page (`curl -I`, `curl -sv`, or the browser's developer tools). Checks the security headers (HSTS, Content-Security-Policy, X-Content-Type-Options, clickjacking protection, Referrer-Policy, Permissions-Policy), cookies (Secure, HttpOnly, SameSite, `__Host-` rules; cookie values are never shown or copied), caching with cookies, CORS mistakes, version numbers the server gives away, redirect chains, and which CDN answered. It makes no request. |

## Engineering Tools (`engineering`)

Everyday tools for developers, system administrators and network engineers. All of them run in the browser: nothing typed or pasted is sent anywhere, and no tool makes a request on your behalf.

| id | Tool | What it does |
|---|---|---|
| `urlparse` | URL Parser | Splits a web address into scheme, user name, password, host, port, path (and each segment), every query parameter with its decoded value, and the fragment. Warns about tricks: a site name before an `@` (`https://paypal.com@evil.example`), look-alike letters in an international domain name (shown as it reads, decoded from `xn--`), an address written as a number or in hexadecimal, passwords or tokens inside the address, path traversal patterns, repeated parameters. |
| `jwtdecode` | JWT Decoder | Reads a JSON Web Token: header and payload as JSON, the times (`exp`, `iat`, `nbf`) as dates with "expired 3 days ago", and each claim explained. Flags `alg: none`, missing or very long expiry, millisecond timestamps, `jku`/`x5u`/`jwk` headers and suspicious `kid` values. **Decoding is not verifying**, and the tool says so. Optionally checks the signature (HS, RS, PS and ES algorithms) with a secret, a public key, a certificate or a JWK; private keys are refused. It tells people not to paste live tokens. |
| `basicauth` | Basic Auth Generator | Makes the `Authorization: Basic ...` header from a user name and password (with the matching `curl` commands) and reads one back. Says plainly that Base64 is not encryption. |
| `xmljson` | XML & JSON Converter | Converts both ways with a stated convention: attributes become `@name`, mixed text becomes `#text`, repeated elements become arrays, an empty element becomes an empty text; optional "always arrays" and "numbers and true/false". XML that is not well-formed is refused with a message that names the problem and its line and column; well-formed XML is read by the browser's own parser, which never loads external files. Says what is lost (comments, the position of text between elements). Input up to 2 MB. |
| `crontab` | Crontab Generator | Explains a standard cron expression in plain words ("At 08:00, on weekdays"), builds one from five boxes or examples, shows a full crontab line with a command, and lists the next 5, 10 or 20 run times in UTC or local time. Warns about the usual traps: day of month and day of week together (cron runs when either matches), dates that never exist, an unescaped `%`, Quartz-only syntax (`L`, `?`, `#`, `W`). Daylight-saving changes are not modelled. |
| `chmodcalc` | chmod Calculator | Permissions as tick boxes, as an octal number (755, 4755), as letters (`rwxr-xr-x`, an `ls -l` line) or as a chmod expression applied to the current mode (`u+x,go-w`), for a file or a directory; the `chmod` commands to use; what each permission means; warnings (777, world-writable, setuid); and a umask helper. |
| `colorconv` | Color Converter | Reads a colour as a name (all 148 CSS names), hex (3, 4, 6 or 8 digits), `rgb()`, `hsl()` or `hwb()` and shows it in every form, with CMYK, the nearest CSS name, a picker, a list of all names, and WCAG contrast against white and black. |

## Image Tools (`images`)

Tools for pictures. All of them run in the browser: the picture is read from the file you open, nothing is uploaded, and the original file is never changed (you save a new copy). Further image tools will be added to this folder.

| id | Tool | What it does |
|---|---|---|
| `imgexif` | Photo Info & Privacy (EXIF) | Opens a JPEG, PNG or WebP and shows the hidden data inside it: camera and lens, date and time, exposure settings, and above all **where it was taken** (GPS, shown as numbers; the tool makes no map request), serial numbers, the owner's or photographer's name, comments, an embedded thumbnail, and other data such as XMP, IPTC and text notes. A summary says what the picture gives away. Every item has a tick box to keep or remove it. An **Edit details** panel is always shown, even for a picture that has no metadata at all: date and time taken (or shift every date by hours and minutes, to fix a wrong camera clock), artist, copyright, description, camera make and model, software, and location as latitude and longitude. A box that has a value replaces it, an emptied box removes it, a filled new box adds it. Text is plain ASCII (accents are simplified, other characters become `?`). Buttons tick and clear the usual choices: remove everything, remove personal details, remove location only, keep everything. The saved copy is made **without re-compressing the picture**: the picture's own bytes are copied unchanged, only the metadata around them changes. The rotation can be kept, so the picture does not turn sideways. The colour profile is kept unless unticked. Maker notes (camera-specific blocks), the thumbnail and the interoperability table are never written to the new file. Before saving, the new file is read back and checked: removed items are gone, kept items are there, the picture bytes are identical and the browser can open it; otherwise nothing is downloaded. HEIC (iPhone originals), TIFF and RAW files are not supported; files over 60 MB are refused. |
| `imgresize` | Resize / Crop | Crop by dragging a box on the picture or by typing pixel numbers (free shape, or a fixed one: square, 4:3, 3:2, 16:9, upright versions, passport 35:45), turn and flip, then resize by exact width and height, percent, or longest side, and save as JPEG, PNG or WebP with a quality setting. Large reductions are done in halves, which looks much better than one jump. A transparent picture saved as JPEG gets a background colour you choose. The picture is drawn again by the browser, so the saved copy **has no hidden camera data and no colour profile** (use Photo Info & Privacy when you want to keep the original pixels). The turn stored in the original's EXIF is applied. Input up to 60 MB and 100 million pixels; the result may be at most 16,384 pixels on a side and 64 million pixels. |
| `imgblur` | Blur / Redact | Mark areas on a picture (rectangles or ovals, drawn, moved and resized with the mouse or a finger) and hide them by **pixelating**, **blurring** or **solid black**. The saved copy has the hidden parts really changed in its pixels (nothing is left underneath), and carries no metadata. Pixelation uses blocks of at least 8 pixels. Before saving, the tool checks the result: every black area must be fully black and every pixelated area must be flat inside each block, otherwise nothing is saved. It says plainly that only solid black cannot be undone, and recommends it for text, numbers, plates and documents. |
| `imgconvert` | Convert & Compress | Saves a picture as JPEG, PNG or WebP with a quality slider, or with a limit ("smaller than N KB": the tool searches for the best quality that fits and says when even the lowest does not). Optional shrinking by longest side. Shows the result as it will be saved, with the old and new size, and warns when the new file is larger. Transparent parts get a background colour you choose when saving as JPEG. A GIF becomes a still picture. The saved copy has no metadata or colour profile. |
| `imgwatermark` | Watermark | Puts text (three type styles, colour, optional outline) or your own logo picture on a picture: nine positions or repeated across the whole picture, size, strength and turn, with a live preview. The picture keeps its size; the type can be JPEG, PNG or WebP. A visible mark can be cropped out by someone determined; the page says so and that a repeated or central mark is harder to remove. |
| `imgbatch` | Batch Pictures | Does the same to many pictures (up to 200, 60 MB each) and saves them in one ZIP: remove the location or all hidden data (the rotation of a photo is kept so it does not turn sideways), resize (longest side or percent), change the type, add a text mark. When the only change is to hidden data, the pictures are **not re-compressed** (JPEG, PNG, WebP; the picture bytes are checked to be identical, and removed location data is checked to be gone). Any other change draws each picture again (no metadata is kept). A list shows the result for every picture; one that fails does not stop the others. The ZIP is limited to 500 MB (browser memory). |
| `imgfavicon` | Favicon & Icon Generator | Makes a website's icons from one picture: `favicon.ico` (16, 32 and 48 pixels), PNGs of 16, 32, 48, 180 (Apple touch icon), 192 and 512 pixels, `site.webmanifest` and the HTML lines to paste, in one ZIP (or just the .ico). The picture can fill the square (cutting the long sides) or be shown whole with space around it; square, rounded or circle outline; transparent or coloured background. A preview shows every size. |

## Reference (`reference`)

Look-up tables with a search box. They are static pages: they run in the browser, need nothing from the server and cost it nothing. On a phone each row becomes a labelled card.

| id | Tool | What it holds |
|---|---|---|
| `portref` | Port Reference | What a port number is used for, and which ports are cleartext, often attacked or unofficial. A hand-written list. |
| `dscp` | DSCP & QoS Values | Every DSCP code point (CS, AF, EF, VA, LE) in decimal and binary, the ToS / Traffic Class byte, IP precedence and the usual service class. |
| `httpstatus` | HTTP Status Codes | The common status codes with their meaning and usual causes, including the nginx 499 and Cloudflare 52x codes. |
| `dnstypes` | DNS Record Types | Everyday, less common and DNSSEC record types with their numbers and examples. |
| `icmptypes` | ICMP Types | ICMP and ICMPv6 types and codes, with firewall advice (which ones must be allowed for Path MTU Discovery and IPv6 neighbor discovery). |
| `tcpref` | TCP Reference | Flags, the flag combinations seen in captures, connection states and when they matter, and the common options (MSS, window scale, SACK, timestamps). |
| `ipsecref` | IPsec Reference | Diffie-Hellman groups 1 to 32 with type, size, approximate strength and advice; **matching strengths** (which DH group, encryption and hash belong together, for example AES-256 with SHA-384 and group 20); encryption and integrity algorithms with the bytes they add to each packet; the ports and protocols; and the main terms (phase 1 and 2, PFS, NAT-T). |
