// Запуск: node --test src/services/lspSession.test.js
// Сеть, WebSocket и библиотека LSP заменены заглушками.

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

import { LspSession } from "./lspSession.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition, label = "условие") {
  for (let i = 0; i < 300; i++) {
    if (condition()) return;
    await sleep(5);
  }
  assert.fail(`не дождались: ${label}`);
}

/** Заглушка бэкенда и агента: записывает вызовы, ответы можно подменять. */
function createWorld(overrides = {}) {
  const world = {
    calls: [],
    sessionCounter: 0,
    agentStatus: 200, // ответ GET /sessions/{id}
    putFileStatus: () => 204,
    startStatus: 201,
    acceptedToken: "T1",
    transports: [],
    clients: [],
    ...overrides,
  };

  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  globalThis.fetch = async (url, options = {}) => {
    const method = options.method ?? "GET";
    const path = String(url).replace("http://agent", "");
    const call = { method, url: String(url), body: options.body };
    world.calls.push(call);

    if (path === "/api/sessions/start-lsp") {
      if (world.startStatus !== 201) {
        return json(world.startStatus, {
          error: "capacity",
          message: "Агент занят",
        });
      }
      const id = `s${++world.sessionCounter}`;
      world.currentId = id;
      world.acceptedToken = "T1";
      return json(201, {
        session_id: id,
        language: "python",
        root_uri: `file:///tmp/execool/session-${id}`,
        limits: { max_files: 3, max_file_bytes: 50, max_total_bytes: 100 },
        agent_url: "http://agent",
        files_token: "T1",
        lsp: { websocket_url: `ws://agent/sessions/${id}/lsp?ticket=A` },
      });
    }

    if (/^\/api\/sessions\/[^/]+\/files-token$/.test(path)) {
      world.acceptedToken = "T2";
      return json(200, { files_token: "T2" });
    }
    if (/^\/api\/sessions\/[^/]+\/lsp-ticket$/.test(path)) {
      return json(200, {
        websocket_url: `ws://agent/sessions/${world.currentId}/lsp?ticket=B`,
      });
    }
    if (method === "DELETE" && /^\/api\/sessions\/[^/]+$/.test(path)) {
      return new Response(null, { status: 204 });
    }

    // агент
    const auth = options.headers?.Authorization;
    if (auth !== `Bearer ${world.acceptedToken}`) {
      return json(401, { error: "unauthorized", message: "токен" });
    }
    if (method === "GET" && /^\/sessions\/[^/]+$/.test(path)) {
      return world.agentStatus === 200
        ? json(200, { id: world.currentId })
        : json(world.agentStatus, {
            error: "session_not_found",
            message: "нет сессии",
          });
    }
    if (method === "PUT" && path.endsWith("/files")) {
      return new Response(null, { status: 204 });
    }
    if (path.includes("/file?path=")) {
      const status = world.putFileStatus(method, decodeURIComponent(path));
      return status === 204
        ? new Response(null, { status })
        : json(status, { error: "file_too_large", message: "большой" });
    }
    return json(404, { error: "not_found", message: path });
  };

  return world;
}

// Сессии, оставшиеся после упавшего теста, иначе держат процесс таймерами.
const openSessions = [];
afterEach(() => {
  for (const session of openSessions.splice(0)) session.stop();
});

function createSession(world, extra = {}) {
  const session = new LspSession({
    heartbeatMs: 30,
    tokenRenewMs: 100_000,
    syncDebounceMs: 5,
    reconnectDelaysMs: [5, 5, 5],
    loadClientLib: async () => ({
      languageServerExtensions: () => [],
      LSPClient: class {
        constructor(config) {
          this.config = config;
          this.disconnected = false;
          world.clients.push(this);
        }
        connect(transport) {
          this.transport = transport;
          return this;
        }
        disconnect() {
          this.disconnected = true;
        }
      },
    }),
    createTransport: async (url, onClose) => {
      if (world.transportDelayMs) await sleep(world.transportDelayMs);
      world.calls.push({ method: "WS", url });
      const transport = {
        url,
        closed: false,
        sent: [],
        send(message) {
          const parsed = JSON.parse(message);
          this.sent.push(parsed);
          world.calls.push({ method: "WS-SEND", url: parsed.method });
        },
        subscribe() {},
        unsubscribe() {},
        close() {
          this.closed = true;
        },
        serverClose: (code) => onClose(code),
      };
      world.transports.push(transport);
      return transport;
    },
    ...extra,
  });
  openSessions.push(session);
  return session;
}

