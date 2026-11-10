package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func newTestLogger(t *testing.T, header string) (*visitLogger, string) {
	t.Helper()
	dir := t.TempDir()
	rv, err := newIPResolver(header, "")
	if err != nil {
		t.Fatal(err)
	}
	l, err := newVisitLogger(dir, 90, rv)
	if err != nil {
		t.Fatal(err)
	}
	return l, dir
}

func readAll(t *testing.T, dir string) (string, []visitEntry) {
	t.Helper()
	files, _ := filepath.Glob(filepath.Join(dir, "visits-*.jsonl"))
	var raw strings.Builder
	var out []visitEntry
	for _, f := range files {
		b, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		raw.Write(b)
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			if line == "" {
				continue
			}
			var e visitEntry
			if err := json.Unmarshal([]byte(line), &e); err != nil {
				t.Fatalf("log line is not valid JSON: %q: %v", line, err)
			}
			out = append(out, e)
		}
	}
	return raw.String(), out
}

func do(h http.Handler, method, path, body, remote, ua string, hdr map[string]string) {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = remote
	if ua != "" {
		r.Header.Set("User-Agent", ua)
	}
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	h.ServeHTTP(httptest.NewRecorder(), r)
}

func TestVisitsAreRecordedAndInputIsNot(t *testing.T) {
	l, dir := newTestLogger(t, "")
	cfg := testCfg()
	cfg.Visits = l
	h, _ := newHandler(cfg)
	ua := "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

	do(h, "GET", "/", "", "192.0.2.7:51000", ua, nil)
	do(h, "GET", "/apps/subnet/app.html?v=14", "", "192.0.2.7:51000", ua, nil)
	do(h, "POST", "/api/aggregate", "SECRET-PASTE 10.1.2.3/24 hunter2", "192.0.2.7:51000", ua, nil)
	// not recorded: static files, icons, libraries, other methods
	for _, p := range []string{"/xp.css", "/shell.css", "/shell.js", "/lib/ipv4.js", "/apps/subnet/icon.svg", "/apps/subnet/app.js", "/nope"} {
		do(h, "GET", p, "", "192.0.2.7:51000", ua, nil)
	}
	do(h, "HEAD", "/", "", "192.0.2.7:51000", ua, nil)
	l.Close()

	raw, entries := readAll(t, dir)
	if len(entries) != 3 {
		t.Fatalf("want 3 entries (visit, app, aggregate), got %d:\n%s", len(entries), raw)
	}
	want := []struct{ ev, app string }{{"visit", ""}, {"app", "subnet"}, {"aggregate", "aggregator"}}
	for i, w := range want {
		e := entries[i]
		if e.Event != w.ev || e.App != w.app || e.IP != "192.0.2.7" || e.Agent != ua {
			t.Errorf("entry %d = %+v", i, e)
		}
		if _, err := time.Parse(time.RFC3339, e.Time); err != nil {
			t.Errorf("bad time %q", e.Time)
		}
	}
	for _, secret := range []string{"SECRET-PASTE", "hunter2", "10.1.2.3"} {
		if strings.Contains(raw, secret) {
			t.Fatalf("pasted input leaked into the log: %q found in\n%s", secret, raw)
		}
	}
	files, _ := filepath.Glob(filepath.Join(dir, "visits-*.jsonl"))
	if len(files) != 1 {
		t.Fatalf("want one daily file, got %v", files)
	}
	if st, _ := os.Stat(files[0]); st.Mode().Perm() != 0o600 {
		t.Errorf("log file mode = %v, want 0600", st.Mode().Perm())
	}
}

func TestLoggingOffByDefault(t *testing.T) {
	l, err := newVisitLogger("", 90, nil)
	if err != nil || l != nil {
		t.Fatalf("empty dir must turn logging off, got %v %v", l, err)
	}
	l.Close() // nil-safe
	h, _ := newHandler(testCfg())
	do(h, "GET", "/", "", "192.0.2.7:1", "x", nil) // must not panic
}

func TestClientIP(t *testing.T) {
	plain, _ := newTestLogger(t, "")
	behind, _ := newTestLogger(t, "X-Forwarded-For")
	ip := func(l *visitLogger, remote string, hdr map[string]string) string {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = remote
		for k, v := range hdr {
			r.Header.Set(k, v)
		}
		return l.clientIP(r)
	}
	cases := []struct {
		name string
		got  string
		want string
	}{
		{"ipv4", ip(plain, "192.0.2.7:5", nil), "192.0.2.7"},
		{"ipv6", ip(plain, "[2001:db8::1]:5", nil), "2001:db8::1"},
		{"v4-mapped v6 is shown as v4", ip(plain, "[::ffff:192.0.2.9]:5", nil), "192.0.2.9"},
		{"header ignored unless configured (no spoofing)", ip(plain, "192.0.2.7:5", map[string]string{"X-Forwarded-For": "6.6.6.6"}), "192.0.2.7"},
		{"trusted header: last value (added by our proxy)", ip(behind, "127.0.0.1:5", map[string]string{"X-Forwarded-For": "6.6.6.6, 203.0.113.5"}), "203.0.113.5"},
		{"trusted header, single value", ip(behind, "127.0.0.1:5", map[string]string{"X-Forwarded-For": "203.0.113.9"}), "203.0.113.9"},
		{"garbage header falls back to the connection", ip(behind, "127.0.0.1:5", map[string]string{"X-Forwarded-For": "not-an-ip"}), "127.0.0.1"},
		{"header missing falls back", ip(behind, "127.0.0.1:5", nil), "127.0.0.1"},
		{"header from a stranger on the network is NOT believed", ip(behind, "10.0.0.1:5", map[string]string{"X-Forwarded-For": "203.0.113.9"}), "10.0.0.1"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s: got %q want %q", c.name, c.got, c.want)
		}
	}
}

