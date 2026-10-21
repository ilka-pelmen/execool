
export default function Terminal({
  output,
  exitCode,
  running,
  saveStatus,
}) {
  return (
    <section className="terminal">
      <div className="terminal-header">
        <span>Терминал / Вывод</span>

        <div className="terminal-meta">
          <span>
            {saveStatus === "saving"
              ? "Сохранение..."
              : saveStatus === "error"
                ? "Ошибка сохранения"
                : saveStatus === "saved"
                  ? "Все изменения сохранены"
                  : ""}
          </span>

          {exitCode !== null && (
            <span>
              Exit code: {exitCode}
            </span>
          )}
        </div>
      </div>

      <pre className="terminal-output">
        {running ? `${output}\nВыполнение программы...` : output}
      </pre>
    </section>
  );
}
