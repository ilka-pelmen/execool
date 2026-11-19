package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Браузер видит рабочую папку сессии как виртуальный корень, а не как настоящий путь
// на сервере. Адреса и тексты ошибок языкового сервера не раскрывают устройство
// файловой системы агента и идентификатор сессии, который входит в путь.
const (
	virtualRootPath = "/workspace"
	virtualRootURI  = "file:///workspace"

	// Заглушки стандартной библиотеки: Pyrefly распаковывает их во временную папку
	// и отдаёт оттуда адреса при переходе к определению (print, len, str...).
	virtualTypeshedPath = "/typeshed"
	virtualTypeshedURI  = "file:///typeshed"
)

// Ключи LSP, в которых лежат адреса файлов. Остальные строки (в первую очередь текст
// документов) при передаче на сервер не трогаем: иначе сместились бы позиции в файле.
var uriKeys = map[string]bool{
	"uri":       true,
	"rootUri":   true,
	"targetUri": true,
	"scopeUri":  true,
	"oldUri":    true,
	"newUri":    true,
}

type replacement struct {
	from []byte
	to   []byte
}

// pathMapper подменяет папку сессии в сообщениях LSP.
type pathMapper struct {
	realURI  string        // file:///tmp/execool-lsp/session-...
	toClient []replacement // настоящие пути -> виртуальный корень
}

func newPathMapper(dir string) *pathMapper {
	m := &pathMapper{realURI: fileURI(dir)}

	dirs := []string{dir}
	// Языковой сервер может назвать путь с раскрытыми символическими ссылками.
	if resolved, err := filepath.EvalSymlinks(dir); err == nil && resolved != dir {
		dirs = append(dirs, resolved)
	}

	for _, d := range dirs {
		// Сначала адрес, потом просто путь: так порядок замен не портит адреса.
		m.add(fileURI(d), virtualRootURI)
		m.add(slashPath(d), virtualRootPath)
		if strings.Contains(d, `\`) {
			// Путь Windows внутри JSON выглядит как C:\\Users\\...
			m.add(strings.ReplaceAll(d, `\`, `\\`), virtualRootPath)
		}
	}

	bundled := filepath.Join(os.TempDir(), "pyrefly_bundled")
	m.add(fileURI(bundled), virtualTypeshedURI)
	m.add(slashPath(bundled), virtualTypeshedPath)
	return m
}

func slashPath(dir string) string {
	p := filepath.ToSlash(dir)
	if !strings.HasPrefix(p, "/") {
		p = "/" + p // Windows: C:/... -> /C:/...
	}
	return p
}

func (m *pathMapper) add(from, to string) {
	if len(from) < 4 {
		return // слишком короткий путь заменил бы лишнее
	}
	m.toClient = append(m.toClient, replacement{from: []byte(from), to: []byte(to)})
}

// ToClient: сообщение языкового сервера -> браузеру. Заменяем настоящий путь везде,
// в том числе внутри текстов ошибок. Позиции в документах от этого не зависят.
func (m *pathMapper) ToClient(msg []byte) []byte {
	for _, r := range m.toClient {
		msg = bytes.ReplaceAll(msg, r.from, r.to)
	}
	return msg
}

// ToServer: сообщение браузера -> языковому серверу. Меняем только адреса в полях
// uri/rootUri и подобных. Если замен нет или сообщение не разобрать, оно уходит как есть.
func (m *pathMapper) ToServer(msg []byte) []byte {
	if !bytes.Contains(msg, []byte(virtualRootURI)) {
		return msg
	}

	decoder := json.NewDecoder(bytes.NewReader(msg))
	decoder.UseNumber() // числа остаются такими, какими пришли
	var root any
	if err := decoder.Decode(&root); err != nil {
		return msg
	}
	if !m.rewriteURIs(root) {
		return msg
	}

	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(root); err != nil {
		return msg
	}
	return bytes.TrimRight(out.Bytes(), "\n")
}

func (m *pathMapper) rewriteURIs(node any) bool {
	changed := false

	switch value := node.(type) {
	case map[string]any:
		for key, item := range value {
			if text, ok := item.(string); ok && uriKeys[key] {
				if mapped, ok := m.uriToReal(text); ok {
					value[key] = mapped
					changed = true
				}
				continue
			}
			if m.rewriteURIs(item) {
				changed = true
			}
		}
	case []any:
		for _, item := range value {
			if m.rewriteURIs(item) {
				changed = true
			}
		}
	}
	return changed
}

func (m *pathMapper) uriToReal(uri string) (string, bool) {
	if uri == virtualRootURI {
		return m.realURI, true
	}
	if strings.HasPrefix(uri, virtualRootURI+"/") {
		return m.realURI + uri[len(virtualRootURI):], true
	}
	return "", false
}
