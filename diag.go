package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Endpoints for the Connection Quality tool (Troubleshooting folder). They carry dummy data only: nothing a visitor typed,
// nothing is written to disk, and none of these requests is entered in the visit log.
//
//	GET  /api/ping?run=ID&seq=N     a tiny reply with the server's receive and send times (microseconds, own monotonic clock).
//	                                The page uses them to tell delay on the way TO the server from delay on the way BACK.
//	GET  /api/seen?run=ID&seqs=1,2  which probes of this run the server did receive (to tell "request lost" from "reply lost").
//	                                &done=1 also forgets the run: the page is finished with it.
//	GET  /api/download?kb=N         N KB of random bytes (at most maxDownloadKB), for the under-load test.
//	POST /api/upload                reads and discards up to maxUploadBytes, for the under-load test.
//	GET  /api/monitor               how Monitor mode is offered here: on or off, exclusive or not, longest run, fine detail allowed, and whether another visitor is monitoring now.
//	POST /api/monitor?run=ID        asks to start monitoring (409 when another visitor is, and exclusive mode is on); &release=1 gives it up.
//	                                While monitoring, probes carry &mon=1, which keeps the claim alive; a claim nobody renews ends by itself.

const (
	maxDownloadKB   = 8192
	maxUploadBytes  = 4 << 20
	ringSize        = 4096            // probes remembered per run (about 13 minutes at 5 a second)
	ringBig         = 16384           // ... for a fine-detail run (20 a second): about 13 minutes
	runTTL          = 3 * time.Minute // a run that sends nothing for this long is forgotten (a running test sends 5 probes a second)
	maxRunsTotal    = 200
	maxRunsPerIP    = 4
	maxSeenQuery    = 400
	diagChunk       = 64 << 10
	diagTransferMax = 90 * time.Second
)

var procStart = time.Now()

func nowMicros() int64 { return time.Since(procStart).Microseconds() }

type diagRun struct {
	ip      string
	touched time.Time
	seqs    []uint32 // which probe each slot holds (seq+1; 0 = empty)
	at      []int64  // when the server received it
}

// the one visitor who currently holds Monitor mode (when it is exclusive)
type lease struct {
	run, ip        string
	since, touched time.Time
}

const leaseIdle = 20 * time.Second // a monitoring page sends a probe every 200 ms; 20 s of silence means it is gone

type diagStore struct {
	mu    sync.Mutex
	runs  map[string]*diagRun
	now   func() time.Time
	lease *lease
}

func newDiagStore() *diagStore { return &diagStore{runs: map[string]*diagRun{}, now: time.Now} }

// valid run ids: 8-40 letters, digits, - or _ (the page makes a random one)
func validRunID(s string) bool {
	if len(s) < 8 || len(s) > 40 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

// note records that probe seq of run arrived at the given time. Returns false when the run cannot be stored (too many runs).
func (d *diagStore) note(ip, run string, seq uint32, at int64) bool {
	return d.noteSized(ip, run, seq, at, false)
}

// noteSized: big asks for the larger memory of a fine-detail run (only honoured when the run is created).
func (d *diagStore) noteSized(ip, run string, seq uint32, at int64, big bool) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	r := d.runs[run]
	if r == nil {
		if len(d.runs) >= maxRunsTotal {
			d.sweepLocked(now)
			if len(d.runs) >= maxRunsTotal {
				return false
			}
		}
		// one address may hold only a few runs: past that, its OLDEST run is dropped to make room (it can only hurt itself)
		own, oldestID := 0, ""
		var oldest time.Time
		for id, o := range d.runs {
			if o.ip == ip {
				own++
				if oldestID == "" || o.touched.Before(oldest) {
					oldestID, oldest = id, o.touched
				}
			}
		}
		if own >= maxRunsPerIP {
			delete(d.runs, oldestID)
		}
		size := ringSize
		if big {
			size = ringBig
		}
		r = &diagRun{ip: ip, seqs: make([]uint32, size), at: make([]int64, size)}
		d.runs[run] = r
	}
	if r.ip != ip {
		return false // somebody else's run id
	}
	r.touched = now
	slot := seq % uint32(len(r.seqs))
	r.seqs[slot], r.at[slot] = seq+1, at
	return true
}

