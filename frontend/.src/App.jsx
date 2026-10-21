
import { useEffect, useRef, useState } from "preact/hooks";

import TopBar from "./components/TopBar.jsx";
import FileExplorer from "./components/FileExplorer.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import Terminal from "./components/Terminal.jsx";

import {
  createProjectSession,
  persistFile,
  executeProject,
  terminateSession,
} from "./services/session.js";

import {
  scheduleSave,
  cancelScheduledSave,
} from "./services/autosave.js";

const INITIAL_FILES = [
  {
    path: "main.py",
    content: 'def main():\n    print("Hello from IDE!")\n\nmain()\n',
    dirty: false,
  },
  {
    path: "utils.py",
    content: 'def greet(name):\n    return f"Hello, {name}!"\n',
    dirty: false,
  },
  {
    path: "requirements.txt",
    content: "",
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
  const saveStatusRef = useRef(saveStatus);
  const saveQueueRef = useRef(Promise.resolve());
  const runningRef = useRef(false);

  // Синхронизируем актуальные значения для асинхронных обработчиков.
  filesRef.current = files;
  sessionIdRef.current = sessionId;
  saveStatusRef.current = saveStatus;
  runningRef.current = running;

  const activeFileData =
    files.find((file) => file.path === activeFile) ?? files[0];

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        cancelScheduledSave(timer);
      }
    };
  }, []);

  function updateFile(path, content) {
    setFiles((current) =>
      current.map((file) =>
        file.path === path
          ? { ...file, content, dirty: true }
          : file
      )
    );

    setSaveStatus("unsaved");

    const previousTimer = timersRef.current.get(path);
    cancelScheduledSave(previousTimer);

    const timer = scheduleSave(() => {
      timersRef.current.delete(path);
      void saveOneFile(path);
    });

    timersRef.current.set(path, timer);
  }

  function saveOneFile(path) {
    const id = sessionIdRef.current;

    if (!id) {
      return Promise.reject(new Error("Сессия не открыта"));
    }

    const currentFile = filesRef.current.find(
      (file) => file.path === path
    );

    if (!currentFile) {
      return Promise.resolve();
    }

    const content = currentFile.content;

    // Запросы сохранения выполняются последовательно.
    const task = saveQueueRef.current
      .catch(() => {})
      .then(() => persistFile(id, path, content));

    saveQueueRef.current = task;

    setSaveStatus("saving");

    return task.then(() => {
      setFiles((current) =>
        current.map((file) =>
          file.path === path && file.content === content
            ? { ...file, dirty: false }
            : file
        )
      );
    }).catch((error) => {
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

    // Сохраняем актуальное содержимое каждого файла.
    for (const file of filesRef.current) {
      await saveOneFile(file.path);
    }

    await saveQueueRef.current;
    setSaveStatus("saved");
  }

  async function handleOpenProject() {
    if (status === "starting" || sessionIdRef.current) {
      return;
    }

    setStatus("starting");
    setOutput("Создание сессии...");

    try {
      // Демонстрационные идентификаторы.
      // Позже заменим их данными реального проекта и авторизации.
      const result = await createProjectSession(
        "proj-999",
        "user-123"
      );

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

    setRunning(true);
    runningRef.current = true;
    setExitCode(null);
    setOutput("Сохранение файлов перед запуском...");

    try {
      await saveAllFiles();

      setOutput("Выполнение программы...");
      const result = await executeProject(
        id,
        "python3 main.py"
      );

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
        projectName="MyApp"
        status={status}
        sessionReady={Boolean(sessionId)}
        running={running}
        onOpen={handleOpenProject}
        onRun={handleRun}
      />

      <section className="workspace">
        <FileExplorer
          files={files}
          activeFile={activeFile}
          onSelect={setActiveFile}
        />

        <CodeEditor
          filePath={activeFileData.path}
          value={activeFileData.content}
          onChange={(value) =>
            updateFile(activeFileData.path, value)
          }
          readOnly={!sessionId}
        />
      </section>

      <Terminal
        output={output}
        exitCode={exitCode}
        running={running}
        saveStatus={saveStatus}
      />

      <footer className="statusbar">
        <span>{activeFileData.path}</span>
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
