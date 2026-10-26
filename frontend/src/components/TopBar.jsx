const STATUS_LABELS = {
  idle: "Python не загружен",
  loading: "Загрузка Python…",
  ready: "Python готов",
  running: "Выполняется…",
  error: "Ошибка загрузки Python",
};

export default function TopBar({
  projectName,
  typeName,
  runtimeStatus,
  running,
  canExport,
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
