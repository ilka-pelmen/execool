import { useEffect, useRef, useState } from "preact/hooks";

import { countFiles } from "../services/format.js";
import { useZoom } from "../services/useZoom.js";
import { Icon } from "./Icons.jsx";
import Menu from "./Menu.jsx";
import ZoomBadge from "./ZoomBadge.jsx";

// Плоский список путей -> строки дерева с отступами.
function buildRows(files, collapsed) {
  const root = { dirs: new Map(), files: [], count: 0 };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      if (!node.dirs.has(parts[i])) {
        node.dirs.set(parts[i], { name: parts[i], path, dirs: new Map(), files: [], count: 0 });
      }
      node = node.dirs.get(parts[i]);
      node.count++;
    }
    node.files.push({ name: parts[parts.length - 1], path: file.path });
  }

  const rows = [];
  (function walk(node, depth) {
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const dir of dirs) {
      rows.push({ type: "dir", depth, name: dir.name, path: dir.path, count: dir.count });
      if (!collapsed.has(dir.path)) walk(dir, depth + 1);
    }
    for (const file of node.files.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push({ type: "file", depth, name: file.name, path: file.path });
    }
  })(root, 0);

  return rows;
}

const extensionOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");

export default function FileExplorer({
  files,
  activeFile,
  onSelect,
  onCreate,
  onDelete,
  onDeleteFolder,
  onImport,
}) {
  const zoom = useZoom("explorer", { base: 13, min: 10, max: 24 });

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null); // { type, path, count }
  const [collapsed, setCollapsed] = useState(() => new Set());
  const inputRef = useRef(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  // Открыли файл (например, переходом к определению): раскрываем его папки.
  useEffect(() => {
    if (!activeFile || !activeFile.includes("/")) return;

    const parts = activeFile.split("/").slice(0, -1);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
    setCollapsed((current) => {
      if (!ancestors.some((path) => current.has(path))) return current;
      const next = new Set(current);
      ancestors.forEach((path) => next.delete(path));
      return next;
    });
  }, [activeFile]);

  function startCreate(prefix = "") {
    setCreating(true);
    setDraft(prefix);
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

  function toggleDir(path) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function confirmDelete() {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target.type === "dir") onDeleteFolder(target.path);
    else onDelete(target.path);
  }

  const rows = buildRows(files, collapsed);

  return (
    <aside
      className="explorer"
      ref={zoom.ref}
      style={{ "--ui-font-size": `${zoom.size}px` }}
      aria-label="Файлы проекта"
    >
      <div className="panel-header">
        <span className="panel-label">Файлы</span>
        <div className="panel-actions">
          <button
            type="button"
            className="icon-btn icon-btn-small"
            onClick={() => startCreate()}
            title="Новый файл"
            aria-label="Новый файл"
          >
            <Icon name="plus" size={15} />
          </button>
          <Menu
            icon="upload"
            title="Импорт"
            align="right"
            items={[
              { label: "Файлы…", icon: "file", hint: "Один или несколько", onClick: () => onImport("files") },
              { label: "Папку…", icon: "folder", hint: "Со всем содержимым", onClick: () => onImport("folder") },
              { label: "ZIP-проект…", icon: "download", hint: "Распакуется в проект", onClick: () => onImport("zip") },
            ]}
          />
        </div>
      </div>

      <div className="tree">
        {creating && (
          <div className="tree-new">
            <input
              ref={inputRef}
              className="text-input"
              value={draft}
              placeholder="src/helpers.py"
              spellcheck={false}
              autocomplete="off"
              aria-label="Имя нового файла"
              onInput={(event) => {
                setDraft(event.currentTarget.value);
                setError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCreate();
                } else if (event.key === "Escape") {
                  cancelCreate();
                }
              }}
              onBlur={() => {
                if (!draft.trim()) cancelCreate();
              }}
            />
            {error && <p className="field-error">{error}</p>}
          </div>
        )}

        {rows.map((row) => {
          const style = { paddingLeft: `${6 + row.depth * 14}px` };

          if (pendingDelete?.path === row.path && pendingDelete.type === row.type) {
            return (
              <div className="tree-confirm" key={`${row.type}:${row.path}`} style={style}>
                <span>
                  {row.type === "dir"
                    ? `Удалить папку ${row.path} (${countFiles(pendingDelete.count)})?`
                    : `Удалить ${row.path}?`}
                </span>
                <div className="tree-confirm-actions">
                  <button type="button" className="text-btn text-btn-danger" onClick={confirmDelete}>
                    Удалить
                  </button>
                  <button type="button" className="text-btn" onClick={() => setPendingDelete(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            );
          }

          if (row.type === "dir") {
            const open = !collapsed.has(row.path);
            return (
              <div className="tree-row" key={`dir:${row.path}`} style={style}>
                <button
                  type="button"
                  className="tree-main"
                  onClick={() => toggleDir(row.path)}
                  aria-expanded={open}
                >
                  <Icon name={open ? "chevronDown" : "chevron"} size={12} />
                  <Icon name="folder" size={15} />
                  <span className="tree-name">{row.name}</span>
                </button>
                <div className="tree-actions">
                  <button
                    type="button"
                    className="icon-btn icon-btn-small"
                    title="Новый файл в папке"
                    aria-label={`Новый файл в ${row.path}`}
                    onClick={() => startCreate(`${row.path}/`)}
                  >
                    <Icon name="plus" size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-small icon-btn-danger"
                    title="Удалить папку"
                    aria-label={`Удалить папку ${row.path}`}
                    onClick={() => {
                      cancelCreate();
                      setPendingDelete({ type: "dir", path: row.path, count: row.count });
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              className={`tree-row${activeFile === row.path ? " active" : ""}`}
              key={`file:${row.path}`}
              style={style}
            >
              <button type="button" className="tree-main" onClick={() => onSelect(row.path)}>
                <span className="tree-spacer" />
                <span className={`file-icon ext-${extensionOf(row.name)}`}>
                  <Icon name="file" size={15} />
                </span>
                <span className="tree-name">{row.name}</span>
              </button>
              <div className="tree-actions">
                <button
                  type="button"
                  className="icon-btn icon-btn-small icon-btn-danger"
                  title="Удалить файл"
                  aria-label={`Удалить ${row.path}`}
                  onClick={() => {
                    cancelCreate();
                    setPendingDelete({ type: "file", path: row.path, count: 1 });
                  }}
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            </div>
          );
        })}

        {files.length === 0 && !creating && (
          <div className="tree-empty">
            <p>Проект пуст.</p>
            <p>Перетащи сюда файлы, папку или ZIP, либо:</p>
            <div className="tree-empty-actions">
              <button type="button" className="btn btn-ghost" onClick={() => startCreate()}>
                <Icon name="plus" size={14} />
                Создать файл
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onImport("files")}>
                <Icon name="upload" size={14} />
                Импорт файлов
              </button>
            </div>
          </div>
        )}
      </div>

      <ZoomBadge zoom={zoom} />
    </aside>
  );
}
