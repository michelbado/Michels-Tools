package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// Which tools a deployer wants on. A plain text file, one "name = true|false" per line:
//
//	# comments start with #
//	pdf = true          # a whole folder
//	pdfimages = false   # one tool
//
// Anything not listed is on. A tool is off when its own line says false OR its folder's line says false.
//
// A few tools also have settings, written as  tool.setting = value  (see toolSettings below and deploy/tools.conf.example).
// The names below must match web/shell.js (tools_test.go checks that they do).

// toolFolders: folder id -> the tools inside it.
var toolFolders = map[string][]string{
	"network":     {"aggregator", "subnet", "splitter", "checker", "ipv6calc", "ipconv", "maclookup", "certdecode", "mailhdr", "mailauth", "mtucalc"},
	"pdf":         {"pdfinfo", "pdfverify", "pdfmeta", "pdfstamp", "pdfwatermark", "pdfpages", "pdfmerge", "pdforganize", "pdfcrop", "pdfredact", "pdfimages", "pdfextract"},
	"trouble":     {"netquality", "connfacts", "idletest", "pathread", "browsercaps", "httphdr"},
	"engineering": {"urlparse", "jwtdecode", "basicauth", "xmljson", "crontab", "chmodcalc", "colorconv"},
	"images":      {"imgexif", "imgresize", "imgblur", "imgconvert", "imgwatermark", "imgbatch", "imgfavicon"},
	"reference":   {"portref", "dscp", "httpstatus", "dnstypes", "icmptypes", "tcpref", "ipsecref"},
}

func isToolApp(name string) bool {
	for _, apps := range toolFolders {
		for _, a := range apps {
			if a == name {
				return true
			}
		}
	}
	return false
}

func knownToolNames() []string {
	var names []string
	for f, apps := range toolFolders {
		names = append(names, f)
		names = append(names, apps...)
	}
	sort.Strings(names)
	return names
}

// toolSet holds the names switched off explicitly, and the settings. A nil *toolSet means everything is on and every setting has its default.
type toolSet struct {
	off   map[string]bool
	bools map[string]bool // settings of type true/false that the file gave
	ints  map[string]int  // settings that are whole numbers
}

// settings of the tools: name -> kind ('b' true/false, 'i' whole number between min and max) and default
type settingSpec struct {
	kind     byte
	min, max int
	defBool  bool
	defInt   int
}

var toolSettings = map[string]settingSpec{
	"netquality.monitor":           {kind: 'b', defBool: true},
	"netquality.monitor_exclusive": {kind: 'b', defBool: true},
	"netquality.monitor_fine":      {kind: 'b', defBool: true},
	"netquality.monitor_minutes":   {kind: 'i', min: 1, max: 60, defInt: 10},
	"idletest.max_seconds":         {kind: 'i', min: 30, max: 600, defInt: 300},
}

func settingNames() []string {
	var n []string
	for k := range toolSettings {
		n = append(n, k)
	}
	sort.Strings(n)
	return n
}

func (t *toolSet) boolSetting(name string) bool {
	if t != nil {
		if v, ok := t.bools[name]; ok {
			return v
		}
	}
	return toolSettings[name].defBool
}

func (t *toolSet) intSetting(name string) int {
	if t != nil {
		if v, ok := t.ints[name]; ok {
			return v
		}
	}
	return toolSettings[name].defInt
}

// monitorCfg: how Connection Quality's Monitor mode is offered on this server.
type monitorCfg struct {
	Enabled   bool // Monitor mode is offered at all
	Exclusive bool // only one visitor may monitor at a time
	Minutes   int  // the longest a monitoring run may last
	Fine      bool // Monitor mode may probe 20 times a second ("fine detail"); false: 5 a second only
}

func (t *toolSet) monitor() monitorCfg {
	return monitorCfg{Enabled: t.boolSetting("netquality.monitor"), Exclusive: t.boolSetting("netquality.monitor_exclusive"), Minutes: t.intSetting("netquality.monitor_minutes"), Fine: t.boolSetting("netquality.monitor_fine")}
}

func parseBool(v string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "true", "yes", "on", "1":
		return true, true
	case "false", "no", "off", "0":
		return false, true
	}
	return false, false
}

