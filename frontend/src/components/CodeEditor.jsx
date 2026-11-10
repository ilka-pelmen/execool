import Editor from "@monaco-editor/react";

const LANGUAGES = {
  py: "python",
  js: "javascript",
  json: "json",
  html: "html",
  css: "css",
  md: "markdown",
};

const THEME = "execool-black";

function defineTheme(monaco) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#010101",
      "editor.foreground": "#ededed",
      "editorGutter.background": "#020202",
      "editor.lineHighlightBackground": "#0d0d0d",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#2a2a2a",
      "editor.inactiveSelectionBackground": "#1a1a1a",
      "editorLineNumber.foreground": "#4a4a4a",
      "editorLineNumber.activeForeground": "#bdbdbd",
      "editorCursor.foreground": "#ffffff",
      "editorIndentGuide.background1": "#1a1a1a",
      "editorIndentGuide.activeBackground1": "#333333",
      "editorWidget.background": "#0a0a0a",
      "editorWidget.border": "#333333",
      "scrollbarSlider.background": "#ffffff1a",
      "scrollbarSlider.hoverBackground": "#ffffff33",
      "scrollbarSlider.activeBackground": "#ffffff4d",
    },
  });
}

export default function CodeEditor({
  filePath,
  value,
  onChange,
  readOnly = false,
}) {
  const extension = filePath.split(".").pop().toLowerCase();
  const language = LANGUAGES[extension] ?? "plaintext";
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

      <div className="monaco-container">
        <Editor
          height="100%"
          language={language}
          theme={THEME}
          beforeMount={defineTheme}
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 14,
            lineHeight: 22,
            fontFamily:
              '"JetBrains Mono", "Cascadia Code", Consolas, monospace',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            overviewRulerBorder: false,
            padding: { top: 16 },
            lineNumbersMinChars: 2,
            glyphMargin: false,
            folding: true,
            lineDecorationsWidth: 5,
          }}
        />
      </div>
    </div>
  );
}