const FILES = [
  { path: "main.py", content: "print(1)\n" },
  { path: "util.py", content: "x = 1\n" },
];

const calls = (world, method, part) =>
  world.calls.filter((c) => c.method === method && c.url.includes(part));

test("старт: сессия, файлы на диск, и только потом WebSocket", async () => {
  const world = createWorld();
  const session = createSession(world);

  await session.start(FILES);

  const order = world.calls.map((c) => `${c.method} ${c.url.replace("http://agent", "")}`);
  assert.deepEqual(order.slice(0, 3), [
    "POST /api/sessions/start-lsp",
    "PUT /sessions/s1/files",
    "WS ws://agent/sessions/s1/lsp?ticket=A",
  ]);

  const state = session.getSnapshot();
  assert.equal(state.status, "ready");
  assert.equal(state.rootUri, "file:///tmp/execool/session-s1");
  assert.equal(state.client.config.rootUri, "file:///tmp/execool/session-s1");

  const sent = JSON.parse(calls(world, "PUT", "/files")[0].body);
  assert.deepEqual(sent.files.map((f) => f.path), ["main.py", "util.py"]);
  session.stop();
});

test("первая синхронизация пропускает файлы вне лимитов и недопустимые пути", async () => {
  const world = createWorld();
  const session = createSession(world);

  await session.start([
    { path: "main.py", content: "ok" },
    { path: "big.py", content: "x".repeat(51) }, // больше max_file_bytes
    { path: "привет.py", content: "ok" }, // кириллица
  ]);

  const sent = JSON.parse(calls(world, "PUT", "/files")[0].body);
  assert.deepEqual(sent.files.map((f) => f.path), ["main.py"]);
  assert.deepEqual(session.getSnapshot().unsynced, ["big.py", "привет.py"]);
  session.stop();
});

test("правки отправляются разницей: изменённые, новые и удалённые файлы", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  session.syncFiles([
    { path: "main.py", content: "print(2)\n" }, // изменён
    { path: "new.py", content: "" }, // новый
    // util.py удалён
  ]);
  await until(() => calls(world, "DELETE", "/file?path=").length === 1, "DELETE");

  assert.deepEqual(
    calls(world, "PUT", "/file?path=").map((c) => c.url.split("path=")[1]).sort(),
    ["main.py", "new.py"]
  );
  assert.ok(calls(world, "DELETE", "util.py").length === 1);

  // Без изменений запросов нет.
  const before = world.calls.length;
  session.syncFiles([
    { path: "main.py", content: "print(2)\n" },
    { path: "new.py", content: "" },
  ]);
  await session.flush();
  assert.equal(world.calls.length, before);
  session.stop();
});

test("401: токен обновляется один раз, запрос повторяется", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  world.acceptedToken = "T2"; // старый токен T1 больше не принимается
  session.syncFiles([{ path: "main.py", content: "изменено" }, FILES[1]]);
  await session.flush();

  assert.equal(calls(world, "POST", "/files-token").length, 1);
  const puts = calls(world, "PUT", "/file?path=");
  assert.equal(puts.length, 2); // первая попытка с 401 и повтор
  session.stop();
});

test("отказ агента (413) не повторяется, файл попадает в unsynced", async () => {
  const world = createWorld({ putFileStatus: () => 413 });
  const session = createSession(world);
  await session.start(FILES);

  const edited = [{ path: "main.py", content: "правка" }, FILES[1]];
  session.syncFiles(edited);
  await session.flush();
  await session.flush();

  assert.equal(calls(world, "PUT", "/file?path=").length, 1);
  assert.deepEqual(session.getSnapshot().unsynced, ["main.py"]);
  session.stop();
});

