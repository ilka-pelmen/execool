import { Icon } from "./Icons.jsx";
import { countFiles, formatDate } from "../services/format.js";

const WASM_SUPPORTED =
  typeof WebAssembly === "object" && typeof WebAssembly.instantiate === "function";

const WASM_TIP = "Браузер должен поддерживать wasm runtime";
const WASM_TIP_MISSING = "Этот браузер не поддерживает WebAssembly, проект открыть нельзя";

const WasmBadge = ({ tip, size = 40 }) => (
  <span className="wasm-badge" data-tooltip={tip} aria-label={`WebAssembly. ${tip}`}>
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M19.153,2.35V2.5a3.2,3.2,0,1,1-6.4,0h0V2.35H2V30.269H29.919V2.35Z"
        fill="none"
        stroke-linejoin="round"
      />
      <path
        d="M8.485,17.4h1.85L11.6,24.123h.023L13.14,17.4h1.731l1.371,6.81h.027l1.44-6.81h1.815l-2.358,9.885H15.329l-1.36-6.728h-.036l-1.456,6.728h-1.87Zm13.124,0h2.917l2.9,9.885H25.515l-.63-2.2H21.562l-.486,2.2H19.217Zm1.11,2.437-.807,3.627h2.512L23.5,19.832Z"
        stroke="none"
      />
    </svg>
  </span>
);

export default function StartScreen({
  types,
  projects,
  onOpen,
  onDelete,
  onSelect,
  onImport,
}) {
  const [latest, ...others] = projects;

  return (
    <main className="start">
      <div className="start-card">
        <div className="start-brand">
          <span className="brand-mark">&lt;/&gt;</span>
          <span>Execool</span>
        </div>

        {latest && (
          <button type="button" className="start-continue" onClick={() => onOpen(latest.id)}>
            <span className="start-item-main">
              <span className="start-item-name">Продолжить: {latest.name}</span>
              <span className="start-item-desc">
                {countFiles(latest.fileCount)} · {formatDate(latest.updatedAt)}
              </span>
            </span>
            <span className="start-continue-arrow" aria-hidden="true">
              →
            </span>
          </button>
        )}

        {others.length > 0 && (
          <>
            <h2 className="start-title">Недавние проекты</h2>
            <ul className="start-list">
              {others.map((item) => (
                <li key={item.id} className="start-row">
                  <button type="button" className="start-item" onClick={() => onOpen(item.id)}>
                    <span className="start-item-main">
                      <span className="start-item-name">{item.name}</span>
                      <span className="start-item-desc">
                        {countFiles(item.fileCount)} · {formatDate(item.updatedAt)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger start-delete"
                    title="Удалить проект"
                    aria-label={`Удалить проект ${item.name}`}
                    onClick={() => onDelete(item)}
                  >
                    <Icon name="trash" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="start-title">Новый проект</h2>
        <ul className="start-list">
          {types.map((type) => {
            const needsWasm = type.runtime === "wasm";
            const unavailable = needsWasm && !WASM_SUPPORTED;
            const tip = unavailable ? WASM_TIP_MISSING : WASM_TIP;

            return (
              <li key={type.id}>
                <button
                  type="button"
                  className="start-item"
                  onClick={() => onSelect(type.id)}
                  disabled={unavailable}
                >
                  <span className="start-item-main">
                    <span className="start-item-name">{type.name}</span>
                    <span className="start-item-desc">{type.description}</span>
                  </span>
                  {needsWasm && <WasmBadge tip={tip} />}
                </button>
              </li>
            );
          })}
        </ul>

        <h2 className="start-title">Импорт</h2>
        <div className="start-import">
          <button type="button" className="btn btn-ghost" onClick={() => onImport("zip")}>
            <Icon name="download" size={14} />
            ZIP-проект
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onImport("folder")}>
            <Icon name="folder" size={14} />
            Папка
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onImport("files")}>
            <Icon name="file" size={14} />
            Файлы
          </button>
        </div>
        <p className="start-note">…или просто перетащи файлы, папку или ZIP в это окно.</p>
      </div>
    </main>
  );
}
