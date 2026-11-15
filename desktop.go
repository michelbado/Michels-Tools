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
//   - A folder directly inside it becomes a folder icon, but only when it holds at least one visible file. Opening it lists the files; clicking one
//     always downloads it (it is never shown in the browser).
//   - Names starting with "." or "_" are not listed. Files inside a folder can still be downloaded by anyone who knows the exact address.
//
// Nothing outside the folder can be reached (os.Root refuses ".." and links that lead out), links are never followed, and there is no upload:
// files are added on the server only. Every download is written to the visit log with the time, the address, the browser and the file.
const (
	desktopMaxItems       = 300
	desktopMaxFolderFiles = 1000
	desktopMaxTextBytes   = 1 << 20
)

type deskItem struct {
	Kind  string `json:"kind"` // "text" or "folder"
	Name  string `json:"name"` // the real name on disk
	Title string `json:"title"`
	Ext   string `json:"ext,omitempty"` // "md" or "txt"
	Size  int64  `json:"size,omitempty"`
	Count int    `json:"count,omitempty"` // files in a folder
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

type desktopStore struct{ dir string }

// open gives the folder as a root that cannot be left (nil when it is missing).
func (d *desktopStore) open() *os.Root {
	r, err := os.OpenRoot(d.dir)
	if err != nil {
		return nil
	}
	return r
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
	entries, err := fs.ReadDir(root.FS(), ".")
	if err != nil {
		return items
	}
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
			if files := d.files(root, n); len(files) > 0 {
				items = append(items, deskItem{Kind: "folder", Name: n, Title: n, Count: len(files)})
			}
		}
		if len(items) >= desktopMaxItems {
			break
		}
	}
	deskSort(items)
	return items
}

// files: the visible files of one folder, in name order.
func (d *desktopStore) files(root *os.Root, folder string) []deskItem {
	entries, err := fs.ReadDir(root.FS(), folder)
	if err != nil {
		return nil
	}
	var out []deskItem
	for _, e := range entries {
		if !deskVisible(e) {
			continue
		}
		it := deskItem{Kind: "file", Name: e.Name(), Title: e.Name()}
		if info, err := e.Info(); err == nil {
			it.Size, it.Mtime = info.Size(), info.ModTime().Unix()
		}
		out = append(out, it)
		if len(out) >= desktopMaxFolderFiles {
			break
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name) })
	return out
}

// openFile opens folder/file for download. Links are refused, and the root keeps everything inside the desktop folder.
func (d *desktopStore) openFile(folder, file string) (*os.File, os.FileInfo, bool) {
	if !deskValidName(folder) || !deskValidName(file) {
		return nil, nil, false
	}
	root := d.open()
	if root == nil {
		return nil, nil, false
	}
	defer root.Close()
	if fi, err := root.Lstat(folder); err != nil || !fi.IsDir() {
		return nil, nil, false
	}
	if fi, err := root.Lstat(folder + "/" + file); err != nil || !fi.Mode().IsRegular() {
		return nil, nil, false
	}
	f, err := root.Open(folder + "/" + file)
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
		name := r.URL.Query().Get("name")
		root := d.open()
		if root == nil || !deskValidName(name) || deskHidden(name) {
			if root != nil {
				root.Close()
			}
			http.NotFound(w, r)
			return
		}
		defer root.Close()
		if fi, err := root.Lstat(name); err != nil || !fi.IsDir() {
			http.NotFound(w, r)
			return
		}
		files := d.files(root, name)
		if len(files) == 0 {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"name": name, "files": files})
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
	mux.HandleFunc("GET /desktop-files/{folder}/{file}", func(w http.ResponseWriter, r *http.Request) {
		folder, file := r.PathValue("folder"), r.PathValue("file")
		f, fi, ok := d.openFile(folder, file)
		if !ok {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		if cfg.Visits != nil && r.Method == http.MethodGet && rangeStartsAtZero(r) {
			cfg.Visits.recordFile(r, "download", folder+"/"+file)
		}
		h := w.Header()
		h.Set("Content-Type", "application/octet-stream")
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": file}))
		h.Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, file, fi.ModTime(), f)
	})
}
