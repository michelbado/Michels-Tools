package main

// Connection Facts (tool id "connfacts") and the CDN-neutral edge probe.
//
// GET /api/facts      what this server saw of the request: the visitor's address, a clock reading, and a few headers a proxy or CDN may have added.
//                     Only an allow-list of headers is shown (never cookies or authorisation), values are cut short, and addresses that
//                     belong to the inside of the hosting setup (private, loopback) are hidden.
// GET /edge-probe.txt a tiny page that a CDN may keep in its cache. Every answer carries the moment it was made, so a page that gets the
//                     SAME moment twice knows that something between it and this server answered from a cache: that is the CDN edge,
//                     whichever company runs it. Without a CDN every answer is new and the page knows there is no edge.
//
// Nothing here executes a program, opens a raw socket or reads the TCP stack.

import (
	"encoding/json"
	"net/http"
	"net/netip"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// factHeaders: the request headers a proxy or CDN may add that are worth showing to the visitor, in the order they are listed.
var factHeaders = []string{
	"Via", "X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Port", "Forwarded", "X-Real-IP", "True-Client-IP",
	"CF-Ray", "CF-Visitor", "CF-Connecting-IP",
	"CloudFront-Forwarded-Proto", "Fastly-Client-IP",
}

const maxFactValue = 200

var addrLike = regexp.MustCompile(`[0-9A-Fa-f:.]{2,}`)

// hideInternal replaces addresses that are private, loopback or link-local by a plain word; other text is left alone.
func hideInternal(v string) string {
	return addrLike.ReplaceAllStringFunc(v, func(tok string) string {
		a, err := netip.ParseAddr(strings.Trim(tok, ":."))
		if err != nil {
			return tok
		}
		a = a.Unmap()
		if a.IsPrivate() || a.IsLoopback() || a.IsLinkLocalUnicast() || a.IsUnspecified() {
			return "[internal address]"
		}
		return tok
	})
}

func cleanFactValue(v string) string {
	var b strings.Builder
	for _, r := range v {
		if unicode.IsPrint(r) && r < 0x7f {
			b.WriteRune(r)
		} else {
			b.WriteByte('?')
		}
		if b.Len() >= maxFactValue {
			break
		}
	}
	return hideInternal(strings.TrimSpace(b.String()))
}

type factHeader struct {
	N string `json:"n"`
	V string `json:"v"`
}

// factsFor builds the answer for one request. ip is the visitor's address as the program resolved it.
func factsFor(r *http.Request, ip string, now time.Time) map[string]any {
	hs := []factHeader{}
	for _, name := range factHeaders {
		if v := r.Header.Get(name); v != "" {
			hs = append(hs, factHeader{name, cleanFactValue(v)})
		}
	}
	family := "unknown"
	if a, err := netip.ParseAddr(ip); err == nil {
		if a.Unmap().Is4() {
			family = "IPv4"
		} else {
			family = "IPv6"
		}
	}
	return map[string]any{"ip": ip, "family": family, "t": now.UnixMicro(), "headers": hs}
}

// edgeOff: the edge endpoints exist when at least one of the tools that use them is on.
func edgeOff(cfg config) bool {
	return cfg.Tools.appOff("netquality") && cfg.Tools.appOff("connfacts")
}

func registerFacts(mux *http.ServeMux, cfg config) {
	mux.HandleFunc("GET /api/facts", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Tools.appOff("connfacts") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(factsFor(r, diagIP(cfg, r), time.Now()))
	})
	mux.HandleFunc("GET /edge-probe.txt", func(w http.ResponseWriter, r *http.Request) {
		if edgeOff(cfg) {
			http.NotFound(w, r)
			return
		}
		// public: a CDN may keep it for a few minutes. The page checks for itself whether that happened.
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Write([]byte("edge-probe " + strconv.FormatInt(time.Now().UnixMicro(), 10) + "\n"))
	})
}
