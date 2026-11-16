package main

import (
	"encoding/json"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"unicode/utf8"
)

// The desktop folder: files and folders the person running this installation puts next to the program (default: "desktop") appear on the web desktop.
//
//   - A .md or .txt file directly inside it becomes an icon that opens in a reader window (Markdown is shown formatted; the page never runs HTML).
//   - A folder directly inside it becomes a folder icon, but only when it holds at least one visible file, directly or in a folder inside it.
//     Opening it lists its folders and files; folders open in the same window, and clicking a file always downloads it (it is never shown in the browser).
//   - Names starting with "." or "_" are not listed. Files can still be downloaded by anyone who knows the exact address.
//
// Nothing outside the folder can be reached (os.Root refuses ".." and links that lead out; links are not followed at all), folders are read at most
// desktopMaxDepth levels deep, and there is no upload: files are added on the server only. Every download is written to the visit log with the time,
// the address, the browser and the file.
const (
	desktopMaxItems       = 300
	desktopMaxFolderFiles = 1000
	desktopMaxTextBytes   = 1 << 20
	desktopMaxDepth       = 8     // folders inside folders: this many levels, counting the folder on the desktop as the first
	desktopScanBudget     = 20000 // directory entries looked at to decide which folders hold files, per request
)

type deskItem struct {
	Kind  string `json:"kind"` // "text", "folder" or "file"
	Name  string `json:"name"` // the real name on disk
	Title string `json:"title"`
	Ext   string `json:"ext,omitempty"` // "md" or "txt"
	Size  int64  `json:"size,omitempty"`
	Count int    `json:"count,omitempty"` // files directly in a folder
	Mtime int64  `json:"mtime,omitempty"`
}

func deskHidden(n string) bool { return strings.HasPrefix(n, ".") || strings.HasPrefix(n, "_") }

// deskValidName: one plain name, never a path.
func deskValidName(n string) bool {
	if n == "" || len(n) > 255 || n == "." || n == ".." || !utf8.ValidString(n) || strings.ContainsAny(n, "/\\") {
		return false
	}
	for _, r := range n {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// deskSegments splits an address inside the desktop folder into names, or says it is not one (empty parts, "..", too deep, bad names).
func deskSegments(p string, maxSegs int, allowHidden bool) ([]string, bool) {
	if p == "" || strings.HasPrefix(p, "/") || strings.HasSuffix(p, "/") {
		return nil, false
	}
	segs := strings.Split(p, "/")
	if len(segs) > maxSegs {
		return nil, false
	}
	for _, s := range segs {
		if !deskValidName(s) || (!allowHidden && deskHidden(s)) {
			return nil, false
		}
	}
	return segs, true
}

func deskTextKind(n string) string {
	switch strings.ToLower(path.Ext(n)) {
	case ".md", ".markdown":
		return "md"
	case ".txt":
		return "txt"
	}
	return ""
}

// deskVisible: a regular file (not a link, not a folder) with an ordinary name.
func deskVisible(e fs.DirEntry) bool {
	return e.Type().IsRegular() && deskValidName(e.Name()) && !deskHidden(e.Name())
}

// deskVisibleDir: a real folder (not a link) with an ordinary name.
func deskVisibleDir(e fs.DirEntry) bool {
	return e.IsDir() && deskValidName(e.Name()) && !deskHidden(e.Name())
}

type desktopStore struct{ dir string }

// open gives the folder as a root that cannot be left (nil when it is missing).
func (d *desktopStore) open() *os.Root {
	r, err := os.OpenRoot(d.dir)
	if err != nil {
		return nil
	}
	return r
}

// hasFiles: does this folder hold a visible file, directly or in a folder that does? depth is 1 for a folder on the desktop.
func deskHasFiles(fsys fs.FS, rel string, depth int, budget *int) bool {
	if depth > desktopMaxDepth || *budget <= 0 {
		return false
	}
	entries, err := fs.ReadDir(fsys, rel)
	if err != nil {
		return false
	}
	*budget -= len(entries)
	for _, e := range entries {
		if deskVisible(e) {
			return true
		}
	}
	for _, e := range entries {
		if deskVisibleDir(e) && deskHasFiles(fsys, rel+"/"+e.Name(), depth+1, budget) {
			return true
		}
	}
	return false
}

func deskSort(items []deskItem) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Kind != items[j].Kind {
			return items[i].Kind == "folder"
		}
		return strings.ToLower(items[i].Title) < strings.ToLower(items[j].Title)
	})
}

// list: the icons for the desktop.
func (d *desktopStore) list() []deskItem {
	items := []deskItem{}
	root := d.open()
	if root == nil {
		return items
	}
	defer root.Close()
	fsys := root.FS()
	entries, err := fs.ReadDir(fsys, ".")
	if err != nil {
		return items
	}
	budget := desktopScanBudget
	for _, e := range entries {
		n := e.Name()
		if !deskValidName(n) || deskHidden(n) {
			continue
		}
		switch {
		case e.Type().IsRegular() && deskTextKind(n) != "":
			it := deskItem{Kind: "text", Name: n, Title: strings.TrimSuffix(n, path.Ext(n)), Ext: deskTextKind(n)}
			if info, err := e.Info(); err == nil {
				it.Size, it.Mtime = info.Size(), info.ModTime().Unix()
			}
			items = append(items, it)
		case e.IsDir(): // a link to a folder has Type ModeSymlink, so it is not taken here
			if deskHasFiles(fsys, n, 1, &budget) {
				items = append(items, deskItem{Kind: "folder", Name: n, Title: n})
			}
		}
		if len(items) >= desktopMaxItems {
			break
		}
	}
	deskSort(items)
	return items
}

