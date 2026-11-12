package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"io/fs"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"path"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

type response struct {
	Found4         int      `json:"found4"`
	Found6         int      `json:"found6"`
	Invalid        int      `json:"invalid"`
	InvalidSamples []string `json:"invalidSamples"`
	Bytes          int64    `json:"bytes"`
	V4             []string `json:"v4"`
	V6             []string `json:"v6"`
}

type config struct {
	MaxBytes   int64         // maximum accepted input size
	Jobs       int           // aggregations running at once
	Queue      int           // requests allowed to wait for a free job slot
	QueueWait  time.Duration // how long a request may wait before "busy"
	UploadTime time.Duration // max time to receive the body once running
	Visits     *visitLogger  // optional: records visits for analytics (nil = off)
	Limits     *ipLimits     // optional: per-visitor rate limits (nil = off)
	IPs        *ipResolver   // finds the visitor's real address (nil = use the connection)
	Tools      *toolSet      // which tools are switched off (nil = all on)
}

// limiter runs at most Jobs requests at once; up to Queue more may wait.
type limiter struct {
	slots   chan struct{}
	waiting atomic.Int32
	queue   int32
	wait    time.Duration
}

func newLimiter(jobs, queue int, wait time.Duration) *limiter {
	return &limiter{slots: make(chan struct{}, jobs), queue: int32(queue), wait: wait}
}

// acquire returns a release func, or nil if the server is busy / client left.
func (l *limiter) acquire(done <-chan struct{}) func() {
	release := func() { <-l.slots }
	select {
	case l.slots <- struct{}{}:
		return release
	default:
	}
	if l.waiting.Add(1) > l.queue {
		l.waiting.Add(-1)
		return nil
	}
	defer l.waiting.Add(-1)
	t := time.NewTimer(l.wait)
	defer t.Stop()
	select {
	case l.slots <- struct{}{}:
		return release
	case <-t.C:
		return nil
	case <-done:
		return nil
	}
}

func newHandler(cfg config) (http.Handler, error) {
	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		return nil, err
	}
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	lim := newLimiter(cfg.Jobs, cfg.Queue, cfg.QueueWait)
	mux := http.NewServeMux()
	files := http.FileServerFS(sub)
	tools := cfg.Tools
	// read by the page before shell.js: the tools to hide. Never cached, so a restart with a new tools.conf shows at once.
	mux.HandleFunc("GET /tools-config.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, tools.toolsScript())
		io.WriteString(w, tools.lockScript(r))
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		// a tool switched off in tools.conf is not served at all, not just hidden
		if id := appIDFromPath(r.URL.Path); id != "" && tools.appOff(id) {
			http.NotFound(w, r)
			return
		}
		// never list a folder's contents: only the page itself and real files are served
		if r.URL.Path != "/" {
			if fi, err := fs.Stat(sub, strings.Trim(path.Clean(r.URL.Path), "/")); err == nil && fi.IsDir() {
				http.NotFound(w, r)
				return
			}
		}
		files.ServeHTTP(w, r)
	})
	registerDiag(mux, cfg)
	registerFacts(mux, cfg)
	registerHold(mux, cfg)
	registerLock(mux, cfg)
	mux.HandleFunc("POST /api/aggregate", func(w http.ResponseWriter, r *http.Request) {
		if tools.appOff("aggregator") {
			http.NotFound(w, r)
			return
		}
		release := lim.acquire(r.Context().Done())
		if release == nil {
			if r.Context().Err() == nil {
				w.Header().Set("Retry-After", "10")
				http.Error(w, "Server busy, try again in a moment.", http.StatusServiceUnavailable)
			}
			return
		}
		defer release()

		rc := http.NewResponseController(w)
		_ = rc.SetReadDeadline(time.Now().Add(cfg.UploadTime))
		r.Body = http.MaxBytesReader(w, r.Body, cfg.MaxBytes)
		c := &Collector{}
		if err := c.Feed(r.Body); err != nil {
			var mbe *http.MaxBytesError
			if errors.As(err, &mbe) {
				http.Error(w, "Input too large.", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, "Could not read input.", http.StatusBadRequest)
			return
		}
		v4, v6 := c.Result()
		_ = rc.SetWriteDeadline(time.Now().Add(2 * time.Minute))
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(response{
			Found4: c.Found4, Found6: c.Found6, Invalid: c.Invalid,
			InvalidSamples: c.InvalidSamples, Bytes: c.Bytes, V4: v4, V6: v6,
		})
	})
	var h http.Handler = lockGuard(tools, mux)
	if cfg.Visits != nil {
		h = cfg.Visits.middleware(h)
	}
	if cfg.Limits != nil { // outermost: refused requests never reach the visit log
		h = cfg.Limits.middleware(cfg.IPs, h)
	}
	return secureHeaders(h), nil
}

// secureHeaders: the page only loads its own files, cannot be framed, and
// browsers must not guess content types.
func secureHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-cache") // page files are tiny; always re-check so updates show up
		next.ServeHTTP(w, r)
	})
}

