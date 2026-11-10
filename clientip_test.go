package main

import (
	"net/http/httptest"
	"testing"
)

func resolve(t *testing.T, header, trusted, remote string, hdr map[string]string) string {
	t.Helper()
	rv, err := newIPResolver(header, trusted)
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = remote
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	return rv.IP(r)
}

func TestCloudflareTunnelSetup(t *testing.T) {
	cf := func(remote string, v string) string {
		return resolve(t, "CF-Connecting-IP", "", remote, map[string]string{"CF-Connecting-IP": v})
	}
	cases := []struct{ name, got, want string }{
		{"tunnel on this machine (IPv4 loopback)", cf("127.0.0.1:40000", "198.51.100.23"), "198.51.100.23"},
		{"tunnel on this machine (IPv6 loopback)", cf("[::1]:40000", "198.51.100.23"), "198.51.100.23"},
		{"visitor on IPv6", cf("127.0.0.1:40000", "2001:db8::77"), "2001:db8::77"},
		{"someone on the LAN sending the header directly is NOT believed", cf("192.168.1.50:51000", "8.8.8.8"), "192.168.1.50"},
		{"someone on the internet sending the header directly is NOT believed", cf("203.0.113.9:51000", "8.8.8.8"), "203.0.113.9"},
		{"header absent: connection address", resolve(t, "CF-Connecting-IP", "", "127.0.0.1:1", nil), "127.0.0.1"},
		{"garbage header ignored", cf("127.0.0.1:1", "<script>"), "127.0.0.1"},
		{"no header configured: always the connection", resolve(t, "", "", "127.0.0.1:1", map[string]string{"CF-Connecting-IP": "8.8.8.8"}), "127.0.0.1"},
	}
	for _, c := range cases {
		if c.got != c.want {
			t.Errorf("%s: got %q want %q", c.name, c.got, c.want)
		}
	}
}

func TestTrustedProxyList(t *testing.T) {
	hdr := map[string]string{"X-Forwarded-For": "198.51.100.23"}
	if got := resolve(t, "X-Forwarded-For", "10.0.0.0/8, 172.16.5.5", "10.1.2.3:1", hdr); got != "198.51.100.23" {
		t.Errorf("CIDR in list: %q", got)
	}
	if got := resolve(t, "X-Forwarded-For", "10.0.0.0/8, 172.16.5.5", "172.16.5.5:1", hdr); got != "198.51.100.23" {
		t.Errorf("single address in list: %q", got)
	}
	if got := resolve(t, "X-Forwarded-For", "10.0.0.0/8", "127.0.0.1:1", hdr); got != "127.0.0.1" {
		t.Errorf("a custom list replaces the default, loopback no longer trusted: %q", got)
	}
	if got := resolve(t, "X-Forwarded-For", "10.0.0.0/8", "[::ffff:10.1.2.3]:1", hdr); got != "198.51.100.23" {
		t.Errorf("v4-mapped peer: %q", got)
	}
	if _, err := newIPResolver("X-Forwarded-For", "not-a-cidr"); err == nil {
		t.Error("bad trusted proxy must be rejected at startup")
	}
}

func TestNilResolverUsesConnection(t *testing.T) {
	var rv *ipResolver
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "[2001:db8::5]:99"
	r.Header.Set("CF-Connecting-IP", "8.8.8.8")
	if got := rv.IP(r); got != "2001:db8::5" {
		t.Errorf("got %q", got)
	}
}