// contents: the visible folders (that hold files) and files of one folder, each in name order.
func deskContents(fsys fs.FS, rel string, depth int) (folders, files []deskItem) {
	entries, err := fs.ReadDir(fsys, rel)
	if err != nil {
		return nil, nil
	}
	budget := desktopScanBudget
	for _, e := range entries {
		switch {
		case deskVisible(e):
			it := deskItem{Kind: "file", Name: e.Name(), Title: e.Name()}
			if info, err := e.Info(); err == nil {
				it.Size, it.Mtime = info.Size(), info.ModTime().Unix()
			}
			if len(files) < desktopMaxFolderFiles {
				files = append(files, it)
			}
		case deskVisibleDir(e):
			if deskHasFiles(fsys, rel+"/"+e.Name(), depth+1, &budget) && len(folders) < desktopMaxFolderFiles {
				folders = append(folders, deskItem{Kind: "folder", Name: e.Name(), Title: e.Name()})
			}
		}
	}
	byName := func(s []deskItem) {
		sort.SliceStable(s, func(i, j int) bool { return strings.ToLower(s[i].Name) < strings.ToLower(s[j].Name) })
	}
	byName(folders)
	byName(files)
	return folders, files
}

// realPath checks every part of an address inside the desktop folder: each must exist and be a real folder (a link is refused), and the last part is
// a real folder (wantDir) or a real file.
func deskRealPath(root *os.Root, segs []string, wantDir bool) bool {
	for i := range segs {
		fi, err := root.Lstat(strings.Join(segs[:i+1], "/"))
		if err != nil || fi.Mode()&fs.ModeSymlink != 0 {
			return false
		}
		last := i == len(segs)-1
		if !last && !fi.IsDir() {
			return false
		}
		if last && wantDir && !fi.IsDir() {
			return false
		}
		if last && !wantDir && !fi.Mode().IsRegular() {
			return false
		}
	}
	return true
}

// openFile opens a file for download. Links are refused, and the root keeps everything inside the desktop folder.
func (d *desktopStore) openFile(segs []string) (*os.File, os.FileInfo, bool) {
	root := d.open()
	if root == nil {
		return nil, nil, false
	}
	defer root.Close()
	if !deskRealPath(root, segs, false) {
		return nil, nil, false
	}
	f, err := root.Open(strings.Join(segs, "/"))
	if err != nil {
		return nil, nil, false
	}
	fi, err := f.Stat()
	if err != nil || !fi.Mode().IsRegular() {
		f.Close()
		return nil, nil, false
	}
	return f, fi, true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// rangeStartsAtZero: a download that resumes in the middle is not counted again.
func rangeStartsAtZero(r *http.Request) bool {
	h := r.Header.Get("Range")
	return h == "" || strings.HasPrefix(h, "bytes=0-")
}

func registerDesktop(mux *http.ServeMux, cfg config) {
	if cfg.DesktopDir == "" || !cfg.Tools.boolSetting("desktop") {
		return // not registered: every desktop address answers 404
	}
	d := &desktopStore{dir: cfg.DesktopDir}
	mux.HandleFunc("GET /api/desktop", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"items": d.list()})
	})
	mux.HandleFunc("GET /api/desktop/folder", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("path")
		segs, ok := deskSegments(p, desktopMaxDepth, false)
		root := d.open()
		if !ok || root == nil {
			if root != nil {
				root.Close()
			}
			http.NotFound(w, r)
			return
		}
		defer root.Close()
		if !deskRealPath(root, segs, true) {
			http.NotFound(w, r)
			return
		}
		folders, files := deskContents(root.FS(), strings.Join(segs, "/"), len(segs))
		if len(folders) == 0 && len(files) == 0 {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"path": segs, "folders": folders, "files": files})
	})
	mux.HandleFunc("GET /api/desktop/text", func(w http.ResponseWriter, r *http.Request) {
		name := r.URL.Query().Get("name")
		kind := deskTextKind(name)
		root := d.open()
		if root == nil {
			http.NotFound(w, r)
			return
		}
		defer root.Close()
		if kind == "" || !deskValidName(name) || deskHidden(name) {
			http.NotFound(w, r)
			return
		}
		if fi, err := root.Lstat(name); err != nil || !fi.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		f, err := root.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		b, err := io.ReadAll(io.LimitReader(f, desktopMaxTextBytes+1))
		if err != nil {
			http.Error(w, "Could not read the file.", http.StatusInternalServerError)
			return
		}
		if len(b) > desktopMaxTextBytes {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "This file is too large to show here."})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"name": name, "kind": kind, "size": len(b), "text": strings.ToValidUTF8(string(b), "�")})
	})
	// The download. Always an attachment of an unknown type: the browser saves the file and never shows it, whatever it is.
	mux.HandleFunc("GET /desktop-files/{path...}", func(w http.ResponseWriter, r *http.Request) {
		segs, ok := deskSegments(r.PathValue("path"), desktopMaxDepth+1, true)
		if !ok || len(segs) < 2 { // a file on the desktop itself has no download address: it is shown, not downloaded
			http.NotFound(w, r)
			return
		}
		f, fi, ok := d.openFile(segs)
		if !ok {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		file := segs[len(segs)-1]
		if cfg.Visits != nil && r.Method == http.MethodGet && rangeStartsAtZero(r) {
			cfg.Visits.recordFile(r, "download", strings.Join(segs, "/"))
		}
		h := w.Header()
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file}))
		h.Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, file, fi.ModTime(), f)
	})
}
