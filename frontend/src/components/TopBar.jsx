
export default function TopBar({
  projectName,
  status,
  sessionReady,
  running,
  onOpen,
  onRun,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">&lt;/&gt;</span>
        <span>{projectName}</span>
      </div>

      <div className="topbar-right">
        <span className={`status status-${status}`}>
          <span className="status-dot" />
          {status === "ready"
            ? "Онлайн"
            : status === "starting"
              ? "Подключение..."
              : status === "error"
                ? "Ошибка"
                : "Не подключено"}
        </span>

        {!sessionReady && (
          <button
            className="button button-secondary"
            onClick={onOpen}
            disabled={status === "starting"}
          >
            Открыть проект
          </button>
        )}

        <button
          className="button button-run"
          onClick={onRun}
          disabled={!sessionReady || running}
        >
          {running ? "Запуск..." : "▶️ Run"}
        </button>
      </div>
    </header>
  );
}
