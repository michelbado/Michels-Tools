package main

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strconv"
	"sync"
	"time"
)

// Idle-timeout finder: GET /api/hold holds a request open and says nothing (or only a small heartbeat), so the page can see how
// long the path between the visitor and this server lets a quiet connection live. Nothing is read, logged or stored; each held
// request costs one sleeping goroutine. Limits: holdMaxTotal at once on the whole server, holdMaxPerIP per visitor, and at most
// the idletest.max_seconds setting (default 300) per request.
const (
	holdMaxTotal  = 40
	holdMaxPerIP  = 4
	holdDefBeat   = 15
	holdMinBeat   = 5
	holdMaxBeat   = 60
	holdMinSecs   = 1
	holdRetryWait = "5"
	holdSeenMax   = 4096
	holdSeenTTL   = 15 * time.Minute
)

type holdGate struct {
	mu    sync.Mutex
	total int
	per   map[string]int
}

func newHoldGate() *holdGate { return &holdGate{per: map[string]int{}} }

func (g *holdGate) acquire(ip string) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.total >= holdMaxTotal || g.per[ip] >= holdMaxPerIP {
		return false
	}
	g.total++
	g.per[ip]++
	return true
}

func (g *holdGate) release(ip string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.total--
	if g.per[ip] <= 1 {
		delete(g.per, ip)
	} else {
		g.per[ip]--
	}
}

func (g *holdGate) counts() (int, int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.total, len(g.per)
}

// holdSeen remembers the id of every hold for a while. When a path cuts a connection, the browser quietly sends the same request again;
// the second arrival is recognised and answered at once with how long ago the first one began, so the page can report the true cut time.
type holdSeen struct {
	mu sync.Mutex
	at map[string]time.Time
}

// first returns (0, false) the first time an id is seen (and remembers it), or (age, true) afterwards.
func (h *holdSeen) first(id string, now time.Time) (time.Duration, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if t, ok := h.at[id]; ok {
		return now.Sub(t), true
	}
	if len(h.at) >= holdSeenMax {
		for k, t := range h.at {
			if now.Sub(t) > holdSeenTTL {
				delete(h.at, k)
			}
		}
	}
	if len(h.at) < holdSeenMax {
		h.at[id] = now
	}
	return 0, false
}

var holdID = regexp.MustCompile("^[A-Za-z0-9]{6,32}$")

func registerHold(mux *http.ServeMux, cfg config) {
	gate := newHoldGate()
	seen := &holdSeen{at: map[string]time.Time{}}
	mux.HandleFunc("GET /api/hold", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Tools.appOff("idletest") {
			http.NotFound(w, r)
			return
		}
		maxSecs := cfg.Tools.intSetting("idletest.max_seconds")
		w.Header().Set("Cache-Control", "no-store")
		q := r.URL.Query()
		if q.Get("secs") == "" { // no duration: say what this server allows
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]int{"max": maxSecs, "beat": holdDefBeat})
			return
		}
		secs, err := strconv.Atoi(q.Get("secs"))
		if err != nil || secs < holdMinSecs || secs > maxSecs {
			http.Error(w, "secs must be a whole number from 1 to "+strconv.Itoa(maxSecs), http.StatusBadRequest)
			return
		}
		beat := 0 // 0: say nothing until the end
		if b := q.Get("beat"); b != "" {
			beat, err = strconv.Atoi(b)
			if err != nil || beat < holdMinBeat || beat > holdMaxBeat {
				http.Error(w, "beat must be a whole number from 5 to 60", http.StatusBadRequest)
				return
			}
		}
		if id := q.Get("id"); id != "" {
			if !holdID.MatchString(id) {
				http.Error(w, "id must be 6 to 32 letters or digits", http.StatusBadRequest)
				return
			}
			if age, dup := seen.first(id, time.Now()); dup {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]any{"retry": true, "age": age.Milliseconds()})
				return
			}
		}
		ip := diagIP(cfg, r)
		if !gate.acquire(ip) {
			w.Header().Set("Retry-After", holdRetryWait)
			http.Error(w, "Too many waiting tests right now. Try again in a few seconds.", http.StatusTooManyRequests)
			return
		}
		defer gate.release(ip)

		total := time.Duration(secs) * time.Second
		end := time.NewTimer(total)
		defer end.Stop()
		if beat == 0 {
			// quiet: not one byte, not even the headers, until the time is up
			select {
			case <-end.C:
			case <-r.Context().Done():
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]int64{"held": int64(secs), "t": time.Now().UnixMicro()})
			return
		}
		// heartbeat: headers now, then one dot every beat seconds, then the closing line
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		rc := http.NewResponseController(w)
		if _, err := w.Write([]byte("hold\n")); err != nil || rc.Flush() != nil {
			return
		}
		tick := time.NewTicker(time.Duration(beat) * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-tick.C:
				if _, err := w.Write([]byte(".")); err != nil || rc.Flush() != nil {
					return
				}
			case <-end.C:
				w.Write([]byte("\nheld " + strconv.Itoa(secs) + "\n"))
				rc.Flush()
				return
			case <-r.Context().Done():
				return
			}
		}
	})
}