func main() {
	addr := flag.String("addr", "127.0.0.1:8080", "listen address")
	maxMB := flag.Int64("max-mb", 50, "maximum accepted input size in MB")
	jobs := flag.Int("jobs", 0, "aggregations running at the same time (0 = choose from the memory available: about one per 200 MB, 1 to 16)")
	memPercent := flag.Int("mem-percent", 80, "soft memory limit for the program as a percent of the memory available to it (0 = leave to the Go runtime or GOMEMLIMIT)")
	toolsConf := flag.String("tools-config", "", "file listing tools to switch off (name = true/false per line); default: tools.conf next to the program, if present")
	queue := flag.Int("queue", 20, "requests allowed to wait for a free slot")
	wait := flag.Duration("queue-wait", 60*time.Second, "how long a request may wait for a slot")
	dataDir := flag.String("data-dir", firstDir(os.Getenv("STATE_DIRECTORY")), "folder for the visit log (analytics); empty turns logging off")
	retention := flag.Int("retention-days", 90, "days to keep visit log files")
	ipHeader := flag.String("real-ip-header", "", "header holding the visitor's IP when behind a trusted proxy, e.g. CF-Connecting-IP (Cloudflare) or X-Forwarded-For")
	rateAPI := flag.Int("rate-api", 30, "aggregations per visitor per minute (0 = no limit)")
	ratePage := flag.Int("rate-page", 600, "page and file requests per visitor per minute (0 = no limit)")
	ipJobs := flag.Int("ip-jobs", 2, "aggregations one visitor may run at the same time (0 = no limit)")
	rateDiag := flag.Int("rate-diag", 1800, "Connection Quality probes per visitor per minute (0 = no limit); fine-detail Monitor mode sends 1200 a minute")
	rateHeavy := flag.Int("rate-heavy", 6, "Connection Quality download/upload transfers per visitor per minute, one at a time (0 = no limit)")
	netScale := flag.Int("rate-net-scale", 50, "how many times one visitor's budget a whole IPv6 /48 network may use together (a /48 is normally one site; raise it for big shared networks)")
	trusted := flag.String("trusted-proxies", "", "addresses/CIDRs allowed to set that header (default: this machine, 127.0.0.0/8 and ::1)")
	flag.Parse()

	mem := effectiveMemory()
	if *jobs <= 0 {
		*jobs = autoJobs(mem)
	}
	if *memPercent > 0 && mem > 0 && os.Getenv("GOMEMLIMIT") == "" {
		debug.SetMemoryLimit(mem / 100 * int64(*memPercent))
	}
	tools, toolsFile, err := loadToolConfig(*toolsConf)
	if err != nil {
		log.Fatal(err)
	}
	if off := tools.hidden(); len(off) > 0 {
		log.Printf("tools switched off by %s: %s", toolsFile, strings.Join(off, ", "))
	}

	ips, err := newIPResolver(*ipHeader, *trusted)
	if err != nil {
		log.Fatal(err)
	}
	if *ipHeader != "" {
		log.Printf("visitor IP taken from header %s when the connection comes from a trusted proxy", *ipHeader)
	}
	visits, err := newVisitLogger(*dataDir, *retention, ips)
	if err != nil {
		log.Fatalf("visit log: %v", err)
	}
	if visits != nil {
		log.Printf("visit log on: %s (kept %d days)", *dataDir, *retention)
	} else {
		log.Printf("visit log off")
	}

	limits := newIPLimits(rateConfig{APIPerMin: *rateAPI, PagePerMin: *ratePage, IPJobs: *ipJobs, NetScale: *netScale, DiagPerMin: *rateDiag, HeavyPerMin: *rateHeavy})
	if limits != nil {
		log.Printf("per-visitor limits on: %d aggregations/min, %d requests/min, %d aggregations at once (0 = off)", *rateAPI, *ratePage, *ipJobs)
		go func() { // a count only, never addresses
			for range time.Tick(time.Hour) {
				if n := limits.takeRefused(); n > 0 {
					log.Printf("rate limit: refused %d requests in the last hour", n)
				}
			}
		}()
	}

	h, err := newHandler(config{
		MaxBytes: *maxMB << 20, Jobs: *jobs, Queue: *queue,
		QueueWait: *wait, UploadTime: 5 * time.Minute, Visits: visits, Limits: limits, IPs: ips, Tools: tools,
	})
	if err != nil {
		log.Fatal(err)
	}
	srv := &http.Server{
		Addr:              *addr,
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()

	log.Printf("Michel's Tools on http://%s (max input %d MB, %d jobs, queue %d, memory available %d MB)", *addr, *maxMB, *jobs, *queue, mem>>20)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	visits.Close() // write out anything still queued
}

// STATE_DIRECTORY is set by systemd and may list several folders; use the first.
func firstDir(v string) string {
	if i := strings.IndexByte(v, ':'); i >= 0 {
		return v[:i]
	}
	return v
}
