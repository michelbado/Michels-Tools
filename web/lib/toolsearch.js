/* Tool search for the Tools menu: finds tools by their name, their folder and everyday words ("hash", "wifi", "compress"), and forgives small typos.
   Pure code: build() prepares the list once, search() answers a query. Every tool in web/shell.js must have an entry in KEYS (a Go test checks this),
   so a new tool can always be found by the words people would use. Exports window.ToolSearch. */
(() => {
  "use strict";
  // id -> extra words people may type. The title, the id and the folder name are searched as well.
  const KEYS = {
    aggregator: "cidr summarize summarise merge ip ranges list combine prefixes route aggregation supernet",
    subnet: "cidr netmask mask hosts broadcast network address calculator ipv4 prefix",
    splitter: "split divide vlsm cidr subnets break up",
    checker: "check ip in range belongs contains overlap match cidr list",
    ipv6calc: "ipv6 prefix slaac eui-64 address expand compress reverse dns ip6",
    ipconv: "convert ip decimal hex binary integer dotted number base",
    maclookup: "mac address vendor oui manufacturer ethernet lookup",
    portref: "ports tcp udp service numbers well known list",
    certcheck: "certificate package check ssl tls key match chain ca bundle pfx csr verify intermediate missing expired validate crt pem",
    certconvert: "certificate convert pem pfx p12 pkcs12 der cer crt p7b key bundle chain fullchain nginx apache iis tomcat haproxy password export extract",
    certcsr: "csr certificate request key generate new rsa ecdsa san wildcard private key create",
    certdecode: "certificate ssl tls x509 pem csr chain decode openssl",
    opensslhelp: "openssl command line help how to cheat sheet certificate key csr pfx convert verify s_client",

    mailhdr: "email e-mail header spam routing received analyse trace phishing forged",
    mailauth: "spf dkim dmarc dns txt email authentication record",
    mtucalc: "mtu mss tcp packet size pppoe gre ipsec vpn wireguard vxlan fragmentation overhead",
    pdfinfo: "pdf information details pages size version properties",
    pdfverify: "pdf signature digital sign verify certificate valid",
    pdfmeta: "pdf metadata author title properties remove edit xmp",
    pdfstamp: "pdf sign signature image stamp picture add logo",
    pdfwatermark: "pdf watermark page numbers header footer text overlay",
    pdfpages: "pdf split extract pages cut separate range",
    pdfmerge: "pdf merge combine join files together",
    pdforganize: "pdf organize reorder rotate delete pages move rearrange",
    pdfcrop: "pdf crop resize page size margins a4 trim",
    pdfredact: "pdf redact black out hide text censor blackout remove sensitive",
    pdfimages: "pdf images pictures convert jpg png to from pdf",
    pdfextract: "pdf extract text images attachments content copy",
    netquality: "connection quality internet speed test latency jitter packet loss ping bufferbloat network monitor",
    connfacts: "connection facts my ip address cdn protocol http3 headers what site sees",
    idletest: "idle timeout keepalive firewall nat session limit connection drop",
    pathread: "ping traceroute tracert mtr pathping reader analyse output hops",
    browsercaps: "browser capabilities features support webgl compatibility report",
    httphdr: "http headers security hsts csp cookies cors cache curl response",
    urlparse: "url parser address query parameters host path link split",
    jwtdecode: "jwt token json web token decode bearer claims",
    basicauth: "basic authentication authorization header base64 username password curl",
    xmljson: "xml json convert transform",
    crontab: "cron schedule crontab expression job timer",
    chmodcalc: "chmod permissions unix linux file octal rwx umask",
    colorconv: "colour color hex rgb hsl hwb css contrast picker",
    jsonfmt: "json format pretty print validate minify beautify prettify lint",
    textdiff: "text compare diff difference changes files",
    encodetool: "base64 url encode decode percent hex html entities unicode escape",
    hashcalc: "hash checksum md5 sha1 sha256 sha512 crc32 hmac digest file integrity",
    timeconv: "timestamp unix epoch date time timezone convert filetime iso",
    passgen: "password generator uuid guid ulid random token secret",
    regextest: "regex regular expression pattern match test replace",
    qrcode: "qr code barcode scan generate wifi vcard read",
    imgexif: "photo exif metadata location gps privacy camera remove strip edit",
    imgresize: "image picture photo resize crop rotate flip scale dimensions",
    imgblur: "image blur pixelate redact hide face censor mosaic black out",
    imgconvert: "image compress convert jpg jpeg png webp smaller size file reduce",
    imgwatermark: "image watermark logo text copyright stamp",
    imgbatch: "images batch bulk many pictures resize convert zip",
    imgfavicon: "favicon icon ico apple touch icon website logo",
    dscp: "dscp qos quality of service markings cos traffic class",
    httpstatus: "http status codes 404 500 error response",
    dnstypes: "dns record types a aaaa mx txt cname ns srv",
    icmptypes: "icmp types codes ping unreachable",
    tcpref: "tcp flags ports states handshake reference",
    ipsecref: "ipsec vpn ike esp dh groups encryption algorithms reference",
    blocks: "game puzzle falling pieces",
    mines: "game puzzle mines clear",
    pinball: "game arcade ball flippers",
    racer: "game driving car racing arcade",
    pool: "game billiards eight ball snooker",
    birdhunt: "game shooting birds hunt",
  };
  const STOP = new Set(["and", "the", "a", "an", "of", "to", "for", "in", "on", "my", "with", "or", "how", "what", "is", "do", "i", "can", "are", "me", "find", "make"]);

  const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const words = s => { const n = norm(s); return n ? n.split(" ") : []; };

  // true when a and b differ by at most `max` single-letter changes, inserts, deletes or swaps of neighbours
  function close(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return false;
    const n = a.length, m = b.length; let prev2 = null, prev = Array.from({ length: m + 1 }, (_, j) => j);
    for (let i = 1; i <= n; i++) {
      const cur = [i];
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur.push(v);
      }
      prev2 = prev; prev = cur;
    }
    return prev[m] <= max;
  }

  /* items: [{ id, title, folder }] (folder = the folder's title). Returns what search() needs. */
  function build(items) {
    return items.map(it => ({ it, title: norm(it.title), tw: words(it.title), kw: [...new Set(words(KEYS[it.id] || ""))], idw: words(it.id).concat(norm(it.id)), fw: words(it.folder || "") }));
  }

  // the score of one query word against one tool (0 = no match)
  function scoreToken(t, d) {
    let best = 0; const up = v => { if (v > best) best = v; };
    for (const w of d.tw) { if (w === t) up(100); else if (w.startsWith(t)) up(80); else if (t.length >= 3 && w.includes(t)) up(50); }
    if (t === d.idw[d.idw.length - 1]) up(90); else if (d.idw[d.idw.length - 1].startsWith(t) && t.length >= 2) up(60);
    for (const w of d.kw) { if (w === t) up(70); else if (w.startsWith(t)) up(55); else if (t.length >= 4 && w.includes(t)) up(35); }
    for (const w of d.fw) { if (w === t) up(25); else if (w.startsWith(t)) up(20); }
    if (best === 0 && t.length >= 4) {      // a typo: one wrong letter for 4 to 7 letters, two for longer words
      const max = t.length >= 8 ? 2 : 1;
      for (const w of d.tw) if (w.length >= 4 && close(t, w, max)) up(32);
      for (const w of d.kw) if (w.length >= 4 && close(t, w, max)) up(26);
    }
    return best;
  }

  /* search(index, query, limit) -> [{ id, title, folder, score }], best first. Every word of the query must match something about the tool. */
  function search(index, query, limit) {
    let toks = words(query); if (!toks.length) return [];
    const real = toks.filter(t => !STOP.has(t)); if (real.length) toks = real;
    const joined = toks.join(" "), out = [];
    for (const d of index) {
      let total = 0, ok = true, inTitle = 0;
      for (const t of toks) {
        const s = scoreToken(t, d); if (!s) { ok = false; break; }
        total += s; if (d.tw.some(w => w.startsWith(t))) inTitle++;
      }
      if (!ok) continue;
      if (d.title === joined) total += 200; else if (d.title.startsWith(joined)) total += 40;
      if (joined === d.idw[d.idw.length - 1]) total += 150;               // the exact id of a tool ("checker") beats a longer title that merely contains the word
      if (inTitle === toks.length) total += 20;
      out.push({ id: d.it.id, title: d.it.title, folder: d.it.folder || "", score: total });
    }
    out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return out.slice(0, limit || 12);
  }

  const api = { build, search, norm, close, KEYS };
  if (typeof window !== "undefined") window.ToolSearch = api;
  if (typeof module !== "undefined") module.exports = api;
})();
