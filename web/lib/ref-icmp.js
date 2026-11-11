/* Reference data: ICMP (IPv4) and ICMPv6 message types and codes, with firewall advice (RFC 792, 4443, 4861, 4890). Registers itself in window.RefData. */
(() => {
  "use strict";
  // type, code, name, meaning, firewall advice
  const v4 = [
    ["0", "0", "Echo reply", "The answer to a ping.", "Allow (replies to your own pings)"],
    ["3", "0", "Destination unreachable: network", "No route to the network.", "Allow"],
    ["3", "1", "Destination unreachable: host", "The host did not answer on the last hop.", "Allow"],
    ["3", "2", "Destination unreachable: protocol", "The host does not support the protocol.", "Allow"],
    ["3", "3", "Destination unreachable: port", "Nothing listens on that UDP port. How traceroute knows it arrived.", "Allow"],
    ["3", "4", "Fragmentation needed and DF set", "The packet is too big for a link and may not be split. This is how Path MTU Discovery works.", "MUST allow: blocking it breaks big transfers (see the MTU & MSS Calculator)"],
    ["3", "9 / 10 / 13", "Destination unreachable: administratively prohibited", "A firewall or router refused (network / host / communication).", "Allow"],
    ["4", "0", "Source quench", "Old congestion signal.", "Obsolete: block"],
    ["5", "0 to 3", "Redirect", "A router says there is a better route.", "Block from outside your network"],
    ["8", "0", "Echo request", "A ping.", "Allow, rate-limited, if you want to be pingable"],
    ["9", "0", "Router advertisement", "A router announces itself on the link.", "Local network only"],
    ["10", "0", "Router solicitation", "A host asks for routers.", "Local network only"],
    ["11", "0", "Time exceeded: TTL expired in transit", "The packet's hop limit ran out. How traceroute finds each hop.", "Allow"],
    ["11", "1", "Time exceeded: fragment reassembly", "Not all fragments arrived in time.", "Allow"],
    ["12", "0 to 2", "Parameter problem", "Something is wrong in the packet's header.", "Allow"],
    ["13 / 14", "0", "Timestamp request / reply", "Reads the clock of another host.", "Block (leaks information)"],
    ["17 / 18", "0", "Address mask request / reply", "Obsolete.", "Block"],
    ["30", "0", "Traceroute (old)", "Obsolete method.", "Block"],
  ];
  const v6 = [
    ["1", "0", "Destination unreachable: no route", "No route to the network.", "Allow"],
    ["1", "1", "Destination unreachable: administratively prohibited", "A firewall refused.", "Allow"],
    ["1", "3", "Destination unreachable: address", "The address could not be reached.", "Allow"],
    ["1", "4", "Destination unreachable: port", "Nothing listens on that port.", "Allow"],
    ["2", "0", "Packet too big", "The packet is bigger than a link's MTU. IPv6 routers never split packets, so this is the ONLY way senders learn the size.", "MUST allow: blocking it breaks connections (see the MTU & MSS Calculator)"],
    ["3", "0 / 1", "Time exceeded", "Hop limit ran out in transit (0) or reassembly timed out (1).", "Allow"],
    ["4", "0 to 2", "Parameter problem", "Something is wrong in the packet's header.", "Allow"],
    ["128", "0", "Echo request", "A ping.", "Allow, rate-limited, if you want to be pingable"],
    ["129", "0", "Echo reply", "The answer to a ping.", "Allow"],
    ["133", "0", "Router solicitation (NDP)", "A host asks for routers.", "MUST allow on the local link; block at the edge"],
    ["134", "0", "Router advertisement (NDP)", "A router announces prefixes and settings.", "MUST allow on the local link; block at the edge"],
    ["135", "0", "Neighbor solicitation (NDP)", "\"Who has this address?\" (IPv6's replacement for ARP).", "MUST allow on the local link; block at the edge"],
    ["136", "0", "Neighbor advertisement (NDP)", "The answer to a neighbor solicitation.", "MUST allow on the local link; block at the edge"],
    ["137", "0", "Redirect", "A router says there is a better next hop.", "Local link only"],
    ["130 / 131 / 132 / 143", "0", "Multicast listener (MLD)", "Hosts tell routers which multicast groups they want.", "Local link only"],
  ];
  const lvl = r => (/MUST/.test(r[4]) ? "good" : /^(Block|Obsolete)/.test(r[4]) ? "bad" : /Local|from outside/.test(r[4]) ? "warn" : "");
  const cols = ["Type", "Code", "Name", "Meaning", "Firewall advice"];
  const data = {
    intro: "ICMP carries the network's own messages: errors, pings, traceroute. Do not block it wholesale: some messages (marked MUST) are needed for normal traffic to work. The advice is the usual practice (RFC 4890 for IPv6); your own policy may differ.",
    sections: [
      { title: "ICMP for IPv4", columns: cols, rows: v4, level: lvl },
      { title: "ICMPv6 (IPv6)", columns: cols, rows: v6, level: lvl, foot: "IPv6 depends on ICMPv6 much more than IPv4 depends on ICMP: neighbor discovery (types 133 to 137) replaces ARP, and Packet Too Big replaces the router-side splitting IPv4 allowed." },
    ],
  };
  if (typeof window !== "undefined") (window.RefData = window.RefData || {}).icmptypes = data;
  if (typeof module !== "undefined") module.exports = data;
})();
