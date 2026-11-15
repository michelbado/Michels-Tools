package main

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// deskFixture builds a desktop folder with everything the rules have to handle.
func deskFixture(t *testing.T) string {
	t.Helper()
	d := t.TempDir()
	w := func(p, body string) {
		full := filepath.Join(d, p)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	w("Welcome.txt", "Hello\nworld")
	w("Notes.md", "# Title\n\nSome **bold** text <script>alert(1)</script>")
	w("readme.pdf", "%PDF-1.4")                  // a file type the desktop does not show
	w(".secret.txt", "hidden")                   // hidden
	w("_draft.md", "hidden too")                 // hidden
	w("Downloads/a.zip", "ZIPDATA")              // a normal download
	w("Downloads/B.html", "<h1>not a page</h1>") // must still be a download, never shown
	w("Downloads/.hidden.bin", "HIDDENBIN")      // not listed, but downloadable
	w("Downloads/_x.txt", "UNDERSCORE")          // not listed, but downloadable
	w("Downloads/sub/deep.txt", "too deep")      // folders inside folders are not listed
	w("Downloads/Ünï cödé.pdf", "UNICODE")
	w("Empty/.keep", "x") // only a hidden file: the folder does not appear
	if err := os.MkdirAll(filepath.Join(d, "Nothing"), 0o755); err != nil {
		t.Fatal(err)
	}
	// links are never followed
	_ = os.Symlink(filepath.Join(d, "Welcome.txt"), filepath.Join(d, "link.txt"))
	_ = os.Symlink(filepath.Join(d, "Downloads"), filepath.Join(d, "linkdir"))
	_ = os.Symlink("/etc/passwd", filepath.Join(d, "Downloads", "pw"))
	_ = os.Symlink(filepath.Join(d, "Welcome.txt"), filepath.Join(d, "Downloads", "inside"))
	return d
}

func deskHandler(t *testing.T, dir string, tools *toolSet, visits *visitLogger) http.Handler {
	t.Helper()
	cfg := testCfg()
	cfg.DesktopDir, cfg.Tools, cfg.Visits = dir, tools, visits
	h, err := newHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func deskGet(h http.Handler, method, target string, hdr map[string]string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, target, nil)
	r.RemoteAddr = "192.0.2.9:4444"
	r.Header.Set("User-Agent", "DeskTest/1.0")
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func titles(items []deskItem) string {
	var s []string
	for _, i := range items {
		s = append(s, i.Kind+":"+i.Title)
	}
	return strings.Join(s, ",")
}

func TestDesktopListRules(t *testing.T) {
	d := deskFixture(t)
	got := titles((&desktopStore{dir: d}).list())
	want := "folder:Downloads,text:Notes,text:Welcome"
	if got != want {
		t.Fatalf("list = %s, want %s (folders first; no hidden, empty, pdf or linked items)", got, want)
	}
	items := (&desktopStore{dir: d}).list()
	if items[0].Count != 3 {
		t.Errorf("Downloads counts %d visible files, want 3 (a.zip, B.html and the unicode one: no hidden files, no folder, no links)", items[0].Count)
	}
	if (&desktopStore{dir: filepath.Join(d, "missing")}).list() == nil || len((&desktopStore{dir: filepath.Join(d, "missing")}).list()) != 0 {
		t.Error("a missing folder must give an empty list, not nil or an error")
	}
}

func TestDesktopEndpoints(t *testing.T) {
	d := deskFixture(t)
	h := deskHandler(t, d, nil, nil)

	w := deskGet(h, "GET", "/api/desktop", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"title":"Welcome"`) || strings.Contains(w.Body.String(), "secret") || strings.Contains(w.Body.String(), "Empty") || strings.Contains(w.Body.String(), "Nothing") {
		t.Fatalf("list: %d %s", w.Code, w.Body.String())
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Error("the list must never be cached")
	}
	// the folder window
	w = deskGet(h, "GET", "/api/desktop/folder?name=Downloads", nil)
	b := w.Body.String()
	if w.Code != 200 || !strings.Contains(b, `"a.zip"`) || !strings.Contains(b, `"B.html"`) || strings.Contains(b, "hidden") || strings.Contains(b, "_x.txt") || strings.Contains(b, "deep") || strings.Contains(b, `"pw"`) || strings.Contains(b, `"inside"`) {
		t.Fatalf("folder: %d %s", w.Code, b)
	}
	for _, n := range []string{"Empty", "Nothing", "nope", ".git", "_x", "..", "a/b", "linkdir", "Welcome.txt", ""} {
		if w := deskGet(h, "GET", "/api/desktop/folder?name="+n, nil); w.Code != 404 {
			t.Errorf("folder %q: %d, want 404", n, w.Code)
		}
	}
	// the text reader
	w = deskGet(h, "GET", "/api/desktop/text?name=Notes.md", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"kind":"md"`) || !strings.Contains(w.Body.String(), `\u003cscript\u003e`) {
		t.Fatalf("text md: %d %s", w.Code, w.Body.String())
	}
	if w := deskGet(h, "GET", "/api/desktop/text?name=Welcome.txt", nil); w.Code != 200 || !strings.Contains(w.Body.String(), `"kind":"txt"`) {
		t.Errorf("text txt: %d %s", w.Code, w.Body.String())
	}
	for _, n := range []string{"readme.pdf", ".secret.txt", "_draft.md", "link.txt", "nope.txt", "../x.txt", "Downloads", "Downloads/a.zip"} {
		if w := deskGet(h, "GET", "/api/desktop/text?name="+n, nil); w.Code != 404 {
			t.Errorf("text %q: %d, want 404", n, w.Code)
		}
	}
	// a file that is too large to show, and bytes that are not UTF-8
	if err := os.WriteFile(filepath.Join(d, "Big.txt"), []byte(strings.Repeat("x", desktopMaxTextBytes+10)), 0o644); err != nil {
		t.Fatal(err)
	}
	if w := deskGet(h, "GET", "/api/desktop/text?name=Big.txt", nil); w.Code != 413 {
		t.Errorf("too large: %d, want 413", w.Code)
	}
	os.WriteFile(filepath.Join(d, "Bad.txt"), []byte("ok \xff\xfe end"), 0o644)
	if w := deskGet(h, "GET", "/api/desktop/text?name=Bad.txt", nil); w.Code != 200 || !strings.Contains(w.Body.String(), "ok ") {
		t.Errorf("invalid UTF-8: %d %s", w.Code, w.Body.String())
	}
}

func TestDesktopDownloadsAreAlwaysAttachments(t *testing.T) {
	d := deskFixture(t)
	h := deskHandler(t, d, nil, nil)
	for path, body := range map[string]string{
		"/desktop-files/Downloads/a.zip":                              "ZIPDATA",
		"/desktop-files/Downloads/B.html":                             "<h1>not a page</h1>",
		"/desktop-files/Downloads/.hidden.bin":                        "HIDDENBIN", // hidden files can be fetched by anyone who knows the address
		"/desktop-files/Downloads/_x.txt":                             "UNDERSCORE",
		"/desktop-files/Downloads/%C3%9Cn%C3%AF%20c%C3%B6d%C3%A9.pdf": "UNICODE",
	} {
		w := deskGet(h, "GET", path, nil)
		if w.Code != 200 || w.Body.String() != body {
			t.Errorf("%s: %d %q", path, w.Code, w.Body.String())
			continue
		}
		cd := w.Header().Get("Content-Disposition")
		if !strings.HasPrefix(cd, "attachment") {
			t.Errorf("%s: Content-Disposition %q, want an attachment", path, cd)
		}
		if ct := w.Header().Get("Content-Type"); ct != "application/octet-stream" {
			t.Errorf("%s: Content-Type %q, want application/octet-stream (never html, text or an image)", path, ct)
		}
		if w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Errorf("%s: no nosniff", path)
		}
	}
	// an unusual name is carried correctly
	w := deskGet(h, "GET", "/desktop-files/Downloads/%C3%9Cn%C3%AF%20c%C3%B6d%C3%A9.pdf", nil)
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, "filename*=utf-8''") {
		t.Errorf("unicode file name: %q", cd)
	}
	// resuming a download works
	w = deskGet(h, "GET", "/desktop-files/Downloads/a.zip", map[string]string{"Range": "bytes=2-4"})
	if w.Code != 206 || w.Body.String() != "PDA" {
		t.Errorf("range: %d %q", w.Code, w.Body.String())
	}
}

