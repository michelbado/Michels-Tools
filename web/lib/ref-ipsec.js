/* Reference data: IPsec / IKE. Diffie-Hellman groups (IANA IKEv2 transform type 4), encryption and integrity algorithms, ports and terms.
   Strength figures are the usual approximate "bits of security" (RFC 3526, RFC 5903, NIST SP 800-57). Advice follows RFC 8247 and current
   vendor guidance and is a starting point: follow your own security policy. Registers itself in window.RefData. */
(() => {
  "use strict";
  // group, type, size, about bits of security, what it pairs with, advice, notes
  const dh = [
    ["1", "MODP", "768-bit", "under 64", "none: avoid this group", "Do not use", "Broken: can be attacked with academic resources."],
    ["2", "MODP", "1024-bit", "about 80", "none: avoid this group", "Avoid", "Considered weak; still the default on some old devices."],
    ["5", "MODP", "1536-bit", "about 90", "none: avoid this group", "Avoid", "Deprecated."],
    ["14", "MODP", "2048-bit", "about 110", "AES-128, SHA-256 (the minimum)", "Acceptable minimum", "The lowest group still widely accepted. A common default."],
    ["15", "MODP", "3072-bit", "about 130", "AES-128, SHA-256", "Good", "Slower than the elliptic-curve groups of similar strength."],
    ["16", "MODP", "4096-bit", "about 150", "AES-128 to AES-192, SHA-256 to SHA-384", "Good", "Slowest of the common groups."],
    ["17", "MODP", "6144-bit", "about 170", "AES-192, SHA-384", "Good, rarely needed", ""],
    ["18", "MODP", "8192-bit", "about 190", "AES-256, SHA-512 (about 190 bits)", "Good, rarely needed", "Very slow."],
    ["19", "ECP (NIST P-256)", "256-bit", "about 128", "AES-128, SHA-256", "Recommended", "Fast, small, widely supported. A good default."],
    ["20", "ECP (NIST P-384)", "384-bit", "about 192", "AES-256, SHA-384 (the \"esp384\" profile)", "Recommended", "Matches AES-256 and SHA-384."],
    ["21", "ECP (NIST P-521)", "521-bit", "about 256", "AES-256, SHA-512", "Good", "Less common; check both ends support it."],
    ["22", "MODP with 160-bit subgroup", "1024-bit", "about 80", "none: avoid this group", "Avoid", "RFC 5114 groups: weak, and their parameters cannot be verified."],
    ["23", "MODP with 224-bit subgroup", "2048-bit", "about 112", "none: avoid this group", "Avoid", "RFC 5114 group (see group 22)."],
    ["24", "MODP with 256-bit subgroup", "2048-bit", "about 128", "none: avoid this group", "Avoid", "RFC 5114 group (see group 22); use group 14 or group 19 instead."],
    ["25", "ECP (NIST P-192)", "192-bit", "about 96", "none: avoid this group", "Avoid", "Too small today."],
    ["26", "ECP (NIST P-224)", "224-bit", "about 112", "none: avoid this group", "Avoid", "Too small today."],
    ["27", "ECP (Brainpool P-224)", "224-bit", "about 112", "none: avoid this group", "Avoid", "Too small today."],
    ["28", "ECP (Brainpool P-256)", "256-bit", "about 128", "AES-128, SHA-256", "Acceptable", "An alternative to P-256 for those who avoid NIST curves. Less widely supported."],
    ["29", "ECP (Brainpool P-384)", "384-bit", "about 192", "AES-256, SHA-384", "Acceptable", "See group 28."],
    ["30", "ECP (Brainpool P-512)", "512-bit", "about 256", "AES-256, SHA-512", "Acceptable", "See group 28."],
    ["31", "Curve25519", "256-bit", "about 128", "AES-128, SHA-256", "Recommended", "Modern, fast and hard to implement wrongly. Use it where both ends support it."],
    ["32", "Curve448", "448-bit", "about 224", "AES-256, SHA-384", "Good", "Less common."],
  ];
  // which pieces belong together: security level, encryption, integrity / PRF, DH group
  const match = [
    ["about 112 bits (the minimum today)", "AES-128 (GCM or CBC)", "SHA-256", "14 (MODP 2048)", "Legacy compatibility. Do not go lower."],
    ["about 128 bits", "AES-128-GCM, or AES-128-CBC with HMAC-SHA-256", "SHA-256", "19 (P-256), 31 (Curve25519) or 15 (MODP 3072)", "A good default for most VPNs: fast and widely supported."],
    ["about 192 bits", "AES-256-GCM, or AES-256-CBC with HMAC-SHA-384", "SHA-384", "20 (P-384) or 29 (Brainpool P-384)", "The usual \"AES-256 + SHA-384 + group 20\" profile; it is also what government suites such as the NSA CNSA suite ask for."],
    ["about 256 bits", "AES-256-GCM, or AES-256-CBC with HMAC-SHA-512", "SHA-512", "21 (P-521), 30 (Brainpool P-512) or 18 (MODP 8192, about 190 bits)", "Highest level; slower and less widely supported."],
  ];
  const dhLevel = r => (/^(Recommended|Good|Acceptable)/.test(r[5]) ? "good" : /^Do not/.test(r[5]) ? "bad" : /^Avoid/.test(r[5]) ? "warn" : "");
  // algorithm, role, sizes, ESP overhead, advice
  const algs = [
    ["AES-GCM-16 (128, 192 or 256-bit key)", "Encryption and integrity in one step (AEAD)", "8-byte IV, 16-byte tag", "adds 8 + 16 bytes", "Recommended: fast and efficient on modern CPUs. The 16 means a 16-byte tag."],
    ["AES-GCM-12 / AES-GCM-8", "AEAD with a shorter tag", "8-byte IV, 12 or 8-byte tag", "adds 8 + 12 or 8 + 8 bytes", "Avoid: use the 16-byte tag."],
    ["ChaCha20-Poly1305", "Encryption and integrity in one step (AEAD)", "8-byte IV, 16-byte tag", "adds 8 + 16 bytes", "Recommended on devices without AES acceleration."],
    ["AES-CBC (128, 192 or 256-bit key)", "Encryption only: needs a separate integrity algorithm", "16-byte IV, padding to 16 bytes", "adds 16 + padding (0 to 15)", "Acceptable and common, but older; prefer AES-GCM."],
    ["HMAC-SHA-256-128 (SHA256)", "Integrity with AES-CBC", "16-byte tag", "adds 16 bytes", "Good."],
    ["HMAC-SHA-384-192 (SHA384)", "Integrity with AES-CBC", "24-byte tag", "adds 24 bytes", "Good (pairs with AES-256)."],
    ["HMAC-SHA-512-256 (SHA512)", "Integrity with AES-CBC", "32-byte tag", "adds 32 bytes", "Good."],
    ["HMAC-SHA-1-96 (SHA1)", "Integrity with AES-CBC", "12-byte tag", "adds 12 bytes", "Avoid for new setups; still not broken for HMAC use, but being phased out."],
    ["HMAC-MD5-96 (MD5)", "Integrity", "12-byte tag", "adds 12 bytes", "Do not use."],
    ["3DES, DES", "Encryption", "8-byte block", "", "Do not use."],
    ["PRF (SHA-256 / 384 / 512)", "Key derivation inside IKE", "no size on the wire", "adds nothing to packets", "Choose to match the strength of the rest: SHA-384 with AES-256 is common. It does not change packet sizes."],
  ];
  const algLevel = r => (/^Recommended|^Good/.test(r[4]) ? "good" : /^Do not/.test(r[4]) ? "bad" : /^Avoid/.test(r[4]) ? "warn" : "");
  const ports = [
    ["UDP 500", "IKE: negotiating keys and settings.", ""],
    ["UDP 4500", "IKE and ESP when a NAT device is in the path (NAT-T).", "ESP is wrapped in UDP, which adds 8 bytes per packet."],
    ["IP protocol 50 (ESP)", "The encrypted traffic itself, when no NAT is in the way.", "It is not TCP or UDP and has no ports: a firewall must allow protocol 50 itself."],
    ["IP protocol 51 (AH)", "Authentication Header: integrity without encryption.", "Rarely used; it cannot pass through NAT."],
  ];
  const terms = [
    ["IKEv1 phase 1 = IKEv2 IKE SA", "The secure channel between the two gateways (key exchange and authentication)."],
    ["IKEv1 phase 2 = IKEv2 child SA", "The tunnels that carry the traffic (the IPsec SAs). Several can share one IKE SA."],
    ["PFS (perfect forward secrecy)", "A fresh Diffie-Hellman exchange when a child SA is renewed, so one stolen key cannot decrypt old traffic. Switched on by choosing a DH group for phase 2."],
    ["Tunnel mode / transport mode", "Tunnel mode wraps the whole original packet in a new IP header (site-to-site VPNs). Transport mode protects only the payload of the original packet (host-to-host). Tunnel mode costs 20 bytes (IPv4) or 40 bytes (IPv6) more."],
    ["NAT-T", "NAT traversal: ESP is carried inside UDP port 4500 so NAT devices can handle it."],
    ["Lifetime", "How long a key is used before it is replaced (by time or by traffic volume). Both ends should agree; if they differ, the shorter one wins."],
    ["DPD (dead peer detection)", "Keepalives that notice when the other gateway has disappeared."],
  ];
  const data = {
    intro: "A reference for the settings you pick when configuring an IPsec VPN. Vendors call the Diffie-Hellman group a \"DH group\" (phase 1) or a \"PFS group\" (phase 2). For how the algorithms change packet sizes, see the MTU & MSS Calculator.",
    sections: [
      { title: "Diffie-Hellman groups (IKE key exchange)", columns: ["Group", "Type", "Size", "Strength (bits)", "Pairs with (encryption, hash)", "Advice", "Notes"], rows: dh, level: dhLevel,
        foot: "Strength is approximate. Both ends must offer a group in common. Prefer 19, 20 or 31, or 14 or higher if you need MODP; avoid anything marked Avoid or Do not use. Post-quantum protection is arriving as an additional key exchange in IKEv2 (RFC 9370): ask your vendor what it supports." },
      { title: "Matching strengths: which pieces belong together", columns: ["Security level", "Encryption", "Integrity / PRF", "DH group (PFS)", "Notes"], rows: match,
        foot: "A tunnel is only as strong as its weakest part: AES-256 and SHA-384 with group 14 is really about 110 bits. The levels are approximate (NIST SP 800-57): group 20 gives about 192 bits, so it matches AES-192, and AES-256 with SHA-384 is the profile usually paired with it. Match both ends exactly; the first proposal the peers have in common wins." },
      { title: "Encryption and integrity algorithms", columns: ["Algorithm", "Role", "Sizes", "Added to each packet", "Advice"], rows: algs, level: algLevel },
      { title: "Ports and protocols", columns: ["Port or protocol", "Used for", "Notes"], rows: ports },
      { title: "Terms", columns: ["Term", "Meaning"], rows: terms },
    ],
  };
  if (typeof window !== "undefined") (window.RefData = window.RefData || {}).ipsecref = data;
  if (typeof module !== "undefined") module.exports = data;
})();
