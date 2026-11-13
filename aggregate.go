package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math/bits"
	"net/netip"
	"slices"
)

// ---------------------------------------------------------------------------
// 128-bit helper (IPv6)
// ---------------------------------------------------------------------------

type u128 struct{ hi, lo uint64 }

var max128 = u128{^uint64(0), ^uint64(0)}

func (a u128) cmp(b u128) int {
	switch {
	case a.hi < b.hi:
		return -1
	case a.hi > b.hi:
		return 1
	case a.lo < b.lo:
		return -1
	case a.lo > b.lo:
		return 1
	}
	return 0
}

func (a u128) sub(b u128) u128 {
	lo, borrow := bits.Sub64(a.lo, b.lo, 0)
	hi, _ := bits.Sub64(a.hi, b.hi, borrow)
	return u128{hi, lo}
}

// add1 returns a+1 (wraps at max).
func (a u128) add1() u128 {
	lo, c := bits.Add64(a.lo, 1, 0)
	hi, _ := bits.Add64(a.hi, 0, c)
	return u128{hi, lo}
}

// addPow2 returns a+2^n and whether it overflowed past 2^128-1.
func (a u128) addPow2(n int) (u128, bool) {
	if n >= 128 {
		return a, true
	}
	var add u128
	if n >= 64 {
		add.hi = 1 << (n - 64)
	} else {
		add.lo = 1 << n
	}
	lo, c := bits.Add64(a.lo, add.lo, 0)
	hi, c2 := bits.Add64(a.hi, add.hi, c)
	return u128{hi, lo}, c2 != 0
}

func (a u128) trailingZeros() int {
	if a.lo != 0 {
		return bits.TrailingZeros64(a.lo)
	}
	if a.hi != 0 {
		return 64 + bits.TrailingZeros64(a.hi)
	}
	return 128
}

func (a u128) bitLen() int {
	if a.hi != 0 {
		return 64 + bits.Len64(a.hi)
	}
	return bits.Len64(a.lo)
}

func (a u128) addr() netip.Addr {
	var b [16]byte
	binary.BigEndian.PutUint64(b[:8], a.hi)
	binary.BigEndian.PutUint64(b[8:], a.lo)
	return netip.AddrFrom16(b)
}

func fromAddr(a netip.Addr) u128 {
	b := a.As16()
	return u128{binary.BigEndian.Uint64(b[:8]), binary.BigEndian.Uint64(b[8:])}
}

// prefixMask returns the network mask for an IPv6 prefix length (0..128).
func prefixMask(plen int) u128 {
	switch {
	case plen <= 0:
		return u128{}
	case plen >= 128:
		return max128
	case plen <= 64:
		return u128{^uint64(0) << (64 - plen), 0}
	default:
		return u128{^uint64(0), ^uint64(0) << (128 - plen)}
	}
}

type range6 struct{ start, end u128 }

// ---------------------------------------------------------------------------
// Collector: extracts every IP / subnet found in arbitrary text.
// ---------------------------------------------------------------------------

const maxInvalidSamples = 10

// Memory is bounded by the number of SEPARATE ranges, not by the number of addresses read. Text such as "::1" repeated twelve million times is 4 bytes
// of input per address but 32 bytes held per address, so without merging on the way one 50 MB request needed more than 1 GB. The collected ranges are
// therefore sorted and merged whenever compactMin of them are waiting (and again when they have doubled since), and the input is refused when more than
// maxRanges4 / maxRanges6 separate ranges remain after merging: far above any real list (the whole public IPv4 routing table is about 1 million
// prefixes, the IPv6 one about a quarter of a million). They are variables only so that tests can use small numbers.
var (
	compactMin = 1 << 20
	maxRanges4 = 2 << 20
	maxRanges6 = 1 << 20
)

// errTooManyRanges: the input holds more separate ranges than maxRanges4 / maxRanges6 (see above).
var errTooManyRanges = errors.New("too many separate address ranges")

