/* Reference data: DSCP / QoS code points (RFC 2474, 2597, 3246, 4594, 5865, 8622). Registers itself in window.RefData. */
(() => {
  "use strict";
  const rows = [
    // name, DSCP, typical use (RFC 4594 service class where one is defined), notes
    ["CS0 (default, best effort)", 0, "Standard: everything that is not marked", "The default. Most internet traffic arrives with this value."],
    ["LE", 1, "Lower effort: scavenger, bulk transfers that must not disturb others", "RFC 8622. Older networks used CS1 for the same purpose."],
    ["CS1", 8, "Low-priority data (scavenger)", "Treated as less than best effort in many designs."],
    ["AF11", 10, "High-throughput data (low drop)", "Assured forwarding class 1: file transfer, bulk business data."],
    ["AF12", 12, "High-throughput data (medium drop)", ""],
    ["AF13", 14, "High-throughput data (high drop)", ""],
    ["CS2", 16, "Network operations, administration and management (OAM)", "SNMP, SSH, remote management."],
    ["AF21", 18, "Low-latency data (low drop)", "Assured forwarding class 2: interactive business applications."],
    ["AF22", 20, "Low-latency data (medium drop)", ""],
    ["AF23", 22, "Low-latency data (high drop)", ""],
    ["CS3", 24, "Broadcast video", "Also used by many vendors for call signalling (SIP, H.323)."],
    ["AF31", 26, "Multimedia streaming (low drop)", "Assured forwarding class 3: video on demand, streaming."],
    ["AF32", 28, "Multimedia streaming (medium drop)", ""],
    ["AF33", 30, "Multimedia streaming (high drop)", ""],
    ["CS4", 32, "Real-time interactive (gaming, video-conferencing with a low-delay target)", ""],
    ["AF41", 34, "Multimedia conferencing (low drop)", "Assured forwarding class 4: video calls. The usual video marking."],
    ["AF42", 36, "Multimedia conferencing (medium drop)", ""],
    ["AF43", 38, "Multimedia conferencing (high drop)", ""],
    ["CS5", 40, "Signalling", "Also used for call signalling in some designs (see CS3)."],
    ["VA (Voice-Admit)", 44, "Voice that passed admission control", "RFC 5865."],
    ["EF (Expedited Forwarding)", 46, "Telephony: voice media (RTP)", "Low delay, low jitter, low loss. The usual voice marking."],
    ["CS6", 48, "Network control: routing protocols", "OSPF, BGP, keepalives. Reserve for the network's own traffic."],
    ["CS7", 56, "Network control (reserved)", "Reserved for the highest-priority network traffic; do not use for user traffic."],
  ];
  const bin = n => n.toString(2).padStart(6, "0");
  const data = {
    intro: "DSCP is the 6-bit priority marking in every IP packet's header (the old ToS byte). Routers can treat packets differently by their DSCP. Many networks and ISPs clear or rewrite the marking at their edge, so a value you set may not survive the path.",
    sections: [{
      title: "DSCP values",
      columns: ["Name", "DSCP (decimal)", "DSCP (binary)", "ToS / Traffic Class byte", "IP precedence", "Typical use", "Notes"],
      rows: rows.map(r => [r[0], String(r[1]), bin(r[1]), "0x" + (r[1] * 4).toString(16).toUpperCase().padStart(2, "0") + " (" + r[1] * 4 + ")", String(r[1] >> 3), r[2], r[3]]),
      foot: "The ToS (IPv4) or Traffic Class (IPv6) byte is the DSCP shifted left by two bits; the last two bits are used for congestion notification (ECN) and are 0 here. IP precedence is the first three bits of the DSCP (the older scheme). Typical uses follow the service classes of RFC 4594; your own network or vendor may map them differently.",
    }],
  };
  if (typeof window !== "undefined") (window.RefData = window.RefData || {}).dscp = data;
  if (typeof module !== "undefined") module.exports = data;
})();
