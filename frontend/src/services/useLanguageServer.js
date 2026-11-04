import { useEffect, useRef, useState } from "preact/hooks";

import { LspSession } from "../services/lspSession.js";

const STORAGE_KEY = "execool:lsp:v1";

function loadEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

// Эксперимент: как сообщать серверу о новых и удалённых файлах.
// Включить без пересборки: localStorage.setItem("execool:lsp:mode", "notify") и перезагрузить страницу.
function loadFileSetMode() {
  try {
    return localStorage.getItem("execool:lsp:mode") === "notify" ? "notify" : "restart";
  } catch {
    return "restart";
  }
}

function saveEnabled(value) {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    // хранилище недоступно: настройка просто не запомнится
  }
}

/**
 * Подсказки от языкового сервера (опционально).
 * Работает, пока есть открытый проект и тоггл включён. Остальное приложение
 * от этого не зависит: при любой ошибке редактор и запуск продолжают работать.
 */
export function useLanguageServer(
  project,
  languageId = "python",
  { openFile } = {}
) {
  const sessionRef = useRef(null);
  if (!sessionRef.current) {
    sessionRef.current = new LspSession({ fileSetChange: loadFileSetMode() });
  }
  const session = sessionRef.current;

  const [enabled, setEnabled] = useState(loadEnabled);
  const [snapshot, setSnapshot] = useState(session.getSnapshot());
  const [notice, setNotice] = useState("");

  const openFileRef = useRef(openFile);
  openFileRef.current = openFile;

  const hasProject = Boolean(project);
  const filesRef = useRef([]);
  filesRef.current = project?.files ?? [];

  useEffect(() => session.subscribe(setSnapshot), [session]);

  // Переход к определению: файл проекта открываем в редакторе, а цель вне проекта
  // (стандартная библиотека на сервере) показать нельзя, поэтому говорим об этом.
  useEffect(() => {
    let timer = null;

    session.setNavigation({
      openFile: (path) => openFileRef.current?.(path),
      onUnavailable: () => {
        setNotice("Определение вне проекта (стандартная библиотека): просмотр недоступен");
        clearTimeout(timer);
        timer = setTimeout(() => setNotice(""), 4000);
      },
    });

    return () => clearTimeout(timer);
  }, [session]);

  // Запуск при включении, остановка при выключении и при закрытии проекта.
  useEffect(() => {
    if (!enabled || !hasProject) return;

    session.start(filesRef.current, languageId);
    return () => session.stop();
  }, [session, enabled, hasProject, languageId]);

  // Зеркалирование правок на агент.
  useEffect(() => {
    if (enabled && hasProject) session.syncFiles(project.files);
  }, [session, enabled, hasProject, project?.files]);

  // Закрытие вкладки: удаляем сессию на сервере (DELETE с keepalive).
  useEffect(() => {
    const onHide = () => session.stop();
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [session]);

  function toggle() {
    const next = !enabled;
    saveEnabled(next);
    setEnabled(next);
  }

  function retry() {
    session.stop();
    session.start(filesRef.current, languageId);
  }

  return {
    enabled,
    toggle,
    retry,
    flush: () => session.flush(),
    status: snapshot.status,
    message: snapshot.message,
    unsynced: snapshot.unsynced,
    notice,
    client: snapshot.client,
    rootUri: snapshot.rootUri,
  };
}