func TestDesktopCannotLeaveItsFolder(t *testing.T) {
	d := deskFixture(t)
	h := deskHandler(t, d, nil, nil)
	for _, p := range []string{
		"/desktop-files/Downloads/pw",                   // a link out of the folder
		"/desktop-files/Downloads/inside",               // any link: links are never followed
		"/desktop-files/linkdir/a.zip",                  // a linked folder
		"/desktop-files/Downloads/..%2fWelcome.txt",     // up one level
		"/desktop-files/..%2f/Welcome.txt",              //
		"/desktop-files/%2e%2e/Welcome.txt",             //
		"/desktop-files/Downloads/%2e%2e",               //
		"/desktop-files/Downloads/..%5cWelcome.txt",     // a backslash
		"/desktop-files/Downloads/%00",                  // a zero byte
		"/desktop-files/Downloads/sub",                  // a folder is not a file
		"/desktop-files/Downloads/",                     //
		"/desktop-files/Downloads",                      // no file named
		"/desktop-files/Welcome.txt",                    // a root file has no download address
		"/desktop-files/Nothing/x",                      //
		"/desktop-files/Downloads/nope",                 //
		"/desktop-files/..%2f..%2f..%2f..%2fetc/passwd", //
		"/desktop-files/Downloads/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
	} {
		w := deskGet(h, "GET", p, nil)
		if w.Code == 200 {
			t.Errorf("%s: answered 200 with %q", p, w.Body.String())
		}
		if strings.Contains(w.Body.String(), "root:") || strings.Contains(w.Body.String(), "hello") {
			t.Errorf("%s: leaked %q", p, w.Body.String())
		}
	}
}

