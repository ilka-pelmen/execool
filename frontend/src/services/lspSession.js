// Подключение к языковому серверу через бэкенд и агент.
//
// Источник правды - проект в браузере. На агенте лежит только зеркало файлов,
// чтобы языковой сервер мог читать их с диска. Выключили подсказки - зеркало
// удалено, проект не пострадал.
//
// Состояния: off -> connecting -> ready <-> reconnecting, и error.
// Модуль не зависит от preact: интерфейс подписывается через subscribe/getSnapshot.

import {
  ApiError,
  agentDeleteFile,
  agentInfo,
  agentPutFile,
  agentReplaceFiles,
  deleteSession,
  renewFilesToken,
  renewLspTicket,
  startLspSession,
} from "./api.js";
import { validatePath } from "./files.js";
import { createWorkspaceClass } from "./lspWorkspace.js";

// Закрытия WebSocket, которые присылает агент.
const CLOSE_SESSION_GONE = 4001; // сессия удалена или истекла
const CLOSE_START_FAILED = 4002; // языковой сервер не запустился
const CLOSE_IDLE = 4003; // закрыто по простою
const CLOSE_REPLACED = 4010; // вытеснено новым подключением

// Лимиты на случай, если агент не прислал свои.
const DEFAULT_LIMITS = {
  max_files: 100,
  max_file_bytes: 1 << 20,
  max_total_bytes: 5 << 20,
};

// Типы событий workspace/didChangeWatchedFiles из спецификации LSP.
const FILE_CREATED = 1;
const FILE_CHANGED = 2;
const FILE_DELETED = 3;

const DEFAULTS = {
  // Что делать, когда на агенте появился или исчез файл:
  //  "restart" - перезапустить языковой сервер (надёжно, но на секунду пропадают подсказки);
  //  "notify"  - отправить серверу workspace/didChangeWatchedFiles (эксперимент).
  fileSetChange: "restart",
  heartbeatMs: 2 * 60_000, // строго меньше AGENT_LSP_IDLE (5 минут)
  tokenRenewMs: 10 * 60_000, // токен файлов живёт 15 минут
  syncDebounceMs: 400,
  reconnectDelaysMs: [1000, 2000, 4000, 8000, 16000],
  recoveryWindowMs: 120_000,
  maxRecoveries: 3,
  // Библиотека грузится только при включении подсказок.
  loadClientLib: () => import("@codemirror/lsp-client"),
  createTransport: openWebSocketTransport,
};

/** Транспорт для LSPClient: один JSON-RPC в одном текстовом кадре. */
export function openWebSocketTransport(url, onClose) {
  return new Promise((resolve, reject) => {
    const handlers = new Set();
    const socket = new WebSocket(url);
    let opened = false;

    socket.onmessage = (event) => {
      const text = String(event.data);
      for (const handler of handlers) handler(text);
    };
    socket.onopen = () => {
      opened = true;
      resolve({
        send(message) {
          if (socket.readyState === 1) socket.send(message);
        },
        subscribe(handler) {
          handlers.add(handler);
        },
        unsubscribe(handler) {
          handlers.delete(handler);
        },
        close() {
          socket.close();
        },
      });
    };
    socket.onerror = () => {
      if (!opened) reject(new Error("Не удалось открыть WebSocket"));
    };
    socket.onclose = (event) => {
      if (opened) onClose(event.code);
      else reject(new Error("Не удалось открыть WebSocket"));
    };
  });
}

export function describeError(error) {
  if (error instanceof ApiError) {
    if (error.status === 0) return "Нет связи с сервером";
    if (error.code === "capacity") return "Сервер занят, попробуйте позже";
    if (error.code === "unsupported_language") {
      return "Язык не поддерживается сервером";
    }
    if (error.status === 502 || error.status === 503) {
      return "Сервер подсказок недоступен";
    }
    return error.message;
  }
  return error?.message || "Не удалось подключиться";
}

function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}

const isSessionGone = (error) =>
  error instanceof ApiError && error.status === 404;

// 400 и 413: агент не принимает именно этот файл, повторять бессмысленно.
const isRejection = (error) =>
  error instanceof ApiError && (error.status === 400 || error.status === 413);

export class LspSession {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.listeners = new Set();
    this.state = {
      status: "off",
      message: "",
      unsynced: [], // файлы, которые не попали на агент
      client: null, // LSPClient, когда status === "ready"
      rootUri: null,
    };

    this.gen = 0; // меняется при каждом старте и остановке: отсекает устаревшие async-цепочки
    this.socketSeq = 0;
    this.conn = null; // { sessionId, agentUrl, filesToken }
    this.rootUri = null;
    this.limits = DEFAULT_LIMITS;
    this.languageId = "python";

