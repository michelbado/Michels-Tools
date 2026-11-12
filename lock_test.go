package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func lockHandler(t *testing.T, conf string) http.Handler {
	t.Helper()
	lockFailDelay = 0
	return handlerWith(t, conf)
}

func lpost(h http.Handler, p, body string, cookie *http.Cookie, hdr ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", p, strings.NewReader(body))
	if cookie != nil {
		r.AddCookie(cookie)
	}
	for i := 0; i+1 < len(hdr); i += 2 {
		r.Header.Set(hdr[i], hdr[i+1])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func lget(h http.Handler, p string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", p, nil)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func lockCookieOf(w *httptest.ResponseRecorder) *http.Cookie {
	for _, c := range w.Result().Cookies() {
		if c.Name == lockCookie {
			return c
		}
	}
	return nil
}

func TestLockedConfigParsing(t *testing.T) {
	ok := []string{
		"qrcode = locked\nlock.code = correct horse\n",
		"pdf = locked\nlock.code = abcdef\npdfcrop = true\n",
		"QRCode = LOCKED\nLock.Code = secret#with#hash\n",
		"lock.hours = 24\n",
		"lock.code =\n", // nothing locked, so no code is needed
	}
	for _, in := range ok {
		if _, err := parseToolConfig(strings.NewReader(in), "tools.conf"); err != nil {
			t.Errorf("%q should parse: %v", in, err)
		}
	}
	bad := map[string]string{
		"qrcode = locked\n":                                  "no access code",
		"qrcode = locked\npdf = locked\n":                    "pdf, qrcode are marked locked",
		"qrcode = locked\nlock.code = abc\n":                 "at least 4 characters",
		"lock.code = abcdef\nlock.code = ghijkl\n":           "listed twice",
		"qrcode = locked\nqrcode = true\nlock.code = abcdef": "listed twice",
		"lock.hours = 0\n":                                   "from 1 to 168",
		"lock.hours = 169\n":                                 "from 1 to 168",
		"qrcode = maybe\n":                                   "true, false or locked",
		"nosuchtool = locked\nlock.code = abcdef\n":          "unknown tool",
	}
	for in, want := range bad {
		_, err := parseToolConfig(strings.NewReader(in), "tools.conf")
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: error %v, want it to contain %q", in, err, want)
		}
	}
	// a "#" inside the code is part of the code, not a comment
	ts := mustParse(t, "qrcode = locked\nlock.code = secret#with#hash\n")
	if ts.lockCode() != "secret#with#hash" {
		t.Errorf("the code was cut at the #: %q", ts.lockCode())
	}
	// a commented-out code line does nothing
	if ts := mustParse(t, "# lock.code = abcdefgh\nqrcode = true\n"); ts.lockCode() != "" || len(ts.lockedNames()) != 0 {
		t.Error("a commented line must be ignored")
	}
	// the code never appears in the list of hidden tools or in the page script
	if strings.Contains(ts.toolsScript(), "secret") {
		t.Error("the code must never be sent to the page")
	}
}

func TestWhatIsLocked(t *testing.T) {
	ts := mustParse(t, "qrcode = locked\nengineering = locked\nimages = locked\nimgblur = false\nlock.code = abcdef\n")
	cases := map[string]bool{
		"qrcode": true, "jsonfmt": true, "colorconv": true, // alone, and through the folder
		"imgexif": true, "imgblur": false, // off wins over locked
		"pdfinfo": false, "subnet": false, "portref": false,
	}
	for id, want := range cases {
		if got := ts.appLocked(id); got != want {
			t.Errorf("appLocked(%q) = %v, want %v", id, got, want)
		}
	}
	if len(ts.hidden()) != 1 || ts.hidden()[0] != "imgblur" {
		t.Errorf("locking must not hide anything: %v", ts.hidden())
	}
	var none *toolSet
	if none.appLocked("qrcode") || len(none.lockedNames()) != 0 || none.lockScript(httptest.NewRequest("GET", "/", nil)) != "" {
		t.Error("with no tools.conf nothing is locked")
	}
	if ts2 := mustParse(t, "pdf = false\npdfcrop = locked\nlock.code = abcdef\n"); ts2.appLocked("pdfcrop") {
		t.Error("a tool in a switched-off folder is off, not locked")
	}
}

func TestLockTokens(t *testing.T) {
	ts := mustParse(t, "qrcode = locked\nlock.code = abcdef\nlock.hours = 2\n")
	now := time.Now()
	tok, exp := ts.newLockToken(now)
	if !ts.validLockToken(tok, now) || exp.Sub(now) != 2*time.Hour {
		t.Fatal("a fresh token must be valid for 2 hours")
	}
	if ts.validLockToken(tok, now.Add(2*time.Hour+time.Second)) {
		t.Error("an expired token must be refused")
	}
	p, sig, _ := strings.Cut(tok, ".")
	for name, bad := range map[string]string{
		"later expiry":    "9999999999." + sig,
		"changed payload": p + "0." + sig,
		"changed sig":     p + "." + sig[:len(sig)-1] + "A",
		"empty":           "",
		"no dot":          p,
		"just a dot":      ".",
		"letters":         "abc.def",
		"huge number":     "99999999999999999999." + sig,
	} {
		if ts.validLockToken(bad, now) {
			t.Errorf("%s: a tampered token was accepted", name)
		}
	}
	other := mustParse(t, "qrcode = locked\nlock.code = abcdeg\nlock.hours = 2\n")
	if other.validLockToken(tok, now) {
		t.Error("a token made with another code must not work: changing the code logs everybody out")
	}
	shorter := mustParse(t, "qrcode = locked\nlock.code = abcdef\nlock.hours = 1\n")
	if shorter.validLockToken(tok, now) {
		t.Error("lowering lock.hours must also shorten cookies that were already handed out")
	}
	same := mustParse(t, "qrcode = locked\nlock.code = abcdef\nlock.hours = 2\n")
	if !same.validLockToken(tok, now) {
		t.Error("the same code and hours (for example after a restart) must keep sessions alive")
	}
}

func TestLockedToolsNeedTheCode(t *testing.T) {
	h := lockHandler(t, "qrcode = locked\nnetquality = locked\naggregator = locked\nidletest = locked\nconnfacts = locked\nlock.code = open sesame\n")
	for _, p := range []string{"/apps/qrcode/app.js", "/apps/qrcode/app.html", "/apps/qrcode/app.css", "/apps/qrcode/../qrcode/app.js", "/apps//qrcode/app.js", "/apps/netquality/app.js", "/api/ping?run=abcdef&seq=1", "/api/seen", "/api/monitor", "/api/download", "/api/hold?secs=1", "/api/facts"} {
		if w := lget(h, p, nil); w.Code != 401 && w.Code != 301 && w.Code != 308 {
			t.Errorf("GET %s without the code: %d, want 401", p, w.Code)
		}
	}
	for _, p := range []string{"/api/aggregate", "/api/upload", "/api/monitor"} {
		if w := lpost(h, p, "10.0.0.0/24", nil); w.Code != 401 {
			t.Errorf("POST %s without the code: %d, want 401", p, w.Code)
		}
	}
	// what stays open: the page, the icons, other tools, shared libraries
	for p, want := range map[string]int{"/": 200, "/apps/qrcode/icon.svg": 200, "/apps/netquality/icon.svg": 200, "/apps/jsonfmt/app.js": 200, "/lib/tk.js": 200, "/shell.js": 200, "/edge-probe.txt": 200} {
		if w := lget(h, p, nil); w.Code != want {
			t.Errorf("GET %s: %d, want %d", p, w.Code, want)
		}
	}
	// the answer says so, and is never cached
	w := lget(h, "/apps/qrcode/app.js", nil)
	if !strings.Contains(w.Body.String(), `"locked":true`) || w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("a locked answer says so and is not cached: %q %q", w.Body.String(), w.Header().Get("Cache-Control"))
	}
	// the page is told what is locked, and not the code
	js := lget(h, "/tools-config.js", nil).Body.String()
	if !strings.Contains(js, `window.TOOLS_LOCKED=["aggregator","connfacts","idletest","netquality","qrcode"]`) || !strings.Contains(js, "window.TOOLS_UNLOCKED=false") || strings.Contains(js, "sesame") {
		t.Errorf("tools-config.js: %q", js)
	}
}

