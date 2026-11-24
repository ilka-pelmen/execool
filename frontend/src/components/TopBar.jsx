import { useEffect, useRef, useState } from "preact/hooks";

import { useDismiss } from "../services/useDismiss.js";
import { countFiles } from "../services/format.js";
import { Icon } from "./Icons.jsx";

const LSP_LABELS = {
  off: "Выключены",
  connecting: "Подключение…",
  ready: "Работают",
  reconnecting: "Переподключение…",
  error: "Недоступны",
};

const LSP_HINT =
  "Подсказки, ошибки и переход к определению от языкового сервера. " +
  "При включении код проекта отправляется на сервер.";

const SHORTCUTS = [
  ["Ctrl + Enter", "Запустить"],
  ["Ctrl + колесо мыши", "Масштаб панели под курсором"],
  ["Ctrl + 0", "Сбросить масштаб панели"],
  ["Ctrl + B", "Показать / скрыть файлы"],
  ["Ctrl + `", "Показать / скрыть терминал"],
  ["Ctrl + S", "Сохранить сейчас"],
  ["Ctrl + C / D / L", "В терминале: стоп / конец ввода / очистить"],
];

/**
 * Логотип Execool: при наведении (или клике) открывает выбор проекта.
 * Клик закрепляет меню, иначе оно закрывается, когда курсор уходит.
 */
