package main

import (
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeClock struct{ t atomic.Int64 } // unix nanoseconds

func (c *fakeClock) now() time.Time          { return time.Unix(0, c.t.Load()).UTC() }
func (c *fakeClock) advance(d time.Duration) { c.t.Add(int64(d)) }

func limitsWith(cfg rateConfig) (*ipLimits, *fakeClock) {
	c := &fakeClock{}
	c.t.Store(time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC).UnixNano())
	l := newIPLimits(cfg)
	l.now = c.now
	return l, c
}

func TestBurstThenRefill(t *testing.T) {
	l, clk := limitsWith(rateConfig{APIPerMin: 30}) // burst 10, one new token every 2 s
	allowed := func() bool {
		ok, _, _, rel := l.admitKey("a", true)
		if rel != nil {
			rel()
		}
		return ok
	}
	for i := 0; i < 10; i++ {
		if !allowed() {
			t.Fatalf("request %d of the burst was refused", i+1)
		}
	}
	ok, wait, msg, _ := l.admitKey("a", true)
	if ok || msg != msgTooFast || wait < 1900*time.Millisecond || wait > 2100*time.Millisecond {
		t.Fatalf("11th request: ok=%v wait=%v msg=%q (want refused, ~2s)", ok, wait, msg)
	}
	clk.advance(2 * time.Second)
	if !allowed() {
		t.Fatal("a token should have come back after 2 s")
	}
	if allowed() {
		t.Fatal("only one token came back")
	}
	clk.advance(time.Hour) // refill is capped at the burst size
	n := 0
	for allowed() {
		n++
		if n > 50 {
			break
		}
	}
	if n != 10 {
		t.Fatalf("after a long pause the burst is %d, want 10", n)
	}
}

func TestVisitorsAreIndependent(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30})
	for i := 0; i < 10; i++ {
		l.admitKey("198.51.100.1", true)
	}
	if ok, _, _, _ := l.admitKey("198.51.100.1", true); ok {
		t.Fatal("first visitor should be limited")
	}
	if ok, _, _, rel := l.admitKey("198.51.100.2", true); !ok {
		t.Fatal("second visitor must not be affected")
	} else if rel != nil {
		rel()
	}
}

func TestLimitKeyGroupsIPv6ByNetwork(t *testing.T) {
	same := [][2]string{
		{"2001:db8:1:2::1", "2001:db8:1:2:ffff:eeee:dddd:9"},
		{"::ffff:192.0.2.9", "192.0.2.9"},
	}
	for _, p := range same {
		if limitKey(p[0]) != limitKey(p[1]) {
			t.Errorf("%s and %s should share a key: %q vs %q", p[0], p[1], limitKey(p[0]), limitKey(p[1]))
		}
	}
	if limitKey("2001:db8:1:2::1") == limitKey("2001:db8:1:3::1") {
		t.Error("different /64 networks must not share a key")
	}
	if limitKey("192.0.2.1") == limitKey("192.0.2.2") {
		t.Error("different IPv4 addresses must not share a key")
	}
	if limitKey("not-an-ip") != "not-an-ip" {
		t.Error("unparseable input is used as is")
	}
}

func TestConcurrentJobsPerVisitor(t *testing.T) {
	l, _ := limitsWith(rateConfig{IPJobs: 2})
	_, _, _, r1 := l.admitKey("a", true)
	_, _, _, r2 := l.admitKey("a", true)
	ok, _, msg, _ := l.admitKey("a", true)
	if ok || msg != msgTooMany {
		t.Fatalf("third concurrent job: ok=%v msg=%q", ok, msg)
	}
	if ok, _, _, rel := l.admitKey("b", true); !ok {
		t.Fatal("another visitor must still get a slot")
	} else {
		rel()
	}
	r1()
	if ok, _, _, rel := l.admitKey("a", true); !ok {
		t.Fatal("a freed slot must be usable again")
	} else {
		rel()
	}
	r2()
	if l.m["a"].inflight != 0 {
		t.Fatalf("inflight leaked: %d", l.m["a"].inflight)
	}
}

func TestPagesAndAggregationsAreCountedSeparately(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30, PagePerMin: 600})
	for i := 0; i < 11; i++ {
		_, _, _, rel := l.admitKey("a", true)
		if rel != nil {
			rel()
		}
	}
	if ok, _, _, _ := l.admitKey("a", true); ok {
		t.Fatal("aggregation budget should be used up")
	}
	for i := 0; i < 50; i++ {
		if ok, _, _, _ := l.admitKey("a", false); !ok {
			t.Fatalf("page request %d refused although only aggregations were used up", i+1)
		}
	}
}

