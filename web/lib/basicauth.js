/* HTTP Basic authentication header: builds "Authorization: Basic ..." from a user name and password (RFC 7617) and reads one back.
   Base64 is an encoding, not encryption: anyone who sees the header can read the password. Pure; works only on the text given.
   Exports window.BasicAuth. */
(() => {
  "use strict";
  const enc = new TextEncoder(), dec = new TextDecoder("utf-8", { fatal: true });
  function b64encode(str) { let bin = ""; for (const b of enc.encode(str)) bin += String.fromCharCode(b); return btoa(bin); }
  function b64decode(b64) { const bin = atob(b64); return dec.decode(Uint8Array.from(bin, c => c.charCodeAt(0))); }

  function encode(user, pass) {
    user = String(user == null ? "" : user); pass = String(pass == null ? "" : pass);
    const notes = [];
    if (user.includes(":")) return { error: "A user name cannot contain a colon (:): the colon is what separates the user name from the password, so the receiver would read it wrongly." };
    if (!user && !pass) return { empty: true };
    if (/[\x00-\x1f\x7f]/.test(user + pass)) notes.push({ level: "warn", text: "The text contains control characters (such as a new line). Many servers refuse them." });
    if (/[^\x00-\x7f]/.test(user + pass)) notes.push({ level: "warn", text: "The text contains non-ASCII characters. They are encoded as UTF-8 here, as the standard asks, but some old servers expect Latin-1 and will read them wrongly." });
    if (!user) notes.push({ level: "", text: "The user name is empty." });
    if (!pass) notes.push({ level: "", text: "The password is empty. That is allowed." });
    notes.push({ level: "warn", text: "This is not encryption. Anyone who can see the header (a proxy, a log, a shared screenshot) can read the password in one step. Send it only over https." });
    const token = b64encode(user + ":" + pass), header = "Authorization: Basic " + token;
    const q = s => "'" + s.replace(/'/g, "'\\''") + "'";
    return { token, header, notes, rows: [
      ["Authorization header", header],
      ["Value only", "Basic " + token],
      ["curl (user and password)", "curl -u " + q(user + ":" + pass) + " https://example.com/"],
      ["curl (header)", "curl -H " + q(header) + " https://example.com/"],
      ["Proxy header", "Proxy-Authorization: Basic " + token],
    ] };
  }

  // Accepts "Basic abc", "Authorization: Basic abc", or just the Base64 text.
  function decode(text) {
    let t = String(text == null ? "" : text).trim();
    if (!t) return { empty: true };
    t = t.replace(/^(proxy-)?authorization\s*:\s*/i, "");
    const m = /^(\w+)\s+(.*)$/.exec(t), scheme = m ? m[1] : "";
    if (m && !/^basic$/i.test(scheme)) return { error: "This is a \"" + scheme + "\" credential, not Basic. Only Basic headers (user:password in Base64) can be read here." };
    let b = (m ? m[2] : t).replace(/\s+/g, "");
    const notes = [];
    if (/-|_/.test(b) && !/[+\/]/.test(b)) { b = b.replace(/-/g, "+").replace(/_/g, "/"); notes.push({ level: "", text: "The text used the URL-safe Base64 alphabet (- and _), which is not valid in a Basic header, but it was read anyway." }); }
    if (!/^[A-Za-z0-9+\/]*={0,2}$/.test(b)) return { error: "This is not Base64 text. A Basic header carries letters, digits, + and / (and = at the end)." };
    if (b.length % 4) { b += "=".repeat((4 - b.length % 4) % 4); notes.push({ level: "", text: "The = padding at the end was missing; it was added." }); }
    let plain; try { plain = b64decode(b); } catch { return { error: "The Base64 text decodes, but not to readable UTF-8 text." }; }
    const i = plain.indexOf(":");
    if (i < 0) return { error: "The decoded text has no colon, so it is not \"user:password\": " + JSON.stringify(plain.length > 40 ? plain.slice(0, 40) + "..." : plain) };
    const user = plain.slice(0, i), pass = plain.slice(i + 1);
    notes.push({ level: "warn", text: "The password was readable straight from the header. Treat any copy of this header as a password." });
    if (pass.includes(":")) notes.push({ level: "", text: "The password itself contains a colon. That is allowed: only the first colon separates the two." });
    return { user, pass, notes, rows: [["User name", user], ["Password", pass], ["Decoded text", plain]] };
  }
  const api = { encode, decode, b64encode, b64decode };
  if (typeof window !== "undefined") window.BasicAuth = api;
  if (typeof module !== "undefined") module.exports = api;
})();
