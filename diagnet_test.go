package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// An IPv6 visitor is told apart by the /64 network, not the exact address: one network holds billions of addresses and must not be able to
// fill every place of the Connection Quality and Idle Test tools alone (see diagNet).

func TestDiagNetKey(t *testing.T) {
	for _, c := range []struct{ remote, want string }{
		{"192.0.2.7:1234", "192.0.2.7"},
		{"[2001:db8:0:1::5]:1234", "2001:db8:0:1::/64"},
		{"[2001:db8:0:1:ffff:ffff:ffff:ffff]:1", "2001:db8:0:1::/64"},
		{"[2001:db8:0:2::5]:1234", "2001:db8:0:2::/64"},
	} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.remote
		if got := diagNet(config{}, r); got != c.want {
			t.Errorf("%s -> %q, want %q", c.remote, got, c.want)
		}
	}
}

func TestTestRunsAreCountedPerNetworkNotPerAddress(t *testing.T) {
	h, err := newHandler(testCfg())
	if err != nil {
		t.Fatal(err)
	}
	get := func(remote, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", path, nil)
		r.RemoteAddr = remote
		h.ServeHTTP(w, r)
		return w
	}
	// somebody else, on another network, has a run going
	if w := get("[2001:db8:0:9::1]:1", "/api/ping?run=otherperson1&seq=0"); w.Code != 200 {
		t.Fatalf("ping: %d", w.Code)
	}
	// six different addresses of ONE /64 each start a run: only maxRunsPerIP of them may stay, the oldest are dropped
	for i := 1; i <= 6; i++ {
		w := get(fmt.Sprintf("[2001:db8:0:1::%x]:1", i), fmt.Sprintf("/api/ping?run=networkrun%d&seq=0", i))
		if w.Code != 200 {
			t.Fatalf("run %d: %d", i, w.Code)
		}
		time.Sleep(2 * time.Millisecond) // the oldest is told apart by the time it was last touched
	}
	seen := func(remote, run string) string {
		return strings.TrimSpace(get(remote, "/api/seen?run="+run+"&seqs=0").Body.String())
	}
	if got := seen("[2001:db8:0:1::99]:1", "networkrun1"); got != `{"0":-1}` {
		t.Errorf("the oldest run of a network that holds too many must be dropped, got %s", got)
	}
	if got := seen("[2001:db8:0:1::99]:1", "networkrun6"); strings.Contains(got, "-1") {
		t.Errorf("the newest run must be kept, got %s", got)
	}
	if got := seen("[2001:db8:0:9::1]:1", "otherperson1"); strings.Contains(got, "-1") {
		t.Errorf("another network's run must not be touched, got %s", got)
	}
}

func TestIdleTestPlacesAreCountedPerNetwork(t *testing.T) {
	cfg := testCfg()
	cfg.IPs, _ = newIPResolver("X-Test-IP", "127.0.0.1")
	h, err := newHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(h)
	t.Cleanup(s.Close)
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup
	for i := 1; i <= holdMaxPerIP; i++ { // four different addresses of one /64 take all four of its places
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			req, _ := http.NewRequestWithContext(ctx, "GET", s.URL+"/api/hold?secs=30", nil)
			req.Header.Set("X-Test-IP", fmt.Sprintf("2001:db8:0:1::%x", i))
			if r, err := http.DefaultClient.Do(req); err == nil {
				r.Body.Close()
			}
		}(i)
	}
	time.Sleep(500 * time.Millisecond)
	try := func(ip string) int {
		req, _ := http.NewRequest("GET", s.URL+"/api/hold?secs=1", nil)
		req.Header.Set("X-Test-IP", ip)
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		return r.StatusCode
	}
	if code := try("2001:db8:0:1::ff"); code != 429 {
		t.Errorf("a fifth address of the same /64 must be refused, got %d", code)
	}
	if code := try("2001:db8:0:2::1"); code != 200 {
		t.Errorf("another network still has room, got %d", code)
	}
	cancel()
	wg.Wait()
}

// ---- Monitor mode: one visitor cannot keep the claim for ever by claiming again (leaseCooldown) ----

func TestMonitorClaimCannotBeKeptForEverByClaimingAgain(t *testing.T) {
	d := newDiagStore()
	now := time.Now()
	d.now = func() time.Time { return now }
	max := 2 * time.Minute // the claim ends after max + 1 minute = 3 minutes
	// a page that claims again with a NEW run id every 15 seconds: the time already held must still count
	refusedAt := -1
	for i := 0; i < 30; i++ {
		if !d.acquire("1.1.1.1", fmt.Sprintf("reclaim-run-%02d", i), max) {
			refusedAt = i
			break
		}
		now = now.Add(15 * time.Second)
	}
	if refusedAt < 12 || refusedAt > 13 { // 12 x 15 s = 3 minutes
		t.Fatalf("the claim must end after the longest run plus a minute, but it was refused at step %d", refusedAt)
	}
	if !d.acquire("2.2.2.2", "somebody-else", max) {
		t.Fatal("another visitor must get the turn at once")
	}
	if d.acquire("1.1.1.1", "reclaim-again", max) || !d.busy("1.1.1.1", max) {
		t.Error("the same network must wait while it cools down")
	}
	d.release("2.2.2.2", "somebody-else")
	if d.acquire("1.1.1.1", "reclaim-again", max) {
		t.Error("still cooling down, even though nobody holds the claim")
	}
	now = now.Add(leaseCooldown + time.Second)
	if !d.acquire("1.1.1.1", "reclaim-later", max) {
		t.Error("after the cooldown the network may claim again")
	}
}

func TestMonitorCooldownOnlyAfterReachingTheLongestRun(t *testing.T) {
	d := newDiagStore()
	now := time.Now()
	d.now = func() time.Time { return now }
	max := 10 * time.Minute
	// letting go (the page finished) costs nothing
	d.acquire("1.1.1.1", "finished-run-1", max)
	d.release("1.1.1.1", "finished-run-1")
	if !d.acquire("1.1.1.1", "finished-run-2", max) {
		t.Error("a claim that was let go must be possible again at once")
	}
	// a claim nobody renews (closed tab) costs nothing either, however long ago it was
	now = now.Add(2 * time.Hour)
	if !d.acquire("1.1.1.1", "after-a-closed-tab", max) {
		t.Error("a claim that went quiet must not make its network wait")
	}
	if d.busy("1.1.1.1", max) {
		t.Error("and it must not look busy to its own network")
	}
}