func TestIdleVisitorsAreForgotten(t *testing.T) {
	l, clk := limitsWith(rateConfig{PagePerMin: 600})
	for _, k := range []string{"a", "b", "c"} {
		l.admitKey(k, false)
	}
	l.admitKey("busy", true) // no IPJobs set, so no slot is held
	clk.advance(11 * time.Minute)
	l.admitKey("d", false) // triggers the sweep
	if len(l.m) != 1 {
		t.Fatalf("tracked visitors after the sweep = %d, want 1 (just the new one)", len(l.m))
	}
}

func TestVisitorWithRunningJobIsNotForgotten(t *testing.T) {
	l, clk := limitsWith(rateConfig{IPJobs: 1})
	_, _, _, rel := l.admitKey("slow", true)
	clk.advance(30 * time.Minute)
	l.admitKey("other", false)
	if _, ok := l.m["slow"]; !ok {
		t.Fatal("a visitor with an aggregation still running must keep its slot count")
	}
	rel()
	if l.m["slow"].inflight != 0 {
		t.Fatal("release must still work")
	}
}

func TestLimitsOffWhenAllZero(t *testing.T) {
	if newIPLimits(rateConfig{}) != nil {
		t.Fatal("all zero must mean no limiter")
	}
	l, _ := limitsWith(rateConfig{IPJobs: 1}) // only the job limit
	for i := 0; i < 100; i++ {
		_, _, _, rel := l.admitKey("a", false)
		if rel != nil {
			rel()
		}
	}
	for i := 0; i < 100; i++ {
		ok, _, _, rel := l.admitKey("a", true)
		if !ok {
			t.Fatal("no rate limit configured, so sequential aggregations must pass")
		}
		rel()
	}
}

func TestSafeUnderConcurrency(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 6000, PagePerMin: 60000, IPJobs: 4})
	var wg sync.WaitGroup
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			key := []string{"a", "b", "c", "d"}[g%4]
			for i := 0; i < 500; i++ {
				ok, _, _, rel := l.admitKey(key, i%3 == 0)
				if ok && rel != nil {
					rel()
				}
			}
		}(g)
	}
	wg.Wait()
	for k, s := range l.m {
		if s.inflight != 0 {
			t.Errorf("%s leaked %d running jobs", k, s.inflight)
		}
	}
}

// --- through the real handler --------------------------------------------------

func limitedHandler(t *testing.T, cfg rateConfig, header string) (http.Handler, *visitLogger, string) {
	t.Helper()
	c := testCfg()
	c.Jobs, c.Queue = 8, 8
	rv, err := newIPResolver(header, "")
	if err != nil {
		t.Fatal(err)
	}
	l, dir := newTestLogger(t, header)
	c.IPs, c.Visits, c.Limits = rv, l, newIPLimits(cfg)
	h, _ := newHandler(c)
	return h, l, dir
}

func postAs(h http.Handler, visitor, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", apiPath, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:40000"
	r.Header.Set("CF-Connecting-IP", visitor)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestThroughTheHandler(t *testing.T) {
	h, l, dir := limitedHandler(t, rateConfig{APIPerMin: 30, PagePerMin: 600, IPJobs: 2}, "CF-Connecting-IP")
	codes := map[int]int{}
	var refused *httptest.ResponseRecorder
	for i := 0; i < 15; i++ {
		w := postAs(h, "198.51.100.7", "10.0.0.1")
		codes[w.Code]++
		if w.Code == 429 {
			refused = w
		}
	}
	if codes[200] < 10 || codes[429] < 3 || codes[200]+codes[429] != 15 {
		t.Fatalf("15 quick aggregations from one visitor: %v (want the burst of ~10 to pass, the rest refused)", codes)
	}
	if refused.Header().Get("Retry-After") == "" || !strings.Contains(refused.Body.String(), "Too many requests") {
		t.Errorf("refusal must say how long to wait and why: %v %q", refused.Header(), refused.Body.String())
	}
	if refused.Header().Get("Content-Security-Policy") == "" || refused.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("refusals still carry the security headers: %v", refused.Header())
	}
	// everyone else is unaffected, although every request comes through the same tunnel (127.0.0.1)
	if w := postAs(h, "198.51.100.8", "10.0.0.1"); w.Code != 200 {
		t.Errorf("a different visitor behind the same tunnel got %d", w.Code)
	}
	// the refused visitor can still load pages
	r := httptest.NewRequest("GET", "/xp.css", nil)
	r.RemoteAddr = "127.0.0.1:40000"
	r.Header.Set("CF-Connecting-IP", "198.51.100.7")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Errorf("pages must stay reachable while aggregations are limited: %d", w.Code)
	}
	l.Close()
	// refused requests never reach the visit log
	raw, entries := readAll(t, dir)
	agg := 0
	for _, e := range entries {
		if e.Event == "aggregate" {
			agg++
		}
	}
	if agg != codes[200]+1 {
		t.Errorf("visit log has %d aggregate entries, want %d (only the allowed ones)\n%s", agg, codes[200]+1, raw)
	}
}

