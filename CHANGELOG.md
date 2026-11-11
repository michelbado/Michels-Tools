# Changelog

## 1.0.1

- **New tools**, all of which run in the browser and only read what you paste or type (nothing is sent anywhere):
  - **SPF, DKIM & DMARC Reader** (`mailauth`, Network Tools): explains pasted DNS records in plain words and finds mistakes, including the real size of a DKIM key.
  - **MTU & MSS Calculator** (`mtucalc`, Network Tools): the largest packet through PPPoE, GRE, IPsec, WireGuard, VXLAN and similar layers, and the TCP MSS to set.
  - **HTTP Header Reader** (`httphdr`, Troubleshooting): checks pasted response headers for security headers, cookies, caching and CORS problems.
  - **Engineering Tools folder** (`engineering`, new), seven tools for developers, sysadmins and network engineers: **URL Parser**, **JWT Decoder**, **Basic Auth Generator**, **XML & JSON Converter**, **Crontab Generator**, **chmod Calculator** and **Color Converter**.
  - **Image Tools folder** (`images`, new): **Photo Info & Privacy (EXIF)** (`imgexif`) reads the hidden data in a JPEG, PNG or WebP (camera, date, exact location, serial numbers, owner names), lets you edit, add or remove any of it (date taken, artist, copyright, description, camera, location; it also works on a picture with no metadata), and saves a copy without re-compressing the picture; the new file is checked before download. **Resize / Crop** (`imgresize`) crops, turns, resizes and saves as JPEG, PNG or WebP. Both run in the browser and upload nothing. More in the same folder: **Blur / Redact** (`imgblur`: pixelate, blur or black out parts of a picture, checked before saving), **Convert & Compress** (`imgconvert`, including "smaller than N KB"), **Watermark** (`imgwatermark`: text or logo), **Batch Pictures** (`imgbatch`: resize, convert, remove hidden data or mark many pictures into one ZIP) and **Favicon & Icon Generator** (`imgfavicon`: `favicon.ico`, PNG sizes, manifest and HTML lines).
  - **Reference folder** (`reference`, new): seven look-up cards with a search box: Port Reference (moved here from Network Tools), DSCP & QoS Values, HTTP Status Codes, DNS Record Types, ICMP Types, TCP Reference and IPsec Reference (Diffie-Hellman groups, which DH group matches which encryption and hash, algorithms and the bytes they add to each packet).
  - **MTU & MSS Calculator:** IPsec ESP with AES-CBC and HMAC-SHA-384 or HMAC-SHA-512 added.
- **Phones:** the Tools menu now opens one folder at a time and scrolls, so a long folder no longer runs off the top of the screen. On wide screens the pop-out list is limited to the screen height and scrolls as well.
- **Upgrading:** a tool that is not listed in `tools.conf` is on. To switch the new tools off, add their names (for example `mailauth`, `mtucalc`, `httphdr`, or the folders `reference`, `engineering` and `images`) set to `false`; `deploy/tools.conf.example` lists them. Port Reference now sits in the `reference` folder, so `network = false` no longer hides it.

## 1.0.0 (first public release)

First public release of Michel's Tools: a web desktop of network tools, PDF tools and connection troubleshooting tools, served by one Go program.

- What each tool does: [docs/tools.md](docs/tools.md).
- How to install it and put your own reverse proxy or tunnel in front (the program speaks plain HTTP only): [docs/installation.md](docs/installation.md).
- Which tools to switch on or off, and every setting: [docs/configuration.md](docs/configuration.md).
- Third-party material is inventoried in [sbom.cdx.json](sbom.cdx.json).
