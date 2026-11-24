import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { splitPartial } from "../services/outputBuffer.js";
import { useZoom } from "../services/useZoom.js";
import { Icon } from "./Icons.jsx";
import ZoomBadge from "./ZoomBadge.jsx";

const STREAM_CLASS = { stderr: "out-err", stdin: "out-in" };

function Chunks({ chunks }) {
  return chunks.map((chunk, index) => (
    <span key={index} className={STREAM_CLASS[chunk.stream] ?? ""}>
      {chunk.text}
    </span>
  ));
}

/**
 * Интерактивный терминал: вывод программы и строка ввода сразу после приглашения input().
 * Ctrl+C - остановить, Ctrl+D - закрыть ввод, Ctrl+L - очистить, стрелки - история ввода.
 */
export default function Terminal({
  output,
  running,
  waitingInput,
  interactive,
  exitCode,
  collapsed,
  onInput,
  onEof,
  onInterrupt,
  onClear,
  onToggle,
}) {
  const zoom = useZoom("terminal", { base: 13, min: 8, max: 40 });

  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottom = useRef(true);
  const history = useRef([]);
  const historyIndex = useRef(-1);
  const [draft, setDraft] = useState("");

  const { done, partial } = useMemo(() => splitPartial(output), [output]);

  // Прокручиваем вниз, только если пользователь не листал вывод вверх.
  useEffect(() => {
    const element = bodyRef.current;
    if (element && stickToBottom.current) element.scrollTop = element.scrollHeight;
  }, [output, running, waitingInput, zoom.size, collapsed]);

  // Программа ждёт ввод: курсор сразу в строку ввода.
  useEffect(() => {
    if (waitingInput && !collapsed) inputRef.current?.focus({ preventScroll: true });
  }, [waitingInput, collapsed]);

  function handleScroll() {
    const element = bodyRef.current;
    stickToBottom.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 24;
  }

  function focusInput() {
    if (!running || window.getSelection()?.toString()) return;
    inputRef.current?.focus();
  }

  function recallHistory(direction) {
    const items = history.current;
    if (items.length === 0) return;

    const next = Math.min(items.length - 1, Math.max(-1, historyIndex.current + direction));
    historyIndex.current = next;
    setDraft(next === -1 ? "" : items[items.length - 1 - next]);
  }

  function handleKeyDown(event) {
    const input = event.currentTarget;
    const key = event.key.toLowerCase();

    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.isComposing) {
      event.preventDefault();
      if (draft) history.current.push(draft);
      historyIndex.current = -1;
      const line = draft;
      setDraft("");
      onInput(line);
    } else if (event.ctrlKey && key === "c" && input.selectionStart === input.selectionEnd) {
      event.preventDefault();
      onInterrupt();
    } else if (event.ctrlKey && key === "d" && draft === "") {
      event.preventDefault();
      onEof();
    } else if (event.ctrlKey && key === "l") {
      event.preventDefault();
      onClear();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      recallHistory(1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      recallHistory(-1);
    }
  }

  let status = null;
  if (running) {
    status = (
      <span className="chip chip-busy">{waitingInput ? "Ждёт ввода" : "Выполняется…"}</span>
    );
  } else if (exitCode !== null) {
    status = (
      <span className={`chip ${exitCode === 0 ? "chip-ok" : "chip-fail"}`}>
        Код выхода: {exitCode}
      </span>
    );
  }

  const empty = output.length === 0 && !running;

  return (
    <section
      className={`terminal${collapsed ? " terminal-collapsed" : ""}`}
      ref={zoom.ref}
      style={{ "--term-font-size": `${zoom.size}px` }}
      aria-label="Терминал"
    >
      <header className="panel-header">
        <button
          type="button"
          className="panel-title"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title="Свернуть / развернуть (Ctrl+`)"
        >
          <Icon name={collapsed ? "chevron" : "chevronDown"} size={14} />
          Терминал
        </button>

        <div className="panel-actions">
          {status}
          <button
            type="button"
            className="icon-btn icon-btn-small"
            onClick={onClear}
            title="Очистить (Ctrl+L)"
            aria-label="Очистить терминал"
            disabled={empty}
          >
            <Icon name="clear" size={14} />
          </button>
        </div>
      </header>

      {!collapsed && (
        <div className="term-body" ref={bodyRef} onScroll={handleScroll} onClick={focusInput}>
          {empty && (
            <div className="term-hint">
              <p>Здесь появится вывод программы.</p>
              <p>
                Запуск: <kbd>Ctrl</kbd>+<kbd>Enter</kbd>. Ввод для <code>input()</code> работает
                прямо тут.
              </p>
              <p>
                Масштаб терминала: <kbd>Ctrl</kbd> + колесо мыши.
              </p>
            </div>
          )}

          <pre className="term-out">
            <Chunks chunks={done} />
          </pre>

          {(partial.length > 0 || running) && (
            <div className="term-line">
              <span className="term-partial">
                <Chunks chunks={partial} />
              </span>

              {running && (
                <>
                  {partial.length === 0 && waitingInput && (
                    <span className="term-caret" aria-hidden="true">
                      ›
                    </span>
                  )}
                  <input
                    ref={inputRef}
                    className="term-input"
                    value={draft}
                    spellcheck={false}
                    autocomplete="off"
                    autocapitalize="off"
                    aria-label="Ввод для программы"
                    disabled={!interactive}
                    placeholder={
                      interactive
                        ? ""
                        : "ввод недоступен: нужны заголовки COOP/COEP"
                    }
                    onInput={(event) => {
                      setDraft(event.currentTarget.value);
                      historyIndex.current = -1;
                    }}
                    onKeyDown={handleKeyDown}
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}

      {!collapsed && <ZoomBadge zoom={zoom} />}
    </section>
  );
}
