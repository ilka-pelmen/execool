import { useEffect, useRef, useState } from "preact/hooks";

import TopBar from "./components/TopBar.jsx";
import FileExplorer from "./components/FileExplorer.jsx";
import EditorTabs from "./components/EditorTabs.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import Terminal from "./components/Terminal.jsx";
import StartScreen from "./components/StartScreen.jsx";
import Splitter from "./components/Splitter.jsx";
import Toasts from "./components/Toasts.jsx";
import { Icon } from "./components/Icons.jsx";

import { PyodideEngine } from "./engines/PyodideEngine.js";
import { PROJECT_TYPES, createProject, getProjectType } from "./projects/types.js";
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  setLastProject,
} from "./services/storage.js";
import { pickRunTarget, safeFileName, uniqueName, validatePath } from "./services/files.js";
import { createZip, downloadBlob } from "./services/export_zip.js";
import {
  buildImport,
  mergeFiles,
  pickSources,
  sourcesFromDataTransfer,
} from "./services/importer.js";
import { appendChunks, cleanOutput } from "./services/outputBuffer.js";
import { countFiles } from "./services/format.js";
import { useLanguageServer } from "./services/useLanguageServer.js";
import { usePersistentState } from "./services/usePersistentState.js";

const RUN_TIMEOUT_MS = 30_000; // считается без ожидания ввода
const LSP_LANGUAGE = "python";

const DEFAULT_EXPLORER_WIDTH = 250;
const DEFAULT_TERMINAL_HEIGHT = 240;
const NARROW_QUERY = "(max-width: 720px)";

