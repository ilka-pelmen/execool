package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const maskTestDir = "/tmp/execool-lsp/session-abc"

func TestPathMapperHidesRealPathFromClient(t *testing.T) {
	m := newPathMapper(maskTestDir)
	in := "{\"params\":{\"uri\":\"file://" + maskTestDir + "/main.py\"," +
		"\"diagnostics\":[{\"message\":\"looked in \\\"" + maskTestDir + "\\\"\"}]}}"

	out := string(m.ToClient([]byte(in)))

	if strings.Contains(out, "execool-lsp") || strings.Contains(out, "session-abc") {
		t.Fatalf("настоящий путь не скрыт: %s", out)
	}
	for _, want := range []string{`"uri":"file:///workspace/main.py"`, `looked in \"/workspace\"`} {
		if !strings.Contains(out, want) {
			t.Fatalf("нет %q в %s", want, out)
		}
	}
}

func TestPathMapperMapsClientURIsOnly(t *testing.T) {
	m := newPathMapper(maskTestDir)
	in := `{"id":12345678901234567890,"params":{"rootUri":"file:///workspace",` +
		`"textDocument":{"uri":"file:///workspace/main.py",` +
		`"text":"p = \"file:///workspace/x\"\nq = \"/workspace\""}}}`

	out := string(m.ToServer([]byte(in)))

	for _, want := range []string{
		`"rootUri":"file://` + maskTestDir + `"`,
		`"uri":"file://` + maskTestDir + `/main.py"`,
		// текст документа остался прежним: позиции в нём не должны сместиться
		`p = \"file:///workspace/x\"`,
		`q = \"/workspace\"`,
		// число не потеряло точность
		`12345678901234567890`,
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("нет %q в %s", want, out)
		}
	}
}

func TestPathMapperToServerLeavesOtherMessagesAlone(t *testing.T) {
	m := newPathMapper(maskTestDir)

	for _, in := range []string{
		`{"method":"initialized"}`,
		`{"params":{"uri":"file:///elsewhere/main.py"}}`,
		`not json, file:///workspace`,
	} {
		if got := string(m.ToServer([]byte(in))); got != in {
			t.Fatalf("сообщение изменилось: %q -> %q", in, got)
		}
	}
}

func TestPathMapperRoundTrip(t *testing.T) {
	m := newPathMapper(maskTestDir)
	original := `{"params":{"uri":"file://` + maskTestDir + `/pkg/util.py"}}`

	toBrowser := m.ToClient([]byte(original))
	back := string(m.ToServer(toBrowser))

	if back != original {
		t.Fatalf("после замены туда и обратно: %s", back)
	}
}

func TestPathMapperHidesBundledTypeshed(t *testing.T) {
	m := newPathMapper(maskTestDir)
	bundled := filepath.Join(os.TempDir(), "pyrefly_bundled")
	in := `{"result":[{"uri":"` + fileURI(bundled) + `/stdlib/builtins.pyi"}]}`

	out := string(m.ToClient([]byte(in)))

	if strings.Contains(out, "pyrefly_bundled") {
		t.Fatalf("путь к заглушкам не скрыт: %s", out)
	}
	if !strings.Contains(out, `"uri":"file:///typeshed/stdlib/builtins.pyi"`) {
		t.Fatalf("неожиданный ответ: %s", out)
	}
}
