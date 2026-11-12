package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"
)

func mustParse(t *testing.T, s string) *toolSet {
	t.Helper()
	ts, err := parseToolConfig(strings.NewReader(s), "tools.conf")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return ts
}

func TestToolConfigParsing(t *testing.T) {
	ts := mustParse(t, "\xef\xbb\xbf# a comment\n\n  PDFImages = FALSE   # trailing comment\npdfinfo=true\nnetwork = no\nchecker = Yes\npdfcrop = 0\nsubnet = on\n")
	for _, id := range []string{"pdfimages", "pdfcrop"} {
		if !ts.appOff(id) {
			t.Errorf("%s should be off", id)
		}
	}
	if ts.appOff("pdfinfo") || ts.appOff("pdfmerge") {
		t.Error("pdfinfo and unlisted tools must stay on")
	}
	// network = no switches the whole folder off, even checker = yes inside it
	for _, id := range toolFolders["network"] {
		if !ts.appOff(id) {
			t.Errorf("%s is in a folder that is off", id)
		}
	}
	if !ts.folderOff("network") || ts.folderOff("pdf") {
		t.Error("folder states wrong")
	}
	if len(mustParse(t, "").off) != 0 || len(mustParse(t, "# only comments\n\n").off) != 0 {
		t.Error("an empty file switches nothing off")
	}
}

func TestToolConfigErrors(t *testing.T) {
	cases := map[string]string{
		"pdfimage = false\n":                "line 1: unknown tool \"pdfimage\"",
		"pdf = maybe\n":                     "line 1: \"maybe\" is not true, false or locked",
		"pdf false\n":                       "expected \"name = true\"",
		"pdf = false\n# x\npdf = true\n":    "line 3: pdf is listed twice",
		"\n\n = true\n":                     "line 3",
		"pdfinfo = false\npdfzzz = false\n": "line 2: unknown tool",
	}
	for in, want := range cases {
		_, err := parseToolConfig(strings.NewReader(in), "tools.conf")
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: error %v, want it to contain %q", in, err, want)
		}
	}
	// the message for an unknown name lists the valid ones
	_, err := parseToolConfig(strings.NewReader("nope = false"), "x")
	if err == nil || !strings.Contains(err.Error(), "pdfimages") || !strings.Contains(err.Error(), "network") {
		t.Errorf("error should list known names: %v", err)
	}
}

func TestHiddenList(t *testing.T) {
	var none *toolSet
	if none.appOff("pdfinfo") || none.folderOff("pdf") || len(none.hidden()) != 0 || none.toolsScript() != "window.TOOLS_OFF=[];\n" {
		t.Error("a nil toolSet means everything is on")
	}
	ts := mustParse(t, "pdfimages = false\naggregator = false\n")
	if got := ts.hidden(); !reflect.DeepEqual(got, []string{"aggregator", "pdfimages"}) {
		t.Errorf("hidden = %v", got)
	}
	// switching off every tool of a folder hides the folder too
	all := "subnet=false\nsplitter=false\nchecker=false\naggregator=false\nipv6calc=false\nipconv=false\nmaclookup=false\nportref=false\nmailhdr=false\nmailauth=false\nmtucalc=false\n"
	if got := mustParse(t, all).hidden(); !reflect.DeepEqual(got, []string{"aggregator", "checker", "ipconv", "ipv6calc", "maclookup", "mailauth", "mailhdr", "mtucalc", "network", "portref", "splitter", "subnet"}) {
		t.Errorf("hidden with the whole folder off = %v", got)
	}
	if s := ts.toolsScript(); s != "window.TOOLS_OFF=[\"aggregator\",\"pdfimages\"];\n" {
		t.Errorf("script = %q", s)
	}
}

func handlerWith(t *testing.T, conf string) http.Handler {
	t.Helper()
	cfg := testCfg()
	if conf != "" {
		cfg.Tools = mustParse(t, conf)
	}
	h, err := newHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func serve(h http.Handler, method, p string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, p, strings.NewReader("10.0.0.0/24\n10.0.1.0/24\n")))
	return w
}