const msgTooManyRanges = "Too many separate address ranges: after merging, more than about 2 million IPv4 or 1 million IPv6 ranges are left. Split the list into smaller parts."

type Collector struct {
	v4             []uint64 // start<<32 | end
	v6             []range6
	Found4         int
	Found6         int
	Invalid        int
	InvalidSamples []string
	Bytes          int64

	at4, at6 int   // merge the list again when it has this many entries (0 = compactMin)
	err      error // errTooManyRanges once a limit was passed: reading stops
}

// mergeV4 sorts the ranges and joins those that overlap or touch, in place. Merging early gives the same final answer as merging at the end.
func mergeV4(l []uint64) []uint64 {
	if len(l) < 2 {
		return l
	}
	slices.Sort(l)
	out := l[:1]
	curS, curE := uint32(l[0]>>32), uint32(l[0])
	for _, v := range l[1:] { // out never gets ahead of the element being read, so writing into l is safe
		s, e := uint32(v>>32), uint32(v)
		if uint64(s) <= uint64(curE)+1 {
			if e > curE {
				curE = e
			}
			continue
		}
		out[len(out)-1] = uint64(curS)<<32 | uint64(curE)
		out = append(out, v)
		curS, curE = s, e
	}
	out[len(out)-1] = uint64(curS)<<32 | uint64(curE)
	return out
}

func mergeV6(l []range6) []range6 {
	if len(l) < 2 {
		return l
	}
	slices.SortFunc(l, func(a, b range6) int {
		if r := a.start.cmp(b.start); r != 0 {
			return r
		}
		return a.end.cmp(b.end)
	})
	out := l[:1]
	cur := l[0]
	for _, r := range l[1:] {
		if cur.end == max128 || r.start.cmp(cur.end.add1()) <= 0 {
			if r.end.cmp(cur.end) > 0 {
				cur.end = r.end
			}
			continue
		}
		out[len(out)-1] = cur
		out = append(out, r)
		cur = r
	}
	out[len(out)-1] = cur
	return out
}

func (c *Collector) settle4() {
	c.v4 = mergeV4(c.v4)
	if len(c.v4) > maxRanges4 {
		c.err = errTooManyRanges
	}
	c.at4 = 2 * len(c.v4)
}

func (c *Collector) settle6() {
	c.v6 = mergeV6(c.v6)
	if len(c.v6) > maxRanges6 {
		c.err = errTooManyRanges
	}
	c.at6 = 2 * len(c.v6)
}

// settle merges everything collected and reports whether the input stayed within the limits.
func (c *Collector) settle() error {
	c.settle4()
	c.settle6()
	return c.err
}

// isRun reports whether c can be part of an IP-looking token.
func isRun(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F' ||
		c == '.' || c == ':' || c == '/'
}

// Feed reads r in chunks and collects every IPv4/IPv6 address or subnet it
// finds. All other text is ignored. Memory use is bounded by the number of
// addresses found, not by the input size.
func (c *Collector) Feed(r io.Reader) error {
	buf := make([]byte, 4<<20)
	have := 0
	for {
		n, err := r.Read(buf[have:])
		have += n
		c.Bytes += int64(n)
		eof := err == io.EOF
		if err != nil && !eof {
			return err
		}
		end := have
		if !eof {
			// hold back a trailing token that may continue in the next chunk
			i := have
			for i > 0 && isRun(buf[i-1]) {
				i--
			}
			if !(i == 0 && have == len(buf)) {
				end = i
			}
		}
		c.scan(buf[:end])
		if c.err != nil {
			return c.err
		}
		have = copy(buf, buf[end:have])
		if eof {
			return c.settle()
		}
	}
}

// FeedBytes is a convenience for tests and small inputs.
func (c *Collector) FeedBytes(b []byte) { c.Bytes += int64(len(b)); c.scan(b) }