func TestUnlocking(t *testing.T) {
	h := lockHandler(t, "qrcode = locked\nlock.code = open sesame\nlock.hours = 5\n")
	if w := lpost(h, "/api/unlock", `{"code":"nope"}`, nil); w.Code != 403 || lockCookieOf(w) != nil {
		t.Errorf("a wrong code: %d, cookie %v", w.Code, lockCookieOf(w))
	}
	if w := lpost(h, "/api/unlock", `not json`, nil); w.Code != 400 {
		t.Errorf("rubbish: %d", w.Code)
	}
	if w := lpost(h, "/api/unlock", `{"code":"`+strings.Repeat("x", 5000)+`"}`, nil); w.Code != 400 {
		t.Errorf("an oversized body: %d", w.Code)
	}
	w := lpost(h, "/api/unlock", `{"code":"  open sesame "}`, nil) // spaces round the code do not matter
	c := lockCookieOf(w)
	if w.Code != 200 || c == nil {
		t.Fatalf("the right code: %d, cookie %v", w.Code, c)
	}
	if !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.Path != "/" || c.MaxAge != 5*3600 || c.Secure {
		t.Errorf("cookie flags: %+v", c)
	}
	if got := lockCookieOf(lpost(h, "/api/unlock", `{"code":"open sesame"}`, nil, "X-Forwarded-Proto", "https")); got == nil || !got.Secure {
		t.Error("over https the cookie must be Secure")
	}
	if w := lget(h, "/apps/qrcode/app.js", c); w.Code != 200 {
		t.Errorf("with the cookie: %d", w.Code)
	}
	if !strings.Contains(lget(h, "/tools-config.js", c).Body.String(), "window.TOOLS_UNLOCKED=true") {
		t.Error("the page must be told this visitor is unlocked")
	}
	bad := *c
	bad.Value = c.Value[:len(c.Value)-2] + "xx"
	if w := lget(h, "/apps/qrcode/app.js", &bad); w.Code != 401 {
		t.Errorf("a tampered cookie: %d", w.Code)
	}
	// another server with another code does not accept this cookie
	h2 := lockHandler(t, "qrcode = locked\nlock.code = open sesamf\nlock.hours = 5\n")
	if w := lget(h2, "/apps/qrcode/app.js", c); w.Code != 401 {
		t.Errorf("a cookie from another code: %d", w.Code)
	}
	// locking again
	w = lpost(h, "/api/lock", "", c)
	if lc := lockCookieOf(w); w.Code != 200 || lc == nil || lc.MaxAge >= 0 {
		t.Errorf("lock again must clear the cookie: %d %+v", w.Code, lc)
	}
}

