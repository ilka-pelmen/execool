import { useEffect, useRef, useState } from "preact/hooks";

import TopBar from "./components/TopBar.jsx";
import FileExplorer from "./components/FileExplorer.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import Terminal from "./components/Terminal.jsx";

import {
  createProjectSession,
  persistFile,
  removeFile,
  executeProject,
  terminateSession,
} from "./services/session.js";

import { scheduleSave, cancelScheduledSave } from "./services/autosave.js";
import { validatePath, pickRunTarget } from "./services/files.js";
import { createZip, downloadBlob } from "./services/export_zip.js";

const PROJECT_NAME = "myapp";

const INITIAL_FILES = [
  {
    path: "main.py",
    content: 'def main():\n    print("Hello from Execool!")\n\nmain()\n',
    dirty: false,
  },
];

export default function App() {
  const [files, setFiles] = useState(INITIAL_FILES);
  const [activeFile, setActiveFile] = useState("main.py");

  const [sessionId, setSessionId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [running, setRunning] = useState(false);

  const [output, setOutput] = useState("Открой проект, чтобы начать.");
  const [exitCode, setExitCode] = useState(null);
  const [saveStatus, setSaveStatus] = useState("saved");

  const timersRef = useRef(new Map());
  const filesRef = useRef(files);
  const sessionIdRef = useRef(sessionId);
  const saveQueueRef = useRef(Promise.resolve());
  const runningRef = useRef(false);

  // Синхронизируем актуальные значения для асинхронных обработчиков.
  filesRef.current = files;
  sessionIdRef.current = sessionId;
  runningRef.current = running;

  const activeFileData =
    files.find((file) => file.path === activeFile) ?? files[0] ?? null;

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        cancelScheduledSave(timer);
      }
    };
  }, []);

  // Закрываем сессию при закрытии вкладки, чтобы контейнеры не копились.
  useEffect(() => {
    const onHide = () => {
      const id = sessionIdRef.current;
      if (id) terminateSession(id).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  function scheduleFileSave(path) {
    cancelScheduledSave(timersRef.current.get(path));

    const timer = scheduleSave(() => {
      timersRef.current.delete(path);
      void saveOneFile(path).catch(() => {});
    });

    timersRef.current.set(path, timer);
  }

  function updateFile(path, content) {
    setFiles((current) =>
      current.map((file) =>
        file.path === path ? { ...file, content, dirty: true } : file
      )
    );

    setSaveStatus("unsaved");
    scheduleFileSave(path);
  }

  function saveOneFile(path) {
    const id = sessionIdRef.current;

    if (!id) {
      return Promise.reject(new Error("Сессия не открыта"));
    }

    const currentFile = filesRef.current.find((file) => file.path === path);

    if (!currentFile) {
      return Promise.resolve();
    }

    const content = currentFile.content;

    // Запросы к агенту выполняются последовательно.
    const task = saveQueueRef.current
      .catch(() => {})
      .then(() => persistFile(id, path, content));

    saveQueueRef.current = task;

    setSaveStatus("saving");

    return task
      .then(() => {
        setFiles((current) =>
          current.map((file) =>
            file.path === path && file.content === content
              ? { ...file, dirty: false }
              : file
          )
        );

        // Последнее сохранение в очереди и нет отложенных: всё записано.
        if (saveQueueRef.current === task && timersRef.current.size === 0) {
          setSaveStatus("saved");
        }
      })
      .catch((error) => {
        setSaveStatus("error");
        setOutput(`Ошибка сохранения ${path}: ${error.message}`);
        throw error;
      });
  }

  async function saveAllFiles() {
    for (const timer of timersRef.current.values()) {
      cancelScheduledSave(timer);
    }

    timersRef.current.clear();

    for (const file of filesRef.current) {
      await saveOneFile(file.path);
    }

    await saveQueueRef.current;
    setSaveStatus("saved");
  }

  function handleCreateFile(rawPath) {
    const result = validatePath(
      rawPath,
      filesRef.current.map((file) => file.path)
    );

    if (result.error) {
      return { error: result.error };
    }

    const path = result.path;
    const hasSession = Boolean(sessionIdRef.current);

    setFiles((current) => [
      ...current,
      { path, content: "", dirty: hasSession },
    ]);
    setActiveFile(path);

    // Без сессии файл уйдёт на агент при запуске.
    if (hasSession) {
      setSaveStatus("unsaved");
      scheduleFileSave(path);
    }

    return {};
  }

  function handleDeleteFile(path) {
    cancelScheduledSave(timersRef.current.get(path));
    timersRef.current.delete(path);

    const remaining = filesRef.current.filter((file) => file.path !== path);
    setFiles(remaining);
    filesRef.current = remaining;

    if (activeFile === path) {
      setActiveFile(remaining[0]?.path ?? null);
    }

    const id = sessionIdRef.current;
    if (!id) return;

    // Удаление идёт в той же очереди, что и сохранения: порядок сохраняется.
    const task = saveQueueRef.current
      .catch(() => {})
      .then(() => removeFile(id, path));

    saveQueueRef.current = task;

    task.catch((error) => {
      setOutput(`Не удалось удалить ${path} в сессии: ${error.message}`);
    });
  }

  function handleExport() {
    if (filesRef.current.length === 0) return;
    downloadBlob(createZip(filesRef.current), `${PROJECT_NAME}.zip`);
  }

  async function handleOpenProject() {
    if (status === "starting" || sessionIdRef.current) {
      return;
    }

    setStatus("starting");
    setOutput("Создание сессии…");

    try {
      // Демонстрационные идентификаторы.
      // Позже заменим их данными реального проекта и авторизации.
      const result = await createProjectSession("proj-999", "user-123");

      setSessionId(result.session_id);
      sessionIdRef.current = result.session_id;
      setStatus("ready");
      setOutput(result.message || "Сессия успешно создана.");
    } catch (error) {
      setStatus("error");
      setOutput(`Не удалось открыть проект: ${error.message}`);
    }
  }

  async function handleRun() {
    const id = sessionIdRef.current;

    if (!id || runningRef.current) {
      return;
    }

    const target = pickRunTarget(filesRef.current, activeFileData?.path);

    if (!target) {
      setOutput("Нечего запускать. Создай main.py или открой любой .py-файл.");
      return;
    }

    setRunning(true);
    runningRef.current = true;
    setExitCode(null);
    setOutput("Сохранение файлов перед запуском…");

    try {
      await saveAllFiles();

      setOutput("Выполнение программы…");
      const result = await executeProject(id, `python3 '${target}'`);

      setOutput(result.output ?? "");
      setExitCode(result.exit_code ?? null);
    } catch (error) {
      setOutput(`Ошибка: ${error.message}`);
    } finally {
      setRunning(false);
      runningRef.current = false;
    }
  }

  async function handleCloseProject() {
    const id = sessionIdRef.current;
    if (!id) return;

    setStatus("closing");

    try {
      await terminateSession(id);
      setSessionId(null);
      sessionIdRef.current = null;
      setStatus("idle");
      setOutput("Сессия завершена.");
    } catch (error) {
      setStatus("error");
      setOutput(`Ошибка завершения сессии: ${error.message}`);
    }
  }

  return (
    <main className="ide">
      <TopBar
        projectName={PROJECT_NAME}
        status={status}
        sessionReady={Boolean(sessionId)}
        running={running}
        canExport={files.length > 0}
        onOpen={handleOpenProject}
        onRun={handleRun}
        onExport={handleExport}
      />

      <section className="workspace">
        <FileExplorer
          projectName={PROJECT_NAME}
          files={files}
          activeFile={activeFileData?.path ?? null}
          onSelect={setActiveFile}
          onCreate={handleCreateFile}
          onDelete={handleDeleteFile}
        />

        {activeFileData ? (
          <CodeEditor
            filePath={activeFileData.path}
            value={activeFileData.content}
            onChange={(value) => updateFile(activeFileData.path, value)}
            readOnly={!sessionId}
          />
        ) : (
          <div className="editor-panel editor-empty">
            <p>Файлов нет</p>
            <p>Создай файл кнопкой «+» в проводнике.</p>
          </div>
        )}
      </section>

      <Terminal
        output={output}
        exitCode={exitCode}
        running={running}
        saveStatus={saveStatus}
      />

      <footer className="statusbar">
        <span>{activeFileData?.path ?? "Нет открытого файла"}</span>
        <span>{sessionId ? "Сессия активна" : "Нет сессии"}</span>

        {sessionId && (
          <button
            className="close-session"
            onClick={handleCloseProject}
            disabled={running}
          >
            Закрыть сессию
          </button>
        )}
      </footer>
    </main>
  );
}