// lookup: the arrival time of probe seq, or -1 when the server never saw it (or it fell out of the ring).
func (d *diagStore) lookup(ip, run string, seq uint32) int64 {
	d.mu.Lock()
	defer d.mu.Unlock()
	r := d.runs[run]
	if r == nil || r.ip != ip {
		return -1
	}
	slot := seq % uint32(len(r.seqs))
	if r.seqs[slot] != seq+1 {
		return -1
	}
	return r.at[slot]
}

func (d *diagStore) sweepLocked(now time.Time) {
	for id, r := range d.runs {
		if now.Sub(r.touched) > runTTL {
			delete(d.runs, id)
		}
	}
}

// drop forgets a finished run (only its own address may do that).
func (d *diagStore) drop(ip, run string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if r := d.runs[run]; r != nil && r.ip == ip {
		delete(d.runs, run)
	}
}

func leaseExpired(l *lease, now time.Time, max time.Duration) bool {
	return now.Sub(l.touched) > leaseIdle || now.Sub(l.since) > max+time.Minute
}

// acquire: the visitor may monitor if nobody else does (the same address may take over its own claim, for example after a page reload).
func (d *diagStore) acquire(ip, run string, max time.Duration) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	if d.lease != nil && leaseExpired(d.lease, now, max) {
		d.lease = nil
	}
	if d.lease != nil && d.lease.ip != ip {
		return false
	}
	since := now
	if d.lease != nil && d.lease.run == run {
		since = d.lease.since
	}
	d.lease = &lease{run: run, ip: ip, since: since, touched: now}
	return true
}

// renew keeps the holder's claim alive; false when the claim is not (or no longer) theirs.
func (d *diagStore) renew(ip, run string, max time.Duration) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	l := d.lease
	if l == nil || l.run != run || l.ip != ip || leaseExpired(l, now, max) {
		return false
	}
	l.touched = now
	return true
}

func (d *diagStore) release(ip, run string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.lease != nil && d.lease.ip == ip && d.lease.run == run {
		d.lease = nil
	}
}

// busy: somebody ELSE is monitoring right now.
func (d *diagStore) busy(ip string, max time.Duration) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	l := d.lease
	return l != nil && !leaseExpired(l, d.now(), max) && l.ip != ip
}

func (d *diagStore) count() int { d.mu.Lock(); defer d.mu.Unlock(); return len(d.runs) }

var randomBlock = func() []byte { b := make([]byte, diagChunk); rand.Read(b); return b }()

