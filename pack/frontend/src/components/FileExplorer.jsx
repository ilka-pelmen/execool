import { useEffect, useRef, useState } from "preact/hooks";

function splitPath(path) {
  const index = path.lastIndexOf("/");
  return index === -1
    ? { dir: "", name: path }
    : { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

export default function FileExplorer({
  projectName,
  files,
  activeFile,
  onSelect,
  onCreate,
  onDelete,
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  function startCreate() {
    setCreating(true);
    setDraft("");
    setError("");
    setPendingDelete(null);
  }

  function cancelCreate() {
    setCreating(false);
    setDraft("");
    setError("");
  }

  function submitCreate() {
    const result = onCreate(draft);
    if (result?.error) {
      setError(result.error);
      return;
    }
    cancelCreate();
  }

  function handleKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      submitCreate();
    } else if (event.key === "Escape") {
      cancelCreate();
    }
  }

  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  return (
    <aside className="file-explorer">
      <div className="explorer-header">
        <span className="explorer-title">{projectName}</span>
        <button
          className="icon-button"
          onClick={startCreate}
          title="Новый файл"
          aria-label="Новый файл"
        >
          +
        </button>
      </div>

      <div className="file-list">
        {creating && (
          <div className="file-new">
            <input
              ref={inputRef}
              className="file-input"
              value={draft}
              placeholder="src/helpers.py"
              spellcheck={false}
              autocomplete="off"
              aria-label="Имя нового файла"
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setError("");
              }}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!draft.trim()) cancelCreate();
              }}
            />
            {error && <p className="file-error">{error}</p>}
          </div>
        )}

        {sorted.map((file) => {
          const { dir, name } = splitPath(file.path);

          if (pendingDelete === file.path) {
            return (
              <div className="file-confirm" key={file.path}>
                <span className="file-confirm-text">
                  Удалить {file.path}?
                </span>
                <div className="file-confirm-actions">
                  <button
                    className="text-button text-button-danger"
                    onClick={() => {
                      setPendingDelete(null);
                      onDelete(file.path);
                    }}
                  >
                    Удалить
                  </button>
                  <button
                    className="text-button"
                    onClick={() => setPendingDelete(null)}
                  >
                    Отмена
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={file.path}
              className={`file-row ${activeFile === file.path ? "active" : ""}`}
            >
              <button className="file-item" onClick={() => onSelect(file.path)}>
                <span className="file-label">
                  {dir && <span className="file-dir">{dir}</span>}
                  <span>{name}</span>
                </span>
                {file.dirty && <span className="dirty-dot" title="Не сохранено" />}
              </button>
              <button
                className="file-remove"
                onClick={() => {
                  cancelCreate();
                  setPendingDelete(file.path);
                }}
                title="Удалить файл"
                aria-label={`Удалить ${file.path}`}
              >
                ×
              </button>
            </div>
          );
        })}

        {files.length === 0 && !creating && (
          <p className="file-empty">Файлов нет. Создай первый кнопкой «+».</p>
        )}
      </div>
    </aside>
  );
}
