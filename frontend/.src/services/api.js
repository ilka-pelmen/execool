const API_BASE = "/api";

/**
 * Универсальный запрос к REST API.
 */
async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(
      responseText ||
        `HTTP ${response.status}: ${response.statusText}`
    );
  }

  // Поддержка ответов без тела, включая 204 No Content.
  if (!responseText.trim()) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      `Сервер вернул некорректный JSON для ${path}`
    );
  }
}

/**
 * Создать новую сессию.
 * POST /api/sessions/start
 *
 * Ожидаемый ответ:
 * { "session_id": "uuid" }
 */
export async function startSession(projectId, userId) {
  const data = await apiRequest("/sessions/start", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      user_id: userId,
    }),
  });

  if (!data?.session_id) {
    throw new Error(
      "Бэкенд не вернул session_id при создании сессии"
    );
  }

  return data;
}

/**
 * Получить список файлов проекта.
 * GET /api/sessions/{sessionId}/files
 */
export function listFiles(sessionId) {
  if (!sessionId) {
    throw new Error("sessionId обязателен");
  }

  return apiRequest(
    `/sessions/${encodeURIComponent(sessionId)}/files`
  );
}

/**
 * Получить содержимое файла.
 * GET /api/sessions/{sessionId}/file?path=...
 */
export function readFile(sessionId, filePath) {
  if (!sessionId) {
    throw new Error("sessionId обязателен");
  }

  if (!filePath) {
    throw new Error("filePath обязателен");
  }

  const query = new URLSearchParams({
    path: filePath,
  });

  return apiRequest(
    `/sessions/${encodeURIComponent(sessionId)}/file?${query}`
  );
}

/**
 * Сохранить файл.
 * PUT /api/sessions/{sessionId}/files
 *
 * Тело:
 * { "file_path": "...", "content": "..." }
 */
export function saveFile(sessionId, filePath, content) {
  if (!sessionId) {
    throw new Error("sessionId обязателен");
  }

  if (!filePath) {
    throw new Error("filePath обязателен");
  }

  if (typeof content !== "string") {
    throw new Error("content должен быть строкой");
  }

  return apiRequest(
    `/sessions/${encodeURIComponent(sessionId)}/file`,
    {
      method: "PUT",
      body: JSON.stringify({
        file_path: filePath,
        content,
      }),
    }
  );
}

/**
 * Удалить файл проекта.
 * DELETE /api/sessions/{sessionId}/file?path=...
 */
export function deleteFile(sessionId, filePath) {
  if (!sessionId) {
    throw new Error("sessionId обязателен");
  }

  if (!filePath) {
    throw new Error("filePath обязателен");
  }

  const query = new URLSearchParams({
    path: filePath,
  });

  return apiRequest(
    `/sessions/${encodeURIComponent(sessionId)}/file?${query}`,
    {
      method: "DELETE",
    }
  );
}

/**
 * Запустить код сессии.
 * POST /api/sessions/{sessionId}/run
 *
 * Бэкенд пока использует заглушку.
 */
export function runCode(sessionId, command) {
  if (!sessionId) {
    throw new Error("sessionId обязателен");
  }

  return apiRequest(
    `/sessions/${encodeURIComponent(sessionId)}/run`,
    {
      method: "POST",
      body: JSON.stringify({
        command: command,
      }),
    }
  );
}

/**
 * Завершить сессию и удалить её файлы.
 * DELETE /api/sessions/{sessionId}
 */
export function stopSession(sessionId) {
  if (!sessionId) {
    throw new Error("sessionId обязателен");
  }

  return apiRequest(
    `/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "DELETE",
      keepalive: true,
    }
  );
}