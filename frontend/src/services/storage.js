// Проекты хранятся в браузере (localStorage): без сервера и без сессий.
// Индекс проектов отдельно от самих проектов, чтобы список открывался быстро.
const INDEX_KEY = "execool:projects:v2";
const ITEM_PREFIX = "execool:project:v2:";
const LEGACY_KEY = "execool:project:v1"; // один проект до появления списка
const LAST_KEY = "execool:last-project";

export function newProjectId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch {
    // небезопасный контекст: берём запасной вариант
  }
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function isValidProject(project) {
  return Boolean(
    project &&
      typeof project.id === "string" &&
      typeof project.type === "string" &&
      typeof project.name === "string" &&
      Array.isArray(project.files) &&
      project.files.every(
        (file) => typeof file?.path === "string" && typeof file?.content === "string"
      )
  );
}

function readIndex() {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((entry) => entry && typeof entry.id === "string")
      : [];
  } catch {
    return [];
  }
}

function writeIndex(list) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

// Старый единственный проект превращаем в запись списка.
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;

    const legacy = JSON.parse(raw);
    const project = { ...legacy, id: newProjectId() };
    if (isValidProject(project) && saveProject(project)) {
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    // битые данные: оставляем как есть
  }
}

/** Список проектов, самые свежие первыми: [{ id, name, type, fileCount, updatedAt }]. */
export function listProjects() {
  migrateLegacy();
  return readIndex().sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function loadProject(id) {
  try {
    const raw = localStorage.getItem(ITEM_PREFIX + id);
    if (!raw) return null;
    const project = JSON.parse(raw);
    return isValidProject(project) && project.id === id ? project : null;
  } catch {
    return null;
  }
}

/** Возвращает true, если проект сохранён. */
export function saveProject(project) {
  if (!project?.id) return false;

  try {
    localStorage.setItem(ITEM_PREFIX + project.id, JSON.stringify(project));
  } catch {
    return false; // переполнение квоты или запрещённое хранилище
  }

  const entry = {
    id: project.id,
    name: project.name,
    type: project.type,
    fileCount: project.files.length,
    updatedAt: Date.now(),
  };
  const index = readIndex().filter((item) => item.id !== project.id);
  index.push(entry);
  return writeIndex(index);
}

export function deleteProject(id) {
  try {
    localStorage.removeItem(ITEM_PREFIX + id);
    if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY);
  } catch {
    // хранилище недоступно
  }
  writeIndex(readIndex().filter((item) => item.id !== id));
}

export function setLastProject(id) {
  try {
    localStorage.setItem(LAST_KEY, id);
  } catch {
    // не критично
  }
}

export function getLastProject() {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}