func TestSwitchedOffToolsAreNotServed(t *testing.T) {
	h := handlerWith(t, "pdfimages = false\naggregator = false\n")
	for _, p := range []string{"/apps/pdfimages/app.js", "/apps/pdfimages/app.html", "/apps/pdfimages/icon.svg", "/apps/pdfimages/", "/apps/pdfimages",
		"/apps//pdfimages/app.js", "/apps/./pdfimages/app.js", "/apps/pdfinfo/../pdfimages/app.js", "/apps/aggregator/app.js"} {
		if c := serve(h, "GET", p).Code; c == 200 {
			t.Errorf("GET %s = 200 though the tool is off", p)
		}
	}
	if c := serve(h, "GET", "/apps/pdfimages/app.js").Code; c != 404 {
		t.Errorf("a disabled tool should be 404, got %d", c)
	}
	for _, p := range []string{"/apps/pdfinfo/app.js", "/apps/pdfcrop/app.html", "/apps/subnet/app.js", "/shell.js", "/lib/pdfcommon.js", "/"} {
		if c := serve(h, "GET", p).Code; c != 200 {
			t.Errorf("GET %s = %d, want 200", p, c)
		}
	}
	if c := serve(h, "POST", "/api/aggregate").Code; c != 404 {
		t.Errorf("aggregator API with the tool off = %d, want 404", c)
	}
	on := handlerWith(t, "pdfimages = false\n")
	if c := serve(on, "POST", "/api/aggregate").Code; c != 200 {
		t.Errorf("aggregator API with the tool on = %d, want 200", c)
	}
	// a whole folder
	pdf := handlerWith(t, "pdf = false\n")
	if serve(pdf, "GET", "/apps/pdfinfo/app.js").Code != 404 || serve(pdf, "GET", "/apps/pdfextract/app.js").Code != 404 || serve(pdf, "GET", "/apps/subnet/app.js").Code != 200 {
		t.Error("pdf = false must switch off every PDF tool and nothing else")
	}
	// no file: everything on
	if serve(handlerWith(t, ""), "GET", "/apps/pdfimages/app.js").Code != 200 {
		t.Error("with no configuration every tool is served")
	}
}

func TestToolsConfigScript(t *testing.T) {
	w := serve(handlerWith(t, "pdfmeta = false\n"), "GET", "/tools-config.js")
	if w.Code != 200 || w.Body.String() != "window.TOOLS_OFF=[\"pdfmeta\"];\n" {
		t.Errorf("tools-config.js = %d %q", w.Code, w.Body.String())
	}
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "text/javascript") || w.Header().Get("Cache-Control") != "no-store" {
		t.Errorf("headers: %v", w.Header())
	}
	if b := serve(handlerWith(t, ""), "GET", "/tools-config.js").Body.String(); b != "window.TOOLS_OFF=[];\n" {
		t.Errorf("default script = %q", b)
	}
}

// The Go list of tools must match the one in web/shell.js, or a new tool could never be switched off.
func TestToolNamesMatchTheShell(t *testing.T) {
	b, err := webFS.ReadFile("web/shell.js")
	if err != nil {
		t.Fatal(err)
	}
	appRe := regexp.MustCompile(`(?m)^\s*\{ id: "([a-z0-9]+)", title: .*?folder: "([a-z]+)"`)
	folderRe := regexp.MustCompile(`(?m)^\s*\{ id: "([a-z0-9]+)", title: "[^"]*", size: `)
	got := map[string][]string{}
	for _, m := range appRe.FindAllStringSubmatch(string(b), -1) {
		got[m[2]] = append(got[m[2]], m[1])
	}
	folders := map[string]bool{}
	for _, m := range folderRe.FindAllStringSubmatch(string(b), -1) {
		folders[m[1]] = true
	}
	for f, apps := range got {
		sort.Strings(apps)
		want := append([]string(nil), toolFolders[f]...)
		sort.Strings(want)
		if !reflect.DeepEqual(apps, want) {
			t.Errorf("folder %q: shell.js has %v, tools.go has %v: update toolFolders in tools.go", f, apps, want)
		}
	}
	for f := range toolFolders {
		if _, ok := got[f]; !ok || !folders[f] {
			t.Errorf("folder %q of tools.go is not in shell.js", f)
		}
	}
	if len(got) != len(toolFolders) {
		t.Errorf("shell.js has %d folders with tools, tools.go %d", len(got), len(toolFolders))
	}
	// every listed tool has its files
	for _, apps := range toolFolders {
		for _, a := range apps {
			if _, err := webFS.ReadFile("web/apps/" + a + "/app.js"); err != nil {
				t.Errorf("tool %s has no web/apps/%s/app.js", a, a)
			}
		}
	}
}

func TestLoadToolConfigFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "my.conf")
	if _, _, err := loadToolConfig(p); err == nil {
		t.Error("an explicit file that does not exist must be an error")
	}
	os.WriteFile(p, []byte("pdfcrop = false\n"), 0o644)
	ts, from, err := loadToolConfig(p)
	if err != nil || from != p || !ts.appOff("pdfcrop") {
		t.Errorf("load: %v %q %v", ts, from, err)
	}
	os.WriteFile(p, []byte("pdfcrp = false\n"), 0o644)
	if _, _, err := loadToolConfig(p); err == nil || !strings.Contains(err.Error(), "unknown tool") {
		t.Errorf("a typo in the file must stop the program, got %v", err)
	}
	if ts, _, err := loadToolConfig(""); err != nil || ts != nil {
		t.Errorf("no path and no tools.conf next to the test binary: want nil, got %v %v", ts, err)
	}
}

func TestResourceSizing(t *testing.T) {
	if parseMemTotal("MemTotal:        1048576 kB\nMemFree: 5 kB\n") != 1<<30 || parseMemTotal("nothing") != 0 || parseMemTotal("MemTotal: x kB") != 0 {
		t.Error("parseMemTotal")
	}
	if parseCgroupMax("max\n") != 0 || parseCgroupMax("751616000\n") != 751616000 || parseCgroupMax("") != 0 || parseCgroupMax("-5") != 0 || parseCgroupMax("abc") != 0 {
		t.Error("parseCgroupMax")
	}
	if cgroupPathV2("12:cpu:/x\n0::/system.slice/michels-tools.service\n") != "/system.slice/michels-tools.service" || cgroupPathV2("1:name=systemd:/x\n") != "" {
		t.Error("cgroupPathV2")
	}
	cases := []struct {
		mb   int64
		want int
	}{{0, 4}, {100, 1}, {717, 3}, {1024, 5}, {4096, 16}, {32768, 16}, {400, 2}}
	for _, c := range cases {
		if got := autoJobs(c.mb << 20); got != c.want {
			t.Errorf("autoJobs(%d MB) = %d, want %d", c.mb, got, c.want)
		}
	}
	if m := effectiveMemory(); m < 0 {
		t.Errorf("effectiveMemory = %d", m)
	}
}

