package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Locked tools. A tool (or a whole folder) that tools.conf marks "locked" stays visible on the desktop, but its files and server calls are refused until
// the visitor has entered the shared access code (lock.code). It is meant to keep a tool out of casual hands, not to guard secrets: there is one code for
// every locked tool, no accounts, and the shared libraries stay public.
//
// How it works: POST /api/unlock with the code sets a cookie that is signed with a key made from the code (so changing the code logs everybody out, and a
// restart does not). Wrong codes are counted per address and overall, and slowed down. Nothing about a visitor is stored on the server.
const (
	lockCookie     = "mt_unlock"
	lockFailWindow = 10 * time.Minute
	lockFailPerIP  = 8
	lockFailTotal  = 120

	lockGateMax = 5000 // addresses remembered at once
)

// lockFailDelay slows every wrong guess a little (a variable so that tests can shorten it).
var lockFailDelay = 400 * time.Millisecond

// ---- the cookie ----

func (t *toolSet) lockKey() []byte {
	h := sha256.Sum256([]byte("michels-tools-lock-v1|" + t.lockCode()))
	return h[:]
}

func (t *toolSet) lockHours() int { return t.intSetting("lock.hours") }

func (t *toolSet) lockSign(payload string) string {
	m := hmac.New(sha256.New, t.lockKey())
	io.WriteString(m, "v1."+payload)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// newLockToken: "<expiry unix seconds>.<signature>"
func (t *toolSet) newLockToken(now time.Time) (string, time.Time) {
	exp := now.Add(time.Duration(t.lockHours()) * time.Hour)
	p := strconv.FormatInt(exp.Unix(), 10)
	return p + "." + t.lockSign(p), exp
}

func (t *toolSet) validLockToken(tok string, now time.Time) bool {
	if t == nil || t.lockCode() == "" {
		return false
	}
	p, sig, ok := strings.Cut(tok, ".")
	if !ok || p == "" || len(p) > 12 {
		return false
	}
	exp, err := strconv.ParseInt(p, 10, 64)
	if err != nil || exp <= now.Unix() || exp > now.Add(time.Duration(t.lockHours())*time.Hour+time.Minute).Unix() {
		return false // expired, or further away than any cookie we would have made (the hours setting may have been lowered)
	}
	return hmac.Equal([]byte(sig), []byte(t.lockSign(p)))
}

func (t *toolSet) unlocked(r *http.Request) bool {
	c, err := r.Cookie(lockCookie)
	return err == nil && t.validLockToken(c.Value, time.Now())
}

// ---- which requests belong to a locked tool ----

// lockedToolFor: the tool a request path belongs to ("" when it belongs to none). A tool's icon stays public: the desktop shows it.
func lockedToolFor(p string) string {
	clean := path.Clean("/" + p)
	if id := appIDFromPath(clean); id != "" {
		if strings.HasSuffix(clean, "/icon.svg") && strings.Count(strings.Trim(clean, "/"), "/") == 2 {
			return ""
		}
		return id
	}
	switch clean {
	case "/api/aggregate":
		return "aggregator"
	case "/api/hold":
		return "idletest"
	case "/api/facts":
		return "connfacts"
	case "/api/ping", "/api/seen", "/api/monitor", "/api/download", "/api/upload":
		return "netquality"
	}
	return ""
}

// lockGuard refuses the files and calls of locked tools unless the visitor has unlocked them.
func lockGuard(t *toolSet, next http.Handler) http.Handler {
	if len(t.lockedNames()) == 0 {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if id := lockedToolFor(r.URL.Path); id != "" && t.appLocked(id) && !t.unlocked(r) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.WriteHeader(http.StatusUnauthorized)
			io.WriteString(w, `{"locked":true}`)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ---- counting wrong codes ----

type lockGate struct {
	mu    sync.Mutex
	fails map[string][]time.Time
	total []time.Time
	now   func() time.Time
}

func newLockGate() *lockGate { return &lockGate{fails: map[string][]time.Time{}, now: time.Now} }

func prune(list []time.Time, cutoff time.Time) []time.Time {
	i := 0
	for i < len(list) && list[i].Before(cutoff) {
		i++
	}
	return list[i:]
}

// wait: 0 when this address may try, otherwise how long it must wait
func (g *lockGate) wait(ip string) time.Duration {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	cut := now.Add(-lockFailWindow)
	g.total = prune(g.total, cut)
	l := prune(g.fails[ip], cut)
	if len(l) == 0 {
		delete(g.fails, ip)
	} else {
		g.fails[ip] = l
	}
	if len(l) >= lockFailPerIP {
		return l[0].Add(lockFailWindow).Sub(now)
	}
	if len(g.total) >= lockFailTotal {
		return g.total[0].Add(lockFailWindow).Sub(now)
	}
	return 0
}

// fail records a wrong code and returns how many wrong codes this address and all addresses together have in the window now.
func (g *lockGate) fail(ip string) (perAddress, overall int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	now := g.now()
	if _, known := g.fails[ip]; !known && len(g.fails) >= lockGateMax {
		for k := range g.fails { // make room: forget one address (map order is random)
			delete(g.fails, k)
			break
		}
	}
	g.fails[ip] = append(g.fails[ip], now)
	g.total = append(g.total, now)
	return len(g.fails[ip]), len(g.total)
}

func (g *lockGate) ok(ip string) { g.mu.Lock(); delete(g.fails, ip); g.mu.Unlock() }

// ---- the two calls ----

func isHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") || strings.Contains(r.Header.Get("CF-Visitor"), `"scheme":"https"`)
}

func setLockCookie(w http.ResponseWriter, r *http.Request, value string, exp time.Time, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: lockCookie, Value: value, Path: "/", Expires: exp, MaxAge: maxAge, HttpOnly: true, Secure: isHTTPS(r), SameSite: http.SameSiteStrictMode})
}

