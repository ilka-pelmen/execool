import { useEffect, useRef } from "preact/hooks";

const SAVE_LABELS = {
  unsaved: "Не сохранено",
  saved: "Сохранено в браузере",
  error: "Не удалось сохранить",
};

export default function Terminal({ lines, exitCode, running, saveStatus }) {
  const outputRef = useRef(null);

  useEffect(() => {
    const element = outputRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines]);

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

      <pre className="terminal-output" ref={outputRef}>
        {lines.length === 0 && !running && (
          <span className="out-hint">Вывод программы появится здесь.</span>
        )}
        {lines.map((line, index) => (
          <span key={index} className={line.stream === "stderr" ? "out-err" : ""}>
            {line.text}
            {"\n"}
          </span>
        ))}
      </pre>
    </section>
  );
}