func diagIP(cfg config, r *http.Request) string {
	if cfg.IPs != nil {
		return cfg.IPs.IP(r)
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}

func registerDiag(mux *http.ServeMux, cfg config) {
	store := newDiagStore()
	// a deployer who switched the tool off (tools.conf) gets no test endpoints either
	off := func(w http.ResponseWriter, r *http.Request) bool {
		if cfg.Tools.appOff("netquality") {
			http.NotFound(w, r)
			return true
		}
		return false
	}
	noStore := func(w http.ResponseWriter, ct string) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", ct)
	}
	// Behind Cloudflare this path is answered by Cloudflare itself and never reaches us. Without Cloudflare we answer with a plain 200 that has
	// no "colo=" line, so the page can tell there is no edge, and the browser console shows no 404 error.
	mux.HandleFunc("GET /cdn-cgi/trace", func(w http.ResponseWriter, r *http.Request) {
		if edgeOff(cfg) {
			http.NotFound(w, r)
			return
		}
		noStore(w, "text/plain; charset=utf-8")
		io.WriteString(w, "no Cloudflare trace here\n")
	})
	mux.HandleFunc("GET /api/ping", func(w http.ResponseWriter, r *http.Request) {
		if off(w, r) {
			return
		}
		a := nowMicros() // the moment the server starts handling the probe
		q := r.URL.Query()
		run := q.Get("run")
		seq, err := strconv.ParseUint(q.Get("seq"), 10, 32)
		if !validRunID(run) || err != nil {
			http.Error(w, "bad probe", http.StatusBadRequest)
			return
		}
		ip := diagIP(cfg, r)
		if !store.noteSized(ip, run, uint32(seq), a, q.Get("f") == "1") {
			http.Error(w, "too many test runs from this address", http.StatusTooManyRequests)
			return
		}
		if q.Get("mon") == "1" {
			if mc := cfg.Tools.monitor(); mc.Enabled && mc.Exclusive {
				store.renew(ip, run, time.Duration(mc.Minutes)*time.Minute)
			}
		}
		noStore(w, "application/json")
		fmt.Fprintf(w, `{"a":%d,"s":%d}`, a, nowMicros())
	})
	mux.HandleFunc("GET /api/seen", func(w http.ResponseWriter, r *http.Request) {
		if off(w, r) {
			return
		}
		q := r.URL.Query()
		run := q.Get("run")
		if !validRunID(run) {
			http.Error(w, "bad run", http.StatusBadRequest)
			return
		}
		parts := strings.Split(q.Get("seqs"), ",")
		if len(parts) > maxSeenQuery {
			http.Error(w, "too many probes asked about", http.StatusBadRequest)
			return
		}
		out := make(map[string]int64, len(parts))
		ip := diagIP(cfg, r)
		for _, p := range parts {
			if p == "" {
				continue
			}
			n, err := strconv.ParseUint(p, 10, 32)
			if err != nil {
				http.Error(w, "bad probe number", http.StatusBadRequest)
				return
			}
			out[p] = store.lookup(ip, run, uint32(n))
		}
		if q.Get("done") == "1" {
			store.drop(ip, run) // the page is finished with this run
		}
		noStore(w, "application/json")
		json.NewEncoder(w).Encode(out)
	})
	mux.HandleFunc("GET /api/monitor", func(w http.ResponseWriter, r *http.Request) {
		if off(w, r) {
			return
		}
		mc := cfg.Tools.monitor()
		busy := mc.Enabled && mc.Exclusive && store.busy(diagIP(cfg, r), time.Duration(mc.Minutes)*time.Minute)
		noStore(w, "application/json")
		fmt.Fprintf(w, `{"enabled":%t,"exclusive":%t,"minutes":%d,"busy":%t,"fine":%t}`, mc.Enabled, mc.Exclusive, mc.Minutes, busy, mc.Fine)
	})
	mux.HandleFunc("POST /api/monitor", func(w http.ResponseWriter, r *http.Request) {
		if off(w, r) {
			return
		}
		mc := cfg.Tools.monitor()
		q := r.URL.Query()
		run := q.Get("run")
		if !validRunID(run) {
			http.Error(w, "bad run", http.StatusBadRequest)
			return
		}
		ip := diagIP(cfg, r)
		noStore(w, "application/json")
		if q.Get("release") == "1" {
			store.release(ip, run)
			fmt.Fprint(w, `{"ok":true}`)
			return
		}
		if !mc.Enabled {
			w.WriteHeader(http.StatusForbidden)
			fmt.Fprint(w, `{"ok":false,"reason":"off"}`)
			return
		}
		if mc.Exclusive && !store.acquire(ip, run, time.Duration(mc.Minutes)*time.Minute) {
			w.WriteHeader(http.StatusConflict)
			fmt.Fprint(w, `{"ok":false,"reason":"busy"}`)
			return
		}
		fmt.Fprintf(w, `{"ok":true,"minutes":%d}`, mc.Minutes)
	})
	mux.HandleFunc("GET /api/download", func(w http.ResponseWriter, r *http.Request) {
		if off(w, r) {
			return
		}
		kb, err := strconv.Atoi(r.URL.Query().Get("kb"))
		if err != nil || kb < 1 {
			kb = 1024
		}
		if kb > maxDownloadKB {
			kb = maxDownloadKB
		}
		total := kb << 10
		noStore(w, "application/octet-stream")
		w.Header().Set("Content-Length", strconv.Itoa(total))
		w.Header().Set("Content-Encoding", "identity")
		rc := http.NewResponseController(w)
		_ = rc.SetWriteDeadline(time.Now().Add(diagTransferMax))
		for sent := 0; sent < total; {
			n := diagChunk
			if total-sent < n {
				n = total - sent
			}
			if _, err := w.Write(randomBlock[:n]); err != nil {
				return
			}
			sent += n
			_ = rc.Flush()
		}
	})
	mux.HandleFunc("POST /api/upload", func(w http.ResponseWriter, r *http.Request) {
		if off(w, r) {
			return
		}
		rc := http.NewResponseController(w)
		_ = rc.SetReadDeadline(time.Now().Add(diagTransferMax))
		n, err := io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, maxUploadBytes))
		if err != nil {
			http.Error(w, "upload too large or interrupted", http.StatusRequestEntityTooLarge)
			return
		}
		noStore(w, "application/json")
		fmt.Fprintf(w, `{"bytes":%d}`, n)
	})
}
