package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The documentation in docs/ must say everything the code offers: this test fails when a tool, a tools.conf setting, a command-line
// flag or an endpoint exists in the code but not in the guide, or when a link inside the documentation is broken.
// (It cannot judge wording: when behaviour changes, change the page.)

func readDoc(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestDocsListEveryToolAndFolder(t *testing.T) {
	doc := readDoc(t, "docs/tools.md")
	for folder, apps := range toolFolders {
		if !strings.Contains(doc, "`"+folder+"`") {
			t.Errorf("docs/tools.md does not mention the folder `%s`", folder)
		}
		for _, a := range apps {
			if !strings.Contains(doc, "| `"+a+"` |") {
				t.Errorf("docs/tools.md has no table row for the tool `%s`", a)
			}
		}
	}
}

func TestDocsListEverySettingAndFlag(t *testing.T) {
	doc := readDoc(t, "docs/configuration.md")
	for _, s := range settingNames() {
		if !strings.Contains(doc, "`"+s+"`") {
			t.Errorf("docs/configuration.md does not describe the setting `%s`", s)
		}
	}
	src := readDoc(t, "main.go")
	flags := regexp.MustCompile(`flag\.(?:String|Int|Int64|Bool|Duration|Float64)\("([a-z-]+)"`).FindAllStringSubmatch(src, -1)
	if len(flags) < 15 {
		t.Fatalf("found only %d flags in main.go: has the way flags are declared changed? fix this test", len(flags))
	}
	for _, f := range flags {
		if !strings.Contains(doc, "`-"+f[1]+"`") {
			t.Errorf("docs/configuration.md does not describe the flag `-%s`", f[1])
		}
	}
}

func TestDocsListEveryEndpoint(t *testing.T) {
	doc := readDoc(t, "docs/server.md")
	n := 0
	for _, file := range []string{"main.go", "diag.go", "facts.go", "hold.go"} {
		for _, m := range regexp.MustCompile(`HandleFunc\("(?:GET|POST) (/[^"]*)"`).FindAllStringSubmatch(readDoc(t, file), -1) {
			n++
			if m[1] == "/" {
				continue // the web files themselves
			}
			if !strings.Contains(doc, m[1]) {
				t.Errorf("docs/server.md does not mention the endpoint %s (%s)", m[1], file)
			}
		}
	}
	if n < 10 {
		t.Fatalf("found only %d endpoints: has the way routes are declared changed? fix this test", n)
	}
}

// githubSlug turns a heading into the anchor GitHub makes for it.
func githubSlug(h string) string {
	h = strings.ToLower(strings.TrimSpace(h))
	var b strings.Builder
	for _, r := range h {
		switch {
		case r == ' ':
			b.WriteByte('-')
		case r == '-' || r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
		}
	}
	return b.String()
}

func TestDocsLinksAreNotBroken(t *testing.T) {
	files := []string{"README.md", "SECURITY.md"}
	more, _ := filepath.Glob("docs/*.md")
	files = append(files, more...)
	link := regexp.MustCompile(`\]\(([^)\s]+)\)`)
	heading := regexp.MustCompile(`(?m)^#{1,6}\s+(.+?)\s*$`)
	for _, f := range files {
		text := readDoc(t, f)
		for _, m := range link.FindAllStringSubmatch(text, -1) {
			target := m[1]
			if strings.HasPrefix(target, "http://") || strings.HasPrefix(target, "https://") || strings.HasPrefix(target, "mailto:") {
				continue
			}
			path, anchor, _ := strings.Cut(target, "#")
			dest := f
			if path != "" {
				dest = filepath.Join(filepath.Dir(f), path)
				if _, err := os.Stat(dest); err != nil {
					t.Errorf("%s links to %q, which does not exist", f, target)
					continue
				}
			}
			if anchor == "" || !strings.HasSuffix(dest, ".md") {
				continue
			}
			found := false
			for _, h := range heading.FindAllStringSubmatch(readDoc(t, dest), -1) {
				if githubSlug(strings.ReplaceAll(h[1], "`", "")) == anchor {
					found = true
				}
			}
			if !found {
				t.Errorf("%s links to %q: no such heading in %s", f, target, dest)
			}
		}
	}
}