const isNumber = (min, max) => (value) =>
  typeof value === "number" && value >= min && value <= max;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function App() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("execool:theme") === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });
  const [project, setProject] = useState(null);
  const [projects, setProjects] = useState(() => listProjects());
  const [activeFile, setActiveFile] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);

  const [output, setOutput] = useState([]);
  const [exitCode, setExitCode] = useState(null);
  const [running, setRunning] = useState(false);
  const [waitingInput, setWaitingInput] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState("idle");
  const [saveStatus, setSaveStatus] = useState("saved");

  const [toasts, setToasts] = useState([]);
  const [dragging, setDragging] = useState(false);

  // Раскладка запоминается между сессиями.
  const [explorerOpen, setExplorerOpen] = usePersistentState("execool:layout:explorer-open", true);
  const [terminalOpen, setTerminalOpen] = usePersistentState("execool:layout:terminal-open", true);
  const [explorerWidth, setExplorerWidth] = usePersistentState(
    "execool:layout:explorer-width",
    DEFAULT_EXPLORER_WIDTH,
    isNumber(120, 2000)
  );
  const [terminalHeight, setTerminalHeight] = usePersistentState(
    "execool:layout:terminal-height",
    DEFAULT_TERMINAL_HEIGHT,
    isNumber(60, 3000)
  );

  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  const [drawerOpen, setDrawerOpen] = useState(false); // проводник-«шторка» на узких экранах

  const projectRef = useRef(project);
  const runningRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const runIdRef = useRef(0); // отличает текущий запуск от устаревшего (после смены проекта)
  const engineRef = useRef(null);
  const bufferRef = useRef([]);
  const flushRef = useRef(null);
  const toastId = useRef(0);
  const lastSaveError = useRef(false);

  projectRef.current = project;

  const files = project?.files ?? [];
  const activeFileData = files.find((file) => file.path === activeFile) ?? null;
  const tabs = openTabs.filter((path) => files.some((file) => file.path === path));
  const projectType = project ? getProjectType(project.type) : null;
  const showExplorer = narrow ? drawerOpen : explorerOpen;

  const lsp = useLanguageServer(project, LSP_LANGUAGE, {
    openFile: (path) => handleSelectFile(path),
  });

  // ---------- тема, окно ----------

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("execool:theme", theme);
    } catch {
      // Тема сохранится только на время текущей вкладки.
    }
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const onQuery = () => setNarrow(query.matches);
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });

    query.addEventListener("change", onQuery);
    window.addEventListener("resize", onResize);
    return () => {
      query.removeEventListener("change", onQuery);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // Размеры панелей не должны вылезать за окно после его уменьшения.
  const maxExplorer = Math.max(160, Math.min(520, viewport.width - 360));
  const maxTerminal = Math.max(100, viewport.height - 260);
  const explorerSize = clamp(explorerWidth, 160, maxExplorer);
  const terminalSize = clamp(terminalHeight, 90, maxTerminal);

  // ---------- уведомления ----------

  function pushToast(text, kind = "info", { detail = null, ttl = 4500 } = {}) {
    const id = ++toastId.current;
    setToasts((current) => [...current.slice(-3), { id, text, kind, detail }]);
    setTimeout(() => dismissToast(id), ttl);
  }

  function dismissToast(id) {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }

  // ---------- вывод терминала ----------

  // Вывод копится и попадает на экран не чаще раза в 50 мс.
  function flushOutput() {
    clearTimeout(flushRef.current);
    flushRef.current = null;

    const chunk = bufferRef.current;
    if (chunk.length === 0) return;
    bufferRef.current = [];

    setOutput((current) => appendChunks(current, chunk));
  }

  function appendOutput(stream, text) {
    bufferRef.current.push({ stream, text: cleanOutput(text) });
    if (!flushRef.current) {
      flushRef.current = setTimeout(flushOutput, 50);
    }
  }

  function clearOutput() {
    clearTimeout(flushRef.current);
    flushRef.current = null;
    bufferRef.current = [];
    setOutput([]);
    setExitCode(null);
  }

  function getEngine() {
    if (!engineRef.current) {
      engineRef.current = new PyodideEngine({
        onOutput: appendOutput,
        onStatus: setRuntimeStatus,
        onWaiting: setWaitingInput,
      });
    }
    return engineRef.current;
  }

  function handleTerminalInput(line) {
    if (!runningRef.current) return;
    appendOutput("stdin", `${line}\n`); // эхо: в терминале видно, что ввёл пользователь
    getEngine().writeInput(line);
  }

  function handleTerminalEof() {
    appendOutput("stdin", "^D\n");
    getEngine().sendEof();
  }

  function handleStop() {
    if (!runningRef.current) return;
    stopRequestedRef.current = true;
    getEngine().interrupt();
  }

  // ---------- сохранение ----------

  useEffect(() => {
    if (!project) return;

    setSaveStatus("unsaved");
    const timer = setTimeout(() => {
      setSaveStatus(saveProject(project) ? "saved" : "error");
    }, 400);

    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    if (saveStatus === "error" && !lastSaveError.current) {
      pushToast(
        "Не удалось сохранить проект: хранилище браузера переполнено. Сделай экспорт в ZIP.",
        "error",
        { ttl: 9000 }
      );
    }
    lastSaveError.current = saveStatus === "error";
  }, [saveStatus]);

  useEffect(() => {
    const onHide = () => {
      if (projectRef.current) saveProject(projectRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  function refreshProjects() {
    setProjects(listProjects());
  }

  function handleSaveNow() {
    const current = projectRef.current;
    if (!current) return;

    const ok = saveProject(current);
    setSaveStatus(ok ? "saved" : "error");
    if (ok) pushToast("Сохранено в браузере", "ok", { ttl: 1500 });
  }

  // ---------- проекты ----------

  function openProject(next) {
    const type = getProjectType(next.type);
    const entry =
      type && next.files.some((file) => file.path === type.entry)
        ? type.entry
        : next.files[0]?.path ?? null;

    clearOutput();
    stopRequestedRef.current = false;
    setProject(next);
    setActiveFile(entry);
    setOpenTabs(entry ? [entry] : []);
    setLastProject(next.id);
    getEngine().preload();
  }

  // Останавливает программу и сохраняет текущий проект перед сменой.
  function leaveProject() {
    if (runningRef.current) {
      runIdRef.current++; // хвост старого запуска ничего не допишет в новый терминал
      getEngine().stop();
      runningRef.current = false;
      setRunning(false);
      setWaitingInput(false);
    }
    if (projectRef.current) saveProject(projectRef.current);
  }

  function takenNames() {
    return listProjects().map((item) => item.name);
  }

  function createNewProject(typeId, name, projectFiles = null) {
    leaveProject();
    openProject(createProject(typeId, uniqueName(name, takenNames()), projectFiles));
  }

  function handleOpenSaved(id) {
    const next = loadProject(id);
    if (!next) {
      pushToast("Не удалось открыть проект: данные повреждены или удалены", "error");
      refreshProjects();
      return;
    }
    leaveProject();
    openProject(next);
  }

  function handleNewProject() {
    if (PROJECT_TYPES.length === 1) {
      createNewProject(PROJECT_TYPES[0].id, "myapp");
    } else {
      handleCloseProject();
    }
  }

  function handleCloseProject() {
    leaveProject();
    refreshProjects();
    setProject(null);
    setActiveFile(null);
    setOpenTabs([]);
    clearOutput();
  }

  function handleDeleteSaved(item) {
    if (!window.confirm(`Удалить проект «${item.name}» из этого браузера? Это нельзя отменить.`)) {
      return;
    }
    deleteProject(item.id);
    refreshProjects();
  }

  function handleRenameProject(name) {
    setProject((current) => ({ ...current, name }));
  }

  // ---------- файлы ----------

  function updateFile(path, content) {
    setProject((current) => ({
      ...current,
      files: current.files.map((file) => (file.path === path ? { ...file, content } : file)),
    }));
  }

  // Перед сменой файла досылаем правки на агент: при закрытии документа
  // языковой сервер перечитывает файл с диска, и там должна лежать свежая версия.
  async function handleSelectFile(path) {
    await lsp.flush();
    setActiveFile(path);
    setOpenTabs((current) => (current.includes(path) ? current : [...current, path]));
    if (narrow) setDrawerOpen(false);
  }

  async function handleCloseTab(path) {
    await lsp.flush();

    const index = openTabs.indexOf(path);
    const rest = openTabs.filter((item) => item !== path);
    setOpenTabs(rest);
    if (activeFile === path) {
      setActiveFile(rest[Math.min(index, rest.length - 1)] ?? null);
    }
  }

  function handleCreateFile(rawPath) {
    const result = validatePath(
      rawPath,
      projectRef.current.files.map((file) => file.path)
    );

    if (result.error) {
      return { error: result.error };
    }

    setProject((current) => ({
      ...current,
      files: [...current.files, { path: result.path, content: "" }],
    }));
    handleSelectFile(result.path);
    return {};
  }

  function removeFiles(paths) {
    const gone = new Set(paths);
    const rest = openTabs.filter((path) => !gone.has(path));

    setProject((current) => ({
      ...current,
      files: current.files.filter((file) => !gone.has(file.path)),
    }));
    setOpenTabs(rest);
    if (gone.has(activeFile)) {
      const index = openTabs.indexOf(activeFile);
      setActiveFile(rest[Math.min(index, rest.length - 1)] ?? null);
    }
  }

  const handleDeleteFile = (path) => removeFiles([path]);
  const handleDeleteFolder = (dir) =>
    removeFiles(files.filter((file) => file.path.startsWith(`${dir}/`)).map((file) => file.path));

  function handleExport() {
    const current = projectRef.current;
    if (!current || current.files.length === 0) return;
    downloadBlob(createZip(current.files), `${safeFileName(current.name)}.zip`);
  }

  // ---------- импорт ----------

  function reportImport(summary, skipped) {
    const detail = skipped.map((item) => `${item.path}: ${item.reason}`);
    pushToast(
      skipped.length > 0 ? `${summary}. Пропущено: ${skipped.length}` : summary,
      skipped.length > 0 ? "warn" : "ok",
      { detail, ttl: skipped.length > 0 ? 9000 : 4500 }
    );
  }

  // mode: "new" - создать проект из импортированного, "merge" - добавить в открытый.
  async function importSources(sources, requestedMode) {
    if (!sources || sources.length === 0) return;
    const mode = projectRef.current ? requestedMode : "new";

    try {
      const result = await buildImport(sources, { stripRoot: mode === "new" });

      if (result.files.length === 0) {
        pushToast("Нечего импортировать: нет подходящих текстовых файлов", "error", {
          detail: result.skipped.map((item) => `${item.path}: ${item.reason}`),
          ttl: 8000,
        });
        return;
      }

      if (mode === "new") {
        createNewProject("python", result.name || "import", result.files);
        reportImport(`Создан проект: ${countFiles(result.files.length)}`, result.skipped);
        return;
      }

      const current = projectRef.current;
      const merged = mergeFiles(current.files, result.files);

      if (merged.replaced.length > 0) {
        const list = merged.replaced.slice(0, 5).join(", ");
        const more = merged.replaced.length > 5 ? "…" : "";
        if (!window.confirm(`Заменить существующие файлы (${merged.replaced.length}): ${list}${more}?`)) {
          return;
        }
      }

      setProject((cur) => ({ ...cur, files: mergeFiles(cur.files, result.files).files }));

      const skipped = [
        ...result.skipped,
        ...merged.conflicts.map((path) => ({ path, reason: "имя занято файлом или папкой" })),
      ];
      const focus =
        result.files.find((file) => file.path === "main.py") ?? result.files[0];
      await handleSelectFile(focus.path);

      reportImport(
        `Добавлено: ${merged.added.length}, заменено: ${merged.replaced.length}`,
        skipped
      );
    } catch (error) {
      pushToast(`Не удалось импортировать: ${error.message}`, "error");
    }
  }

  async function handleImport(kind, mode) {
    importSources(await pickSources(kind), mode);
  }

  // Перетаскивание файлов, папок и ZIP в окно. Capture + stopPropagation: иначе
  // редактор вставил бы содержимое файла как текст.
  const importRef = useRef(importSources);
  importRef.current = importSources;

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onEnter = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth++;
      setDragging(true);
    };
    const onOver = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      setDragging(false);

      sourcesFromDataTransfer(event.dataTransfer).then(
        (sources) => importRef.current(sources, "merge"),
        (error) => pushToast(`Не удалось прочитать файлы: ${error.message}`, "error")
      );
    };

    window.addEventListener("dragenter", onEnter, true);
    window.addEventListener("dragover", onOver, true);
    window.addEventListener("dragleave", onLeave, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragenter", onEnter, true);
      window.removeEventListener("dragover", onOver, true);
      window.removeEventListener("dragleave", onLeave, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);

  // ---------- запуск ----------

  async function handleRun() {
    const current = projectRef.current;
    if (!current || runningRef.current) return;

    clearOutput();
    setTerminalOpen(true);

    const target = pickRunTarget(current.files, activeFileData?.path);
    if (!target) {
      appendOutput("stderr", "Нечего запускать. Создай main.py или открой любой .py-файл.\n");
      flushOutput();
      return;
    }

    stopRequestedRef.current = false;
    runningRef.current = true;
    setRunning(true);
    const runId = ++runIdRef.current;

    const result = await getEngine().run(current.files, target, {
      timeoutMs: RUN_TIMEOUT_MS,
    });

    if (runIdRef.current !== runId) return; // проект успели закрыть или сменить

    if (result.reason === "timeout") {
      appendOutput("stderr", `\nВыполнение прервано: превышено ${RUN_TIMEOUT_MS / 1000} с.\n`);
    } else if (result.reason === "output-limit") {
      appendOutput("stderr", "\nВыполнение прервано: слишком большой вывод.\n");
    } else if (result.reason === "stopped" || stopRequestedRef.current) {
      appendOutput("stderr", "\nВыполнение остановлено.\n");
    } else {
      if (result.error) appendOutput("stderr", `${result.error}\n`);
      setExitCode(result.exitCode);
    }

    // Весь вывод показываем сразу, до кода выхода.
    flushOutput();
    runningRef.current = false;
    setRunning(false);
    setWaitingInput(false);
  }

  // ---------- горячие клавиши ----------

  const actionsRef = useRef({});
  actionsRef.current = {
    run: handleRun,
    save: handleSaveNow,
    toggleExplorer: () =>
      narrow ? setDrawerOpen((open) => !open) : setExplorerOpen((open) => !open),
    toggleTerminal: () => setTerminalOpen((open) => !open),
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.defaultPrevented || !projectRef.current) return;
      if (!event.ctrlKey && !event.metaKey) return;

      const actions = actionsRef.current;
      const key = event.key.toLowerCase();

      if (event.key === "Enter") {
        event.preventDefault();
        actions.run();
      } else if (key === "s") {
        event.preventDefault();
        actions.save();
      } else if (key === "b") {
        event.preventDefault();
        actions.toggleExplorer();
      } else if (event.key === "`") {
        event.preventDefault();
        actions.toggleTerminal();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------- разметка ----------

  const overlay = dragging && (
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-card">
        <Icon name="upload" size={28} />
        <strong>Отпусти, чтобы импортировать</strong>
        <span>
          {project ? "Файлы, папки и ZIP добавятся в проект" : "Из файлов, папки или ZIP получится новый проект"}
        </span>
      </div>
    </div>
  );

  if (!project) {
    return (
      <>
        <StartScreen
          types={PROJECT_TYPES}
          projects={projects}
          onOpen={handleOpenSaved}
          onDelete={handleDeleteSaved}
          onSelect={(typeId) => createNewProject(typeId, "myapp")}
          onImport={(kind) => handleImport(kind, "new")}
        />
        {overlay}
        <Toasts toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <main className="ide">
      <TopBar
        theme={theme}
        onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
        projectName={project.name}
        saveStatus={saveStatus}
        projects={projects}
        currentId={project.id}
        onMenuOpen={refreshProjects}
        onSwitchProject={handleOpenSaved}
        onNewProject={handleNewProject}
        onImportProject={(kind) => handleImport(kind, "new")}
        onRenameProject={handleRenameProject}
        onCloseProject={handleCloseProject}
        onExport={handleExport}
        canExport={files.length > 0}
        explorerOpen={showExplorer}
        onToggleExplorer={actionsRef.current.toggleExplorer}
        terminalOpen={terminalOpen}
        onToggleTerminal={actionsRef.current.toggleTerminal}
        lspEnabled={lsp.enabled}
        lspStatus={lsp.status}
        lspMessage={lsp.message}
        onToggleLsp={lsp.toggle}
        onRetryLsp={lsp.retry}
        running={running}
        onRun={handleRun}
        onStop={handleStop}
      />

      <section className="workspace">
        <div className="work-top">
          {showExplorer && narrow && (
            <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />
          )}

          {showExplorer && (
            <>
              <div
                className={`sidebar${narrow ? " sidebar-drawer" : ""}`}
                style={narrow ? undefined : { width: `${explorerSize}px` }}
              >
                <FileExplorer
                  files={files}
                  activeFile={activeFileData?.path ?? null}
                  onSelect={handleSelectFile}
                  onCreate={handleCreateFile}
                  onDelete={handleDeleteFile}
                  onDeleteFolder={handleDeleteFolder}
                  onImport={(kind) => handleImport(kind, "merge")}
                />
              </div>
              {!narrow && (
                <Splitter
                  axis="x"
                  label="Ширина списка файлов"
                  value={explorerSize}
                  min={160}
                  max={maxExplorer}
                  onChange={setExplorerWidth}
                  onReset={() => setExplorerWidth(DEFAULT_EXPLORER_WIDTH)}
                />
              )}
            </>
          )}

          <div className="editor-area">
            <EditorTabs
              tabs={tabs}
              active={activeFileData?.path ?? null}
              onSelect={handleSelectFile}
              onClose={handleCloseTab}
            />

            {activeFileData ? (
              <CodeEditor
                filePath={activeFileData.path}
                value={activeFileData.content}
                onChange={(value) => updateFile(activeFileData.path, value)}
                onRun={handleRun}
                onSave={handleSaveNow}
                lspClient={lsp.client}
                lspRootUri={lsp.rootUri}
                theme={theme}
              />
            ) : (
              <div className="editor-empty">
                <p className="editor-empty-title">
                  {files.length === 0 ? "В проекте нет файлов" : "Файл не выбран"}
                </p>
                <p>
                  Выбери файл слева, создай новый кнопкой «+» или перетащи сюда файлы,
                  папку и ZIP.
                </p>
                <p className="editor-empty-keys">
                  <kbd>Ctrl</kbd>+<kbd>Enter</kbd> запуск · <kbd>Ctrl</kbd> + колесо мыши масштаб
                </p>
              </div>
            )}
          </div>
        </div>

        {terminalOpen && (
          <Splitter
            axis="y"
            reverse
            label="Высота терминала"
            value={terminalSize}
            min={90}
            max={maxTerminal}
            onChange={setTerminalHeight}
            onReset={() => setTerminalHeight(DEFAULT_TERMINAL_HEIGHT)}
          />
        )}

        <div
          className="terminal-slot"
          style={terminalOpen ? { height: `${terminalSize}px` } : undefined}
        >
          <Terminal
            output={output}
            running={running}
            waitingInput={waitingInput}
            interactive={getEngine().interactive}
            exitCode={exitCode}
            collapsed={!terminalOpen}
            onInput={handleTerminalInput}
            onEof={handleTerminalEof}
            onInterrupt={handleStop}
            onClear={clearOutput}
            onToggle={actionsRef.current.toggleTerminal}
          />
        </div>
      </section>

      <footer className="statusbar">
        <span className={`status status-${runtimeStatus}`}>
          <span className="status-dot" />
          {{
            idle: "Python не загружен",
            loading: "Загрузка Python…",
            ready: "Python готов",
            running: running && waitingInput ? "Ждёт ввода" : "Выполняется…",
            error: "Ошибка загрузки Python",
          }[runtimeStatus] ?? ""}
        </span>

        {lsp.enabled && (
          <span
            className={`status status-${
              { off: "idle", connecting: "loading", ready: "ready", reconnecting: "loading", error: "error" }[
                lsp.status
              ] ?? "idle"
            }`}
            title={lsp.message || "Подсказки кода"}
          >
            <span className="status-dot" />
            {lsp.status === "ready"
              ? "Подсказки"
              : lsp.status === "error"
                ? lsp.message || "Подсказки недоступны"
                : "Подсказки: подключение…"}
          </span>
        )}

        {lsp.notice && <span className="statusbar-warning">{lsp.notice}</span>}

        {lsp.unsynced.length > 0 && (
          <span
            className="statusbar-warning"
            title={`Не отправлены на сервер подсказок: ${lsp.unsynced.join(", ")}`}
          >
            Не синхронизировано: {lsp.unsynced.length}
          </span>
        )}

        <span className="statusbar-right">
          <span className="statusbar-hint">Ctrl + колесо мыши: масштаб панели</span>
          <span>{activeFileData?.path ?? projectType?.name ?? project.type}</span>
        </span>
      </footer>

      {overlay}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
