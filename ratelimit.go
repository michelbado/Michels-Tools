package main

import (
	"hash/fnv"
	"math"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Per-visitor limits, kept in memory (nothing is written anywhere):
//   - requests to the heavy endpoint (aggregation), per minute
//   - how many aggregations one visitor may have running at once
//   - all other requests (pages, scripts, icons), per minute
//
// Visitors are told apart by their real address (see ipResolver). IPv6
// visitors are counted twice: by /64 network (the normal budget) and by the
// whole /48 they belong to (a much larger budget, NetScale times a single
// visitor's). The /48 budget exists so that one address allocation cannot mint
// endless fresh visitors; it is deliberately generous so that unrelated people
// who happen to share a /48 almost never feel it.
//
// The table of known visitors is bounded. Requests that are refused never add
// to it, so flooding an already-limited network cannot fill it. When it is
// full anyway, idle visitors are forgotten first; if it is still full,
// visitors that do not fit share an overflow budget, split into shards by
// network, so one network exhausts only its own shard and not everyone's.
type rateConfig struct {
	APIPerMin   int // aggregations per visitor per minute (0 = no limit)
	PagePerMin  int // other requests per visitor per minute (0 = no limit)
	IPJobs      int // aggregations running at once per visitor (0 = no limit)
	NetScale    int // a whole IPv6 /48 may use this many times one visitor's budget (0 = 50)
	DiagPerMin  int // Connection Quality probes per visitor per minute (0 = no limit)
	HeavyPerMin int // Connection Quality download/upload transfers per visitor per minute, one at a time (0 = no limit)
}

type bucket struct {
	tokens float64
	last   time.Time
}

// refill brings the bucket up to date; perMin and burst may be scaled.
func (b *bucket) refill(perMin, burst float64, now time.Time) {
	if b.last.IsZero() {
		b.tokens, b.last = burst, now
		return
	}
	if dt := now.Sub(b.last).Seconds(); dt > 0 {
		b.tokens = math.Min(burst, b.tokens+dt*perMin/60)
		b.last = now
	}
}

func (b *bucket) has() bool { return b.tokens >= 1 }

// wait: how long until one token is available.
func (b *bucket) wait(perMin float64) time.Duration {
	return time.Duration((1 - b.tokens) / (perMin / 60) * float64(time.Second))
}

type ipState struct {
	api, page   bucket
	diag, heavy bucket
	inflight    int
	heavyIn     int
	seen        time.Time
	scale       float64 // budgets are this many times a single visitor's
}

// keyScale names one budget a visitor is counted under.
type keyScale struct {
	key string
	net bool // true: a whole network (the /48), which gets the larger NetScale budget
}

type ipLimits struct {
	cfg        rateConfig
	apiBurst   float64
	pageBurst  float64
	diagBurst  float64
	heavyBurst float64
	netScale   float64
	mu         sync.Mutex
	m          map[string]*ipState
	overflow   [overflowShards]*ipState // shared budgets for visitors that do not fit in the table
	lastSweep  time.Time
	now        func() time.Time
	capacity   int // visitors remembered at once
	refused    atomic.Int64
}

const (
	maxTracked      = 200000           // visitors remembered at once
	idleForget      = 10 * time.Minute // a visitor idle this long is forgotten
	sweepEvery      = time.Minute      // normal housekeeping
	sweepWhenFull   = time.Second      // at most this often when the table is full
	defaultNetScale = 50               // a /48 network may use 50x a single visitor's budget
	scaleOverflow   = 20               // each overflow shard: 20x a single visitor's budget
	overflowShards  = 64               // overflow budgets, one per hashed network
	msgTooFast      = "Too many requests. Please wait a moment and try again."
	msgTooMany      = "You already have the maximum number of aggregations running. Please wait for one to finish."
	apiPath         = "/api/aggregate"
)

// newIPLimits returns nil when every limit is off.
func newIPLimits(cfg rateConfig) *ipLimits {
	if cfg.APIPerMin <= 0 && cfg.PagePerMin <= 0 && cfg.IPJobs <= 0 && cfg.DiagPerMin <= 0 && cfg.HeavyPerMin <= 0 {
		return nil
	}
	ns := float64(cfg.NetScale)
	if cfg.NetScale <= 0 {
		ns = defaultNetScale
	}
	l := &ipLimits{
		cfg:        cfg,
		apiBurst:   math.Max(5, float64(cfg.APIPerMin)/3),
		pageBurst:  math.Max(20, float64(cfg.PagePerMin)/3),
		diagBurst:  math.Max(30, float64(cfg.DiagPerMin)/3),
		heavyBurst: math.Max(3, float64(cfg.HeavyPerMin)/2),
		netScale:   ns,
		m:          make(map[string]*ipState),
		now:        time.Now,
		capacity:   maxTracked,
	}
	for i := range l.overflow {
		l.overflow[i] = &ipState{scale: scaleOverflow}
	}
	return l
}

// limitKeys: what to count a visitor under. IPv4: the address. IPv6: the /64
// and the /48 it sits in.
func limitKeys(ip string) []keyScale {
	a, err := netip.ParseAddr(ip)
	if err != nil {
		return []keyScale{{ip, false}}
	}
	a = a.Unmap()
	if a.Is6() {
		return []keyScale{
			{netip.PrefixFrom(a, 64).Masked().String(), false},
			{netip.PrefixFrom(a, 48).Masked().String(), true},
		}
	}
	return []keyScale{{a.String(), false}}
}

// limitKey is the main key only (used by tests).
func limitKey(ip string) string { return limitKeys(ip)[0].key }

// shardOf picks the overflow budget for a key by its wider network
// (IPv6 /32, IPv4 /16): one network shares one shard.
func shardOf(key string) int {
	network := key
	if p, err := netip.ParsePrefix(key); err == nil {
		network = netip.PrefixFrom(p.Addr(), 32).Masked().String()
	} else if a, err := netip.ParseAddr(key); err == nil {
		bits := 32
		if a.Is4() {
			bits = 16
		}
		network = netip.PrefixFrom(a, bits).Masked().String()
	}
	h := fnv.New32a()
	h.Write([]byte(network))
	return int(h.Sum32() % overflowShards)
}

// sweep forgets visitors that have been idle (caller holds the lock).
func (l *ipLimits) sweep(now time.Time) {
	for k, s := range l.m {
		if s.inflight == 0 && now.Sub(s.seen) > idleForget {
			delete(l.m, k)
		}
	}
	l.lastSweep = now
}

// admitKey is admit for a single plain key.
func (l *ipLimits) admitKey(key string, isAPI bool) (bool, time.Duration, string, func()) {
	return l.admit([]keyScale{{key, false}}, isAPI)
}

// the kinds of request that have their own budget
const (
	clsPage = iota
	clsAPI
	clsDiag  // Connection Quality probes
	clsHeavy // Connection Quality transfers (also limited to one at a time)
)

func (l *ipLimits) admit(keys []keyScale, isAPI bool) (ok bool, retry time.Duration, msg string, release func()) {
	if isAPI {
		return l.admitClass(keys, clsAPI)
	}
	return l.admitClass(keys, clsPage)
}

type target struct {
	key   string
	s     *ipState
	fresh bool // not in the table yet: inserted only if the request is admitted
}

// admit decides about one request. On success release (maybe nil) must be called when it ends.
// Every budget that applies must have room; only then is anything used up or remembered.
func (l *ipLimits) admitClass(keys []keyScale, class int) (ok bool, retry time.Duration, msg string, release func()) {
	useBucket := l.cfg.PagePerMin > 0
	useJobs := false
	perMin, burst := float64(l.cfg.PagePerMin), l.pageBurst
	bucketOf := func(s *ipState) *bucket { return &s.page }
	inflightOf := func(s *ipState) *int { return &s.inflight }
	jobsLimit := 0.0
	tooMany := msgTooMany
	switch class {
	case clsAPI:
		useBucket, useJobs = l.cfg.APIPerMin > 0, l.cfg.IPJobs > 0
		perMin, burst = float64(l.cfg.APIPerMin), l.apiBurst
		bucketOf = func(s *ipState) *bucket { return &s.api }
		jobsLimit = float64(l.cfg.IPJobs)
	case clsDiag:
		useBucket = l.cfg.DiagPerMin > 0
		perMin, burst = float64(l.cfg.DiagPerMin), l.diagBurst
		bucketOf = func(s *ipState) *bucket { return &s.diag }
	case clsHeavy:
		useBucket, useJobs = l.cfg.HeavyPerMin > 0, l.cfg.HeavyPerMin > 0
		perMin, burst = float64(l.cfg.HeavyPerMin), l.heavyBurst
		bucketOf = func(s *ipState) *bucket { return &s.heavy }
		inflightOf = func(s *ipState) *int { return &s.heavyIn }
		jobsLimit = 1
		tooMany = "A speed-test transfer is already running. Please wait for it to finish."
	}
	if !useBucket && !useJobs {
		return true, 0, "", nil // no limit applies: do not even remember the visitor
	}

	now := l.now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.lastSweep) > sweepEvery {
		l.sweep(now)
	}

	// Work out which budgets this request would be charged to, without touching the table.
	var targets []target
	seen := map[*ipState]bool{}
	fresh := 0
	for _, ks := range keys {
		s := l.m[ks.key]
		isFresh := false
		if s == nil {
			if len(l.m)+fresh >= l.capacity && now.Sub(l.lastSweep) >= sweepWhenFull {
				l.sweep(now) // make room by forgetting idle visitors
			}
			if len(l.m)+fresh >= l.capacity {
				s = l.overflow[shardOf(ks.key)]
			} else {
				scale := 1.0
				if ks.net {
					scale = l.netScale
				}
				s, isFresh = &ipState{scale: scale}, true
				fresh++
			}
		}
		if !seen[s] { // two keys can land on the same shared entry: charge it once
			seen[s] = true
			targets = append(targets, target{ks.key, s, isFresh})
		}
	}

	// 1. is there room everywhere? A refusal changes nothing and remembers nobody.
	if useBucket {
		for _, t := range targets {
			b := bucketOf(t.s)
			b.refill(perMin*t.s.scale, burst*t.s.scale, now)
			if !b.has() {
				return false, b.wait(perMin * t.s.scale), msgTooFast, nil
			}
		}
	}
	if useJobs {
		for _, t := range targets {
			if float64(*inflightOf(t.s)) >= math.Ceil(jobsLimit*t.s.scale) {
				return false, 2 * time.Second, tooMany, nil
			}
		}
	}
	// 2. admitted: remember new visitors, use up the budgets
	states := make([]*ipState, 0, len(targets))
	for _, t := range targets {
		if t.fresh {
			l.m[t.key] = t.s
		}
		t.s.seen = now
		if useBucket {
			bucketOf(t.s).tokens--
		}
		states = append(states, t.s)
	}
	if !useJobs {
		return true, 0, "", nil
	}
	for _, s := range states {
		*inflightOf(s)++
	}
	return true, 0, "", func() {
		l.mu.Lock()
		for _, s := range states {
			*inflightOf(s)--
		}
		l.mu.Unlock()
	}
}

