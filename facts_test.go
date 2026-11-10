package main

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestFactsShowsOnlyAllowListedHeaders(t *testing.T) {
	h := diagHandler(t)
	req := httptest.NewRequest("GET", "/api/facts", nil)
	req.RemoteAddr = "203.0.113.5:4444"
	req.Header.Set("Cookie", "secret=1")
	req.Header.Set("Authorization", "Bearer abc")
	req.Header.Set("Via", "1.1 varnish")
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 10.1.2.3, 127.0.0.1, fe80::1, 2001:db8::5")
	req.Header.Set("CF-IPCountry", "LB") // must NOT be shown: the country is deliberately not reported
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	b := w.Body.String()
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("facts: %d %v", w.Code, w.Header())
	}
	for _, bad := range []string{"secret", "Bearer", "Cookie", "Authorization", "10.1.2.3", "127.0.0.1", "fe80", "LB", "CF-IPCountry"} {
		if strings.Contains(b, bad) {
			t.Errorf("facts must not show %q: %s", bad, b)
		}
	}
	for _, good := range []string{`"ip":"203.0.113.5"`, `"family":"IPv4"`, "198.51.100.7", "2001:db8::5", "[internal address]", "varnish"} {
		if !strings.Contains(b, good) {
			t.Errorf("facts should show %q: %s", good, b)
		}
	}
}

func TestFactsClockAndFamily(t *testing.T) {
	h := diagHandler(t)
	before := time.Now().UnixMicro()
	w := serveFrom(h, "2001:db8::1", "GET", "/api/facts")
	if !strings.Contains(w.Body.String(), `"family":"IPv6"`) {
		t.Errorf("an IPv6 visitor is reported as IPv6: %s", w.Body.String())
	}
	i := strings.Index(w.Body.String(), `"t":`)
	if i < 0 || before == 0 {
		t.Fatalf("no clock reading: %s", w.Body.String())
	}
}

func TestFactValuesAreCleaned(t *testing.T) {
	long := strings.Repeat("a", 500)
	if got := cleanFactValue(long); len(got) > maxFactValue {
		t.Errorf("values are cut short: %d", len(got))
	}
	if got := cleanFactValue("ok\x00\x1b[31m<script>é"); strings.ContainsAny(got, "\x00\x1b") || strings.Contains(got, "é") {
		t.Errorf("control and non-ASCII characters are replaced: %q", got)
	}
	if got := hideInternal("for=192.168.1.9;by=8.8.8.8"); got != "for=[internal address];by=8.8.8.8" {
		t.Errorf("only inside addresses are hidden: %q", got)
	}
}

func TestEdgeProbeIsFreshAndCacheable(t *testing.T) {
	h := diagHandler(t)
	a := serve(h, "GET", "/edge-probe.txt")
	time.Sleep(3 * time.Millisecond)
	b := serve(h, "GET", "/edge-probe.txt")
	if a.Code != 200 || !strings.HasPrefix(a.Body.String(), "edge-probe ") || a.Header().Get("Cache-Control") != "public, max-age=300" {
		t.Fatalf("edge probe: %d %q %v", a.Code, a.Body.String(), a.Header())
	}
	if a.Body.String() == b.Body.String() {
		t.Errorf("each answer from the server itself must be new, so that a repeated one proves a cache: %q", a.Body.String())
	}
}

func TestFactsAndEdgeSwitches(t *testing.T) {
	if c := serve(handlerWith(t, "connfacts = false\n"), "GET", "/api/facts").Code; c != 404 {
		t.Errorf("connfacts off: facts answers 404, got %d", c)
	}
	// Connection Quality still needs the edge probe when only Connection Facts is off
	if c := serve(handlerWith(t, "connfacts = false\n"), "GET", "/edge-probe.txt").Code; c != 200 {
		t.Errorf("edge probe stays while Connection Quality is on, got %d", c)
	}
	if c := serve(handlerWith(t, "netquality = false\n"), "GET", "/edge-probe.txt").Code; c != 200 {
		t.Errorf("edge probe stays while Connection Facts is on, got %d", c)
	}
	both := handlerWith(t, "netquality = false\nconnfacts = false\n")
	for _, p := range []string{"/edge-probe.txt", "/api/facts", "/cdn-cgi/trace"} {
		if c := serve(both, "GET", p).Code; c != 404 {
			t.Errorf("both tools off: %s answers 404, got %d", p, c)
		}
	}
	if c := serve(handlerWith(t, "trouble = false\n"), "GET", "/api/facts").Code; c != 404 {
		t.Errorf("the folder off hides the tool, got %d", c)
	}
}
