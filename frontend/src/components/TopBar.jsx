const STATUS_LABELS = {
  idle: "Python не загружен",
  loading: "Загрузка Python…",
  ready: "Python готов",
  running: "Выполняется…",
  error: "Ошибка загрузки Python",
};

const LSP_LABELS = {
  off: "Подсказки выкл",
  connecting: "Подключение…",
  ready: "Подсказки вкл",
  reconnecting: "Переподключение…",
  error: "Подсказки недоступны",
};

// Классы точки совпадают с индикатором Python.
const LSP_DOT = {
  off: "idle",
  connecting: "loading",
  ready: "ready",
  reconnecting: "loading",
  error: "error",
};

const LSP_HINT =
  "Подсказки, ошибки и переход к определению от языкового сервера. " +
  "При включении код проекта отправляется на сервер.";

export default function TopBar({
  projectName,
  typeName,
  runtimeStatus,
  running,
  canExport,
  lspEnabled,
  lspStatus,
  lspMessage,
  onToggleLsp,
  onRetryLsp,
  onRun,
  onStop,
  onExport,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">&lt;/&gt;</span>
        <span>Execool</span>
        <span className="brand-project">
          {projectName} · {typeName}
        </span>
      </div>

      <div className="topbar-right">
        <div className="lsp-toggle">
          <button
            type="button"
            role="switch"
            aria-checked={lspEnabled}
            aria-label="Подсказки языкового сервера"
            className={`switch${lspEnabled ? " switch-on" : ""}`}
            title={LSP_HINT}
            onClick={onToggleLsp}
          >
            <span className="switch-thumb" />
          </button>

          <span
            className={`status status-${LSP_DOT[lspStatus] ?? "idle"}`}
            title={lspMessage || LSP_HINT}
          >
            <span className="status-dot" />
            {lspStatus === "error" && lspMessage
              ? lspMessage
              : LSP_LABELS[lspStatus] ?? ""}
          </span>

          {lspStatus === "error" && (
            <button type="button" className="button" onClick={onRetryLsp}>
              Повторить
            </button>
          )}
        </div>

        <span className={`status status-${runtimeStatus}`}>
          <span className="status-dot" />
          {STATUS_LABELS[runtimeStatus] ?? ""}
        </span>

        <button className="button" onClick={onExport} disabled={!canExport}>
          Экспорт
        </button>

        {running ? (
          <button className="button" onClick={onStop}>
            Остановить
          </button>
        ) : (
          <button className="button button-run" onClick={onRun}>
            Запустить
          </button>
        )}
      </div>
    </header>
  );
}