func registerLock(mux *http.ServeMux, cfg config) {
	t := cfg.Tools
	if len(t.lockedNames()) == 0 {
		return
	}
	gate := newLockGate()
	code := sha256.Sum256([]byte(t.lockCode()))
	reply := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(v)
	}
	mux.HandleFunc("POST /api/unlock", func(w http.ResponseWriter, r *http.Request) {
		ip := diagIP(cfg, r)
		who := fmt.Sprintf("%s, browser %q", ip, cleanForLog(r.Header.Get("User-Agent"), 120)) // the address is parsed, the browser text is cleaned: safe for a log line
		if d := gate.wait(ip); d > 0 {
			events.say("unlock-turned-away", time.Minute, "unlock: attempts are being turned away because of too many wrong codes (latest from %s)", who)
			secs := int(d.Seconds()) + 1
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			reply(w, http.StatusTooManyRequests, map[string]any{"error": "Too many wrong codes. Try again in " + waitText(secs) + ".", "retry": secs})
			return
		}
		var body struct {
			Code string `json:"code"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&body); err != nil {
			reply(w, http.StatusBadRequest, map[string]any{"error": "Send the code as JSON: {\"code\": \"...\"}."})
			return
		}
		given := sha256.Sum256([]byte(strings.TrimSpace(body.Code)))
		if subtle.ConstantTimeCompare(given[:], code[:]) != 1 {
			n, all := gate.fail(ip)
			// who is guessing: the address and browser, and how many wrong codes that address has used; the code that was typed is never written down
			log.Printf("unlock: wrong code from %s (%d of %d allowed in %s)", who, n, lockFailPerIP, lockFailWindow)
			if n == lockFailPerIP {
				log.Printf("unlock: %s is blocked for up to %s after %d wrong codes", ip, lockFailWindow, n)
			}
			if all == lockFailTotal {
				log.Printf("unlock: %d wrong codes from all addresses together in %s: unlocking is paused for everybody until the window passes", all, lockFailWindow)
			}
			time.Sleep(lockFailDelay)
			reply(w, http.StatusForbidden, map[string]any{"error": "That is not the code."})
			return
		}
		gate.ok(ip)
		log.Printf("unlock: code accepted from %s", who)
		tok, exp := t.newLockToken(time.Now())
		setLockCookie(w, r, tok, exp, t.lockHours()*3600)
		reply(w, http.StatusOK, map[string]any{"ok": true, "hours": t.lockHours()})
	})
	// lock again: forget the cookie
	mux.HandleFunc("POST /api/lock", func(w http.ResponseWriter, r *http.Request) {
		setLockCookie(w, r, "", time.Unix(0, 0), -1)
		reply(w, http.StatusOK, map[string]any{"ok": true})
	})
}

func waitText(secs int) string {
	if secs >= 90 {
		return fmt.Sprintf("%d minutes", (secs+59)/60)
	}
	return fmt.Sprintf("%d seconds", secs)
}

// lockScript: what the page needs to know, added to /tools-config.js: which tools ask for a code and whether this visitor has already entered it.
func (t *toolSet) lockScript(r *http.Request) string {
	apps := t.lockedApps()
	if len(apps) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("window.TOOLS_LOCKED=[")
	for i, n := range apps {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%q", n)
	}
	fmt.Fprintf(&b, "];\nwindow.TOOLS_UNLOCKED=%t;\n", t.unlocked(r))
	return b.String()
}