func TestFakedHeaderDoesNotBuyAFreshBudget(t *testing.T) {
	// a client on the network (not the tunnel) rotates the header: still one visitor
	h, _, _ := limitedHandler(t, rateConfig{APIPerMin: 30}, "CF-Connecting-IP")
	refused := 0
	for i := 0; i < 20; i++ {
		r := httptest.NewRequest("POST", apiPath, strings.NewReader("10.0.0.1"))
		r.RemoteAddr = "192.168.1.50:5000"
		r.Header.Set("CF-Connecting-IP", "203.0.113."+string(rune('1'+i%9)))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code == 429 {
			refused++
		}
	}
	if refused < 8 {
		t.Fatalf("rotating a forged header must not reset the limit; refused only %d of 20", refused)
	}
}

func TestConcurrentUploadsFromOneVisitor(t *testing.T) {
	h, _, _ := limitedHandler(t, rateConfig{IPJobs: 2}, "CF-Connecting-IP")
	hold := make(chan struct{})
	var started sync.WaitGroup
	var wg sync.WaitGroup
	slow := func() {
		defer wg.Done()
		pr, pw := newPipe()
		go func() { <-hold; pw.Close() }()
		r := httptest.NewRequest("POST", apiPath, pr)
		r.RemoteAddr = "127.0.0.1:40000"
		r.Header.Set("CF-Connecting-IP", "198.51.100.7")
		started.Done()
		h.ServeHTTP(httptest.NewRecorder(), r)
	}
	started.Add(2)
	wg.Add(2)
	go slow()
	go slow()
	started.Wait()
	time.Sleep(100 * time.Millisecond) // both are now inside the handler, waiting for their upload
	if w := postAs(h, "198.51.100.7", "10.0.0.1"); w.Code != 429 || !strings.Contains(w.Body.String(), "maximum number of aggregations") {
		t.Fatalf("third simultaneous aggregation: %d %q", w.Code, w.Body.String())
	}
	if w := postAs(h, "198.51.100.9", "10.0.0.1"); w.Code != 200 {
		t.Fatalf("another visitor was blocked: %d", w.Code)
	}
	close(hold)
	wg.Wait()
	if w := postAs(h, "198.51.100.7", "10.0.0.1"); w.Code != 200 {
		t.Fatalf("after the uploads finished the visitor should be free again: %d", w.Code)
	}
}

func TestPageRequestsAreLimitedToo(t *testing.T) {
	h, _, _ := limitedHandler(t, rateConfig{PagePerMin: 60}, "CF-Connecting-IP") // burst 20
	ok, refused := 0, 0
	for i := 0; i < 40; i++ {
		r := httptest.NewRequest("GET", "/xp.css", nil)
		r.RemoteAddr = "127.0.0.1:1"
		r.Header.Set("CF-Connecting-IP", "198.51.100.7")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code == 200 {
			ok++
		} else if w.Code == 429 {
			refused++
		}
	}
	if ok < 20 || refused < 15 {
		t.Fatalf("40 quick page requests: %d ok, %d refused", ok, refused)
	}
}

// --- table full / IPv6 networks / bookkeeping -----------------------------------

func TestFullTableForgetsIdleVisitorsFirst(t *testing.T) {
	l, clk := limitsWith(rateConfig{APIPerMin: 30})
	l.capacity = 3
	for _, k := range []string{"a", "b", "c"} {
		l.admitKey(k, true)
	}
	clk.advance(11 * time.Minute) // all three are idle now
	ok, _, _, rel := l.admitKey("newcomer", true)
	if !ok {
		t.Fatal("newcomer refused")
	}
	if rel != nil {
		rel()
	}
	if _, tracked := l.m["newcomer"]; !tracked || len(l.m) > 3 {
		t.Fatalf("idle visitors should have been forgotten to make room: tracked=%v size=%d", tracked, len(l.m))
	}
}

