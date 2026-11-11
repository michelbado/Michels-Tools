/* Reference data: DNS record types (IANA registry, RFC 1035 and later). Registers itself in window.RefData. */
(() => {
  "use strict";
  const common = [
    ["A", "1", "An IPv4 address for a name.", "www.example.com. 300 IN A 192.0.2.10"],
    ["AAAA", "28", "An IPv6 address for a name.", "www.example.com. 300 IN AAAA 2001:db8::10"],
    ["CNAME", "5", "An alias: this name is another name. It cannot sit next to other records of the same name, so not at the zone apex.", "www.example.com. IN CNAME web.example.net."],
    ["MX", "15", "Where mail for the domain goes (lowest preference number first).", "example.com. IN MX 10 mail.example.com."],
    ["NS", "2", "Which servers answer for the zone.", "example.com. IN NS ns1.example.net."],
    ["TXT", "16", "Free text; used for SPF, DKIM, DMARC and ownership checks. Long values are split into strings of at most 255 characters.", "example.com. IN TXT \"v=spf1 include:_spf.example.net -all\""],
    ["SOA", "6", "Start of authority: the zone's main server, contact and timers (serial, refresh, retry, expire, negative-cache time).", "example.com. IN SOA ns1.example.net. hostmaster.example.com. 2026111001 7200 3600 1209600 300"],
    ["PTR", "12", "Reverse lookup: the name for an address (under in-addr.arpa or ip6.arpa).", "10.2.0.192.in-addr.arpa. IN PTR www.example.com."],
    ["SRV", "33", "Where a service runs: priority, weight, port and host.", "_sip._tcp.example.com. IN SRV 10 60 5060 sip.example.com."],
    ["CAA", "257", "Which certificate authorities may issue certificates for the name.", "example.com. IN CAA 0 issue \"letsencrypt.org\""],
    ["HTTPS", "65", "Connection hints for a website: HTTP/3 support, alternative endpoints, address hints.", "example.com. IN HTTPS 1 . alpn=\"h3,h2\""],
    ["SVCB", "64", "The general form of HTTPS for other services.", "_svc.example.com. IN SVCB 1 svc.example.net. port=8443"],
  ];
  const more = [
    ["NAPTR", "35", "Rewrite rules used by telephone-number and some SIP lookups.", ""],
    ["SSHFP", "44", "Fingerprints of a host's SSH keys.", ""],
    ["TLSA", "52", "Ties a TLS certificate to a name (DANE).", "_443._tcp.example.com. IN TLSA 3 1 1 <hash>"],
    ["DNAME", "39", "An alias for a whole subtree of names.", ""],
    ["LOC", "29", "Geographic location of a host.", ""],
    ["URI", "256", "Maps a name to a URI.", ""],
    ["OPT", "41", "Pseudo-record that carries EDNS options (not stored in zones).", ""],
    ["ANY", "255", "A query for all records of a name. Many servers now refuse or shorten the answer.", ""],
    ["AXFR", "252", "Transfers a whole zone to another server.", "Should be limited to your own secondary servers."],
    ["IXFR", "251", "Transfers only the changes of a zone.", ""],
  ];
  const dnssec = [
    ["DNSKEY", "48", "A zone's public signing key.", ""],
    ["DS", "43", "Delegation signer: a hash of the child zone's key, stored in the parent zone to link the chain of trust.", ""],
    ["RRSIG", "46", "The signature over a set of records.", ""],
    ["NSEC", "47", "Proves that a name does not exist, by naming the next existing name.", ""],
    ["NSEC3", "50", "The same, with hashed names (harder to list the whole zone).", ""],
    ["CDS / CDNSKEY", "59 / 60", "A child zone tells its parent which DS to publish.", ""],
  ];
  const data = {
    intro: "What each DNS record type is for, its IANA number, and an example in zone-file form. To look up records yourself: dig TXT example.com, dig MX example.com, dig -x 192.0.2.10.",
    sections: [
      { title: "Everyday records", columns: ["Type", "Number", "What it is for", "Example"], rows: common },
      { title: "Less common records", columns: ["Type", "Number", "What it is for", "Example"], rows: more },
      { title: "DNSSEC records", columns: ["Type", "Number", "What it is for", "Example"], rows: dnssec },
    ],
  };
  if (typeof window !== "undefined") (window.RefData = window.RefData || {}).dnstypes = data;
  if (typeof module !== "undefined") module.exports = data;
})();