func TestWrongCodesAreLimited(t *testing.T) {
	h := lockHandler(t, "qrcode = locked\nlock.code = open sesame\n")
	for i := 0; i < lockFailPerIP; i++ {
		if w := lpost(h, "/api/unlock", `{"code":"wrong`+string(rune('a'+i))+`"}`, nil); w.Code != 403 {
			t.Fatalf("try %d: %d", i+1, w.Code)
		}
	}
	w := lpost(h, "/api/unlock", `{"code":"open sesame"}`, nil)
	if w.Code != 429 || w.Header().Get("Retry-After") == "" || lockCookieOf(w) != nil {
		t.Errorf("after %d wrong codes even the right one waits: %d %q", lockFailPerIP, w.Code, w.Header().Get("Retry-After"))
	}
	if !strings.Contains(w.Body.String(), "Try again in") {
		t.Errorf("the message says how long: %q", w.Body.String())
	}
	// another address is not affected
	r := httptest.NewRequest("POST", "/api/unlock", strings.NewReader(`{"code":"open sesame"}`))
	r.RemoteAddr = "192.0.2.77:5000"
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	if rec.Code != 200 {
		t.Errorf("a different visitor: %d", rec.Code)
	}
}

func TestLockGateWindow(t *testing.T) {
	g := newLockGate()
	now := time.Now()
	g.now = func() time.Time { return now }
	for i := 0; i < lockFailPerIP; i++ {
		g.fail("1.2.3.4")
	}
	if g.wait("1.2.3.4") <= 0 || g.wait("5.6.7.8") != 0 {
		t.Error("only the address with too many failures waits")
	}
	now = now.Add(lockFailWindow + time.Second)
	if g.wait("1.2.3.4") != 0 {
		t.Error("the wait ends after the window")
	}
	// many addresses together also hit the overall limit
	for i := 0; i < lockFailTotal; i++ {
		g.fail("10.0." + string(rune('0'+i/50)) + "." + string(rune('0'+i%50)))
	}
	if g.wait("9.9.9.9") <= 0 {
		t.Error("a guessing run spread over many addresses must also be slowed down")
	}
	// memory stays bounded
	g2 := newLockGate()
	for i := 0; i < lockGateMax+500; i++ {
		g2.fail("a" + string(rune(i)))
	}
	if len(g2.fails) > lockGateMax {
		t.Errorf("the gate remembers %d addresses", len(g2.fails))
	}
}

