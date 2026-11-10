package main

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ipResolver finds the real address of a visitor.
//
// Behind a trusted proxy such as a Cloudflare Tunnel, every connection comes
// from the proxy itself and the visitor's own address is in a request header
// (CF-Connecting-IP, X-Forwarded-For, ...). That header is believed only when
// the connection really comes from a trusted proxy address (this machine, by
// default), so nobody can fake their address by sending the header directly.
type ipResolver struct {
	header  string
	trusted []netip.Prefix
}

const defaultTrustedProxies = "127.0.0.0/8,::1/128"

// newIPResolver: header "" means "never use a header, always the connection".
// trustedCSV is a comma-separated list of addresses or CIDRs; empty = this machine.
func newIPResolver(header, trustedCSV string) (*ipResolver, error) {
	if strings.TrimSpace(trustedCSV) == "" {
		trustedCSV = defaultTrustedProxies
	}
	rv := &ipResolver{header: strings.TrimSpace(header)}
	for _, part := range strings.Split(trustedCSV, ",") {
		p := strings.TrimSpace(part)
		if p == "" {
			continue
		}
		pfx, err := netip.ParsePrefix(p)
		if err != nil {
			a, err2 := netip.ParseAddr(p)
			if err2 != nil {
				return nil, fmt.Errorf("bad trusted proxy %q: want an address or CIDR", p)
			}
			pfx = netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen())
		}
		rv.trusted = append(rv.trusted, pfx)
	}
	return rv, nil
}

func (rv *ipResolver) isTrusted(a netip.Addr) bool {
	for _, p := range rv.trusted {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// IP returns the visitor's address as text. Safe to call on a nil resolver.
func (rv *ipResolver) IP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, perr := netip.ParseAddr(host)
	if perr == nil {
		peer = peer.Unmap()
	}
	if rv != nil && rv.header != "" && perr == nil && rv.isTrusted(peer) {
		if v := r.Header.Get(rv.header); v != "" {
			parts := strings.Split(v, ",")
			// the last value is the one our own proxy added
			if a, err := netip.ParseAddr(strings.TrimSpace(parts[len(parts)-1])); err == nil {
				return a.Unmap().String()
			}
		}
	}
	if perr == nil {
		return peer.String()
	}
	return host
}
