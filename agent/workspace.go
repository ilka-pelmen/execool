package main

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

// ---- правила путей ----
const maxPathLength = 120

// Латиница, цифры и символы . _ - / (слеш нужен для вложенных папок).
var allowedPath = regexp.MustCompile(`^[A-Za-z0-9._\-/]+$`)

// Конфигурации анализатора не записываем в рабочую папку: через них проект мог бы
// изменить поведение языкового сервера (например, добавить чужие пути поиска).
var ignoredNamesByLanguage = map[string]map[string]bool{
	"python": {
		"pyrefly.toml":       true,
		".pyrefly.toml":      true,
		"pyproject.toml":     true,
		"pyrightconfig.json": true,
		"mypy.ini":           true,
		"setup.cfg":          true,
		"tox.ini":            true,
	},
}

func isIgnored(language, p string) bool {
	names := ignoredNamesByLanguage[strings.ToLower(language)]
	name := p[strings.LastIndex(p, "/")+1:]
	return names[strings.ToLower(name)]
}

func validatePath(p string) error {
	if p == "" {
		return invalidPath("Не указан путь файла")
	}
	if len(p) > maxPathLength {
		return invalidPath("Путь длиннее %d символов", maxPathLength)
	}
	if !allowedPath.MatchString(p) {
		return invalidPath("Допустимы латиница, цифры и символы . _ - /")
	}
	if strings.HasPrefix(p, "/") || strings.HasSuffix(p, "/") {
		return invalidPath("Путь не должен начинаться или заканчиваться на /")
	}
	for _, segment := range strings.Split(p, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return invalidPath("Недопустимый путь: %s", p)
		}
	}
	return nil
}

// ---- рабочая папка ----
type Limits struct {
	MaxFiles      int
	MaxFileBytes  int64
	MaxTotalBytes int64
}

type FileEntry struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// Workspace: файлы проекта на диске. Все проверки выполняются до изменения диска,
// запись атомарная (временный файл и переименование).
// Файлы пишет только агент по строго проверенным путям, поэтому симлинков в папке нет.
type Workspace struct {
	mu       sync.Mutex
	root     string
	language string
	limits   Limits
	sizes    map[string]int64
	total    int64
}

func NewWorkspace(root string, limits Limits, language string) *Workspace {
	return &Workspace{
		root:     filepath.Clean(root),
		language: strings.ToLower(language),
		limits:   limits,
		sizes:    make(map[string]int64),
	}
}

func (w *Workspace) FileCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.sizes)
}

func (w *Workspace) Paths() []string {
	w.mu.Lock()
	defer w.mu.Unlock()
	paths := w.keys()
	sort.Strings(paths)
	return paths
}

