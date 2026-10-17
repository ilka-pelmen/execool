
export default function FileExplorer({
  files,
  activeFile,
  onSelect,
}) {
  return (
    <aside className="file-explorer">
      <div className="panel-heading">Проводник</div>

      <div className="project-folder">
        <span>▾</span> MYAPP
      </div>

      <div className="file-list">
        {files.map((file) => (
          <button
            key={file.path}
            className={`file-item ${
              activeFile === file.path ? "active" : ""
            }`}
            onClick={() => onSelect(file.path)}
          >
            <span className="file-icon">
              {file.path.endsWith(".py")
                ? "Py"
                : file.path.endsWith(".txt")
                  ? "≡"
                  : "JS"}
            </span>
            <span>{file.path}</span>
            {file.dirty && <span className="dirty-dot" />}
          </button>
        ))}
      </div>
    </aside>
  );
}
