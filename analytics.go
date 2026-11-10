package main

import (
	"bufio"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sync/atomic"
	"time"
)

// visitLogger records one JSON line per page visit or app opened, for
// analytics and statistics: time, IP address, browser string, event and app.
//
// It never sees request bodies. Nothing a visitor types, pastes or uploads is
// passed to it, so it cannot be written to the log.
type visitLogger struct {
	dir       string
	retention int         // days to keep daily files
	ips       *ipResolver // finds the visitor's real address (may be nil: use the connection)
	ch        chan []byte
	quit      chan struct{}
	done      chan struct{}
	dropped   atomic.Int64
	now       func() time.Time
}

type visitEntry struct {
	Time  string `json:"t"`
	IP    string `json:"ip"`
	Agent string `json:"ua"`
	Event string `json:"ev"`
	App   string `json:"app,omitempty"`
}

const maxAgentLen = 300

var (
	appPath  = regexp.MustCompile(`^/apps/([a-z0-9_-]{1,40})/app\.html$`)
	fileName = regexp.MustCompile(`^visits-(\d{4}-\d{2}-\d{2})\.jsonl$`)
)

// newVisitLogger returns nil (logging off) when dir is empty.
func newVisitLogger(dir string, retentionDays int, ips *ipResolver) (*visitLogger, error) {
	return startVisitLogger(dir, retentionDays, ips, time.Now)
}

// startVisitLogger is newVisitLogger with an injectable clock (for tests).
func startVisitLogger(dir string, retentionDays int, ips *ipResolver, now func() time.Time) (*visitLogger, error) {
	if dir == "" {
		return nil, nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	if retentionDays < 1 {
		retentionDays = 1
	}
	l := &visitLogger{
		dir: dir, retention: retentionDays, ips: ips,
		ch:   make(chan []byte, 4096),
		quit: make(chan struct{}),
		done: make(chan struct{}),
		now:  now,
	}
	l.cleanup()
	go l.run()
	return l, nil
}

// Close stops the logger after writing everything already queued.
func (l *visitLogger) Close() {
	if l == nil {
		return
	}
	close(l.quit)
	<-l.done
}

func (l *visitLogger) run() {
	defer close(l.done)
	var (
		f    *os.File
		w    *bufio.Writer
		name string
	)
	flush := func() {
		if w != nil {
			w.Flush()
		}
	}
	write := func(line []byte) {
		day := l.now().UTC().Format("2006-01-02")
		if day != name {
			flush()
			if f != nil {
				f.Close()
			}
			var err error
			f, err = os.OpenFile(filepath.Join(l.dir, "visits-"+day+".jsonl"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
			if err != nil {
				f, w, name = nil, nil, ""
				l.dropped.Add(1)
				return
			}
			w, name = bufio.NewWriter(f), day
		}
		w.Write(line)
	}
	tick := time.NewTicker(time.Second)
	clean := time.NewTicker(time.Hour)
	defer tick.Stop()
	defer clean.Stop()
	for {
		select {
		case line := <-l.ch:
			write(line)
		case <-tick.C:
			flush()
		case <-clean.C:
			l.cleanup()
		case <-l.quit:
			for {
				select {
				case line := <-l.ch:
					write(line)
				default:
					flush()
					if f != nil {
						f.Close()
					}
					return
				}
			}
		}
	}
}

// cleanup deletes daily files older than the retention period.
func (l *visitLogger) cleanup() {
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		return
	}
	cutoff := l.now().UTC().AddDate(0, 0, -l.retention)
	for _, e := range entries {
		m := fileName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		day, err := time.Parse("2006-01-02", m[1])
		if err == nil && day.Before(cutoff.Truncate(24*time.Hour)) {
			os.Remove(filepath.Join(l.dir, e.Name()))
		}
	}
}

// clientIP is the visitor's real address (see ipResolver).
func (l *visitLogger) clientIP(r *http.Request) string { return l.ips.IP(r) }

// classify decides whether a request counts as a visit, an app being opened,
// or neither (stylesheets, scripts, icons and so on are not recorded).
func classify(r *http.Request) (event, app string) {
	switch {
	case r.Method == http.MethodGet && (r.URL.Path == "/" || r.URL.Path == "/index.html"):
		return "visit", ""
	case r.Method == http.MethodGet:
		if m := appPath.FindStringSubmatch(r.URL.Path); m != nil {
			return "app", m[1]
		}
	case r.Method == http.MethodPost && r.URL.Path == "/api/aggregate":
		return "aggregate", "aggregator"
	}
	return "", ""
}

func (l *visitLogger) record(r *http.Request, event, app string) {
	ua := r.Header.Get("User-Agent")
	if len(ua) > maxAgentLen {
		ua = ua[:maxAgentLen]
	}
	b, err := json.Marshal(visitEntry{
		Time: l.now().UTC().Format(time.RFC3339), IP: l.clientIP(r), Agent: ua, Event: event, App: app,
	})
	if err != nil {
		return
	}
	select {
	case l.ch <- append(b, '\n'):
	default:
		l.dropped.Add(1) // never slow a visitor down because of the log
	}
}

func (l *visitLogger) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if ev, app := classify(r); ev != "" {
			l.record(r, ev, app)
		}
		next.ServeHTTP(w, r)
	})
}
