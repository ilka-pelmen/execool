// Проект хранится в браузере (localStorage): без сервера и без сессий.
const KEY = "execool:project:v1";

function isValid(project) {
  return (
    project &&
    typeof project.type === "string" &&
    typeof project.name === "string" &&
    Array.isArray(project.files) &&
    project.files.every(
      (file) => typeof file?.path === "string" && typeof file?.content === "string"
    )
  );
}

export function loadProject() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const project = JSON.parse(raw);
    return isValid(project) ? project : null;
  } catch {
    return null;
  }
}

/** Возвращает true, если проект сохранён. */
export function saveProject(project) {
  try {
    localStorage.setItem(KEY, JSON.stringify(project));
    return true;
  } catch {
    return false; // переполнение квоты или запрещённое хранилище
  }
}
