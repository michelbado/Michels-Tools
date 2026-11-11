package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func diagHandler(t *testing.T) http.Handler {
	t.Helper()
	h, err := newHandler(testCfg())
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func TestPing(t *testing.T) {
	h := diagHandler(t)
	w := serve(h, "GET", "/api/ping?run=abcdef123456&seq=7")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" || !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") {
		t.Fatalf("ping: %d %v", w.Code, w.Header())
	}
	var j struct{ A, S int64 }
	if err := json.Unmarshal(w.Body.Bytes(), &j); err != nil {
		t.Fatalf("body %q: %v", w.Body.String(), err)
	}
	if j.A <= 0 || j.S < j.A {
		t.Errorf("times must be positive and the send time not before the receive time: %+v", j)
	}
	if time.Duration(j.S-j.A)*time.Microsecond > 50*time.Millisecond {
		t.Errorf("a ping should be answered almost at once, took %d us", j.S-j.A)
	}
	var j2 struct{ A, S int64 }
	json.Unmarshal(serve(h, "GET", "/api/ping?run=abcdef123456&seq=8").Body.Bytes(), &j2)
	if j2.A < j.S {
		t.Errorf("the server clock must not go backwards: %d then %d", j.S, j2.A)
	}
	for _, bad := range []string{"/api/ping", "/api/ping?run=short&seq=1", "/api/ping?run=abcdef123456", "/api/ping?run=abcdef123456&seq=-1", "/api/ping?run=abcdef123456&seq=x", "/api/ping?run=ab%20cdef123456&seq=1", "/api/ping?run=" + strings.Repeat("a", 41) + "&seq=1"} {
		if c := serve(h, "GET", bad).Code; c != 400 {
			t.Errorf("%s = %d, want 400", bad, c)
		}
	}
}

func TestSeen(t *testing.T) {
	h := diagHandler(t)
	for _, q := range []string{"1", "2", "5000"} {
		serve(h, "GET", "/api/ping?run=runrunrun1&seq="+q)
	}
	w := serve(h, "GET", "/api/seen?run=runrunrun1&seqs=1,2,3,5000,9999")
	var m map[string]int64
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatal(err, w.Body.String())
	}
	if m["1"] <= 0 || m["2"] < m["1"] || m["5000"] <= 0 || m["3"] != -1 || m["9999"] != -1 {
		t.Errorf("seen: %v", m)
	}
	// a ring slot reused by a newer probe forgets the old one
	serve(h, "GET", "/api/ping?run=runrunrun1&seq="+"4097") // 4097 % 4096 == 1
	m = nil
	json.Unmarshal(serve(h, "GET", "/api/seen?run=runrunrun1&seqs=1,4097").Body.Bytes(), &m)
	if m["1"] != -1 || m["4097"] <= 0 {
		t.Errorf("ring reuse: %v", m)
	}
	// an unknown run, a bad number, too many numbers
	if m2 := serve(h, "GET", "/api/seen?run=nobodyhere1&seqs=1"); m2.Code != 200 || !strings.Contains(m2.Body.String(), `"1":-1`) {
		t.Errorf("unknown run: %d %s", m2.Code, m2.Body.String())
	}
	if c := serve(h, "GET", "/api/seen?run=runrunrun1&seqs=1,x").Code; c != 400 {
		t.Errorf("bad number = %d", c)
	}
	many := make([]string, maxSeenQuery+1)
	for i := range many {
		many[i] = "1"
	}
	if c := serve(h, "GET", "/api/seen?run=runrunrun1&seqs="+strings.Join(many, ",")).Code; c != 400 {
		t.Errorf("too many numbers = %d", c)
	}
}

