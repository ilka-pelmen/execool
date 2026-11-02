import { useEffect, useRef } from "preact/hooks";

import { basicSetup } from "codemirror";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentMore, indentLess } from "@codemirror/commands"; // Добавили отступы
import { foldGutter, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";

// Импортируем функции для работы с autocomplete
import { acceptCompletion, completionStatus } from "@codemirror/autocomplete";

import { python } from "@codemirror/lang-python";

// Языки по расширению файла...
const LANGUAGES = {
  py: python,
};

function languageFor(path) {
  const extension = path.split(".").pop().toLowerCase();
  const factory = LANGUAGES[extension];
  return factory ? factory() : [];
}

const blackTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "#010101",
      color: "#ededed",
      fontSize: "15px",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      fontFamily: 'var(--mono, "JetBrains Mono", Consolas, monospace)',
      lineHeight: "20px",
    },
    ".cm-content": { 
      padding: "0", 
      caretColor: "#ffffff", 
      outline: "none" 
    },

    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#ffffff" },
    ".cm-gutters": {
      backgroundColor: "#020202",
      color: "#4a4a4a",
      border: "none",
    },
    ".cm-gutter-lint": { width: "0.1em" },
    ".cm-line": {
      padding: "2 2",
    },
    
    /* Делаем активную строку полупрозрачной, чтобы выделение под ней было видно */
    ".cm-activeLine": { 
      backgroundColor: "rgba(25, 25, 25, 0.6)" 
    },
    ".cm-activeLineGutter": { 
      backgroundColor: "#111111", 
      color: "#bdbdbd" 
    },
    
    /* Цвет и видимость выделения */
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "#343434 !important",
    },
    
    ".cm-selectionMatch": { backgroundColor: "#1f1f1f" },
    "&.cm-focused .cm-matchingBracket": {
      backgroundColor: "#2a2a2a",
      outline: "1px solid #333333",
    },
    ".cm-tooltip": {
      backgroundColor: "#0a0a0a",
      border: "1px solid #333333",
      color: "#ededed",
    },
    ".cm-panels": {
      backgroundColor: "#0a0a0a",
      color: "#ededed",
      borderColor: "#333333",
    },
    ".cm-scroller::-webkit-scrollbar": { width: "10px", height: "10px" },
    ".cm-scroller::-webkit-scrollbar-track": { background: "transparent" },
    ".cm-scroller::-webkit-scrollbar-thumb": {
      background: "#ffffff1a",
      borderRadius: "5px",
    },
    ".cm-scroller::-webkit-scrollbar-thumb:hover": { background: "#ffffff33" },
    ".cm-scroller::-webkit-scrollbar-thumb:active": { background: "#ffffff4d" },
  },
  { dark: true }
);

const editableCompartment = new Compartment();
const externalChange = Annotation.define();

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
  issues = [],
}) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const pathRef = useRef(filePath);
  const onChangeRef = useRef(onChange);

  onChangeRef.current = onChange;

  function createState(path, doc) {
    return EditorState.create({
      doc,
      extensions: [
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
        blackTheme,
        syntaxHighlighting(oneDarkHighlightStyle),
        editableCompartment.of(editableExtensions(readOnly)),
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

  // Остальной код компонента без изменений...
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

    view.dispatch(
      setDiagnostics(view.state, toDiagnostics(view.state.doc, issues))
    );
  }, [issues, filePath]);

  const slash = filePath.lastIndexOf("/");

  return (
    <div className="editor-panel">
      <div className="editor-tab">
        <span>
          {slash !== -1 && (
            <span className="file-dir">{filePath.slice(0, slash + 1)}</span>
          )}
          {filePath.slice(slash + 1)}
        </span>
        {readOnly && (
          <span className="editor-tab-label">
            Открой проект, чтобы редактировать
          </span>
        )}
      </div>

      <div
        className="editor-host"
        style={{ flex: 1, minHeight: 0 }}
        ref={hostRef}
      />
    </div>
  );
}