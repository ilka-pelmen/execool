import { useEffect, useRef } from "preact/hooks";

import { basicSetup } from "codemirror";
import { Annotation, Compartment, EditorState, Prec, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentMore, indentLess } from "@codemirror/commands"; // Добавили отступы
import { defaultHighlightStyle, foldGutter, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

// Импортируем функции для работы с autocomplete
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";

import { python } from "@codemirror/lang-python";

import { useZoom } from "../services/useZoom.js";
import ZoomBadge from "./ZoomBadge.jsx";

// Языки по расширению файла...
const LANGUAGES = {
  py: python,
};

function languageFor(path) {
  const extension = path.split(".").pop().toLowerCase();
  const factory = LANGUAGES[extension];
  return factory ? factory() : [];
}

const editorTheme = (light) => EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--editor-bg)",
      color: "var(--text)",
      fontSize: "var(--editor-font-size, 14px)",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: 'var(--mono, "JetBrains Mono", Consolas, monospace)',
      lineHeight: "1.55",
    },
    ".cm-content": { 
      padding: "0", 
      caretColor: "var(--text)",
      outline: "none" 
    },

    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
    ".cm-gutters": {
      backgroundColor: "var(--editor-gutter)",
      color: "var(--faint)",
      border: "none",
    },
    ".cm-gutter-lint": { width: "0.1em" },
    ".cm-line": {
      padding: "0 6px",
    },
    
    /* Делаем активную строку полупрозрачной, чтобы выделение под ней было видно */
    ".cm-activeLine": { 
      backgroundColor: "var(--editor-active)"
    },
    ".cm-activeLineGutter": { 
      backgroundColor: "var(--selected)",
      color: "var(--text)"
    },
    
    /* Цвет и видимость выделения */
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--editor-selection) !important",
    },
    
    ".cm-selectionMatch": { backgroundColor: "var(--selected)" },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "var(--selected)",
      outline: "1px solid var(--line-strong)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--editor-tooltip)",
      border: "1px solid var(--line-strong)",
      color: "var(--text)",
    },
    ".cm-panels": {
      backgroundColor: "var(--editor-tooltip)",
      color: "var(--text)",
      borderColor: "var(--line-strong)",
    },
    ".cm-scroller::-webkit-scrollbar": { width: "10px", height: "10px" },
    ".cm-scroller::-webkit-scrollbar-track": { background: "transparent" },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      background: "color-mix(in srgb, var(--text) 12%, transparent)",
      borderRadius: "5px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": { background: "color-mix(in srgb, var(--text) 22%, transparent)" },
    ".cm-scroller::-webkit-scrollbar-thumb:active": { background: "color-mix(in srgb, var(--text) 32%, transparent)" },
  },
  { dark: !light }
);

const editableCompartment = new Compartment();
const lspCompartment = new Compartment();
const themeCompartment = new Compartment();
const externalChange = Annotation.define();

// Подсказки языкового сервера: расширение привязано к URI файла на агенте.
function lspExtensions(client, rootUri, path) {
  if (!client || !rootUri || !/\.pyi?$/i.test(path)) return [];
  return client.plugin(`${rootUri}/${path}`, "python");
}

function editableExtensions(readOnly) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

export function toDiagnostics(doc, issues) {
  const diagnostics = [];
  for (const issue of issues ?? []) {
    if (issue.line < 1 || issue.line > doc.lines) continue;
    const startLine = doc.line(issue.line);
    const endLine = doc.line(
      Math.min(Math.max(issue.endLine, issue.line), doc.lines)
    );
    const from = Math.min(
      startLine.from + Math.max(issue.column - 1, 0),
      startLine.to
    );
    let to = Math.min(
      endLine.from + Math.max(issue.endColumn - 1, 0),
      endLine.to
    );
    if (to <= from) to = Math.min(from + 1, endLine.to);

    diagnostics.push({
      from,
      to,
      severity: issue.severity === "error" ? "error" : "warning",
      message: issue.message,
      source: issue.code ?? "ruff",
    });
  }
  return diagnostics;
}

