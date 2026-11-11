/* Reference data: TCP flags, connection states and common options (RFC 9293, 7323, 2018, 7413). Registers itself in window.RefData. */
(() => {
  "use strict";
  const flags = [
    ["SYN", "0x02", "Synchronise: opens a connection and carries the starting sequence number.", "Only in the first two packets of the handshake."],
    ["ACK", "0x10", "Acknowledgement: the acknowledgement number is valid.", "Set on almost every packet after the first."],
    ["FIN", "0x01", "No more data from the sender: closes its half of the connection.", "A normal, orderly close."],
    ["RST", "0x04", "Reset: abort the connection at once.", "Sent when a port is closed, a connection is unknown, or a firewall or application kills it."],
    ["PSH", "0x08", "Push: hand the data to the application now.", "Often seen on the last packet of a message."],
    ["URG", "0x20", "The urgent pointer is valid.", "Rarely used today."],
    ["ECE", "0x40", "ECN echo: the network signalled congestion.", ""],
    ["CWR", "0x80", "Congestion window reduced: the sender slowed down.", ""],
    ["NS", "0x100", "Nonce sum, an experimental ECN protection.", "Rarely used."],
  ];
  const combos = [
    ["SYN", "Connection request.", "The first packet of every new connection; also what a port scan sends."],
    ["SYN, ACK", "Connection accepted.", "The server's answer: the port is open."],
    ["RST, ACK", "Connection refused or aborted.", "The answer from a closed port; also a firewall rejecting."],
    ["FIN, ACK", "Orderly close.", ""],
    ["no flags (NULL), or FIN+PSH+URG (XMAS)", "Not valid in a normal connection.", "Used by scanners; drop them."],
    ["SYN + FIN", "Not valid.", "Drop it."],
  ];
  const states = [
    ["LISTEN", "A server waiting for connections.", ""],
    ["SYN-SENT", "A client sent its SYN and waits.", "Many in this state: the server or a firewall is not answering."],
    ["SYN-RECEIVED", "A server got a SYN and answered.", "Many of them: a SYN flood, or clients that never finish."],
    ["ESTABLISHED", "The connection is open.", ""],
    ["FIN-WAIT-1 / FIN-WAIT-2", "This side closed and waits for the other side.", "FIN-WAIT-2 can last forever if the other side never closes."],
    ["CLOSE-WAIT", "The other side closed; this side's program has not.", "Many of them: the application forgets to close sockets."],
    ["LAST-ACK", "The other side closed, then this side closed too; waiting for the final ACK.", ""],
    ["CLOSING", "Both sides closed at the same time.", "Rare."],
    ["TIME-WAIT", "The connection is finished; the address is held for a short time so stray packets cannot confuse a new one.", "Normal: expect many on a busy server. Typically 60 seconds."],
  ];
  const options = [
    ["0", "End of options", "1 byte", ""],
    ["1", "No-operation (padding)", "1 byte", ""],
    ["2", "Maximum segment size (MSS)", "4 bytes", "Only in SYN packets. The largest data block this side accepts: see the MTU & MSS Calculator."],
    ["3", "Window scale", "3 bytes", "Only in SYN packets. Lets the window exceed 64 KB; needed for fast long-distance links. A middlebox that removes it makes transfers slow."],
    ["4", "SACK permitted", "2 bytes", "Only in SYN packets. Allows selective acknowledgement."],
    ["5", "SACK", "variable", "Reports which blocks arrived out of order."],
    ["8", "Timestamps", "10 bytes", "Measures round-trip time and protects against old packets. It makes every packet carry 12 bytes more (10 plus padding)."],
    ["34", "TCP Fast Open", "variable", "Lets data travel in the SYN for repeat connections."],
  ];
  const data = {
    intro: "The parts of TCP you meet in packet captures and in netstat or ss output.",
    sections: [
      { title: "Flags", columns: ["Flag", "Bit value", "Meaning", "Notes"], rows: flags },
      { title: "Flag combinations you meet", columns: ["Flags", "Meaning", "Notes"], rows: combos },
      { title: "Connection states", columns: ["State", "Meaning", "When it matters"], rows: states },
      { title: "Options", columns: ["Kind", "Name", "Size", "Notes"], rows: options },
    ],
  };
  if (typeof window !== "undefined") (window.RefData = window.RefData || {}).tcpref = data;
  if (typeof module !== "undefined") module.exports = data;
})();