func TestRequestsWithoutAnApplicableLimitLeaveNoTrace(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30}) // pages are not limited
	for i := 0; i < 1000; i++ {
		if ok, _, _, _ := l.admitKey("p"+strconvI(i), false); !ok {
			t.Fatal("page request refused with no page limit configured")
		}
	}
	if len(l.m) != 0 {
		t.Fatalf("%d visitors remembered for requests that no limit applies to", len(l.m))
	}
	l2, _ := limitsWith(rateConfig{PagePerMin: 600}) // aggregation is not limited
	for i := 0; i < 1000; i++ {
		if ok, _, _, rel := l2.admitKey("a"+strconvI(i), true); !ok {
			t.Fatal("aggregation refused with no aggregation limit configured")
		} else if rel != nil {
			rel()
		}
	}
	if len(l2.m) != 0 {
		t.Fatalf("%d visitors remembered", len(l2.m))
	}
}

func TestIPv6NetworkBudget(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30, NetScale: 10}) // /64 burst 10, whole /48 burst 100
	pass, fail := 0, 0
	for net := 0; net < 12; net++ { // 12 different /64s inside one /48, 10 requests each
		ip := "2001:db8:abcd:" + strconvHex(net) + "::1"
		for i := 0; i < 10; i++ {
			ok, _, _, rel := l.admit(limitKeys(ip), true)
			if ok {
				pass++
				if rel != nil {
					rel()
				}
			} else {
				fail++
			}
		}
	}
	if pass != 100 || fail != 20 {
		t.Fatalf("one /48 spread over 12 /64s: %d passed, %d refused (want 100 / 20): minting new /64s must not mint new budget", pass, fail)
	}
	// a different /48 is a different visitor
	if ok, _, _, rel := l.admit(limitKeys("2001:db8:ffff::1"), true); !ok {
		t.Fatal("another /48 must be unaffected")
	} else if rel != nil {
		rel()
	}
	// IPv4 is not grouped
	if k := limitKeys("192.0.2.1"); len(k) != 1 || k[0].key != "192.0.2.1" || k[0].net {
		t.Fatalf("ipv4 keys: %+v", k)
	}
}

func TestIPv6ConcurrentJobsAreBoundedPerNetwork(t *testing.T) {
	l, _ := limitsWith(rateConfig{IPJobs: 2, NetScale: 10}) // per /64: 2; per /48: 20
	granted := 0
	for net := 0; net < 30; net++ {
		ok, _, _, _ := l.admit(limitKeys("2001:db8:abcd:"+strconvHex(net)+"::1"), true)
		if ok {
			granted++
		}
	}
	if granted != 20 {
		t.Fatalf("simultaneous jobs from one /48: %d, want 20", granted)
	}
}

func strconvI(i int) string   { return strconv.Itoa(i) }
func strconvHex(i int) string { return strconv.FormatInt(int64(i), 16) }

// --- v2: refused requests leave no trace, overflow is per network, /48 is generous ---

// sameNet returns n distinct addresses inside 198.51.0.0/16 (they hash to one overflow shard).
func sameNet(n int) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = "198.51." + strconvI(i/250) + "." + strconvI(i%250+1)
	}
	return out
}

func TestFullTableOverflowBudgetIsPerNetwork(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30})
	l.capacity = 3
	for _, k := range []string{"a", "b", "c"} {
		l.admitKey(k, true) // busy, not idle: cannot be forgotten
	}
	// 1000 different visitors from ONE network, none of which fit in the table
	allowed, refused := 0, 0
	for _, ip := range sameNet(1000) {
		if ok, _, _, _ := l.admitKey(ip, true); ok {
			allowed++
		} else {
			refused++
		}
	}
	// that network's shard: 20 x one visitor's burst of 10
	if allowed != 200 || refused != 800 {
		t.Fatalf("one network in overflow: %d allowed, %d refused (want 200 / 800)", allowed, refused)
	}
	// a visitor from a network that hashes to another shard is untouched by that flood
	other := ""
	for i := 0; i < 200 && other == ""; i++ {
		if ip := "10." + strconvI(i) + ".0.1"; shardOf(ip) != shardOf("198.51.0.1") {
			other = ip
		}
	}
	for i := 0; i < 10; i++ {
		if ok, _, _, _ := l.admitKey(other, true); !ok {
			t.Fatalf("a visitor from a different network was refused (%s) because of someone else's flood", other)
		}
	}
	if len(l.m) != 3 {
		t.Fatalf("table grew past its capacity: %d", len(l.m))
	}
}

