const STATUS_LABELS = {
  ready: "Онлайн",
  starting: "Подключение…",
  closing: "Отключение…",
  error: "Ошибка",
};

export default function TopBar({
  projectName,
  status,
  sessionReady,
  running,
  canExport,
  onOpen,
  onRun,
  onExport,
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">&lt;/&gt;</span>
        <span>Execool</span>
      </div>

      <div className="topbar-right">
        <span className={`status status-${status}`}>
          <span className="status-dot" />
          {STATUS_LABELS[status] ?? "Не подключено"}
        </span>

        <button
          className="button"
          onClick={onExport}
          disabled={!canExport}
          title={`Скачать ${projectName}.zip`}
        >
          Экспорт
        </button>

        {!sessionReady && (
          <button
            className="button"
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
          {running ? "Запуск…" : "Запустить"}
        </button>
      </div>
    </header>
  );
}