test("закрытие 4003 (простой): новый билет, та же сессия", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);
  const firstClient = session.getSnapshot().client;

  world.transports[0].serverClose(4003);
  await until(() => world.transports.length === 2 && session.getSnapshot().status === "ready", "reconnect");

  assert.equal(calls(world, "POST", "/lsp-ticket").length, 1);
  assert.equal(calls(world, "POST", "/start-lsp").length, 1, "новая сессия не создавалась");
  assert.notEqual(session.getSnapshot().client, firstClient);
  assert.ok(firstClient.disconnected);
  session.stop();
});

test("закрытие 4001: создаётся новая сессия и файлы отправляются заново", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  world.transports[0].serverClose(4001);
  await until(() => world.sessionCounter === 2 && session.getSnapshot().status === "ready", "recover");

  assert.equal(calls(world, "PUT", "/sessions/s2/files").length, 1);
  assert.equal(session.getSnapshot().rootUri, "file:///tmp/execool/session-s2");
  session.stop();
});

test("обрыв сети: повторы, а если сессии уже нет (404), создаётся новая", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  world.agentStatus = 404; // агент забыл сессию
  world.transports[0].serverClose(1006);
  await until(() => world.sessionCounter === 2 && session.getSnapshot().status === "ready", "recover after 404");
  session.stop();
});

test("heartbeat: GET сессии раз в интервал; 404 запускает восстановление", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  await until(() => calls(world, "GET", "/sessions/s1").length >= 2, "heartbeat");

  world.agentStatus = 404;
  await until(() => world.sessionCounter === 2, "recover by heartbeat");
  session.stop();
});

test("4010 и 4002 завершают работу ошибкой без повторов", async () => {
  for (const [code, text] of [
    [4010, "Подключение заменено другим"],
    [4002, "Не удалось запустить языковой сервер"],
  ]) {
    const world = createWorld();
    const session = createSession(world);
    await session.start(FILES);

    world.transports[0].serverClose(code);
    const state = session.getSnapshot();
    assert.equal(state.status, "error");
    assert.equal(state.message, text);
    assert.equal(world.transports.length, 1);
    assert.equal(calls(world, "DELETE", "/api/sessions/s1").length, 1);
  }
});

test("сервер занят (503 capacity): ошибка с понятным текстом, WebSocket не открывался", async () => {
  const world = createWorld({ startStatus: 503 });
  const session = createSession(world);

  await session.start(FILES);

  const state = session.getSnapshot();
  assert.equal(state.status, "error");
  assert.equal(state.message, "Сервер занят, попробуйте позже");
  assert.equal(world.transports.length, 0);

  // После ошибки можно запустить снова.
  world.startStatus = 201;
  await session.start(FILES);
  assert.equal(session.getSnapshot().status, "ready");
  session.stop();
});

test("stop(): закрывает сокет, удаляет сессию, дальше ничего не происходит", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  session.stop();
  assert.equal(session.getSnapshot().status, "off");
  assert.equal(session.getSnapshot().client, null);
  assert.ok(world.transports[0].closed);
  assert.equal(calls(world, "DELETE", "/api/sessions/s1").length, 1);

  const before = world.calls.length;
  session.syncFiles([{ path: "a.py", content: "1" }]);
  await sleep(80); // дольше интервала heartbeat
  assert.equal(world.calls.length, before);
});

test("stop() во время подключения: созданная сессия удаляется", async () => {
  const world = createWorld();
  const session = createSession(world);

  const starting = session.start(FILES);
  session.stop(); // до ответа start-lsp
  await starting;

  assert.equal(session.getSnapshot().status, "off");
  await until(() => calls(world, "DELETE", "/api/sessions/s1").length === 1, "DELETE");
  assert.equal(world.transports.length, 0);
});

test("с DefaultWorkspace клиент получает свой рабочий проводник, без него стандартный", async () => {
  class FakeDefaultWorkspace {
    constructor(client) {
      this.client = client;
      this.files = [];
    }
  }

  const withLib = createWorld();
  const first = createSession(withLib, {
    loadClientLib: async () => ({
      languageServerExtensions: () => [],
      DefaultWorkspace: FakeDefaultWorkspace,
      LSPClient: class {
        constructor(config) {
          this.config = config;
          withLib.clients.push(this);
        }
        connect() {
          return this;
        }
        disconnect() {}
      },
    }),
  });
  await first.start(FILES);
  const factory = withLib.clients[0].config.workspace;
  assert.equal(typeof factory, "function");
  const workspace = factory({});
  assert.ok(workspace instanceof FakeDefaultWorkspace);
  assert.equal(typeof workspace.displayFile, "function");
  first.stop();

  const withoutLib = createWorld();
  const second = createSession(withoutLib);
  await second.start(FILES);
  assert.equal("workspace" in withoutLib.clients[0].config, false);
  second.stop();
});

