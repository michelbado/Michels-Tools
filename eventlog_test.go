package main

import (
	"bytes"
	"log"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func captureLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	log.SetOutput(&buf)
	events = newThrottle()
	t.Cleanup(func() { log.SetOutput(os.Stderr); events = newThrottle() })
	return &buf
}

func TestThrottleWritesTheFirstThenOnePerInterval(t *testing.T) {
	th := newThrottle()
	now := time.Now()
	th.now = func() time.Time { return now }
	if ok, held := th.allow("a", time.Minute); !ok || held != 0 {
		t.Fatalf("the first line is written: %v %d", ok, held)
	}
	for i := 0; i < 5; i++ {
		now = now.Add(5 * time.Second)
		if ok, _ := th.allow("a", time.Minute); ok {
			t.Fatal("inside the interval nothing is written")
		}
	}
	if ok, _ := th.allow("b", time.Minute); !ok {
		t.Error("another kind has its own turn")
	}
	now = now.Add(time.Minute)
	if ok, held := th.allow("a", time.Minute); !ok || held != 5 {
		t.Errorf("after the interval the next line says how many were held back: %v %d", ok, held)
	}
}

func TestSayMentionsHeldBackLines(t *testing.T) {
	buf := captureLog(t)
	now := time.Now()
	events.now = func() time.Time { return now }
	events.say("k", time.Minute, "thing happened")
	events.say("k", time.Minute, "thing happened")
	events.say("k", time.Minute, "thing happened")
	now = now.Add(2 * time.Minute)
	events.say("k", time.Minute, "thing happened")
	out := buf.String()
	if strings.Count(out, "thing happened") != 2 || !strings.Contains(out, "(and 2 more of this kind in the last 1m0s)") {
		t.Errorf("log: %q", out)
	}
}

func TestCleanForLog(t *testing.T) {
	if got := cleanForLog("Mozilla/5.0\nunlock: code accepted from 6.6.6.6\x00\r\t!", 200); strings.ContainsAny(got, "\n\r\x00\t") {
		t.Errorf("control characters must go: %q", got)
	}
	if got := cleanForLog(strings.Repeat("a", 500), 120); len(got) != 123 || !strings.HasSuffix(got, "...") {
		t.Errorf("long text is cut: %d %q", len(got), got[len(got)-5:])
	}
	if got := cleanForLog("Chrome 126 é", 50); got != "Chrome 126 é" {
		t.Errorf("ordinary text stays: %q", got)
	}
}

func TestMemoryWatchSpeaksOnlyWhenHighAndOncePerMinute(t *testing.T) {
	var m memWatch
	now := time.Now()
	const limit = 1000 << 20
	if s := m.check(now, 300<<20, limit, 1); s != "" {
		t.Errorf("30%% is quiet: %q", s)
	}
	if s := m.check(now, 650<<20, limit, 3); !strings.Contains(s, "650 MB of the 1000 MB") || !strings.Contains(s, "3 aggregations") {
		t.Errorf("65%% must speak: %q", s)
	}
	now = now.Add(20 * time.Second)
	if s := m.check(now, 700<<20, limit, 3); s != "" {
		t.Errorf("not again within a minute: %q", s)
	}
	now = now.Add(45 * time.Second)
	if s := m.check(now, 700<<20, limit, 3); s == "" {
		t.Error("still high after a minute: say so again")
	}
	if s := m.check(now, 550<<20, limit, 0); s != "" {
		t.Errorf("between the two marks it stays quiet (no flapping): %q", s)
	}
	if s := m.check(now, 200<<20, limit, 0); !strings.Contains(s, "back to") {
		t.Errorf("it says when it is back to normal: %q", s)
	}
	if s := m.check(now, 200<<20, limit, 0); s != "" {
		t.Errorf("and only once: %q", s)
	}
	if s := m.check(now, 900<<20, 0, 0); s != "" {
		t.Errorf("an unknown limit means no judging: %q", s)
	}
}

func TestUsedMemoryIsSomething(t *testing.T) {
	if n := usedMemory(); n < 1<<20 || n > 64<<30 {
		t.Errorf("usedMemory = %d", n)
	}
}

func TestAggregatorRefusalsAreLoggedWithoutAddressesOrText(t *testing.T) {
	buf := captureLog(t)
	withLimits(t, 4, 10, 10)
	var in strings.Builder
	for i := 0; i < 50; i++ {
		in.WriteString("10.0." + strconvI(i*2) + ".0/24 ")
	}
	h, _ := newHandler(testCfg())
	r := httptest.NewRequest("POST", "/api/aggregate", strings.NewReader(in.String()))
	r.RemoteAddr = "198.51.100.23:4000"
	h.ServeHTTP(httptest.NewRecorder(), r)
	out := buf.String()
	if !strings.Contains(out, "aggregate: refused, too many separate ranges after merging") {
		t.Errorf("the refusal must be in the log: %q", out)
	}
	if strings.Contains(out, "198.51.100.23") || strings.Contains(out, "10.0.") {
		t.Errorf("neither the visitor's address nor any of the text may be logged here: %q", out)
	}
}
