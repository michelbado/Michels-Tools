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
	maxBytes  int64       // most the log files may take together (0 = no limit); the oldest days are deleted first, and when today alone reaches it, visits are not recorded
	size      int64       // what the log files take now (only the logger goroutine touches it)
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
func newVisitLogger(dir string, retentionDays int, maxBytes int64, ips *ipResolver) (*visitLogger, error) {
	return startVisitLogger(dir, retentionDays, maxBytes, ips, time.Now)
}

// startVisitLogger is newVisitLogger with an injectable clock (for tests).
func startVisitLogger(dir string, retentionDays int, maxBytes int64, ips *ipResolver, now func() time.Time) (*visitLogger, error) {
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
		dir: dir, retention: retentionDays, maxBytes: maxBytes, ips: ips,
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
			if name != "" {
				l.cleanup() // a new day: old days may now be due, which also frees room under the size limit
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
		if l.maxBytes > 0 && l.size+int64(len(line)) > l.maxBytes {
			l.dropped.Add(1) // the folder is full and nothing older can go: never grow past the limit
			return
		}
		w.Write(line)
		l.size += int64(len(line))
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

// cleanup deletes daily files older than the retention period and then, when the files together take more than maxBytes, the oldest days
// until they fit (today's file is never deleted). It also measures what the files take now.
func (l *visitLogger) cleanup() {
	entries, err := os.ReadDir(l.dir)
	if err != nil {
		return
	}
	cutoff := l.now().UTC().AddDate(0, 0, -l.retention)
	type dayFile struct {
		name string
		size int64
	}
	var keep []dayFile
	var total int64
	for _, e := range entries { // ReadDir lists by name, and the names start with the date: oldest first
		m := fileName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		day, err := time.Parse("2006-01-02", m[1])
		if err == nil && day.Before(cutoff.Truncate(24*time.Hour)) {
			os.Remove(filepath.Join(l.dir, e.Name()))
			continue
		}
		if info, err := e.Info(); err == nil {
			keep = append(keep, dayFile{e.Name(), info.Size()})
			total += info.Size()
		}
	}
	if l.maxBytes > 0 {
		today := "visits-" + l.now().UTC().Format("2006-01-02") + ".jsonl"
		for _, f := range keep {
			if total <= l.maxBytes || f.name >= today {
				break
			}
			if os.Remove(filepath.Join(l.dir, f.name)) == nil {
				total -= f.size
			}
		}
	}
	l.size = total
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