    this.latest = []; // актуальные файлы проекта
    this.mirror = new Map(); // что уже лежит на агенте: path -> content
    this.rejected = new Map(); // что агент отклонил: path -> content
    this.queue = Promise.resolve();
    this.syncTimer = null;

    this.timers = [];
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.recoveries = [];

    this.transport = null;
    this.lspClient = null;
    this.navigation = {}; // { openFile(path), onUnavailable(uri) } от интерфейса
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.state;

  /** Что делать при переходе к определению: открыть файл проекта или сообщить, что цель недоступна. */
  setNavigation(handlers) {
    this.navigation = handlers ?? {};
  }

  #setState(patch) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  // ---- запуск и остановка ----

  async start(files, languageId = "python") {
    if (this.state.status !== "off" && this.state.status !== "error") return;
    this.languageId = languageId;
    this.latest = files;
    this.recoveries = [];
    this.reconnectAttempts = 0;
    await this.#establish(++this.gen);
  }

  stop() {
    if (this.state.status === "off") return;
    this.gen++;
    this.#teardown();
    this.#setState({
      status: "off",
      message: "",
      unsynced: [],
      client: null,
      rootUri: null,
    });
  }

  /** Новая сессия на агенте: создание, первая синхронизация, WebSocket. */
  async #establish(gen) {
    this.#setState({ status: "connecting", message: "", client: null });

    try {
      const data = await startLspSession(this.languageId);
      if (gen !== this.gen) {
        deleteSession(data.session_id).catch(() => {});
        return;
      }

      this.conn = {
        sessionId: data.session_id,
        agentUrl: String(data.agent_url).replace(/\/+$/, ""),
        filesToken: data.files_token,
      };
      this.rootUri = data.root_uri;
      this.limits = { ...DEFAULT_LIMITS, ...data.limits };
      this.mirror = new Map();
      this.rejected = new Map();

      // Файлы должны лежать на диске до запуска языкового сервера.
      await this.#enqueue(() => this.#syncOnce(true));
      if (gen !== this.gen) return;

      await this.#connectSocket(gen, data.lsp.websocket_url);
      if (gen !== this.gen) return;

      this.#startTimers(gen);
      this.#becomeReady(gen);
    } catch (error) {
      this.#fail(gen, error);
    }
  }

  #becomeReady(gen) {
    if (gen !== this.gen) return;
    this.reconnectAttempts = 0;
    this.#setState({
      status: "ready",
      message: "",
      client: this.lspClient,
      rootUri: this.rootUri,
    });
    this.flush(); // правки, сделанные пока шло подключение
  }

  #fail(gen, error) {
    if (gen !== this.gen) return;
    this.gen++;
    this.#teardown();
    this.#setState({
      status: "error",
      message: describeError(error),
      client: null,
    });
  }

  #teardown() {
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.#clearTimers();
    this.#dropSocket();

    const conn = this.conn;
    this.conn = null;
    this.mirror = new Map();
    this.rejected = new Map();

    if (conn) deleteSession(conn.sessionId).catch(() => {});
  }

  // ---- WebSocket ----

  async #connectSocket(gen, url) {
    const id = ++this.socketSeq;
    const transport = await this.opts.createTransport(url, (code) => {
      if (gen === this.gen && id === this.socketSeq) this.#onSocketClosed(code);
    });

    if (gen !== this.gen || id !== this.socketSeq) {
      transport.close();
      throw new Error("Подключение отменено");
    }

    const { LSPClient, languageServerExtensions, DefaultWorkspace } =
      await this.opts.loadClientLib();
    if (gen !== this.gen || id !== this.socketSeq) {
      transport.close();
      throw new Error("Соединение закрыто");
    }

    const config = {
      rootUri: this.rootUri,
      extensions: languageServerExtensions(),
    };

    // Свой рабочий проводник нужен для перехода в другие файлы проекта.
    // Если библиотека не отдаёт DefaultWorkspace, остаётся стандартное поведение.
    if (DefaultWorkspace) {
      const WorkspaceClass = createWorkspaceClass(DefaultWorkspace, {
        getRootUri: () => this.rootUri,
        openFile: (path) => this.navigation.openFile?.(path),
        onUnavailable: (uri) => this.navigation.onUnavailable?.(uri),
      });
      config.workspace = (client) => new WorkspaceClass(client);
    }

    this.transport = transport;
    this.lspClient = new LSPClient(config).connect(transport);
  }

  #dropSocket() {
    this.socketSeq++; // событие закрытия от этого сокета больше не обрабатывается
    const { lspClient, transport } = this;
    this.lspClient = null;
    this.transport = null;

    try {
      lspClient?.disconnect();
    } catch {
      // клиент уже отключён
    }
    try {
      transport?.close();
    } catch {
      // сокет уже закрыт
    }
  }

  #onSocketClosed(code) {
    const gen = this.gen;
    this.#dropSocket();
    if (this.state.status !== "ready") return;

    this.#setState({ client: null });

    if (code === CLOSE_SESSION_GONE) return void this.#recover(gen);
    if (code === CLOSE_REPLACED) {
      return this.#fail(gen, new Error("Подключение заменено другим"));
    }
    if (code === CLOSE_START_FAILED) {
      return this.#fail(gen, new Error("Не удалось запустить языковой сервер"));
    }
    if (code === CLOSE_IDLE) {
      this.reconnectAttempts = 0;
      return this.#scheduleReconnect(gen, true);
    }
    this.#scheduleReconnect(gen);
  }

  #scheduleReconnect(gen, immediate = false) {
    if (gen !== this.gen) return;

    const delays = this.opts.reconnectDelaysMs;
    if (!immediate && this.reconnectAttempts >= delays.length) {
      return this.#fail(gen, new Error("Не удалось восстановить соединение"));
    }

    const delay = immediate ? 0 : delays[this.reconnectAttempts++];
    this.#setState({ status: "reconnecting", message: "", client: null });
    this.reconnectTimer = setTimeout(() => this.#reconnect(gen), delay);
  }

  /** Та же сессия, новый билет и новый процесс языкового сервера. */
  async #reconnect(gen) {
    this.reconnectTimer = null;
    if (gen !== this.gen) return;

    try {
      // Сначала проверяем, жива ли сессия: если нет, нужен новый старт, а не билет.
      await this.#agent((conn) => agentInfo(conn));
      if (gen !== this.gen) return;

      await this.#enqueue(() => this.#syncOnce(false)); // правки, сделанные без связи
      if (gen !== this.gen) return;

      const lsp = await renewLspTicket(this.conn.sessionId);
      if (gen !== this.gen) return;

      await this.#connectSocket(gen, lsp.websocket_url);
      this.#becomeReady(gen);
    } catch (error) {
      if (gen !== this.gen) return;
      if (isSessionGone(error)) return void this.#recover(gen);
      this.#scheduleReconnect(gen);
    }
  }

  /** Сессия пропала на агенте (простой, лимит жизни, перезапуск): создаём новую. */
  async #recover(gen) {
    if (gen !== this.gen) return;

    const now = Date.now();
    this.recoveries = this.recoveries.filter(
      (time) => now - time < this.opts.recoveryWindowMs
    );
    if (this.recoveries.length >= this.opts.maxRecoveries) {
      return this.#fail(gen, new Error("Сессия постоянно пропадает на сервере"));
    }
    this.recoveries.push(now);

    clearTimeout(this.syncTimer);
    clearTimeout(this.reconnectTimer);
    this.#clearTimers();
    this.#dropSocket();
    this.conn = null; // удалять нечего: сервер сессию уже убрал

    await this.#establish(++this.gen);
  }

  // ---- синхронизация файлов ----

  /** Вызывается при каждом изменении проекта. */
  syncFiles(files) {
    this.latest = files;
    if (this.state.status !== "ready") return;

    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.flush();
    }, this.opts.syncDebounceMs);
  }

  /** Отправляет накопленные правки сразу. Не бросает ошибок. */
  flush() {
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    if (this.state.status !== "ready") return Promise.resolve();

    const gen = this.gen;
    return this.#enqueue(() => this.#syncOnce(false))
      .then((changes) => this.#onFilesChanged(gen, changes))
      .catch((error) => {
        if (gen !== this.gen) return;
        if (isSessionGone(error)) void this.#recover(gen);
        // Остальное (сеть) не критично: следующая правка повторит синхронизацию.
      });
  }

  /** На агенте появились, изменились или исчезли файлы. */
  #onFilesChanged(gen, changes) {
    if (gen !== this.gen || this.state.status !== "ready") return;

    // Правки содержимого открытого файла сервер получает через didChange; интересны
    // только появившиеся и удалённые файлы.
    const structural = changes.filter((change) => change.type !== FILE_CHANGED);
    if (structural.length === 0) return;

    if (this.opts.fileSetChange === "notify") {
      this.#notifyFileChanges(structural);
    } else {
      this.#restartServer(gen);
    }
  }

  /** Сообщаем серверу об изменениях на диске, не перезапуская его. */
  #notifyFileChanges(changes) {
    this.transport?.send(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "workspace/didChangeWatchedFiles",
        params: {
          changes: changes.map(({ path, type }) => ({
            uri: `${this.rootUri}/${path}`,
            type,
          })),
        },
      })
    );
  }

  /**
   * Языковой сервер узнаёт о новых и удалённых файлах только при старте: клиент
   * не сообщает ему об изменениях на диске. Поэтому после смены набора файлов
   * перезапускаем сервер. Сессия та же, процесс новый, файлы уже на диске.
   */
  #restartServer(gen) {
    if (gen !== this.gen || this.state.status !== "ready") return;

    this.#dropSocket();
    this.reconnectAttempts = 0;
    this.#setState({ client: null, message: "Обновление списка файлов" });
    this.#scheduleReconnect(gen, true);
  }

  #enqueue(task) {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => {},
      () => {}
    );
    return run;
  }

  #plan(files) {
    const { max_files, max_file_bytes, max_total_bytes } = this.limits;
    const send = new Map();
    const skipped = [];
    let total = 0;

    for (const file of files) {
      const size = utf8Length(file.content);
      if (
        validatePath(file.path, []).error ||
        send.size >= max_files ||
        size > max_file_bytes ||
        total + size > max_total_bytes
      ) {
        skipped.push(file.path);
        continue;
      }
      send.set(file.path, file.content);
      total += size;
    }
    return { send, skipped };
  }

  /** Возвращает изменения на агенте: [{ path, type }], type как в LSP (1 создан, 2 изменён, 3 удалён). */
  async #syncOnce(full) {
    const { send, skipped } = this.#plan(this.latest);
    const changes = [];

    if (full) {
      const files = [...send].map(([path, content]) => ({ path, content }));
      await this.#agent((conn) => agentReplaceFiles(conn, files));
      this.mirror = new Map(send);
      this.rejected = new Map();
      this.#publishUnsynced(skipped);
      return changes;
    }

    for (const path of this.rejected.keys()) {
      if (!send.has(path)) this.rejected.delete(path);
    }

    for (const [path, content] of send) {
      if (this.mirror.get(path) === content) continue;
      if (this.rejected.get(path) === content) continue;

      try {
        await this.#agent((conn) => agentPutFile(conn, path, content));
        changes.push({
          path,
          type: this.mirror.has(path) ? FILE_CHANGED : FILE_CREATED,
        });
        this.mirror.set(path, content);
        this.rejected.delete(path);
      } catch (error) {
        if (!isRejection(error)) throw error;
        this.rejected.set(path, content);
      }
    }

    for (const path of [...this.mirror.keys()]) {
      if (send.has(path)) continue;
      await this.#agent((conn) => agentDeleteFile(conn, path));
      this.mirror.delete(path);
      changes.push({ path, type: FILE_DELETED });
    }

    this.#publishUnsynced(skipped);
    return changes;
  }

  #publishUnsynced(skipped) {
    const list = [...new Set([...skipped, ...this.rejected.keys()])].sort();
    const current = this.state.unsynced;
    const same =
      list.length === current.length &&
      list.every((path, index) => path === current[index]);
    if (!same) this.#setState({ unsynced: list });
  }

  // ---- токен и heartbeat ----

  /** Запрос к агенту; при 401 один раз обновляет токен и повторяет. */
  async #agent(call) {
    const conn = this.conn;
    if (!conn) throw new ApiError(0, "stopped", "Сессия закрыта");

    try {
      return await call(conn);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;

      await this.#renewToken(conn);
      if (!this.conn) throw new ApiError(0, "stopped", "Сессия закрыта");
      return call(this.conn);
    }
  }

  async #renewToken(conn = this.conn) {
    const data = await renewFilesToken(conn.sessionId);
    if (this.conn && this.conn.sessionId === conn.sessionId) {
      this.conn = { ...this.conn, filesToken: data.files_token };
    }
  }

  #startTimers(gen) {
    this.#clearTimers();
    this.timers = [
      setInterval(() => this.#heartbeat(gen), this.opts.heartbeatMs),
      setInterval(() => {
        if (gen === this.gen) this.#renewToken().catch(() => {});
      }, this.opts.tokenRenewMs),
    ];
  }

  #clearTimers() {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  async #heartbeat(gen) {
    if (gen !== this.gen) return;
    try {
      await this.#agent((conn) => agentInfo(conn));
    } catch (error) {
      if (gen === this.gen && isSessionGone(error)) void this.#recover(gen);
    }
  }
}