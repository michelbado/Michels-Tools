package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// sbom.cdx.json is the ONE inventory of third-party material (see web/vendor/README.md for how the files were obtained).
// This test keeps it true: every vendored file is listed with its real SHA-256, every licence file it names exists,
// and the Go side still has no dependency besides the standard library.

type sbomComponent struct {
	Type     string `json:"type"`
	BomRef   string `json:"bom-ref"`
	Name     string `json:"name"`
	Version  string `json:"version"`
	Purl     string `json:"purl"`
	Licenses []struct {
		Expression string `json:"expression"`
		License    *struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"license"`
	} `json:"licenses"`
	Hashes []struct {
		Alg     string `json:"alg"`
		Content string `json:"content"`
	} `json:"hashes"`
	Properties []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	} `json:"properties"`
}

type sbomDoc struct {
	BomFormat    string          `json:"bomFormat"`
	SpecVersion  string          `json:"specVersion"`
	Components   []sbomComponent `json:"components"`
	Dependencies []struct {
		Ref       string   `json:"ref"`
		DependsOn []string `json:"dependsOn"`
	} `json:"dependencies"`
}

func TestSBOMMatchesVendoredFiles(t *testing.T) {
	raw, err := os.ReadFile("sbom.cdx.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc sbomDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if doc.BomFormat != "CycloneDX" || doc.SpecVersion == "" {
		t.Fatalf("not a CycloneDX document: %q %q", doc.BomFormat, doc.SpecVersion)
	}
	vendor := filepath.Join("web", "vendor")
	refs := map[string]bool{"michels-tools": true}
	listed := map[string]bool{}
	for _, c := range doc.Components {
		if c.BomRef == "" || refs[c.BomRef] {
			t.Errorf("component %q: missing or duplicate bom-ref %q", c.Name, c.BomRef)
		}
		refs[c.BomRef] = true
		switch c.Type {
		case "file":
			if !strings.HasPrefix(c.BomRef, "file:") || c.BomRef != "file:"+c.Name {
				t.Errorf("file component %q has bom-ref %q", c.Name, c.BomRef)
			}
			data, err := os.ReadFile(filepath.Join(vendor, filepath.FromSlash(c.Name)))
			if err != nil {
				t.Errorf("listed file is missing: %v", err)
				continue
			}
			sum := sha256.Sum256(data)
			if len(c.Hashes) != 1 || c.Hashes[0].Alg != "SHA-256" || c.Hashes[0].Content != hex.EncodeToString(sum[:]) {
				t.Errorf("%s: SHA-256 in the SBOM does not match the file (the file changed? update the SBOM and web/vendor/README.md)", c.Name)
			}
			listed[c.Name] = true
		case "library", "data":
			if len(c.Licenses) == 0 {
				t.Errorf("%s has no licence", c.Name)
			}
			for _, l := range c.Licenses {
				if l.Expression == "" && (l.License == nil || (l.License.ID == "" && l.License.Name == "")) {
					t.Errorf("%s has an empty licence entry", c.Name)
				}
			}
			if c.Purl != "" && strings.HasPrefix(c.Purl, "pkg:npm/") && !strings.HasSuffix(c.Purl, "@"+c.Version) {
				t.Errorf("%s: purl %q does not end with version %q", c.Name, c.Purl, c.Version)
			}
			for _, p := range c.Properties {
				if p.Name != "michels-tools:licenseFile" {
					continue
				}
				b, err := os.ReadFile(filepath.Join(vendor, filepath.FromSlash(p.Value)))
				if err != nil || len(b) < 200 {
					t.Errorf("%s: licence file %q is missing or too short", c.Name, p.Value)
				}
			}
		default:
			t.Errorf("%s: unexpected component type %q", c.Name, c.Type)
		}
	}
	// every real vendored file is listed (README.md and licenses/ are documentation, not components)
	filepath.WalkDir(vendor, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(vendor, p)
		rel = filepath.ToSlash(rel)
		if rel == "README.md" || strings.HasPrefix(rel, "licenses/") {
			return nil
		}
		if !listed[rel] {
			t.Errorf("web/vendor/%s is not in sbom.cdx.json", rel)
		}
		return nil
	})
	// every licence text in licenses/ is used by some component (no orphans)
	used := map[string]bool{}
	for _, c := range doc.Components {
		for _, p := range c.Properties {
			if p.Name == "michels-tools:licenseFile" {
				used[p.Value] = true
			}
		}
	}
	entries, _ := os.ReadDir(filepath.Join(vendor, "licenses"))
	for _, e := range entries {
		if !used["licenses/"+e.Name()] {
			t.Errorf("licenses/%s belongs to no component in the SBOM", e.Name())
		}
	}
	for _, d := range doc.Dependencies {
		if !refs[d.Ref] {
			t.Errorf("dependency from unknown ref %q", d.Ref)
		}
		for _, o := range d.DependsOn {
			if !refs[o] {
				t.Errorf("%s depends on unknown ref %q", d.Ref, o)
			}
		}
	}
}

// The server has no third-party Go module; the Go standard library entry must match the go directive in go.mod.
func TestSBOMGoSide(t *testing.T) {
	mod, err := os.ReadFile("go.mod")
	if err != nil {
		t.Fatal(err)
	}
	if regexp.MustCompile(`(?m)^\s*(require\b|replace\b)`).Match(mod) {
		t.Fatal("go.mod now lists a dependency: add it to sbom.cdx.json (and this test)")
	}
	if _, err := os.Stat("go.sum"); err == nil {
		t.Fatal("go.sum exists: the server has Go dependencies that sbom.cdx.json does not list")
	}
	want := regexp.MustCompile(`(?m)^go (\d+\.\d+)`).FindSubmatch(mod)
	raw, _ := os.ReadFile("sbom.cdx.json")
	var doc sbomDoc
	json.Unmarshal(raw, &doc)
	for _, c := range doc.Components {
		if c.BomRef == "pkg:golang/stdlib@"+string(want[1]) && c.Version == string(want[1]) {
			return
		}
	}
	t.Fatalf("sbom.cdx.json has no Go standard library entry for go %s (the go line in go.mod)", want[1])
}
