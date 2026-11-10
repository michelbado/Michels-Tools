package main

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func holdServer(t *testing.T, conf string) *httptest.Server {
	t.Helper()
	cfg := testCfg()
	if conf != "" {
		cfg.Tools = mustParse(t, conf)
	}
	h, err := newHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	return s
}

func TestHoldInfoAndBadInput(t *testing.T) {
	s := holdServer(t, "idletest.max_seconds = 120\n")
	get := func(path string) (int, string) {
		resp, err := http.Get(s.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		b := new(strings.Builder)
		bufio.NewReader(resp.Body).WriteTo(b)
		return resp.StatusCode, b.String()
	}
	if c, b := get("/api/hold"); c != 200 || !strings.Contains(b, `"max":120`) || !strings.Contains(b, `"beat":15`) {
		t.Errorf("info: %d %s", c, b)
	}
	for _, p := range []string{"?secs=0", "?secs=121", "?secs=abc", "?secs=-5", "?secs=5&beat=1", "?secs=5&beat=61", "?secs=5&beat=x"} {
		if c, _ := get("/api/hold" + p); c != 400 {
			t.Errorf("%s should be refused, got %d", p, c)
		}
	}
}

func TestHoldQuietWaitsThenAnswers(t *testing.T) {
	s := holdServer(t, "")
	start := time.Now()
	resp, err := http.Get(s.URL + "/api/hold?secs=1")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	el := time.Since(start)
	if resp.StatusCode != 200 || el < 950*time.Millisecond || el > 2500*time.Millisecond || resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("quiet hold: %d after %v %v", resp.StatusCode, el, resp.Header)
	}
}

func TestHoldHeartbeatSendsHeadersAtOnce(t *testing.T) {
	s := holdServer(t, "")
	start := time.Now()
	resp, err := http.Get(s.URL + "/api/hold?secs=6&beat=5")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if time.Since(start) > time.Second {
		t.Errorf("the headers of a heartbeat hold must arrive at once, took %v", time.Since(start))
	}
	rd := bufio.NewReader(resp.Body)
	first, _ := rd.ReadString('\n')
	if first != "hold\n" {
		t.Errorf("first line %q", first)
	}
	rest := new(strings.Builder)
	rd.WriteTo(rest)
	if !strings.HasPrefix(rest.String(), ".") || !strings.HasSuffix(rest.String(), "held 6\n") {
		t.Errorf("rest %q", rest.String())
	}
	if el := time.Since(start); el < 5900*time.Millisecond {
		t.Errorf("ended too early: %v", el)
	}
}

func TestHoldLimitsAndRelease(t *testing.T) {
	g := newHoldGate()
	for i := 0; i < holdMaxPerIP; i++ {
		if !g.acquire("a") {
			t.Fatalf("slot %d refused", i)
		}
	}
	if g.acquire("a") {
		t.Error("a fifth hold for one visitor must be refused")
	}
	if !g.acquire("b") {
		t.Error("another visitor still has room")
	}
	g.release("a")
	if !g.acquire("a") {
		t.Error("a released slot can be used again")
	}
	g2 := newHoldGate()
	for i := 0; i < holdMaxTotal; i++ {
		if !g2.acquire("ip" + string(rune('A'+i%26)) + string(rune('a'+i/26))) {
			t.Fatalf("global slot %d refused", i)
		}
	}
	if g2.acquire("zz") {
		t.Error("the global limit must hold")
	}
	if tot, ips := g2.counts(); tot != holdMaxTotal || ips != holdMaxTotal {
		t.Errorf("counts %d %d", tot, ips)
	}
}

func TestHoldClientLeavingFreesTheSlot(t *testing.T) {
	s := holdServer(t, "")
	client := &http.Client{Timeout: 400 * time.Millisecond}
	for i := 0; i < holdMaxPerIP+2; i++ { // more attempts than slots: each gives up, so none may stay occupied
		client.Get(s.URL + "/api/hold?secs=30")
	}
	time.Sleep(300 * time.Millisecond)
	resp, err := http.Get(s.URL + "/api/hold?secs=1")
	if err != nil || resp.StatusCode != 200 {
		t.Errorf("slots were not freed: %v %v", err, resp)
	}
	if resp != nil {
		resp.Body.Close()
	}
}

func TestHoldOffIs404(t *testing.T) {
	s := holdServer(t, "idletest = false\n")
	resp, err := http.Get(s.URL + "/api/hold")
	if err != nil || resp.StatusCode != 404 {
		t.Errorf("a switched-off tool must answer 404: %v %v", err, resp)
	}
	s2 := holdServer(t, "trouble = false\n")
	resp2, _ := http.Get(s2.URL + "/api/hold?secs=1")
	if resp2.StatusCode != 404 {
		t.Errorf("folder off: %d", resp2.StatusCode)
	}
}

func TestHoldRecognisesABrowserRetry(t *testing.T) {
	s := holdServer(t, "")
	first := make(chan struct{})
	go func() {
		c := &http.Client{Timeout: 700 * time.Millisecond}
		c.Get(s.URL + "/api/hold?secs=20&id=abcdef123456")
		close(first)
	}()
	time.Sleep(400 * time.Millisecond)
	resp, err := http.Get(s.URL + "/api/hold?secs=20&id=abcdef123456")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b := new(strings.Builder)
	bufio.NewReader(resp.Body).WriteTo(b)
	if resp.StatusCode != 409 || !strings.Contains(b.String(), `"retry":true`) || !strings.Contains(b.String(), `"age":`) {
		t.Errorf("a repeated id must be answered at once with 409: %d %s", resp.StatusCode, b.String())
	}
	<-first
	if c, _ := http.Get(s.URL + "/api/hold?secs=1&id=short"); c.StatusCode != 400 {
		t.Errorf("bad id: %d", c.StatusCode)
	}
}