func TestHostileUserAgentStaysOneValidLine(t *testing.T) {
	l, dir := newTestLogger(t, "")
	h, _ := newHandler(func() config { c := testCfg(); c.Visits = l; return c }())
	do(h, "GET", "/", "", "192.0.2.7:1", "evil\"}\n{\"ev\":\"forged\",\"ip\":\"1.1.1.1\"}", nil)
	do(h, "GET", "/", "", "192.0.2.7:1", strings.Repeat("A", 1000), nil)
	l.Close()
	raw, entries := readAll(t, dir)
	if len(entries) != 2 || strings.Count(raw, "\n") != 2 {
		t.Fatalf("each visit must be exactly one line; got %d entries:\n%s", len(entries), raw)
	}
	if entries[0].Event != "visit" || entries[1].Event != "visit" {
		t.Fatalf("forged event got through: %+v", entries)
	}
	if len(entries[1].Agent) != maxAgentLen {
		t.Errorf("long User-Agent not truncated: %d", len(entries[1].Agent))
	}
}

func TestRetentionDeletesOldFilesOnly(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	mk := func(name string) { os.WriteFile(filepath.Join(dir, name), []byte("{}\n"), 0o600) }
	mk("visits-2026-11-07.jsonl") // today
	mk("visits-2026-08-10.jsonl") // 89 days old: keep
	mk("visits-2026-08-09.jsonl") // 90 days old: keep (cutoff day itself)
	mk("visits-2026-08-08.jsonl") // 91 days old: delete
	mk("visits-2025-01-01.jsonl") // far too old: delete
	mk("notes.txt")               // not ours: never touched
	mk("visits-bad-name.jsonl")   // not ours: never touched
	l := &visitLogger{dir: dir, retention: 90, now: func() time.Time { return now }}
	l.cleanup()
	left := map[string]bool{}
	es, _ := os.ReadDir(dir)
	for _, e := range es {
		left[e.Name()] = true
	}
	for _, keep := range []string{"visits-2026-11-07.jsonl", "visits-2026-08-10.jsonl", "visits-2026-08-09.jsonl", "notes.txt", "visits-bad-name.jsonl"} {
		if !left[keep] {
			t.Errorf("%s was deleted but should be kept", keep)
		}
	}
	for _, gone := range []string{"visits-2026-08-08.jsonl", "visits-2025-01-01.jsonl"} {
		if left[gone] {
			t.Errorf("%s should have been deleted", gone)
		}
	}
}

func TestNewFileEachDay(t *testing.T) {
	dir := t.TempDir()
	var clock atomic.Int64
	clock.Store(time.Date(2026, 11, 7, 23, 59, 59, 0, time.UTC).Unix())
	l, _ := startVisitLogger(dir, 90, nil, func() time.Time { return time.Unix(clock.Load(), 0).UTC() })
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.7:1"
	l.record(r, "visit", "")
	time.Sleep(50 * time.Millisecond)
	clock.Add(2) // past midnight
	l.record(r, "visit", "")
	l.Close()
	for _, f := range []string{"visits-2026-11-07.jsonl", "visits-2026-11-08.jsonl"} {
		if b, err := os.ReadFile(filepath.Join(dir, f)); err != nil || strings.Count(string(b), "\n") != 1 {
			t.Errorf("%s: err=%v content=%q", f, err, b)
		}
	}
}

func TestFullQueueDropsInsteadOfBlocking(t *testing.T) {
	l := &visitLogger{ch: make(chan []byte, 1), now: time.Now}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.0.2.7:1"
	done := make(chan struct{})
	go func() {
		for i := 0; i < 10; i++ {
			l.record(r, "visit", "")
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("record blocked on a full queue")
	}
	if l.dropped.Load() != 9 {
		t.Errorf("dropped = %d, want 9", l.dropped.Load())
	}
}

func TestClassify(t *testing.T) {
	cases := []struct{ method, path, ev, app string }{
		{"GET", "/", "visit", ""}, {"GET", "/index.html", "visit", ""},
		{"GET", "/apps/aggregator/app.html", "app", "aggregator"}, {"GET", "/apps/ip-checker_2/app.html", "app", "ip-checker_2"},
		{"POST", "/api/aggregate", "aggregate", "aggregator"},
		{"GET", "/apps/../../etc/app.html", "", ""}, {"GET", "/apps/UP/app.html", "", ""}, {"GET", "/apps/x/app.js", "", ""},
		{"GET", "/api/aggregate", "", ""}, {"POST", "/", "", ""}, {"GET", "/xp.css", "", ""}, {"DELETE", "/", "", ""},
	}
	for _, c := range cases {
		r := httptest.NewRequest(c.method, c.path, nil)
		if ev, app := classify(r); ev != c.ev || app != c.app {
			t.Errorf("%s %s -> (%q,%q), want (%q,%q)", c.method, c.path, ev, app, c.ev, c.app)
		}
	}
}
