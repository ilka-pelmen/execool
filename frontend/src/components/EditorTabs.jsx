import { Icon } from "./Icons.jsx";

function splitPath(path) {
  const index = path.lastIndexOf("/");
  return { dir: path.slice(0, index + 1), name: path.slice(index + 1) };
}

/** Вкладки открытых файлов. Средняя кнопка мыши закрывает вкладку. */
export default function EditorTabs({ tabs, active, onSelect, onClose }) {
  if (tabs.length === 0) return null;

  // Если имена совпадают (a/utils.py и b/utils.py), показываем и папку.
  const names = tabs.map((path) => splitPath(path).name);

  return (
    <div className="tabs" role="tablist">
      {tabs.map((path, index) => {
        const { dir, name } = splitPath(path);
        const duplicate = names.indexOf(name) !== index || names.lastIndexOf(name) !== index;

        return (
          <div
            key={path}
            role="tab"
            aria-selected={path === active}
            className={`tab${path === active ? " active" : ""}`}
            title={path}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(path);
              }
            }}
          >
            <button type="button" className="tab-main" onClick={() => onSelect(path)}>
              {duplicate && dir && <span className="file-dir">{dir}</span>}
              {name}
            </button>
            <button
              type="button"
              className="tab-close"
              onClick={() => onClose(path)}
              aria-label={`Закрыть ${path}`}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