func TestRunStoreLimits(t *testing.T) {
	d := newDiagStore()
	now := time.Now()
	d.now = func() time.Time { return now }
	for i := 0; i < maxRunsPerIP; i++ {
		now = now.Add(time.Second)
		if !d.note("1.1.1.1", "run-number-"+string(rune('a'+i)), 1, int64(5+i)) {
			t.Fatalf("run %d should be accepted", i)
		}
	}
	// past the limit the OLDEST run of that address is dropped; the new one is accepted (a visitor can only hurt themselves)
	now = now.Add(time.Second)
	if !d.note("1.1.1.1", "run-number-new", 1, 99) {
		t.Fatal("a new run must be accepted")
	}
	if d.lookup("1.1.1.1", "run-number-a", 1) != -1 || d.lookup("1.1.1.1", "run-number-new", 1) != 99 || d.lookup("1.1.1.1", "run-number-b", 1) == -1 {
		t.Error("the oldest run (a) should be gone, the others and the new one kept")
	}
	if !d.note("2.2.2.2", "run-number-zz", 1, 5) {
		t.Error("another address is not affected")
	}
	if d.note("3.3.3.3", "run-number-b", 1, 5) || d.lookup("3.3.3.3", "run-number-b", 1) != -1 {
		t.Error("somebody else's run id must be neither usable nor readable")
	}
	d.drop("3.3.3.3", "run-number-b")
	if d.lookup("1.1.1.1", "run-number-b", 1) == -1 {
		t.Error("another address cannot drop my run")
	}
	d.drop("1.1.1.1", "run-number-b")
	if d.lookup("1.1.1.1", "run-number-b", 1) != -1 {
		t.Error("a finished run can be dropped by its owner")
	}
	now = now.Add(runTTL + time.Minute)
	if !d.note("1.1.1.1", "run-number-late", 1, 5) {
		t.Error("expired runs make room")
	}
	d.mu.Lock()
	d.sweepLocked(now)
	d.mu.Unlock()
	if d.count() != 1 {
		t.Errorf("idle runs are swept after the TTL, have %d", d.count())
	}
}

func TestSeenDoneForgetsTheRun(t *testing.T) {
	h := diagHandler(t)
	serve(h, "GET", "/api/ping?run=finishedrun1&seq=1")
	if !strings.Contains(serve(h, "GET", "/api/seen?run=finishedrun1&seqs=1&done=1").Body.String(), "\"1\":") {
		t.Fatal("the answer to the last question is still given")
	}
	if !strings.Contains(serve(h, "GET", "/api/seen?run=finishedrun1&seqs=1").Body.String(), "\"1\":-1") {
		t.Error("after done=1 the run is forgotten")
	}
	if c := serve(h, "GET", "/api/seen?run=finishedrun1&seqs=&done=1").Code; c != 200 {
		t.Errorf("an empty question with done=1 is fine, got %d", c)
	}
}