func TestNothingLockedMeansNoUnlockCall(t *testing.T) {
	h := lockHandler(t, "")
	if w := lpost(h, "/api/unlock", `{"code":"x"}`, nil); w.Code == 200 {
		t.Error("with no locked tools there is nothing to unlock")
	}
	if w := lget(h, "/apps/qrcode/app.js", nil); w.Code != 200 {
		t.Errorf("nothing is locked: %d", w.Code)
	}
	if strings.Contains(lget(h, "/tools-config.js", nil).Body.String(), "TOOLS_LOCKED") {
		t.Error("no lock information when nothing is locked")
	}
}

func TestLockedFolder(t *testing.T) {
	h := lockHandler(t, "pdf = locked\npdfcrop = true\nlock.code = abcdefgh\n")
	for _, id := range []string{"pdfinfo", "pdfcrop", "pdfredact"} {
		if w := lget(h, "/apps/"+id+"/app.js", nil); w.Code != 401 {
			t.Errorf("%s in a locked folder: %d", id, w.Code)
		}
	}
	if w := lget(h, "/apps/subnet/app.js", nil); w.Code != 200 {
		t.Errorf("a tool outside the folder: %d", w.Code)
	}
}

func TestLockedToolPathMapping(t *testing.T) {
	cases := map[string]string{
		"/apps/qrcode/app.js": "qrcode", "/apps/qrcode/icon.svg": "", "/apps/qrcode/sub/icon.svg": "qrcode", "/apps/qrcode/../jsonfmt/app.js": "jsonfmt",
		"/api/hold": "idletest", "/api/ping": "netquality", "/api/aggregate": "aggregator", "/api/facts": "connfacts", "/api/unlock": "", "/": "", "/lib/tk.js": "",
		"//apps//qrcode//app.js": "qrcode", "/APPS/qrcode/app.js": "",
	}
	for p, want := range cases {
		if got := lockedToolFor(p); got != want {
			t.Errorf("lockedToolFor(%q) = %q, want %q", p, got, want)
		}
	}
}

// Games are tools like any other: a game, or the whole Games folder, can be locked. The games make no server calls, so the lock is their files.
func TestLockedGames(t *testing.T) {
	games := []string{"blocks", "mines", "pinball", "racer", "pool", "birdhunt"}
	ts := mustParse(t, "games = locked\nlock.code = abcdef\n")
	for _, g := range games {
		if !ts.appLocked(g) {
			t.Errorf("%s must be locked when the Games folder is", g)
		}
	}
	one := mustParse(t, "pool = locked\nlock.code = abcdef\n")
	for _, g := range games {
		if want := g == "pool"; one.appLocked(g) != want {
			t.Errorf("only pool is locked, but appLocked(%q) = %v", g, one.appLocked(g))
		}
	}
	if off := mustParse(t, "games = false\npool = locked\nlock.code = abcdef\n"); off.appLocked("pool") {
		t.Error("a game in a switched-off folder is off, not locked")
	}

	h := lockHandler(t, "games = locked\nlock.code = open sesame\n")
	var cookie *http.Cookie
	for _, g := range games {
		for _, f := range []string{"app.js", "app.html", "app.css"} {
			if w := lget(h, "/apps/"+g+"/"+f, nil); w.Code != 401 {
				t.Errorf("/apps/%s/%s without the code: %d, want 401", g, f, w.Code)
			}
		}
		if w := lget(h, "/apps/"+g+"/icon.svg", nil); w.Code != 200 {
			t.Errorf("the icon of %s must stay public (the desktop shows it): %d", g, w.Code)
		}
	}
	if w := lget(h, "/lib/gamekit.js", nil); w.Code != 200 {
		t.Errorf("the shared games library is public like every library: %d", w.Code)
	}
	cookie = lockCookieOf(lpost(h, "/api/unlock", `{"code":"open sesame"}`, nil))
	if cookie == nil {
		t.Fatal("no cookie")
	}
	for _, g := range games {
		if w := lget(h, "/apps/"+g+"/app.js", cookie); w.Code != 200 {
			t.Errorf("/apps/%s/app.js with the code: %d", g, w.Code)
		}
	}
	// one game locked: its neighbours stay open
	h2 := lockHandler(t, "pool = locked\nlock.code = open sesame\n")
	if lget(h2, "/apps/pool/app.js", nil).Code != 401 || lget(h2, "/apps/blocks/app.js", nil).Code != 200 || lget(h2, "/apps/pinball/app.js", nil).Code != 200 {
		t.Error("locking one game must not lock the others")
	}
	if js := lget(h2, "/tools-config.js", nil).Body.String(); !strings.Contains(js, `window.TOOLS_LOCKED=["pool"]`) {
		t.Errorf("tools-config.js: %q", js)
	}
}
