package main

import (
	"errors"
	"fmt"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"testing/iotest"
)

func agg(t *testing.T, in string) (v4, v6 []string, c *Collector) {
	t.Helper()
	c = &Collector{}
	if err := c.Feed(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}
	v4, v6 = c.Result()
	return
}

func TestUserExample(t *testing.T) {
	v4, _, _ := agg(t, "172.16.20.0/24 172.16.0.0/16\n172.16.2.3\n172.16.200.4/32\n")
	if want := []string{"172.16.0.0/16"}; !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v want %v", v4, want)
	}
}

func TestBGPNoise(t *testing.T) {
	in := `  216.238.188.0/23     4608 7575 16509      + Announce - aggregate of 216.238.188.0/24 (4608 7575 16509) and 216.238.189.0/24 (4608 7575 16509)
  216.238.188.0/24     4608 7575 16509      - Withdrawn - aggregated with 216.238.189.0/24 (4608 7575 16509)
  216.244.0.0/24       4608 7575 16509
  216.244.1.0/24       4777 2516 16509
  216.244.2.0/24       4608 7575 16509
  216.244.3.0/24       4777 2516 16509
  220.36.0.0/15        4777 2516 6453 16509 + Announce - aggregate of 220.36.0.0/16 (4777) and 220.37.0.0/16 (4777)
`
	v4, _, c := agg(t, in)
	want := []string{"216.238.188.0/23", "216.244.0.0/22", "220.36.0.0/15"}
	if !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v want %v", v4, want)
	}
	if c.Invalid != 0 {
		t.Fatalf("unexpected invalid: %v", c.InvalidSamples)
	}
}

func TestAdjacentAndUnaligned(t *testing.T) {
	v4, _, _ := agg(t, "10.0.0.0/25 10.0.0.128/25 10.0.1.128/25 10.0.2.0/24")
	want := []string{"10.0.0.0/24", "10.0.1.128/25", "10.0.2.0/24"}
	if !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v want %v", v4, want)
	}
	// range that does not align to one CIDR
	v4, _, _ = agg(t, "10.0.0.128/25 10.0.1.0/24")
	want = []string{"10.0.0.128/25", "10.0.1.0/24"}
	if !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v want %v", v4, want)
	}
}

func TestEdges(t *testing.T) {
	v4, _, _ := agg(t, "0.0.0.0/0 1.2.3.4")
	if want := []string{"0.0.0.0/0"}; !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v", v4)
	}
	v4, _, _ = agg(t, "255.255.255.255 255.255.255.254")
	if want := []string{"255.255.255.254/31"}; !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v", v4)
	}
	// host bits set -> masked
	v4, _, _ = agg(t, "10.1.2.3/24")
	if want := []string{"10.1.2.0/24"}; !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v", v4)
	}
	// leading zeros ok
	v4, _, _ = agg(t, "010.001.001.001")
	if want := []string{"10.1.1.1/32"}; !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v", v4)
	}
}

func TestSeparatorsAndPunctuation(t *testing.T) {
	v4, _, _ := agg(t, "a=1.1.1.1,2.2.2.2;(3.3.3.3) [4.4.4.4]:80 5.5.5.5. ip:6.6.6.6 \"7.7.7.7/32\"")
	want := []string{"1.1.1.1/32", "2.2.2.2/32", "3.3.3.3/32", "4.4.4.4/32", "5.5.5.5/32", "6.6.6.6/32", "7.7.7.7/32"}
	if !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v", v4)
	}
}

func TestInvalidAndNoise(t *testing.T) {
	v4, _, c := agg(t, "999.1.1.1 1.2.3.4/33 4777 2516 3.14 2024.01.15 e.g. 1.2.3.4")
	if want := []string{"1.2.3.4/32"}; !reflect.DeepEqual(v4, want) {
		t.Fatalf("got %v", v4)
	}
	if c.Invalid != 2 {
		t.Fatalf("invalid=%d samples=%v", c.Invalid, c.InvalidSamples)
	}
}

func TestIPv6(t *testing.T) {
	_, v6, _ := agg(t, "2001:db8::/32 2001:db8:1::1 [2001:db8:ffff::5]:443 2001:db9::/33 2001:db9:8000::/33 std::vector 12:30:45")
	want := []string{"2001:db8::/31"}
	if !reflect.DeepEqual(v6, want) {
		t.Fatalf("got %v", v6)
	}
	_, v6, _ = agg(t, "::/0 2001:db8::1")
	if want := []string{"::/0"}; !reflect.DeepEqual(v6, want) {
		t.Fatalf("got %v", v6)
	}
	_, v6, _ = agg(t, "ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")
	if want := []string{"ffff:ffff:ffff:ffff:ffff:ffff:ffff:fffe/127"}; !reflect.DeepEqual(v6, want) {
		t.Fatalf("got %v", v6)
	}
}

func TestMixedAndCounts(t *testing.T) {
	v4, v6, c := agg(t, "10.0.0.1 10.0.0.1 2001:db8::1")
	if len(v4) != 1 || len(v6) != 1 || c.Found4 != 2 || c.Found6 != 1 {
		t.Fatalf("v4=%v v6=%v c=%+v", v4, v6, c)
	}
}

// Tokens split across read boundaries must still be found.
func TestChunkBoundaries(t *testing.T) {
	in := "x 192.168.10.0/24 y 192.168.11.0/24 z 2001:db8::/32\n"
	c := &Collector{}
	if err := c.Feed(iotest.OneByteReader(strings.NewReader(in))); err != nil {
		t.Fatal(err)
	}
	v4, v6 := c.Result()
	if !reflect.DeepEqual(v4, []string{"192.168.10.0/23"}) || !reflect.DeepEqual(v6, []string{"2001:db8::/32"}) {
		t.Fatalf("v4=%v v6=%v", v4, v6)
	}
}

