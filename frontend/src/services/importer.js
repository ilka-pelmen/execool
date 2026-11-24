// Импорт файлов, папок и ZIP-проектов в проект.
// Источник (source) - это { path, size, read() -> Promise<Uint8Array> }.
// Из источников получаем только текстовые UTF-8 файлы разумного размера.

import { listZipEntries, readZipEntry } from "./zip_reader.js";

export const LIMITS = {
  fileBytes: 1_000_000, // один файл
  totalBytes: 3_000_000, // весь проект (он хранится в localStorage)
  fileCount: 500,
  scanCount: 5000, // сколько записей вообще готовы перебирать
};

const IGNORED_DIRS = new Set([
  ".git",
  ".idea",
  ".vscode",
  ".venv",
  "venv",
  "node_modules",
  "__pycache__",
  "__MACOSX",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
]);
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);
const BINARY_EXT =
  /\.(pyc|pyo|so|dll|dylib|exe|bin|png|jpe?g|gif|webp|bmp|ico|pdf|mp3|mp4|mov|avi|wav|woff2?|ttf|otf|whl|gz|tgz|tar|7z|rar|zip)$/i;

const MAX_PATH = 200;

/** Приводит путь к виду "a/b.py". null, если путь небезопасен. */
export function normalizeImportPath(raw) {
  const parts = String(raw ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part !== "" && part !== ".");

  if (parts.length === 0 || parts.some((part) => part === "..")) return null;

  const path = parts.join("/").replace(/[\u0000-\u001f]/g, "");
  return path && path.length <= MAX_PATH ? path : null;
}

function isIgnored(path) {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  return IGNORED_FILES.has(file) || parts.slice(0, -1).some((dir) => IGNORED_DIRS.has(dir));
}

function looksBinary(bytes) {
  const end = Math.min(bytes.length, 8000);
  for (let i = 0; i < end; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}

function baseName(path) {
  return path.slice(path.lastIndexOf("/") + 1);
}

// ---------- источники ----------

export function sourcesFromFileList(list) {
  return Array.from(list ?? []).map((file) => ({
    path: file.webkitRelativePath || file.name,
    size: file.size,
    read: async () => new Uint8Array(await file.arrayBuffer()),
  }));
}

async function collectEntries(entries) {
  const sources = [];
  let scanned = 0;

  async function walk(entry) {
    if (++scanned > LIMITS.scanCount) throw new Error("слишком много файлов");

    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      sources.push({
        path: entry.fullPath.replace(/^\//, ""),
        size: file.size,
        read: async () => new Uint8Array(await file.arrayBuffer()),
      });
      return;
    }

    if (entry.isDirectory) {
      if (IGNORED_DIRS.has(entry.name)) return;

      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject)
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }

  for (const entry of entries) await walk(entry);
  return sources;
}

/**
 * Файлы и папки из drag-and-drop. Записи нужно взять синхронно, внутри обработчика drop:
 * после него DataTransfer пустеет. Поэтому функция не async.
 */
export function sourcesFromDataTransfer(dataTransfer) {
  const entries = [];
  for (const item of Array.from(dataTransfer?.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    return Promise.resolve(sourcesFromFileList(dataTransfer?.files));
  }
  return collectEntries(entries);
}

let activeInput = null; // держим ссылку: Safari иначе может собрать input до события change

/** Окно выбора файлов. kind: "files" | "folder" | "zip". Возвращает источники или null. */
export function pickSources(kind) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";

    if (kind === "folder") {
      input.webkitdirectory = true;
    } else if (kind === "zip") {
      input.accept = ".zip,application/zip";
    } else {
      input.multiple = true;
    }

    input.addEventListener(
      "change",
      () => {
        activeInput = null;
        resolve(input.files?.length ? sourcesFromFileList(input.files) : null);
      },
      { once: true }
    );
    input.addEventListener(
      "cancel",
      () => {
        activeInput = null;
        resolve(null);
      },
      { once: true }
    );

    activeInput = input;
    input.click();
  });
}

// ---------- сборка результата ----------