func (l *ipLimits) middleware(ips *ipResolver, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		class := clsPage
		switch {
		case r.Method == http.MethodPost && r.URL.Path == apiPath:
			class = clsAPI
		case r.URL.Path == "/api/ping" || r.URL.Path == "/api/seen" || r.URL.Path == "/api/monitor" || r.URL.Path == "/api/facts" || r.URL.Path == "/api/hold" || r.URL.Path == "/edge-probe.txt":
			class = clsDiag
		case r.URL.Path == "/api/download" || r.URL.Path == "/api/upload":
			class = clsHeavy
		}
		ok, wait, msg, release := l.admitClass(limitKeys(ips.IP(r)), class)
		if !ok {
			l.refused.Add(1)
			secs := int(math.Ceil(wait.Seconds()))
			if secs < 1 {
				secs = 1
			}
			w.Header().Set("Retry-After", strconv.Itoa(secs))
			w.Header().Set("Cache-Control", "no-store")
			http.Error(w, msg, http.StatusTooManyRequests)
			return
		}
		if release != nil {
			defer release()
		}
		next.ServeHTTP(w, r)
	})
}

// takeRefused returns how many requests were refused since the last call (a count only, no addresses).
func (l *ipLimits) takeRefused() int64 { return l.refused.Swap(0) }