func TestDesktopOffMeansNotFound(t *testing.T) {
	d := deskFixture(t)
	off, err := parseToolConfig(strings.NewReader("desktop = false\n"), "test")
	if err != nil {
		t.Fatal(err)
	}
	for name, h := range map[string]http.Handler{"switched off": deskHandler(t, d, off, nil), "no folder given": deskHandler(t, "", nil, nil)} {
		for _, p := range []string{"/api/desktop", "/api/desktop/folder?name=Downloads", "/api/desktop/text?name=Notes.md", "/desktop-files/Downloads/a.zip"} {
			if w := deskGet(h, "GET", p, nil); w.Code != 404 {
				t.Errorf("%s: %s answered %d, want 404", name, p, w.Code)
			}
		}
	}
	if _, err := parseToolConfig(strings.NewReader("desktop = maybe\n"), "test"); err == nil {
		t.Error("desktop = maybe should be refused")
	}
}

func TestDesktopListIsCapped(t *testing.T) {
	d := t.TempDir()
	for i := 0; i < desktopMaxItems+20; i++ {
		os.WriteFile(filepath.Join(d, fmt.Sprintf("n%04d.txt", i)), []byte("x"), 0o644)
	}
	if n := len((&desktopStore{dir: d}).list()); n != desktopMaxItems {
		t.Errorf("%d items listed, want the cap %d", n, desktopMaxItems)
	}
}

func TestDesktopDownloadsAreLogged(t *testing.T) {
	d := deskFixture(t)
	l, dir := newTestLogger(t, "")
	h := deskHandler(t, d, nil, l)
	deskGet(h, "GET", "/desktop-files/Downloads/a.zip", nil)                                    // counted
	deskGet(h, "GET", "/desktop-files/Downloads/.hidden.bin", nil)                              // counted
	deskGet(h, "HEAD", "/desktop-files/Downloads/a.zip", nil)                                   // not a download
	deskGet(h, "GET", "/desktop-files/Downloads/a.zip", map[string]string{"Range": "bytes=3-"}) // a resume: not counted again
	deskGet(h, "GET", "/desktop-files/Downloads/nope", nil)                                     // missing: nothing was downloaded
	deskGet(h, "GET", "/desktop-files/Downloads/pw", nil)                                       // refused
	deskGet(h, "GET", "/api/desktop", nil)                                                      // looking is not downloading
	l.Close()
	raw, entries := readAll(t, dir)
	if len(entries) != 2 {
		t.Fatalf("want 2 download entries, got %d:\n%s", len(entries), raw)
	}
	for i, f := range []string{"Downloads/a.zip", "Downloads/.hidden.bin"} {
		e := entries[i]
		if e.Event != "download" || e.File != f || e.IP != "192.0.2.9" || e.Agent != "DeskTest/1.0" || e.Time == "" {
			t.Errorf("entry %d = %+v", i, e)
		}
	}
	if strings.Contains(raw, "ZIPDATA") || strings.Contains(raw, "HIDDENBIN") {
		t.Error("file contents must never reach the log")
	}
}