test("файлы на диске меняются: серверу уходит уведомление, соединение не трогается", async () => {
  const world = createWorld();
  const session = createSession(world);
  const statuses = [];
  session.subscribe((state) => statuses.push(state.status));
  await session.start(FILES);
  const afterStart = statuses.length;
  const transport = world.transports[0];
  const root = "file:///tmp/execool/session-s1";

  // Новый файл.
  session.syncFiles([...FILES, { path: "utils.py", content: "x = 1\n" }]);
  await until(() => transport.sent.length === 1, "created");
  assert.deepEqual(transport.sent[0], {
    jsonrpc: "2.0",
    method: "workspace/didChangeWatchedFiles",
    params: { changes: [{ uri: `${root}/utils.py`, type: 1 }] },
  });

  // Изменился модуль: сервер должен перечитать его с диска.
  session.syncFiles([FILES[0], FILES[1], { path: "utils.py", content: "x = 2\n" }]);
  await until(() => transport.sent.length === 2, "changed");
  assert.deepEqual(transport.sent[1].params.changes, [{ uri: `${root}/utils.py`, type: 2 }]);

  // Файл удалён.
  session.syncFiles([FILES[0], { path: "utils.py", content: "x = 2\n" }]);
  await until(() => transport.sent.length === 3, "deleted");
  assert.deepEqual(transport.sent[2].params.changes, [{ uri: `${root}/util.py`, type: 3 }]);

  // Ни переподключения, ни смены статуса: индикатор не мигает.
  assert.equal(world.transports.length, 1);
  assert.equal(calls(world, "POST", "/lsp-ticket").length, 0);
  assert.ok(!transport.closed);
  assert.ok(statuses.slice(afterStart).every((status) => status === "ready"));
  session.stop();
});

test("уведомление уходит после записи файла на агент, а не до", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);

  session.syncFiles([...FILES, { path: "utils.py", content: "x = 1\n" }]);
  await until(() => calls(world, "WS-SEND", "didChangeWatchedFiles").length === 1, "notification");

  const order = world.calls.map((c) => `${c.method} ${c.url}`);
  const put = order.findIndex((c) => c.startsWith("PUT") && c.includes("path=utils.py"));
  const sent = order.findIndex((c) => c.startsWith("WS-SEND"));
  assert.ok(put >= 0 && put < sent, "сначала файл на агенте, потом уведомление");
  session.stop();
});

test("flush: к моменту возврата файл на агенте и сервер уже уведомлён (смена файла в редакторе)", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start(FILES);
  const transport = world.transports[0];

  session.syncFiles([{ path: "main.py", content: "правка" }, FILES[1]]);
  await session.flush();

  assert.equal(transport.sent.length, 1);
  assert.deepEqual(transport.sent[0].params.changes, [
    { uri: "file:///tmp/execool/session-s1/main.py", type: 2 },
  ]);
  session.stop();
});

test("пустой файл на агент отправляется как перевод строки, и при полной, и при разностной синхронизации", async () => {
  const world = createWorld();
  const session = createSession(world);
  await session.start([{ path: "main.py", content: "print(1)" }, { path: "empty.py", content: "" }]);

  const full = JSON.parse(calls(world, "PUT", "/files")[0].body);
  assert.deepEqual(full.files.find((f) => f.path === "empty.py"), { path: "empty.py", content: "\n" });

  // Новый пустой файл (как при создании в проводнике).
  session.syncFiles([
    { path: "main.py", content: "print(1)" },
    { path: "empty.py", content: "" },
    { path: "new.py", content: "" },
  ]);
  await session.flush();

  const put = calls(world, "PUT", "path=new.py")[0];
  assert.equal(put.body, "\n");

  // Повторная синхронизация без правок ничего не отправляет: сравниваем то, что лежит на агенте.
  const before = world.calls.length;
  await session.flush();
  assert.equal(world.calls.length, before);
  session.stop();
});