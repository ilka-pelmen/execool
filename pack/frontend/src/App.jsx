import { useEffect, useRef, useState } from "preact/hooks";

import TopBar from "./components/TopBar.jsx";
import FileExplorer from "./components/FileExplorer.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import Terminal from "./components/Terminal.jsx";
import StartScreen from "./components/StartScreen.jsx";

import { PyodideEngine } from "./engines/PyodideEngine.js";
import {
  PROJECT_TYPES,
  createProject,
  getProjectType,
} from "./projects/types.js";
import { loadProject, saveProject } from "./services/storage.js";
import { validatePath, pickRunTarget } from "./services/files.js";
import { createZip, downloadBlob } from "./services/export_zip.js";

import "./styles-start.css";

const RUN_TIMEOUT_MS = 30_000;
const MAX_LINES = 2000; // сколько строк вывода держим на экране

export default function App() {
  const [project, setProject] = useState(null);
  const [saved, setSaved] = useState(() => loadProject());
  const [activeFile, setActiveFile] = useState(null);

  const [lines, setLines] = useState([]);
  const [exitCode, setExitCode] = useState(null);
  const [running, setRunning] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState("idle");
  const [saveStatus, setSaveStatus] = useState("saved");

  const projectRef = useRef(project);
  const engineRef = useRef(null);
  const bufferRef = useRef([]);
  const flushRef = useRef(null);

  projectRef.current = project;

  const files = project?.files ?? [];
  const activeFileData =
    files.find((file) => file.path === activeFile) ?? files[0] ?? null;
  const projectType = project ? getProjectType(project.type) : null;

  // Вывод копится и выводится на экран не чаще раза в 50 мс.
  function flushOutput() {
    clearTimeout(flushRef.current);
    flushRef.current = null;

    const chunk = bufferRef.current;
    if (chunk.length === 0) return;
    bufferRef.current = [];

    setLines((current) => {
      const next = current.concat(chunk);
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }

  function appendOutput(stream, text) {
    bufferRef.current.push({ stream, text });
    if (!flushRef.current) {
      flushRef.current = setTimeout(flushOutput, 50);
    }
  }

  function clearOutput() {
    clearTimeout(flushRef.current);
    flushRef.current = null;
    bufferRef.current = [];
    setLines([]);
    setExitCode(null);
  }

  function getEngine() {
    if (!engineRef.current) {
      engineRef.current = new PyodideEngine({
        onOutput: appendOutput,
        onStatus: setRuntimeStatus,
      });
    }
    return engineRef.current;
  }

  // Автосохранение проекта в браузере.
  useEffect(() => {
    if (!project) return;

    setSaveStatus("unsaved");
    const timer = setTimeout(() => {
      setSaveStatus(saveProject(project) ? "saved" : "error");
    }, 400);

    return () => clearTimeout(timer);
  }, [project]);

  useEffect(() => {
    const onHide = () => {
      if (projectRef.current) saveProject(projectRef.current);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  function openProject(next) {
    const type = getProjectType(next.type);
    const entry =
      type && next.files.some((file) => file.path === type.entry)
        ? type.entry
        : next.files[0]?.path ?? null;

    clearOutput();
    setProject(next);
    setActiveFile(entry);
    getEngine().preload();
  }

  function handleSelectType(typeId) {
    if (
      saved &&
      !window.confirm("Новый проект заменит сохранённый в этом браузере. Продолжить?")
    ) {
      return;
    }
    openProject(createProject(typeId));
  }

  function handleContinue() {
    if (saved) openProject(saved);
  }

  function handleCloseProject() {
    if (running) getEngine().stop();
    if (projectRef.current) saveProject(projectRef.current);

    setSaved(loadProject());
    setProject(null);
    setActiveFile(null);
    clearOutput();
  }

  function updateFile(path, content) {
    setProject((current) => ({
      ...current,
      files: current.files.map((file) =>
        file.path === path ? { ...file, content } : file
      ),
    }));
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
    setActiveFile(result.path);
    return {};
  }

  function handleDeleteFile(path) {
    const remaining = projectRef.current.files.filter((file) => file.path !== path);

    setProject((current) => ({ ...current, files: remaining }));
    if (activeFile === path) {
      setActiveFile(remaining[0]?.path ?? null);
    }
  }

  function handleExport() {
    const current = projectRef.current;
    if (!current || current.files.length === 0) return;
    downloadBlob(createZip(current.files), `${current.name}.zip`);
  }

  async function handleRun() {
    const current = projectRef.current;
    if (!current || running) return;

    clearOutput();

    const target = pickRunTarget(current.files, activeFileData?.path);
    if (!target) {
      appendOutput("stderr", "Нечего запускать. Создай main.py или открой любой .py-файл.");
      return;
    }

    setRunning(true);
    const result = await getEngine().run(current.files, target, {
      timeoutMs: RUN_TIMEOUT_MS,
    });

    if (result.reason === "timeout") {
      appendOutput("stderr", `Выполнение прервано: превышено ${RUN_TIMEOUT_MS / 1000} с.`);
    } else if (result.reason === "output-limit") {
      appendOutput("stderr", "Выполнение прервано: слишком большой вывод.");
    } else if (result.reason === "stopped") {
      appendOutput("stderr", "Выполнение остановлено.");
    } else {
      if (result.error) appendOutput("stderr", result.error);
      setExitCode(result.exitCode);
    }

    // Весь вывод показываем сразу, до кода выхода.
    flushOutput();
    setRunning(false);
  }

  if (!project) {
    return (
      <StartScreen
        types={PROJECT_TYPES}
        saved={saved}
        onSelect={handleSelectType}
        onContinue={handleContinue}
      />
    );
  }

  return (
    <main className="ide">
      <TopBar
        projectName={project.name}
        typeName={projectType?.name ?? project.type}
        runtimeStatus={runtimeStatus}
        running={running}
        canExport={files.length > 0}
        onRun={handleRun}
        onStop={() => getEngine().stop()}
        onExport={handleExport}
      />

      <section className="workspace">
        <FileExplorer
          projectName={project.name}
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
          />
        ) : (
          <div className="editor-panel editor-empty">
            <p>Файлов нет</p>
            <p>Создай файл кнопкой «+» в проводнике.</p>
          </div>
        )}
      </section>

      <Terminal
        lines={lines}
        exitCode={exitCode}
        running={running}
        saveStatus={saveStatus}
      />

      <footer className="statusbar">
        <span>{activeFileData?.path ?? "Нет открытого файла"}</span>
        <span>{projectType?.name ?? project.type}</span>

        <button className="close-session" onClick={handleCloseProject}>
          Закрыть проект
        </button>
      </footer>
    </main>
  );
}
