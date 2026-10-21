const SAVE_LABELS = {
  saving: "Сохранение…",
  saved: "Все изменения сохранены",
  error: "Ошибка сохранения",
};

export default function Terminal({ output, exitCode, running, saveStatus }) {
  return (
    <section className="terminal">
      <div className="terminal-header">
        <span>Вывод</span>

        <div className="terminal-meta">
          <span>{SAVE_LABELS[saveStatus] ?? ""}</span>

          {running && <span>Выполняется…</span>}

          {!running && exitCode !== null && (
            <span
              className={`exit-code ${exitCode === 0 ? "exit-ok" : "exit-fail"}`}
            >
              Код выхода: {exitCode}
            </span>
          )}
        </div>
      </div>

      <pre className="terminal-output">{output}</pre>
    </section>
  );
}
