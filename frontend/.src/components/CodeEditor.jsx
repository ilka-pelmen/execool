
import Editor from "@monaco-editor/react";

export default function CodeEditor({
  filePath,
  value,
  onChange,
  readOnly = false,
}) {
  const language = filePath.endsWith(".py")
    ? "python"
    : filePath.endsWith(".js")
      ? "javascript"
      : filePath.endsWith(".json")
        ? "json"
        : filePath.endsWith(".html")
          ? "html"
          : filePath.endsWith(".css")
            ? "css"
            : "plaintext";

  return (
    <div className="editor-panel">
      <div className="editor-tab">
        <span>{filePath}</span>
        <span className="editor-tab-label">Editor</span>
      </div>

      <div className="monaco-container">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? "")}
          options={{
            readOnly,
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: "Consolas, monospace",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 16 },
          }}
        />
      </div>
    </div>
  );
}
