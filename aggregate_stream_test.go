package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"testing"
)

// The streamed answer must be byte for byte what encoding the response struct gave before (so the page sees no difference).
func oldJSON(c *Collector) []byte {
	v4, v6 := c.Result()
	var b bytes.Buffer
	json.NewEncoder(&b).Encode(response{Found4: c.Found4, Found6: c.Found6, Invalid: c.Invalid, InvalidSamples: c.InvalidSamples, Bytes: c.Bytes, V4: v4, V6: v6})
	return b.Bytes()
}

func streamJSON(t *testing.T, in string) (got, want []byte) {
	t.Helper()
	c := &Collector{}
	if err := c.Feed(strings.NewReader(in)); err != nil {
		t.Fatal(err)
	}
	want = oldJSON(c) // Result() merges, so c is ready for the streaming walk too
	var b bytes.Buffer
	c.Merge()
	if err := c.WriteJSON(&b); err != nil {
		t.Fatal(err)
	}
	return b.Bytes(), want
}

func TestStreamedAnswerEqualsEncodedAnswer(t *testing.T) {
	cases := []string{
		"",                                // nothing: both lists null
		"10.0.0.0/8 10.1.0.0/16\n",        // IPv4 only: v6 is null
		"2001:db8::/32 2001:db8:1::/48\n", // IPv6 only: v4 is null
		"10.0.0.1 10.0.0.2 10.0.0.3 ::1 fe80::/10 192.168.0.0/16\n",
		"1.2.3.4 <b>not an address</b> & 999.1.1.1 \"quoted\"   tab\there ünï\n", // free text kept apart from the lists, escaped by the JSON package
		"1.0.0.1-1.255.255.254\n", // a range that needs many CIDRs
	}
	for i, in := range cases {
		got, want := streamJSON(t, in)
		if !bytes.Equal(got, want) {
			t.Errorf("case %d differs:\n got %s\nwant %s", i, got, want)
		}
	}
	rnd := rand.New(rand.NewSource(11))
	for i := 0; i < 300; i++ {
		got, want := streamJSON(t, randomAddressText(rnd, 1+rnd.Intn(400)))
		if !bytes.Equal(got, want) {
			t.Fatalf("random input %d differs:\n got %.300s\nwant %.300s", i, got, want)
		}
	}
	var one strings.Builder // many separate ranges
	for i := 0; i < 5000; i++ {
		fmt.Fprintf(&one, "%d.%d.%d.0/24\n", 1+i%200, (i/200)%250, i%250)
	}
	if got, want := streamJSON(t, one.String()); !bytes.Equal(got, want) {
		t.Fatal("a long list differs")
	}
}

// The point of streaming: writing a large answer takes memory for the ranges, not for the answer.
func TestStreamedAnswerDoesNotGrowWithTheAnswer(t *testing.T) {
	c := &Collector{}
	var in strings.Builder
	for i := 0; i < 200000; i++ { // 200,000 separate /32 hosts, far apart
		fmt.Fprintf(&in, "%d.%d.%d.%d\n", 1+i%220, (i/220)%250, (i/7)%250, (i*13)%250)
	}
	if err := c.Feed(strings.NewReader(in.String())); err != nil {
		t.Fatal(err)
	}
	c.Merge()
	var cw sizeCounter
	allocs := testing.AllocsPerRun(1, func() { cw = sizeCounter{}; _ = c.WriteJSON(&cw) })
	if cw.n < 1_000_000 {
		t.Fatalf("expected a large answer, got %d bytes", cw.n)
	}
	// one string per CIDR is made while walking (fmtV4), nothing for the lists or the buffer: about one allocation per address
	if per := allocs / float64(len(c.v4)); per > 2.5 {
		t.Fatalf("%.1f allocations per address: the answer seems to be built up in memory", per)
	}
}

type sizeCounter struct{ n int }

func (w *sizeCounter) Write(p []byte) (int, error) { w.n += len(p); return len(p), nil }