export default function CodeEditor({
  filePath,
  value,
  onChange,
  readOnly = false,
  onRun,
  onSave,
  issues, // диагностика не от LSP; при включённых подсказках не передавать
  lspClient = null,
  lspRootUri = null,
  theme = "dark",
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const pathRef = useRef(filePath);
  const onChangeRef = useRef(onChange);
  const lspRef = useRef({ client: lspClient, rootUri: lspRootUri });
  const appliedClientRef = useRef(null); // клиент, с которым собрано текущее состояние редактора
  const onRunRef = useRef(onRun);
  const onSaveRef = useRef(onSave);
  const zoom = useZoom("editor", { base: 14, min: 8, max: 48 });

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  onSaveRef.current = onSave;
  lspRef.current = { client: lspClient, rootUri: lspRootUri };

  function createState(path, doc) {
    const { client, rootUri } = lspRef.current;
    appliedClientRef.current = client;

    return EditorState.create({
      doc,
      extensions: [
        // Выше стандартной раскладки: Ctrl+Enter в редакторе по умолчанию вставляет строку.
        Prec.highest(
          keymap.of([
            {
              key: "Mod-Enter",
              preventDefault: true,
              run: () => {
                onRunRef.current?.();
                return true;
              },
            },
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                onSaveRef.current?.();
                return true;
              },
            },
          ])
        ),
        basicSetup,
        keymap.of([
          {
            key: "Tab",
            run: (view) => {
              if (completionStatus(view.state)) {
                return acceptCompletion(view);
              }
              return indentMore(view);
            },
            shift: indentLess,
          },
        ]),
        languageFor(path),
        themeCompartment.of([
          editorTheme(theme === "light"),
          syntaxHighlighting(theme === "light" ? defaultHighlightStyle : oneDarkHighlightStyle),
        ]),
        editableCompartment.of(editableExtensions(readOnly)),
        lspCompartment.of(lspExtensions(client, rootUri, path)),
        EditorView.updateListener.of((update) => {
          const external = update.transactions.some((tr) =>
            tr.annotation(externalChange)
          );
          if (update.docChanged && !external) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });
  }

  useEffect(() => {
    const view = new EditorView({
      state: createState(filePath, value),
      parent: hostRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    if (pathRef.current !== filePath) {
      pathRef.current = filePath;
      view.setState(createState(filePath, value));
      return;
    }

    const doc = view.state.doc;
    if (doc.length !== value.length || doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: value },
        annotations: externalChange.of(true),
      });
    }
  }, [filePath, value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure(editableExtensions(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
  const view = viewRef.current;
  if (!view) return;

  view.requestMeasure();

  // Временная вставка и удаление пробела: документ меняется, гаттер пересчитывается.
  // externalChange не даёт вызвать onChange, addToHistory(false) не добавляет шаги в undo.
  view.dispatch({
    changes: { from: 0, insert: " " },
    annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
  });
  view.dispatch({
    changes: { from: 0, to: 1 },
    annotations: [externalChange.of(true), Transaction.addToHistory.of(false)],
  });
}, [zoom.size]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.reconfigure([
        editorTheme(theme === "light"),
        syntaxHighlighting(theme === "light" ? defaultHighlightStyle : oneDarkHighlightStyle),
      ]),
    });
  }, [theme]);

  // Клиент LSP появился, пропал или заменился (переподключение): меняем расширение.
  // При смене файла состояние собирается заново в createState, этот эффект тогда ничего не делает.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || appliedClientRef.current === lspClient) return;

    appliedClientRef.current = lspClient;
    view.dispatch({
      effects: lspCompartment.reconfigure(
        lspExtensions(lspClient, lspRootUri, pathRef.current)
      ),
    });

    // Без клиента старые подчёркивания остались бы в тексте.
    if (!lspClient) view.dispatch(setDiagnostics(view.state, []));
  }, [lspClient, lspRootUri]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !issues) return;

    view.dispatch(
      setDiagnostics(view.state, toDiagnostics(view.state.doc, issues))
    );
  }, [issues, filePath]);

  return (
    <div
      className="editor-panel"
      ref={zoom.ref}
      style={{ "--editor-font-size": `${zoom.size}px` }}
    >
      <div className="editor-host" ref={hostRef} />
      <ZoomBadge zoom={zoom} />
    </div>
  );
}
