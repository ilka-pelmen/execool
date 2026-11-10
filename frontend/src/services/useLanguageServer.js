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

function loadDebug() {
  try {
    return localStorage.getItem("execool:lsp:debug") === "1";
  } catch {
    return false;
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
    sessionRef.current = new LspSession({
      debug: loadDebug(),
    });
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

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const hasProjectRef = useRef(hasProject);
  hasProjectRef.current = hasProject;

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
  // Если страницу потом вернут из кэша переходов (назад/вперёд), эффекты не выполнятся
  // заново, а сессия уже остановлена: поэтому на pageshow запускаем её снова.
  useEffect(() => {
    const onHide = () => session.stop();
    const onShow = (event) => {
      if (event.persisted && enabledRef.current && hasProjectRef.current) {
        session.start(filesRef.current, languageId);
      }
    };

    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, [session, languageId]);

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