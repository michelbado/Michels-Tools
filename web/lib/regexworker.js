/* Worker for the Regex Tester: runs one match job and answers. The page stops this worker if it takes too long. */
importScripts("regextest.js");
self.onmessage = e => { let r; try { r = self.RegexTest.run(e.data); } catch (err) { r = { ok: false, error: String(err && err.message || err) }; } self.postMessage(r); };
