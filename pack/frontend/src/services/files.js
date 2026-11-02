const MAX_PATH = 120;

// Латиница, цифры и символы . _ - / (слеш нужен для вложенных папок).
const ALLOWED = /^[A-Za-z0-9._\-\/]+$/;

/**
 * Проверяет путь нового файла.
 * Возвращает { path } или { error }.
 */
export function validatePath(raw, existingPaths) {
  const path = String(raw ?? "").trim();

  if (!path) return { error: "Введите имя файла" };
  if (path.length > MAX_PATH) {
    return { error: `Не длиннее ${MAX_PATH} символов` };
  }
  if (!ALLOWED.test(path)) {
    return { error: "Допустимы латиница, цифры и символы . _ - /" };
  }
  if (path.startsWith("/") || path.endsWith("/")) {
    return { error: "Путь не должен начинаться или заканчиваться на /" };
  }
  if (path.split("/").some((p) => p === "" || p === "." || p === "..")) {
    return { error: "Недопустимый путь" };
  }

  for (const existing of existingPaths) {
    if (existing === path) return { error: "Такой файл уже есть" };
    if (path.startsWith(existing + "/")) {
      return { error: `«${existing}» это файл, в него нельзя вложить` };
    }
    if (existing.startsWith(path + "/")) {
      return { error: `«${path}» уже используется как папка` };
    }
  }

  return { path };
}

/**
 * Что запускать по кнопке «Запустить»:
 * main.py, если он есть, иначе открытый .py-файл.
 */
export function pickRunTarget(files, activePath) {
  const has = (p) => files.some((f) => f.path === p);

  if (has("main.py")) return "main.py";
  if (activePath && activePath.endsWith(".py") && has(activePath)) {
    return activePath;
  }
  return null;
}