func (c *Collector) scan(b []byte) {
	i, n := 0, len(b)
	for i < n {
		if c.err != nil {
			return // over the limit: the rest is not read
		}
		if !isRun(b[i]) {
			i++
			continue
		}
		j := i + 1
		for j < n && isRun(b[j]) {
			j++
		}
		c.processRun(b[i:j])
		i = j
	}
}

func (c *Collector) processRun(run []byte) {
	hasDot := bytes.IndexByte(run, '.') >= 0
	hasColon := bytes.IndexByte(run, ':') >= 0
	switch {
	case hasColon:
		if c.tryV6(run) {
			return
		}
		if hasDot {
			// things like "1.2.3.4:80" or "ip:1.2.3.4"
			for _, seg := range bytes.Split(run, []byte{':'}) {
				if bytes.IndexByte(seg, '.') >= 0 {
					c.tryV4(seg)
				}
			}
		}
	case hasDot:
		c.tryV4(run)
	}
}

func (c *Collector) addInvalid(tok []byte) {
	c.Invalid++
	if len(c.InvalidSamples) < maxInvalidSamples {
		c.InvalidSamples = append(c.InvalidSamples, string(tok))
	}
}

// tryV4 parses a token such as 10.0.0.0/8 or 10.1.2.3. Host bits are masked.
func (c *Collector) tryV4(tok []byte) {
	// trim junk around the token
	for len(tok) > 0 && (tok[0] < '0' || tok[0] > '9') {
		tok = tok[1:]
	}
	for len(tok) > 0 {
		l := tok[len(tok)-1]
		if l == '.' || l == ':' || l == '/' {
			tok = tok[:len(tok)-1]
		} else {
			break
		}
	}
	if bytes.Count(tok, []byte{'.'}) < 3 {
		return // not IPv4-shaped (version, date, number, ...)
	}
	ip, plen, ok := parseV4(tok)
	if !ok {
		c.addInvalid(tok)
		return
	}
	var mask uint32
	if plen > 0 {
		mask = ^uint32(0) << (32 - plen)
	}
	start := ip & mask
	end := start | ^mask
	c.v4 = append(c.v4, uint64(start)<<32|uint64(end))
	c.Found4++
	if len(c.v4) >= max(c.at4, compactMin) {
		c.settle4()
	}
}

func parseV4(tok []byte) (ip uint32, plen int, ok bool) {
	plen = 32
	pos := 0
	for oct := 0; oct < 4; oct++ {
		if oct > 0 {
			if pos >= len(tok) || tok[pos] != '.' {
				return 0, 0, false
			}
			pos++
		}
		start := pos
		v := 0
		for pos < len(tok) && tok[pos] >= '0' && tok[pos] <= '9' && pos-start < 3 {
			v = v*10 + int(tok[pos]-'0')
			pos++
		}
		if pos == start || v > 255 {
			return 0, 0, false
		}
		ip = ip<<8 | uint32(v)
	}
	if pos == len(tok) {
		return ip, plen, true
	}
	if tok[pos] != '/' {
		return 0, 0, false
	}
	pos++
	start := pos
	v := 0
	for pos < len(tok) && tok[pos] >= '0' && tok[pos] <= '9' && pos-start < 2 {
		v = v*10 + int(tok[pos]-'0')
		pos++
	}
	if pos == start || pos != len(tok) || v > 32 {
		return 0, 0, false
	}
	return ip, v, true
}