// Write записывает один файл. Файлы-конфигурации анализатора молча пропускаются.
func (w *Workspace) Write(path string, content []byte) error {
	if err := validatePath(path); err != nil {
		return err
	}
	if isIgnored(w.language, path) {
		return nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if err := w.checkFileSize(path, int64(len(content))); err != nil {
		return err
	}
	if err := checkConflicts(path, w.keys()); err != nil {
		return err
	}
	old, exists := w.sizes[path]
	if !exists && len(w.sizes)+1 > w.limits.MaxFiles {
		return w.tooManyFiles()
	}
	if w.total-old+int64(len(content)) > w.limits.MaxTotalBytes {
		return w.sessionTooLarge()
	}
	return w.store(path, content)
}

// Delete удаляет файл. Если файла нет, ничего не происходит.
func (w *Workspace) Delete(path string) error {
	if err := validatePath(path); err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if _, exists := w.sizes[path]; !exists {
		return nil
	}
	return w.remove(path)
}

// ReplaceAll заменяет весь набор файлов. Сначала проверяется весь набор, потом меняется диск.
func (w *Workspace) ReplaceAll(files []FileEntry) error {
	if len(files) > w.limits.MaxFiles {
		return w.tooManyFiles()
	}
	incoming := make(map[string][]byte)
	var order []string
	seen := make(map[string]bool)
	var total int64
	for _, f := range files {
		if err := validatePath(f.Path); err != nil {
			return err
		}
		if seen[f.Path] {
			return invalidPath("Путь указан дважды: %s", f.Path)
		}
		seen[f.Path] = true
		if isIgnored(w.language, f.Path) {
			continue
		}
		content := []byte(f.Content)
		if err := w.checkFileSize(f.Path, int64(len(content))); err != nil {
			return err
		}
		total += int64(len(content))
		incoming[f.Path] = content
		order = append(order, f.Path)
	}
	if total > w.limits.MaxTotalBytes {
		return w.sessionTooLarge()
	}
	for i, p := range order {
		if err := checkConflicts(p, order[i+1:]); err != nil {
			return err
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()

	// Проверки прошли: убираем лишнее, затем пишем новое.
	for _, existing := range w.keys() {
		if _, keep := incoming[existing]; !keep {
			if err := w.remove(existing); err != nil {
				return err
			}
		}
	}
	for _, p := range order {
		if err := w.store(p, incoming[p]); err != nil {
			return err
		}
	}
	return nil
}

// ---- внутреннее (вызывается под w.mu) ----
func (w *Workspace) keys() []string {
	keys := make([]string, 0, len(w.sizes))
	for k := range w.sizes {
		keys = append(keys, k)
	}
	return keys
}

func (w *Workspace) store(path string, content []byte) error {
	target, err := w.resolve(path)
	if err != nil {
		return err
	}
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".upload-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	_, writeErr := tmp.Write(content)
	closeErr := tmp.Close()
	if writeErr != nil || closeErr != nil {
		os.Remove(tmpName)
		return errors.Join(writeErr, closeErr)
	}
	if err := os.Rename(tmpName, target); err != nil {
		os.Remove(tmpName)
		return err
	}
	w.total += int64(len(content)) - w.sizes[path]
	w.sizes[path] = int64(len(content))
	return nil
}

func (w *Workspace) remove(path string) error {
	target, err := w.resolve(path)
	if err != nil {
		return err
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	w.pruneEmptyDirs(filepath.Dir(target))
	w.total -= w.sizes[path]
	delete(w.sizes, path)
	return nil
}

// pruneEmptyDirs убирает опустевшие папки, чтобы потом можно было создать файл с таким именем.
func (w *Workspace) pruneEmptyDirs(dir string) {
	prefix := w.root + string(filepath.Separator)
	for strings.HasPrefix(dir, prefix) {
		if err := os.Remove(dir); err != nil {
			return // папка не пуста
		}
		dir = filepath.Dir(dir)
	}
}

func (w *Workspace) resolve(path string) (string, error) {
	target := filepath.Join(w.root, filepath.FromSlash(path))
	if !strings.HasPrefix(target, w.root+string(filepath.Separator)) {
		return "", invalidPath("Путь выходит за пределы проекта")
	}
	return target, nil
}

func (w *Workspace) checkFileSize(path string, size int64) error {
	if size > w.limits.MaxFileBytes {
		return newAPIError(413, "file_too_large", "Файл %s больше %d байт", path, w.limits.MaxFileBytes)
	}
	return nil
}

func (w *Workspace) tooManyFiles() error {
	return newAPIError(413, "too_many_files", "Не больше %d файлов", w.limits.MaxFiles)
}

func (w *Workspace) sessionTooLarge() error {
	return newAPIError(413, "session_too_large", "Суммарный размер файлов больше %d байт", w.limits.MaxTotalBytes)
}

func checkConflicts(path string, others []string) error {
	for _, other := range others {
		if other == path {
			continue
		}
		if strings.HasPrefix(path, other+"/") {
			return invalidPath("«%s» уже файл, в него нельзя вложить", other)
		}
		if strings.HasPrefix(other, path+"/") {
			return invalidPath("«%s» уже используется как папка", path)
		}
	}
	return nil
}