async function expandZip(source) {
  const bytes = await source.read();
  const entries = listZipEntries(bytes);

  return entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      path: entry.name,
      size: entry.size,
      read: () => readZipEntry(bytes, entry),
    }));
}

/**
 * Превращает источники в файлы проекта.
 * stripRoot: если все файлы лежат в одной папке (как при импорте папки или ZIP), убрать её.
 * Возвращает { name, files: [{ path, content }], skipped: [{ path, reason }] }.
 */
export async function buildImport(sources, { stripRoot = false } = {}) {
  const skipped = [];
  const expanded = [];
  let archiveName = null;

  for (const source of sources) {
    if (/\.zip$/i.test(source.path)) {
      try {
        expanded.push(...(await expandZip(source)));
        if (sources.length === 1) {
          archiveName = baseName(source.path).replace(/\.zip$/i, "");
        }
      } catch (error) {
        skipped.push({ path: source.path, reason: `не удалось прочитать ZIP: ${error.message}` });
      }
      continue;
    }
    expanded.push(source);
  }

  if (expanded.length > LIMITS.scanCount) throw new Error("слишком много файлов");

  let items = [];
  for (const source of expanded) {
    const path = normalizeImportPath(source.path);
    if (!path) {
      skipped.push({ path: source.path, reason: "недопустимый путь" });
    } else if (!isIgnored(path)) {
      items.push({ path, size: source.size, read: source.read });
    }
  }

  // Общая корневая папка: имя проекта берём из неё.
  let rootName = null;
  if (items.length > 0 && items.every((item) => item.path.includes("/"))) {
    const first = items[0].path.split("/")[0];
    if (items.every((item) => item.path.split("/")[0] === first)) {
      rootName = first;
      if (stripRoot) {
        items = items.map((item) => ({ ...item, path: item.path.slice(first.length + 1) }));
      }
    }
  }

  const files = [];
  let total = 0;

  for (const item of items.sort((a, b) => a.path.localeCompare(b.path))) {
    const skip = (reason) => skipped.push({ path: item.path, reason });

    if (files.length >= LIMITS.fileCount) {
      skip(`лимит: не больше ${LIMITS.fileCount} файлов`);
      continue;
    }
    if (BINARY_EXT.test(item.path)) {
      skip("не текстовый файл");
      continue;
    }
    if (item.size > LIMITS.fileBytes) {
      skip("файл больше 1 МБ");
      continue;
    }

    let bytes;
    try {
      bytes = await item.read();
    } catch (error) {
      skip(`не удалось прочитать: ${error.message}`);
      continue;
    }

    if (bytes.length > LIMITS.fileBytes) {
      skip("файл больше 1 МБ");
      continue;
    }
    if (looksBinary(bytes)) {
      skip("не текстовый файл");
      continue;
    }

    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      skip("не в кодировке UTF-8");
      continue;
    }

    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    text = text.replace(/\r\n?/g, "\n");

    if (total + text.length > LIMITS.totalBytes) {
      skip("лимит: проект не больше 3 МБ");
      continue;
    }

    total += text.length;
    files.push({ path: item.path, content: text });
  }

  return { name: rootName ?? archiveName, files, skipped };
}

/**
 * Добавляет импортированные файлы в проект.
 * Возвращает { files, added, replaced, conflicts }: replaced - перезаписанные пути,
 * conflicts - пути, которые не удалось добавить (файл против папки с тем же именем).
 */
export function mergeFiles(existing, incoming) {
  const map = new Map(existing.map((file) => [file.path, file]));
  const added = [];
  const replaced = [];
  const conflicts = [];

  for (const file of incoming) {
    const clash = [...map.keys()].some(
      (path) => file.path.startsWith(`${path}/`) || path.startsWith(`${file.path}/`)
    );
    if (clash) {
      conflicts.push(file.path);
      continue;
    }

    if (map.has(file.path)) replaced.push(file.path);
    else added.push(file.path);
    map.set(file.path, { path: file.path, content: file.content });
  }

  return { files: [...map.values()], added, replaced, conflicts };
}
