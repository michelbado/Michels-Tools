package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testCfg() config {
	return config{MaxBytes: 1 << 20, Jobs: 1, Queue: 1, QueueWait: 100 * time.Millisecond, UploadTime: time.Minute}
}

func post(h http.Handler, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/api/aggregate", strings.NewReader(body)))
	return w
}

func TestAPIAndHeaders(t *testing.T) {
	h, _ := newHandler(testCfg())
	w := post(h, "172.16.20.0/24 172.16.0.0/16 172.16.2.3")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"v4":["172.16.0.0/16"]`) {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Content-Security-Policy") == "" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("missing security headers")
	}
	if w.Header().Get("Cache-Control") != "no-store" { // API responses are never cached
		t.Fatalf("api cache-control = %q", w.Header().Get("Cache-Control"))
	}
}

func TestTooLarge(t *testing.T) {
	cfg := testCfg()
	cfg.MaxBytes = 100
	h, _ := newHandler(cfg)
	if w := post(h, strings.Repeat("1.2.3.4 ", 100)); w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("got %d", w.Code)
	}
}

func TestLimiter(t *testing.T) {
	l := newLimiter(1, 1, 100*time.Millisecond)
	r1 := l.acquire(nil)
	if r1 == nil {
		t.Fatal("first should get slot")
	}
	// one waiter allowed: times out -> nil
	start := time.Now()
	if l.acquire(nil) != nil {
		t.Fatal("should time out")
	}
	if time.Since(start) < 90*time.Millisecond {
		t.Fatal("did not wait")
	}
	// waiter that gets the slot when released
	got := make(chan func(), 1)
	go func() { got <- l.acquire(nil) }()
	time.Sleep(20 * time.Millisecond)
	// queue (size 1) is now full -> immediate rejection
	start = time.Now()
	if l.acquire(nil) != nil || time.Since(start) > 50*time.Millisecond {
		t.Fatal("full queue should reject immediately")
	}
	r1()
	if r := <-got; r == nil {
		t.Fatal("waiter should get released slot")
	} else {
		r()
	}
}

func TestBusyReturns503(t *testing.T) {
	cfg := testCfg()
	cfg.Queue = 0
	h, _ := newHandler(cfg)
	// hold the only slot with a request whose body never finishes
	pr, pw := ioPipe()
	done := make(chan struct{})
	go func() {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/aggregate", pr))
		close(done)
	}()
	time.Sleep(50 * time.Millisecond)
	if w := post(h, "1.1.1.1"); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("got %d", w.Code)
	}
	pw.Close()
	<-done
}

func ioPipe() (*io.PipeReader, *io.PipeWriter) { return io.Pipe() }

func TestNoDirectoryListings(t *testing.T) {
	h, _ := newHandler(testCfg())
	get := func(p string) int {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", p, nil))
		return w.Code
	}
	for _, p := range []string{"/apps/", "/apps", "/apps/aggregator/", "/apps/aggregator", "/lib/", "/lib", "//apps//", "/apps/../apps/"} {
		if c := get(p); c == 200 {
			t.Errorf("GET %s lists a folder (200)", p)
		}
	}
	for _, p := range []string{"/", "/shell.js", "/xp.css", "/lib/ipv4.js", "/apps/aggregator/app.html", "/apps/subnet/icon.svg"} {
		if c := get(p); c != 200 {
			t.Errorf("GET %s = %d, want 200", p, c)
		}
	}
	// the body of a folder request must not reveal file names
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/apps/", nil))
	if strings.Contains(w.Body.String(), "aggregator") {
		t.Errorf("folder request leaks names: %q", w.Body.String())
	}
}

// newPipe: a request body that stays open until the writer is closed.
func newPipe() (*io.PipeReader, *io.PipeWriter) { return io.Pipe() }
