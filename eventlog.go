package main

// What the program writes to its OWN log, besides the visit log. Under systemd this is the system journal (journalctl -u michels-tools), which is
// kept by systemd's own rules and not by -retention-days or log.max_mb. The lines exist so that, after a restart or a crash, there is a trail:
//
//	aggregate: ...   a request the IP Aggregator turned away, and why (sizes and counts, never an address and never any of the text)
//	memory: ...      the program is using more than 60% of the memory it may use (at most one line a minute), and when it is back to normal
//	unlock: ...      a wrong or accepted access code, with the visitor's address and browser type (never the code that was typed)
//
// Lines that an outsider can trigger at will go through a throttle, so a flood of refused requests cannot flood the journal.

import (
	"fmt"
	"log"
	"runtime/metrics"
	"strings"
	"sync"
	"time"
	"unicode"
)

// ---- throttle ----

type throttle struct {
	mu      sync.Mutex
	last    map[string]time.Time
	skipped map[string]int
	now     func() time.Time
}

func newThrottle() *throttle {
	return &throttle{last: map[string]time.Time{}, skipped: map[string]int{}, now: time.Now}
}

// allow says whether a line of this kind may be written now (the first one, then at most one per interval), and how many were held back since.
// The kinds are a fixed handful of words in the code, never text from a visitor, so the maps stay small.
func (t *throttle) allow(kind string, every time.Duration) (bool, int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.now()
	if last, ok := t.last[kind]; ok && now.Sub(last) < every {
		t.skipped[kind]++
		return false, 0
	}
	t.last[kind] = now
	n := t.skipped[kind]
	delete(t.skipped, kind)
	return true, n
}

// events is the program's throttle for the lines above.
var events = newThrottle()

// say writes one line of the given kind, at most once per interval; the line that follows a quiet spell says how many were held back.
func (t *throttle) say(kind string, every time.Duration, format string, args ...any) {
	ok, held := t.allow(kind, every)
	if !ok {
		return
	}
	line := fmt.Sprintf(format, args...)
	if held > 0 {
		line += fmt.Sprintf(" (and %d more of this kind in the last %s)", held, every)
	}
	log.Print(line)
}

// cleanForLog makes text from a visitor safe for one log line: no control characters, no line breaks, cut to n characters.
func cleanForLog(s string, n int) string {
	var b strings.Builder
	count := 0
	for _, r := range s {
		if count >= n {
			b.WriteString("...")
			break
		}
		if unicode.IsPrint(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte('?')
		}
		count++
	}
	return b.String()
}

// ---- memory ----

const (
	memHighPercent = 60 // say something when the program uses more than this much of the memory it may use ...
	memLowPercent  = 50 // ... and say it is back to normal below this
)

type memWatch struct {
	high    bool
	lastSay time.Time
}

// check decides what to write about the memory (an empty string = nothing). used and limit are in bytes, running is the number of aggregations at work.
func (m *memWatch) check(now time.Time, used, limit int64, running int) string {
	if limit <= 0 {
		return ""
	}
	pct := used * 100 / limit
	switch {
	case pct >= memHighPercent && (!m.high || now.Sub(m.lastSay) >= time.Minute):
		m.high, m.lastSay = true, now
		return fmt.Sprintf("memory: the program holds %d MB of the %d MB it may use (%d%%), %d aggregations running", used>>20, limit>>20, pct, running)
	case pct < memLowPercent && m.high:
		m.high = false
		return fmt.Sprintf("memory: back to %d MB of %d MB (%d%%), %d aggregations running", used>>20, limit>>20, pct, running)
	}
	return ""
}

// usedMemory is what the Go runtime holds from the system right now (memory it has already given back is not counted).
func usedMemory() int64 {
	s := []metrics.Sample{{Name: "/memory/classes/total:bytes"}, {Name: "/memory/classes/heap/released:bytes"}}
	metrics.Read(s)
	if s[0].Value.Kind() != metrics.KindUint64 || s[1].Value.Kind() != metrics.KindUint64 {
		return 0
	}
	return int64(s[0].Value.Uint64()) - int64(s[1].Value.Uint64())
}

// watchMemory looks every 10 seconds and writes a line when the memory is high, so that a restart caused by running out of memory (which leaves
// no stack trace, only systemd's "killed by the OOM killer") has a trail of what led up to it. It runs for ever.
func watchMemory(limit int64, running func() int) {
	var m memWatch
	for range time.Tick(10 * time.Second) {
		if line := m.check(time.Now(), usedMemory(), limit, running()); line != "" {
			log.Print(line)
		}
	}
}
