// Два сервера:
//  - бэкенд (/api): создаёт сессии и выдаёт токены;
//  - агент (agent_url): хранит зеркало файлов и держит языковой сервер.
// Браузер ходит к агенту напрямую, с токеном, который выдал бэкенд.

const API_BASE = "/api";
const JSON_HEADERS = { "Content-Type": "application/json" };

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 - сервер недоступен
    this.code = code;
  }
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new ApiError(0, "network", "Нет связи с сервером");
  }

  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      // тело не JSON, например страница прокси
    }
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      data?.error ?? `http_${response.status}`,
      data?.message ?? `Ошибка сервера (${response.status})`
    );
  }
  return data;
}

// ---- бэкенд ----

/** Создаёт сессию на агенте. Возвращает всё нужное для подключения. */
export function startLspSession(languageId) {
  return request(`${API_BASE}/sessions/start-lsp`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ language_id: languageId }),
  });
}

/** Новый одноразовый билет для WebSocket (переподключение). */
export function renewLspTicket(sessionId) {
  return request(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/lsp-ticket`,
    { method: "POST" }
  );
}

export function renewFilesToken(sessionId) {
  return request(
    `${API_BASE}/sessions/${encodeURIComponent(sessionId)}/files-token`,
    { method: "POST" }
  );
}

/** keepalive: запрос дойдёт, даже если вкладку закрывают. */
export function deleteSession(sessionId) {
  return request(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    keepalive: true,
  });
}

// ---- агент ----
// conn = { agentUrl, sessionId, filesToken }

function agentRequest(conn, path, options = {}) {
  const url = `${conn.agentUrl}/sessions/${encodeURIComponent(conn.sessionId)}${path}`;
  return request(url, {
    ...options,
    headers: { Authorization: `Bearer ${conn.filesToken}`, ...options.headers },
  });
}

/** Проверка, что сессия жива. Заодно продлевает её (heartbeat). */
export function agentInfo(conn) {
  return agentRequest(conn, "");
}

/** Заменяет весь набор файлов. files: [{ path, content }] */
export function agentReplaceFiles(conn, files) {
  return agentRequest(conn, "/files", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({ files }),
  });
}

export function agentPutFile(conn, path, content) {
  return agentRequest(conn, `/file?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: content,
  });
}

export function agentDeleteFile(conn, path) {
  return agentRequest(conn, `/file?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}