func TestEmpty(t *testing.T) {
	v4, v6, c := agg(t, "")
	if len(v4) != 0 || len(v6) != 0 || c.Found4 != 0 {
		t.Fatal("expected nothing")
	}
}

func BenchmarkMillion(b *testing.B) {
	var sb strings.Builder
	for i := 0; i < 1_000_000; i++ {
		sb.WriteString("  ")
		sb.WriteString(fmtV4(uint32(i)*4096+0x0A000000, 24))
		sb.WriteString("   4777 2516 6453 16509\n")
	}
	in := sb.String()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		c := &Collector{}
		_ = c.Feed(strings.NewReader(in))
		c.Result()
	}
}

// ---- memory is bounded by the number of SEPARATE ranges (see the comment above compactMin) ----

// withLimits runs a test with small merge/limit numbers and puts the real ones back afterwards.
func withLimits(t *testing.T, compact, max4, max6 int) {
	t.Helper()
	c, m4, m6 := compactMin, maxRanges4, maxRanges6
	compactMin, maxRanges4, maxRanges6 = compact, max4, max6
	t.Cleanup(func() { compactMin, maxRanges4, maxRanges6 = c, m4, m6 })
}

func randomAddressText(rnd *rand.Rand, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		switch rnd.Intn(4) {
		case 0:
			fmt.Fprintf(&b, "10.0.%d.%d/%d", rnd.Intn(4), rnd.Intn(256), []int{22, 23, 24, 25, 26, 32}[rnd.Intn(6)])
		case 1:
			fmt.Fprintf(&b, "10.0.%d.%d", rnd.Intn(4), rnd.Intn(256))
		case 2:
			fmt.Fprintf(&b, "2001:db8::%x/%d", rnd.Intn(1024), []int{118, 120, 124, 126, 128}[rnd.Intn(5)])
		default:
			fmt.Fprintf(&b, "2001:db8:0:%x::%x", rnd.Intn(3), rnd.Intn(64))
		}
		b.WriteString([]string{" ", "\n", ", "}[rnd.Intn(3)])
	}
	return b.String()
}

func TestMergingEarlyGivesTheSameAnswer(t *testing.T) {
	rnd := rand.New(rand.NewSource(7))
	for round := 0; round < 200; round++ {
		in := randomAddressText(rnd, 1+rnd.Intn(400))
		wantV4, wantV6, want := agg(t, in) // merged only at the end (default limits: nothing reaches a million)
		func() {
			withLimits(t, 1+rnd.Intn(6), 1<<20, 1<<20) // merged every few addresses
			gotV4, gotV6, got := agg(t, in)
			if !reflect.DeepEqual(gotV4, wantV4) || !reflect.DeepEqual(gotV6, wantV6) {
				t.Fatalf("round %d: early merging changed the answer for %q\n got %v %v\nwant %v %v", round, in, gotV4, gotV6, wantV4, wantV6)
			}
			if got.Found4 != want.Found4 || got.Found6 != want.Found6 || got.Invalid != want.Invalid {
				t.Fatalf("round %d: the counts changed: %d/%d/%d instead of %d/%d/%d", round, got.Found4, got.Found6, got.Invalid, want.Found4, want.Found6, want.Invalid)
			}
		}()
	}
}

func TestTooManySeparateRangesAreRefused(t *testing.T) {
	withLimits(t, 4, 10, 10)
	var v4, v6 strings.Builder
	for i := 0; i < 50; i++ {
		fmt.Fprintf(&v4, "10.0.%d.0/24 ", i*2) // every other /24: never touching, so they cannot merge
		fmt.Fprintf(&v6, "2001:db8:%x::/48 ", i*2)
	}
	for name, in := range map[string]string{"IPv4": v4.String(), "IPv6": v6.String()} {
		c := &Collector{}
		if err := c.Feed(strings.NewReader(in)); !errors.Is(err, errTooManyRanges) {
			t.Errorf("%s: want errTooManyRanges, got %v", name, err)
		}
	}
	// the same amount of text that DOES merge is fine
	var merged strings.Builder
	for i := 0; i < 500; i++ {
		fmt.Fprintf(&merged, "10.0.%d.%d 2001:db8::%x ", i/256, i%256, i)
	}
	if v4, v6, _ := agg(t, merged.String()); len(v4) == 0 || len(v6) == 0 { // agg fails the test itself on an error
		t.Errorf("text that merges into a few ranges must be accepted: %v %v", v4, v6)
	}
	// and the handler answers 413 with a sentence a person can act on
	h, _ := newHandler(testCfg())
	w := post(h, v4.String())
	if w.Code != 413 || !strings.Contains(w.Body.String(), "Split the list") {
		t.Errorf("handler: %d %q", w.Code, w.Body.String())
	}
}

func TestRepeatedAddressesDoNotPileUp(t *testing.T) {
	// 3 million "::1" lines (12 MB, 96 MB if every one were kept): the list must stay near compactMin, and the counts must still be exact.
	const n = 3_000_000
	c := &Collector{}
	if err := c.Feed(strings.NewReader(strings.Repeat("::1\n", n))); err != nil {
		t.Fatal(err)
	}
	if c.Found6 != n {
		t.Errorf("Found6 = %d, want %d", c.Found6, n)
	}
	if len(c.v6) != 1 || cap(c.v6) > 2*compactMin {
		t.Errorf("kept %d ranges in room for %d: the list was not merged on the way", len(c.v6), cap(c.v6))
	}
	if _, v6 := c.Result(); !reflect.DeepEqual(v6, []string{"::1/128"}) {
		t.Errorf("result %v", v6)
	}
}