func TestOverflowShardsAlsoBoundConcurrentJobs(t *testing.T) {
	l, _ := limitsWith(rateConfig{IPJobs: 2})
	l.capacity = 1
	l.admitKey("tracked", true)
	var rels []func()
	granted := 0
	for _, ip := range sameNet(100) {
		if ok, _, _, rel := l.admitKey(ip, true); ok {
			granted++
			rels = append(rels, rel)
		}
	}
	if granted != 40 { // 20 x 2, for this one network
		t.Fatalf("one network in overflow got %d simultaneous slots, want 40", granted)
	}
	for _, r := range rels {
		r()
	}
	for i, sh := range l.overflow {
		if sh.inflight != 0 {
			t.Fatalf("overflow shard %d leaked %d slots", i, sh.inflight)
		}
	}
}

func TestShardOfGroupsByNetwork(t *testing.T) {
	if shardOf("198.51.1.1") != shardOf("198.51.200.9") {
		t.Error("IPv4 addresses in one /16 should share a shard")
	}
	if shardOf("2001:db8:1:1::/64") != shardOf("2001:db8:ffff:2::/64") || shardOf("2001:db8:abcd::/48") != shardOf("2001:db8:1:1::/64") {
		t.Error("IPv6 /64s and /48s inside one /32 should share a shard")
	}
	seen := map[int]bool{}
	for i := 0; i < 400; i++ {
		seen[shardOf("10."+strconvI(i%250)+"."+strconvI(i/250)+".1")] = true
		seen[shardOf("2001:"+strconvHex(i)+"::/64")] = true
	}
	if len(seen) < overflowShards/2 {
		t.Errorf("only %d of %d shards are ever used: the spread is poor", len(seen), overflowShards)
	}
	for i := 0; i < 1000; i++ {
		if s := shardOf("x" + strconvI(i)); s < 0 || s >= overflowShards {
			t.Fatalf("shard %d out of range", s)
		}
	}
}

func TestRefusedRequestsDoNotFillTheTable(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30, NetScale: 10})
	for n := 0; n < 10; n++ { // use up the /48's budget (100 tokens) through ten /64s
		for i := 0; i < 10; i++ {
			l.admit(limitKeys("2001:db8:abcd:"+strconvHex(n)+"::1"), true)
		}
	}
	before := len(l.m)
	refused := 0
	for n := 100; n < 5100; n++ { // 5000 fresh /64s inside the exhausted /48
		if ok, _, _, _ := l.admit(limitKeys("2001:db8:abcd:"+strconvHex(n)+"::1"), true); !ok {
			refused++
		}
	}
	if refused != 5000 {
		t.Fatalf("refused %d of 5000, want all", refused)
	}
	if len(l.m) != before {
		t.Fatalf("refused requests added %d entries to the table: flooding a limited network must not fill it", len(l.m)-before)
	}
}

func TestRefusalDoesNotUseUpOtherBudgets(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30, NetScale: 10})
	for n := 0; n < 10; n++ {
		for i := 0; i < 10; i++ {
			l.admit(limitKeys("2001:db8:abcd:"+strconvHex(n)+"::1"), true)
		}
	}
	fresh := limitKeys("2001:db8:abcd:ff::1")
	if ok, _, _, _ := l.admit(fresh, true); ok {
		t.Fatal("the /48 is used up, a fresh /64 inside it must be refused")
	}
	if _, known := l.m[fresh[0].key]; known {
		t.Fatal("a refused visitor must not be remembered")
	}
}

func TestRefusalLeavesAKnownVisitorsOwnBudgetAlone(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30, NetScale: 10})
	mine := limitKeys("2001:db8:abcd:1::1")
	l.admit(mine, true) // known now, 9 tokens left
	for n := 2; n < 12; n++ {
		for i := 0; i < 10; i++ {
			l.admit(limitKeys("2001:db8:abcd:"+strconvHex(n)+"::1"), true) // others use up the /48
		}
	}
	if ok, _, _, _ := l.admit(mine, true); ok {
		t.Fatal("the /48 is used up")
	}
	if tok := l.m[mine[0].key].api.tokens; tok < 8.9 || tok > 9.1 {
		t.Fatalf("a refusal because of the /48 changed this visitor's own tokens: %v (want 9)", tok)
	}
}