// parseToolConfig reads the file. Mistakes are reported with the line number, because a typo that is silently ignored
// would leave a tool on that the deployer believes is off.
func parseToolConfig(r io.Reader, source string) (*toolSet, error) {
	known := map[string]bool{}
	for _, n := range knownToolNames() {
		known[n] = true
	}
	seen := map[string]bool{}
	t := &toolSet{off: map[string]bool{}, bools: map[string]bool{}, ints: map[string]int{}}
	sc := bufio.NewScanner(r)
	for ln := 1; sc.Scan(); ln++ {
		line := sc.Text()
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		line = strings.TrimSpace(strings.TrimPrefix(line, "\xef\xbb\xbf"))
		if line == "" {
			continue
		}
		k, v, found := strings.Cut(line, "=")
		name := strings.ToLower(strings.TrimSpace(k))
		if !found || name == "" {
			return nil, fmt.Errorf("%s line %d: expected \"name = true\" or \"name = false\", got %q", source, ln, line)
		}
		if spec, isSetting := toolSettings[name]; isSetting {
			if seen[name] {
				return nil, fmt.Errorf("%s line %d: %s is listed twice", source, ln, name)
			}
			seen[name] = true
			if spec.kind == 'b' {
				b, okb := parseBool(v)
				if !okb {
					return nil, fmt.Errorf("%s line %d: %q is not true or false (for %s)", source, ln, strings.TrimSpace(v), name)
				}
				t.bools[name] = b
			} else {
				n, err := strconv.Atoi(strings.TrimSpace(v))
				if err != nil || n < spec.min || n > spec.max {
					return nil, fmt.Errorf("%s line %d: %s must be a whole number from %d to %d, got %q", source, ln, name, spec.min, spec.max, strings.TrimSpace(v))
				}
				t.ints[name] = n
			}
			continue
		}
		if strings.Contains(name, ".") {
			return nil, fmt.Errorf("%s line %d: unknown setting %q (known settings: %s)", source, ln, name, strings.Join(settingNames(), ", "))
		}
		if !known[name] {
			return nil, fmt.Errorf("%s line %d: unknown tool %q (known names: %s)", source, ln, name, strings.Join(knownToolNames(), ", "))
		}
		val, okv := parseBool(v)
		if !okv {
			return nil, fmt.Errorf("%s line %d: %q is not true or false (for %s)", source, ln, strings.TrimSpace(v), name)
		}
		if seen[name] {
			return nil, fmt.Errorf("%s line %d: %s is listed twice", source, ln, name)
		}
		seen[name] = true
		if !val {
			t.off[name] = true
		}
	}
	if err := sc.Err(); err != nil {
		return nil, fmt.Errorf("%s: %w", source, err)
	}
	return t, nil
}

// loadToolConfig: an explicit path must exist; with no path, tools.conf next to the program is used if it is there.
func loadToolConfig(p string) (*toolSet, string, error) {
	explicit := p != ""
	if !explicit {
		exe, err := os.Executable()
		if err != nil {
			return nil, "", nil
		}
		p = filepath.Join(filepath.Dir(exe), "tools.conf")
	}
	f, err := os.Open(p)
	if err != nil {
		if !explicit && os.IsNotExist(err) {
			return nil, "", nil // no file: everything is on
		}
		return nil, "", fmt.Errorf("tools config: %w", err)
	}
	defer f.Close()
	t, err := parseToolConfig(f, p)
	return t, p, err
}

func (t *toolSet) appOff(id string) bool {
	if t == nil {
		return false
	}
	if t.off[id] {
		return true
	}
	for folder, apps := range toolFolders {
		if t.off[folder] {
			for _, a := range apps {
				if a == id {
					return true
				}
			}
		}
	}
	return false
}

func (t *toolSet) folderOff(folder string) bool {
	if t == nil {
		return false
	}
	if t.off[folder] {
		return true
	}
	apps := toolFolders[folder]
	for _, a := range apps {
		if !t.appOff(a) {
			return false
		}
	}
	return len(apps) > 0
}

// hidden: every tool and folder the page must not show, sorted.
func (t *toolSet) hidden() []string {
	if t == nil {
		return nil
	}
	var out []string
	for _, n := range knownToolNames() {
		if (isToolApp(n) && t.appOff(n)) || (!isToolApp(n) && t.folderOff(n)) {
			out = append(out, n)
		}
	}
	return out
}

// appIDFromPath: "/apps/pdfcrop/app.js" -> "pdfcrop"; "" for any other path.
func appIDFromPath(p string) string {
	parts := strings.Split(strings.Trim(path.Clean("/"+p), "/"), "/")
	if len(parts) >= 2 && parts[0] == "apps" {
		return parts[1]
	}
	return ""
}

// toolsScript: the tiny script the page loads before shell.js so it knows what to hide. No inline script: the CSP forbids it.
func (t *toolSet) toolsScript() string {
	var b strings.Builder
	b.WriteString("window.TOOLS_OFF=[")
	for i, n := range t.hidden() {
		if i > 0 {
			b.WriteByte(',')
		}
		fmt.Fprintf(&b, "%q", n)
	}
	b.WriteString("];\n")
	return b.String()
}