function ProjectMenu({
  projects,
  currentId,
  canExport,
  onOpen,
  onSwitch,
  onNew,
  onImport,
  onExport,
  onClose,
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapRef = useRef(null);
  const timer = useRef(null);

  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPinned(false);
  };
  useDismiss(open, close, wrapRef);
  useEffect(() => () => clearTimeout(timer.current), []);

  function show() {
    if (!open) {
      onOpen?.();
      setOpen(true);
    }
  }

  function handlePointerEnter(event) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    timer.current = setTimeout(show, 120);
  }

  function handlePointerLeave(event) {
    if (event.pointerType !== "mouse") return;
    clearTimeout(timer.current);
    if (!pinned) timer.current = setTimeout(close, 250);
  }

  function handleClick() {
    clearTimeout(timer.current);
    if (open && pinned) {
      close();
    } else {
      show();
      setPinned(true);
    }
  }

  const run = (action) => () => {
    close();
    action();
  };

  return (
    <div
      className="menu-wrap"
      ref={wrapRef}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <button
        type="button"
        className="logo-btn"
        onClick={handleClick}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Проекты"
      >
        <span className="brand-mark">&lt;/&gt;</span>
        <span className="brand-name">Execool</span>
        <Icon name="chevronDown" size={13} />
      </button>

      {open && (
        <div className="menu menu-wide" role="menu">
          <div className="menu-label">Проекты</div>
          <div className="menu-scroll">
            {projects.map((item) => (
              <button
                type="button"
                role="menuitem"
                key={item.id}
                className={`menu-item${item.id === currentId ? " is-current" : ""}`}
                onClick={run(() => onSwitch(item.id))}
              >
                <span className="menu-item-main">
                  <span className="menu-item-title">{item.name}</span>
                  <span className="menu-item-hint">{countFiles(item.fileCount)}</span>
                </span>
                {item.id === currentId && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>

          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-item" onClick={run(onNew)}>
            <Icon name="plus" />
            <span className="menu-item-title">Новый проект</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={run(() => onImport("zip"))}>
            <Icon name="download" />
            <span className="menu-item-main">
              <span className="menu-item-title">Открыть ZIP как проект…</span>
            </span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={run(() => onImport("folder"))}>
            <Icon name="folder" />
            <span className="menu-item-title">Открыть папку как проект…</span>
          </button>

          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={!canExport}
            onClick={run(onExport)}
          >
            <Icon name="upload" />
            <span className="menu-item-title">Экспорт в ZIP</span>
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={run(onClose)}>
            <Icon name="x" />
            <span className="menu-item-title">Закрыть проект</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Название проекта: клик - переименовать. */
function ProjectTitle({ name, saveStatus, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function commit() {
    const value = draft.trim().slice(0, 60);
    setEditing(false);
    if (value && value !== name) onRename(value);
  }

  const saveLabel = {
    saved: "Сохранено в браузере",
    unsaved: "Сохранение…",
    error: "Не удалось сохранить: место в браузере закончилось",
  }[saveStatus];

  return (
    <div className="project-title">
      {editing ? (
        <input
          ref={inputRef}
          className="text-input title-input"
          value={draft}
          maxLength={60}
          aria-label="Название проекта"
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            } else if (event.key === "Escape") {
              cancelled.current = true;
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (cancelled.current) cancelled.current = false;
            else commit();
          }}
        />
      ) : (
        <button
          type="button"
          className="title-btn"
          title="Переименовать проект"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          {name}
        </button>
      )}
      <span className={`save-dot save-${saveStatus}`} title={saveLabel} role="img" aria-label={saveLabel} />
      {saveStatus === "error" && <span className="save-error">Не сохранено</span>}
    </div>
  );
}

function SettingsMenu({ lspEnabled, lspStatus, lspMessage, onToggleLsp, onRetryLsp }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        title="Настройки и горячие клавиши"
        aria-label="Настройки"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="sliders" />
      </button>

      {open && (
        <div className="menu menu-right menu-settings" role="dialog" aria-label="Настройки">
          <div className="setting-row">
            <div className="setting-text">
              <span className="menu-item-title">Подсказки кода</span>
              <span className="menu-item-hint" title={LSP_HINT}>
                {lspStatus === "error" && lspMessage ? lspMessage : LSP_LABELS[lspStatus] ?? ""}
              </span>
            </div>
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
          </div>
          <p className="setting-note">При включении код проекта отправляется на сервер.</p>
          {lspStatus === "error" && (
            <button type="button" className="btn btn-ghost" onClick={onRetryLsp}>
              Повторить подключение
            </button>
          )}

          <div className="menu-sep" />
          <div className="menu-label">Горячие клавиши</div>
          <dl className="shortcuts">
            {SHORTCUTS.map(([keys, action]) => (
              <div key={keys}>
                <dt>{keys}</dt>
                <dd>{action}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

export default function TopBar({
  theme,
  onToggleTheme,
  projectName,
  saveStatus,
  projects,
  currentId,
  onMenuOpen,
  onSwitchProject,
  onNewProject,
  onImportProject,
  onRenameProject,
  onCloseProject,
  onExport,
  canExport,
  explorerOpen,
  onToggleExplorer,
  terminalOpen,
  onToggleTerminal,
  lspEnabled,
  lspStatus,
  lspMessage,
  onToggleLsp,
  onRetryLsp,
  running,
  onRun,
  onStop,
}) {
  return (
    <header className="topbar">
      <div className="topbar-group">
        <button
          type="button"
          className={`icon-btn${explorerOpen ? " is-on" : ""}`}
          onClick={onToggleExplorer}
          title="Файлы (Ctrl+B)"
          aria-label="Показать или скрыть файлы"
          aria-pressed={explorerOpen}
        >
          <Icon name="sidebar" />
        </button>

        <ProjectMenu
          projects={projects}
          currentId={currentId}
          canExport={canExport}
          onOpen={onMenuOpen}
          onSwitch={onSwitchProject}
          onNew={onNewProject}
          onImport={onImportProject}
          onExport={onExport}
          onClose={onCloseProject}
        />

        <ProjectTitle name={projectName} saveStatus={saveStatus} onRename={onRenameProject} />
      </div>

      <div className="topbar-group">
        <button
          type="button"
          className={`icon-btn${terminalOpen ? " is-on" : ""}`}
          onClick={onToggleTerminal}
          title="Терминал (Ctrl+`)"
          aria-label="Показать или скрыть терминал"
          aria-pressed={terminalOpen}
        >
          <Icon name="terminal" />
        </button>

        <button
          type="button"
          className="icon-btn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>

        <SettingsMenu
          lspEnabled={lspEnabled}
          lspStatus={lspStatus}
          lspMessage={lspMessage}
          onToggleLsp={onToggleLsp}
          onRetryLsp={onRetryLsp}
        />

        {running ? (
          <button type="button" className="btn btn-stop" onClick={onStop} title="Остановить (Ctrl+C в терминале)">
            <Icon name="stop" size={13} />
            <span className="btn-label">Стоп</span>
          </button>
        ) : (
          <button type="button" className="btn btn-run" onClick={onRun} title="Запустить (Ctrl+Enter)">
            <Icon name="play" size={13} />
            <span className="btn-label">Запустить</span>
          </button>
        )}
      </div>
    </header>
  );
}