func TestNetworkBudgetDefaultsToFifty(t *testing.T) {
	l, _ := limitsWith(rateConfig{APIPerMin: 30})
	if l.netScale != 50 {
		t.Fatalf("default network budget = %v, want 50", l.netScale)
	}
	// with 50x, ten busy neighbours in one /48 do not get in each other's way
	for n := 0; n < 10; n++ {
		for i := 0; i < 10; i++ {
			if ok, _, _, _ := l.admit(limitKeys("2001:db8:abcd:"+strconvHex(n)+"::1"), true); !ok {
				t.Fatalf("neighbour %d was refused at request %d although each used only their own burst", n, i+1)
			}
		}
	}
	// ...but one /48 still cannot exceed 50 x 10 = 500 in a burst
	pass := 100
	for n := 10; n < 200 && pass < 600; n++ {
		for i := 0; i < 10; i++ {
			if ok, _, _, _ := l.admit(limitKeys("2001:db8:abcd:"+strconvHex(n)+"::1"), true); ok {
				pass++
			}
		}
	}
	if pass != 500 {
		t.Fatalf("one /48 got %d requests through in a burst, want 500 (50 x 10)", pass)
	}
}

// ---- the server-wide cap on speed-test transfers (rateConfig.HeavyTotal) ----

func TestHeavyTransfersHaveAServerWideCap(t *testing.T) {
	l, _ := limitsWith(rateConfig{HeavyPerMin: 600, HeavyTotal: 2})
	okA, _, _, relA := l.admitClass(limitKeys("192.0.2.1"), clsHeavy)
	okB, _, _, relB := l.admitClass(limitKeys("192.0.2.2"), clsHeavy)
	if !okA || !okB {
		t.Fatal("two different visitors fit in a cap of two")
	}
	known := len(l.m)
	ok, retry, msg, _ := l.admitClass(limitKeys("192.0.2.3"), clsHeavy)
	if ok || msg != msgHeavyBusy || retry <= 0 {
		t.Fatalf("a third transfer must be refused with a wait time: ok=%v retry=%v msg=%q", ok, retry, msg)
	}
	if len(l.m) != known {
		t.Error("a visitor refused by the server-wide cap must not be remembered")
	}
	relA()
	okC, _, _, relC := l.admitClass(limitKeys("192.0.2.3"), clsHeavy)
	if !okC {
		t.Fatal("a place freed by a finished transfer must be usable at once")
	}
	relB()
	relC()
	if n := l.heavyNow.Load(); n != 0 {
		t.Fatalf("every place must be given back, %d still counted", n)
	}
}

func TestHeavyCapIsNotUsedUpByRefusalsOrOtherClasses(t *testing.T) {
	l, _ := limitsWith(rateConfig{HeavyPerMin: 600, HeavyTotal: 2, PagePerMin: 600})
	ok1, _, _, rel1 := l.admitClass(limitKeys("192.0.2.1"), clsHeavy)
	ok2, _, _, _ := l.admitClass(limitKeys("192.0.2.1"), clsHeavy) // the same visitor: refused by its own one-at-a-time rule
	if !ok1 || ok2 {
		t.Fatalf("one transfer at a time per visitor: %v %v", ok1, ok2)
	}
	if n := l.heavyNow.Load(); n != 1 {
		t.Errorf("a refused transfer must not keep a place in the cap: %d counted", n)
	}
	for i := 0; i < 20; i++ { // ordinary page requests do not touch it
		if ok, _, _, _ := l.admitClass(limitKeys("192.0.2.9"), clsPage); !ok {
			t.Fatal("page requests are not limited by the transfer cap")
		}
	}
	rel1()
	if n := l.heavyNow.Load(); n != 0 {
		t.Errorf("%d still counted", n)
	}
}

func TestHeavyCapOffWhenZero(t *testing.T) {
	l, _ := limitsWith(rateConfig{HeavyPerMin: 600})
	for i := 0; i < 20; i++ {
		if ok, _, _, _ := l.admitClass(limitKeys("192.0.2."+strconvI(i+1)), clsHeavy); !ok {
			t.Fatalf("with no server-wide cap, visitor %d must pass", i)
		}
	}
	if l2 := newIPLimits(rateConfig{HeavyTotal: 3}); l2 == nil {
		t.Error("a server-wide cap alone is a limit: the limiter must exist")
	}
}