// deploy/tools.conf.example must list every folder and tool, so a deployer can see all the names. Adding a tool without
// adding its line there fails this test.
func TestExampleConfigListsEveryTool(t *testing.T) {
	b, err := os.ReadFile("deploy/tools.conf.example")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parseToolConfig(strings.NewReader(string(b)), "tools.conf.example"); err != nil {
		t.Fatalf("the example file does not parse: %v", err)
	}
	if ts, err := parseToolConfig(strings.NewReader(string(b)), "tools.conf.example"); err == nil && (ts.lockCode() != "" || len(ts.lockedNames()) != 0) {
		t.Errorf("the example file must lock nothing and carry no access code (a comment after lock.code would become the code): code %q, locked %v", ts.lockCode(), ts.lockedNames())
	}
	listed := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^([a-z0-9._]+)\s*=`).FindAllStringSubmatch(string(b), -1) {
		listed[m[1]] = true
	}
	for _, n := range knownToolNames() {
		if !listed[n] {
			t.Errorf("deploy/tools.conf.example has no line for %q: add \"%s = true\" with a comment naming the tool", n, n)
		}
	}
	for _, n := range settingNames() {
		if !listed[n] {
			t.Errorf("deploy/tools.conf.example has no line for the setting %q: add it with its default value and a comment", n)
		}
	}
}

func TestToolSettings(t *testing.T) {
	var none *toolSet
	if mc := none.monitor(); !mc.Enabled || !mc.Exclusive || mc.Minutes != 10 {
		t.Errorf("defaults: %+v", mc)
	}
	ts := mustParse(t, "netquality.monitor_minutes = 3\nnetquality.monitor_exclusive = no   # one at a time off\nNetQuality.Monitor = true\n")
	if mc := ts.monitor(); !mc.Enabled || mc.Exclusive || mc.Minutes != 3 {
		t.Errorf("parsed: %+v", mc)
	}
	if len(ts.hidden()) != 0 {
		t.Error("settings must not switch any tool off")
	}
	if mc := mustParse(t, "netquality.monitor = false\n").monitor(); mc.Enabled || !mc.Exclusive || mc.Minutes != 10 {
		t.Errorf("only the listed setting changes: %+v", mc)
	}
	cases := map[string]string{
		"netquality.monitor_minutes = 0\n":                                 "must be a whole number from 1 to 60",
		"netquality.monitor_minutes = 61\n":                                "from 1 to 60",
		"netquality.monitor_minutes = ten\n":                               "must be a whole number",
		"netquality.monitor = maybe\n":                                     "is not true or false",
		"netquality.monitor_minutes = 5\nnetquality.monitor_minutes = 6\n": "listed twice",
		"netquality.colour = red\n":                                        "unknown setting",
		"pdf.monitor = true\n":                                             "unknown setting",
	}
	for in, want := range cases {
		_, err := parseToolConfig(strings.NewReader(in), "tools.conf")
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%q: error %v, want it to contain %q", in, err, want)
		}
	}
	if _, err := parseToolConfig(strings.NewReader("netquality.colour = red\n"), "tools.conf"); err == nil || !strings.Contains(err.Error(), "netquality.monitor_minutes") {
		t.Errorf("the error for an unknown setting lists the known ones: %v", err)
	}
}

// No two tools may share an id, a title, or the same words in another order ("Crop / Resize Pages" and "Resize / Crop Pages"): a visitor would
// not know which to choose, and the second one is almost certainly a copy of the first.
func TestNoDuplicateTools(t *testing.T) {
	b, err := webFS.ReadFile("web/shell.js")
	if err != nil {
		t.Fatal(err)
	}
	re := regexp.MustCompile(`(?m)^\s*\{ id: "([a-z0-9]+)", title: "([^"]+)", base:`)
	ids := map[string]bool{}
	words := map[string]string{}
	n := 0
	for _, m := range re.FindAllStringSubmatch(string(b), -1) {
		n++
		id, title := m[1], m[2]
		if ids[id] {
			t.Errorf("tool id %q appears twice in web/shell.js", id)
		}
		ids[id] = true
		ws := strings.Fields(strings.ToLower(regexp.MustCompile(`[^a-z0-9]+`).ReplaceAllString(title, " ")))
		sort.Strings(ws)
		key := strings.Join(ws, " ")
		if other, ok := words[key]; ok {
			t.Errorf("tools %q and %q have the same title (or the same words in another order)", other, title)
		}
		words[key] = title
	}
	if n < 50 {
		t.Errorf("found only %d tools in web/shell.js; the pattern in this test may be out of date", n)
	}
}

// Every tool must be findable in the Tools menu search by everyday words: web/lib/toolsearch.js needs an entry for each tool id in web/shell.js.
func TestEveryToolHasSearchWords(t *testing.T) {
	shell, err := webFS.ReadFile("web/shell.js")
	if err != nil {
		t.Fatal(err)
	}
	search, err := webFS.ReadFile("web/lib/toolsearch.js")
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range regexp.MustCompile(`(?m)^\s*\{ id: "([a-z0-9]+)", title: "[^"]+", base:`).FindAllStringSubmatch(string(shell), -1) {
		if !regexp.MustCompile(`(?m)^\s+` + m[1] + `: "`).Match(search) {
			t.Errorf("web/lib/toolsearch.js has no search words for the tool %q: add a line to KEYS", m[1])
		}
	}
}