func TestDownloadAndUpload(t *testing.T) {
	h := diagHandler(t)
	w := serve(h, "GET", "/api/download?kb=300")
	if w.Code != 200 || w.Body.Len() != 300<<10 || w.Header().Get("Content-Length") != "307200" || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Content-Encoding") != "identity" {
		t.Errorf("download 300 KB: %d len %d %v", w.Code, w.Body.Len(), w.Header())
	}
	if n := serve(h, "GET", "/api/download?kb=999999").Body.Len(); n != maxDownloadKB<<10 {
		t.Errorf("download is capped at %d KB, sent %d bytes", maxDownloadKB, n)
	}
	if n := serve(h, "GET", "/api/download").Body.Len(); n != 1024<<10 {
		t.Errorf("default download is 1 MB, got %d", n)
	}
	b := serve(h, "GET", "/api/download?kb=64").Body.Bytes()
	zero := 0
	for _, c := range b {
		if c == 0 {
			zero++
		}
	}
	if zero > len(b)/20 {
		t.Errorf("download data should look random (incompressible), %d of %d bytes are zero", zero, len(b))
	}
	// upload
	req := httptest.NewRequest("POST", "/api/upload", strings.NewReader(strings.Repeat("x", 1<<20)))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"bytes":1048576`) {
		t.Errorf("upload 1 MB: %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest("POST", "/api/upload", strings.NewReader(strings.Repeat("x", maxUploadBytes+10)))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("upload over the cap = %d, want 413", rec.Code)
	}
	if c := serve(h, "GET", "/api/upload").Code; c == 200 {
		t.Error("upload must not answer GET")
	}
	if c := serve(h, "POST", "/api/ping?run=abcdef123456&seq=1").Code; c == 200 {
		t.Error("ping must not answer POST")
	}
}

func TestDiagBudgetsAreSeparate(t *testing.T) {
	l := newIPLimits(rateConfig{PagePerMin: 600, DiagPerMin: 60, HeavyPerMin: 6})
	now := time.Now()
	l.now = func() time.Time { return now }
	keys := []keyScale{{"9.9.9.9", false}}
	// use up the probe budget (burst = max(30, 60/3) = 30)
	for i := 0; i < 30; i++ {
		if ok, _, _, rel := l.admitClass(keys, clsDiag); !ok {
			t.Fatalf("probe %d refused too early", i)
		} else if rel != nil {
			rel()
		}
	}
	if ok, _, _, _ := l.admitClass(keys, clsDiag); ok {
		t.Error("the 31st probe in a burst must be refused")
	}
	if ok, _, _, _ := l.admitClass(keys, clsPage); !ok {
		t.Error("page loads must be unaffected by the probe budget")
	}
	now = now.Add(2 * time.Second)
	if ok, _, _, _ := l.admitClass(keys, clsDiag); !ok {
		t.Error("probes come back with time (60 a minute = 1 a second)")
	}
	// transfers: one at a time, and a per-minute count
	ok, _, _, rel1 := l.admitClass(keys, clsHeavy)
	if !ok || rel1 == nil {
		t.Fatal("first transfer should start")
	}
	ok, _, msg, _ := l.admitClass(keys, clsHeavy)
	if ok || !strings.Contains(msg, "already running") {
		t.Errorf("a second transfer at the same time must be refused with a clear message, got ok=%v msg=%q", ok, msg)
	}
	rel1()
	ok, _, _, rel2 := l.admitClass(keys, clsHeavy)
	if !ok {
		t.Error("after the first one ends, the next may start")
	}
	rel2()
	count := 0
	for i := 0; i < 20; i++ {
		if ok, _, _, rel := l.admitClass(keys, clsHeavy); ok {
			count++
			rel()
		}
	}
	if count > 3 {
		t.Errorf("transfers per minute must be limited, %d more were admitted", count)
	}
	// another visitor has their own budgets
	if ok, _, _, _ := l.admitClass([]keyScale{{"8.8.8.8", false}}, clsDiag); !ok {
		t.Error("another visitor is unaffected")
	}
}

func TestDiagRequestsAreNotVisitLogged(t *testing.T) {
	for _, p := range []string{"/api/ping?run=abcdef123456&seq=1", "/api/seen?run=abcdef123456&seqs=1", "/api/download?kb=1"} {
		r := httptest.NewRequest("GET", p, nil)
		if ev, _ := classify(r); ev != "" {
			t.Errorf("%s would be written to the visit log as %q", p, ev)
		}
	}
	if ev, _ := classify(httptest.NewRequest("POST", "/api/upload", io.NopCloser(strings.NewReader("")))); ev != "" {
		t.Errorf("upload would be logged as %q", ev)
	}
	if ev, app := classify(httptest.NewRequest("GET", "/apps/netquality/app.html", nil)); ev != "app" || app != "netquality" {
		t.Errorf("opening the tool should count as an app visit, got %q %q", ev, app)
	}
}

func TestToolSwitchOffCoversTheNewTool(t *testing.T) {
	h := handlerWith(t, "netquality = false\n")
	if serve(h, "GET", "/apps/netquality/app.js").Code != 404 {
		t.Error("netquality = false must refuse its files")
	}
	for _, p := range []string{"/api/ping?run=abcdef123456&seq=1", "/api/seen?run=abcdef123456&seqs=1", "/api/download?kb=1"} {
		if c := serve(h, "GET", p).Code; c != 404 {
			t.Errorf("%s = %d with the tool off, want 404", p, c)
		}
	}
	if c := serve(h, "POST", "/api/upload").Code; c != 404 {
		t.Errorf("upload = %d with the tool off, want 404", c)
	}
	if c := serve(handlerWith(t, "pdf = false\n"), "GET", "/api/ping?run=abcdef123456&seq=1").Code; c != 200 {
		t.Errorf("switching off an unrelated folder must leave the test endpoints on, got %d", c)
	}
	if got := mustParse(t, "trouble = false\n").hidden(); strings.Join(got, ",") != "browsercaps,connfacts,httphdr,idletest,netquality,pathread,trouble" {
		t.Errorf("trouble = false hides the folder and its tool: %v", got)
	}
}

func TestTraceWithoutCloudflare(t *testing.T) {
	w := serve(diagHandler(t), "GET", "/cdn-cgi/trace")
	if w.Code != 200 || strings.Contains(w.Body.String(), "colo=") || w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("without Cloudflare the trace path answers 200 with no colo line: %d %q", w.Code, w.Body.String())
	}
}

func serveFrom(h http.Handler, ip, method, p string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, p, nil)
	req.RemoteAddr = ip + ":4444"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestMonitorLeaseStore(t *testing.T) {
	d := newDiagStore()
	now := time.Now()
	d.now = func() time.Time { return now }
	max := 10 * time.Minute
	if !d.acquire("1.1.1.1", "run-monitor-a", max) {
		t.Fatal("the first visitor may monitor")
	}
	if d.acquire("2.2.2.2", "run-monitor-b", max) {
		t.Error("a second visitor must wait")
	}
	if !d.busy("2.2.2.2", max) || d.busy("1.1.1.1", max) {
		t.Error("busy is true for the others only")
	}
	if !d.acquire("1.1.1.1", "run-monitor-a2", max) {
		t.Error("the holder's address may take its own claim over (a page reload)")
	}
	now = now.Add(15 * time.Second)
	if !d.renew("1.1.1.1", "run-monitor-a2", max) || d.renew("2.2.2.2", "run-monitor-a2", max) || d.renew("1.1.1.1", "run-monitor-a", max) {
		t.Error("only the current holder renews")
	}
	now = now.Add(15 * time.Second)
	if !d.busy("2.2.2.2", max) {
		t.Error("renewing keeps the claim alive")
	}
	now = now.Add(leaseIdle + time.Second)
	if d.busy("2.2.2.2", max) || !d.acquire("2.2.2.2", "run-monitor-b", max) {
		t.Error("a claim nobody renews ends by itself")
	}
	d.release("1.1.1.1", "run-monitor-b")
	if !d.busy("1.1.1.1", max) {
		t.Error("somebody else cannot release my claim")
	}
	d.release("2.2.2.2", "run-monitor-b")
	if d.busy("1.1.1.1", max) {
		t.Error("released")
	}
	// even a claim that is kept alive ends after the longest run (plus a minute of grace)
	d.acquire("1.1.1.1", "run-monitor-a", 2*time.Minute)
	for i := 0; i < 20; i++ {
		now = now.Add(10 * time.Second)
		d.renew("1.1.1.1", "run-monitor-a", 2*time.Minute)
	}
	if d.busy("2.2.2.2", 2*time.Minute) {
		t.Error("after the longest run the claim must be over even if it was renewed")
	}
}

func TestMonitorEndpoints(t *testing.T) {
	h := handlerWith(t, "")
	st := func(ip string) map[string]any {
		var m map[string]any
		json.Unmarshal(serveFrom(h, ip, "GET", "/api/monitor").Body.Bytes(), &m)
		return m
	}
	s := st("10.0.0.1")
	if s["enabled"] != true || s["exclusive"] != true || s["minutes"] != float64(10) || s["busy"] != false {
		t.Errorf("default status: %v", s)
	}
	if c := serveFrom(h, "10.0.0.1", "POST", "/api/monitor?run=visitor-one-1").Code; c != 200 {
		t.Fatalf("first claim = %d", c)
	}
	if st("10.0.0.2")["busy"] != true || st("10.0.0.1")["busy"] != false {
		t.Error("the second visitor sees it busy, the holder does not")
	}
	w := serveFrom(h, "10.0.0.2", "POST", "/api/monitor?run=visitor-two-2")
	if w.Code != 409 || !strings.Contains(w.Body.String(), `"reason":"busy"`) {
		t.Errorf("second claim = %d %s", w.Code, w.Body.String())
	}
	// probes with mon=1 from the holder keep it alive and are otherwise normal pings
	if c := serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=visitor-one-1&seq=1&mon=1").Code; c != 200 {
		t.Errorf("ping with mon=1 = %d", c)
	}
	if c := serveFrom(h, "10.0.0.2", "GET", "/api/ping?run=visitor-two-2&seq=1&mon=1").Code; c != 200 || st("10.0.0.1")["busy"] != false {
		t.Error("a non-holder's mon=1 changes nothing")
	}
	serveFrom(h, "10.0.0.1", "POST", "/api/monitor?run=visitor-one-1&release=1")
	if st("10.0.0.2")["busy"] != false || serveFrom(h, "10.0.0.2", "POST", "/api/monitor?run=visitor-two-2").Code != 200 {
		t.Error("after release the other visitor can monitor")
	}
	if c := serveFrom(h, "10.0.0.2", "POST", "/api/monitor?run=bad").Code; c != 400 {
		t.Errorf("bad run id = %d", c)
	}
	if c := serveFrom(h, "10.0.0.2", "GET", "/api/monitor?x=1").Code; c != 200 {
		t.Errorf("status = %d", c)
	}
}

func TestMonitorSettingsChangeBehaviour(t *testing.T) {
	off := handlerWith(t, "netquality.monitor = false\n")
	var m map[string]any
	json.Unmarshal(serveFrom(off, "10.0.0.1", "GET", "/api/monitor").Body.Bytes(), &m)
	if m["enabled"] != false {
		t.Errorf("status with monitor off: %v", m)
	}
	if w := serveFrom(off, "10.0.0.1", "POST", "/api/monitor?run=visitor-one-1"); w.Code != 403 || !strings.Contains(w.Body.String(), `"reason":"off"`) {
		t.Errorf("claim with monitor off = %d %s", w.Code, w.Body.String())
	}
	if c := serveFrom(off, "10.0.0.1", "GET", "/api/ping?run=visitor-one-1&seq=1").Code; c != 200 {
		t.Error("the quick test still works with Monitor off")
	}
	shared := handlerWith(t, "netquality.monitor_exclusive = false\nnetquality.monitor_minutes = 2\n")
	if serveFrom(shared, "10.0.0.1", "POST", "/api/monitor?run=visitor-one-1").Code != 200 || serveFrom(shared, "10.0.0.2", "POST", "/api/monitor?run=visitor-two-2").Code != 200 {
		t.Error("with exclusive off, any number of visitors may monitor")
	}
	m = nil
	json.Unmarshal(serveFrom(shared, "10.0.0.3", "GET", "/api/monitor").Body.Bytes(), &m)
	if m["busy"] != false || m["exclusive"] != false || m["minutes"] != float64(2) {
		t.Errorf("status with exclusive off: %v", m)
	}
	gone := handlerWith(t, "netquality = false\n")
	if serveFrom(gone, "10.0.0.1", "GET", "/api/monitor").Code != 404 || serveFrom(gone, "10.0.0.1", "POST", "/api/monitor?run=visitor-one-1").Code != 404 {
		t.Error("with the tool off the monitor endpoints are gone too")
	}
}

func TestFineModeSetting(t *testing.T) {
	var none *toolSet
	if !none.monitor().Fine {
		t.Error("fine detail is allowed by default")
	}
	if mustParse(t, "netquality.monitor_fine = false\n").monitor().Fine {
		t.Error("netquality.monitor_fine = false switches it off")
	}
	h := handlerWith(t, "netquality.monitor_fine = false\n")
	var m map[string]any
	json.Unmarshal(serveFrom(h, "10.0.0.1", "GET", "/api/monitor").Body.Bytes(), &m)
	if m["fine"] != false {
		t.Errorf("status with fine off: %v", m)
	}
	m = nil
	json.Unmarshal(serveFrom(diagHandler(t), "10.0.0.1", "GET", "/api/monitor").Body.Bytes(), &m)
	if m["fine"] != true {
		t.Errorf("status by default: %v", m)
	}
}

func TestFineRunsRememberMoreProbes(t *testing.T) {
	h := diagHandler(t)
	// a normal run forgets a probe once 4096 newer ones have come; a fine run (f=1) remembers 16384
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=normalrun001&seq=5")
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=normalrun001&seq=4101") // same slot as 5
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=finerun0001&seq=5&f=1")
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=finerun0001&seq=4101&f=1")
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=finerun0001&seq=16000&f=1")
	var n, f map[string]int64
	json.Unmarshal(serveFrom(h, "10.0.0.1", "GET", "/api/seen?run=normalrun001&seqs=5,4101").Body.Bytes(), &n)
	json.Unmarshal(serveFrom(h, "10.0.0.1", "GET", "/api/seen?run=finerun0001&seqs=5,4101,16000,16389").Body.Bytes(), &f)
	if n["5"] != -1 || n["4101"] <= 0 {
		t.Errorf("a normal run reuses the slot after 4096 probes: %v", n)
	}
	if f["5"] <= 0 || f["4101"] <= 0 || f["16000"] <= 0 || f["16389"] != -1 {
		t.Errorf("a fine run keeps 16384 probes: %v", f)
	}
	// the size is fixed when the run is created
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=normalrun001&seq=9&f=1")
	serveFrom(h, "10.0.0.1", "GET", "/api/ping?run=normalrun001&seq=4105&f=1")
	n = nil
	json.Unmarshal(serveFrom(h, "10.0.0.1", "GET", "/api/seen?run=normalrun001&seqs=9").Body.Bytes(), &n)
	if n["9"] != -1 {
		t.Errorf("f=1 on an existing small run must not change its size: %v", n)
	}
}

func TestDefaultProbeBudgetCoversFineMode(t *testing.T) {
	// the default is 1800 probes a minute: a fine-detail monitor (20 a second = 1200 a minute) must never be refused
	l := newIPLimits(rateConfig{DiagPerMin: 1800, HeavyPerMin: 6})
	now := time.Now()
	l.now = func() time.Time { return now }
	keys := []keyScale{{"9.9.9.9", false}}
	refused := 0
	for i := 0; i < 20*180; i++ { // three minutes at 20 a second
		now = now.Add(50 * time.Millisecond)
		if ok, _, _, rel := l.admitClass(keys, clsDiag); !ok {
			refused++
		} else if rel != nil {
			rel()
		}
	}
	if refused != 0 {
		t.Errorf("20 probes a second were refused %d times under the default budget", refused)
	}
	// ... and somebody sending 60 a second still is limited
	refused = 0
	for i := 0; i < 60*60; i++ {
		now = now.Add(time.Second / 60)
		if ok, _, _, _ := l.admitClass(keys, clsDiag); !ok {
			refused++
		}
	}
	if refused < 1000 {
		t.Errorf("a flood of 60 a second must be limited, only %d refused", refused)
	}
}