// tryV6 parses an IPv6 address or prefix. Returns false if tok is not IPv6.
func (c *Collector) tryV6(tok []byte) bool {
	hasDigit := false
	for _, ch := range tok {
		if ch >= '0' && ch <= '9' {
			hasDigit = true
			break
		}
	}
	if !hasDigit && bytes.Count(tok, []byte{':'}) < 3 {
		return false // avoids matching C++ "std::" style text
	}
	for len(tok) > 0 && tok[len(tok)-1] == '.' {
		tok = tok[:len(tok)-1]
	}
	for attempt := 0; attempt < 2; attempt++ {
		addrPart, plen := tok, 128
		if k := bytes.IndexByte(tok, '/'); k >= 0 {
			addrPart = tok[:k]
			p := tok[k+1:]
			if len(p) == 0 || len(p) > 3 {
				return false
			}
			v := 0
			for _, ch := range p {
				if ch < '0' || ch > '9' {
					return false
				}
				v = v*10 + int(ch-'0')
			}
			if v > 128 {
				return false
			}
			plen = v
		}
		if a, err := netip.ParseAddr(string(addrPart)); err == nil && a.Is6() && !a.Is4In6() && a.Zone() == "" {
			ip := fromAddr(a)
			m := prefixMask(plen)
			start := u128{ip.hi & m.hi, ip.lo & m.lo}
			end := u128{start.hi | ^m.hi, start.lo | ^m.lo}
			c.v6 = append(c.v6, range6{start, end})
			c.Found6++
			if len(c.v6) >= max(c.at6, compactMin) {
				c.settle6()
			}
			return true
		}
		// "ip:2001:db8::1" -> strip one leading ':' (not "::") and retry once
		if attempt == 0 && len(tok) > 1 && tok[0] == ':' && tok[1] != ':' {
			tok = tok[1:]
			continue
		}
		return false
	}
	return false
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

// Result returns the minimal sorted CIDR lists for IPv4 and IPv6.
func (c *Collector) Result() (v4, v6 []string) {
	return c.result4(), c.result6()
}

func (c *Collector) result4() []string {
	c.v4 = mergeV4(c.v4)
	if len(c.v4) == 0 {
		return nil
	}
	out := make([]string, 0, len(c.v4)/2+1)
	emit := func(s, e uint32) {
		cur := uint64(s)
		end := uint64(e)
		for {
			size := bits.TrailingZeros64(cur)
			if size > 32 {
				size = 32
			}
			maxbits := bits.Len64(end-cur+1) - 1
			if size > maxbits {
				size = maxbits
			}
			out = append(out, fmtV4(uint32(cur), 32-size))
			cur += 1 << size
			if cur > end {
				return
			}
		}
	}
	for _, v := range c.v4 { // already merged: disjoint and not touching
		emit(uint32(v>>32), uint32(v))
	}
	return out
}

func fmtV4(ip uint32, plen int) string {
	var b [18]byte
	buf := b[:0]
	buf = appendInt(buf, int(ip>>24))
	buf = append(buf, '.')
	buf = appendInt(buf, int(ip>>16&255))
	buf = append(buf, '.')
	buf = appendInt(buf, int(ip>>8&255))
	buf = append(buf, '.')
	buf = appendInt(buf, int(ip&255))
	buf = append(buf, '/')
	buf = appendInt(buf, plen)
	return string(buf)
}

func appendInt(b []byte, v int) []byte {
	if v >= 100 {
		b = append(b, byte('0'+v/100))
	}
	if v >= 10 {
		b = append(b, byte('0'+v/10%10))
	}
	return append(b, byte('0'+v%10))
}

func (c *Collector) result6() []string {
	c.v6 = mergeV6(c.v6)
	if len(c.v6) == 0 {
		return nil
	}
	var out []string
	emit := func(s, e u128) {
		cur := s
		for {
			size := cur.trailingZeros()
			d := e.sub(cur)
			var maxbits int
			if d == max128 {
				maxbits = 128
			} else {
				maxbits = d.add1().bitLen() - 1
			}
			if size > maxbits {
				size = maxbits
			}
			out = append(out, netip.PrefixFrom(cur.addr(), 128-size).String())
			next, carry := cur.addPow2(size)
			if carry || next.cmp(e) > 0 {
				return
			}
			cur = next
		}
	}
	for _, r := range c.v6 { // already merged: disjoint and not touching
		emit(r.start, r.end)
	}
	return out
}
