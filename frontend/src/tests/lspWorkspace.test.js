// Запуск: node --test src/services/lspWorkspace.test.js

import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceClass, projectPathFromUri } from "./lspWorkspace.js";

const ROOT = "file:///workspace";

test("projectPathFromUri: файлы проекта и всё остальное", () => {
  assert.equal(projectPathFromUri(`${ROOT}/utils.py`, ROOT), "utils.py");
  assert.equal(projectPathFromUri(`${ROOT}/pkg/a%20b.py`, ROOT), "pkg/a b.py");
  assert.equal(projectPathFromUri("file:///typeshed/stdlib/builtins.pyi", ROOT), null);
  assert.equal(projectPathFromUri("file:///tmp/pyrefly_bundled/x.pyi", ROOT), null);
  assert.equal(projectPathFromUri(ROOT, ROOT), null);
  assert.equal(projectPathFromUri(`${ROOT}/x.py`, null), null);
  assert.equal(projectPathFromUri(`${ROOT}/%E0%A4%A.py`, ROOT), null, "битая кодировка");
});

class FakeDefaultWorkspace {
  constructor() {
    this.files = [];
  }
}

function setup(overrides = {}) {
  const log = { opened: [], unavailable: [] };
  const hooks = {
    getRootUri: () => ROOT,
    openFile: async (path) => {
      log.opened.push(path);
    },
    onUnavailable: (uri) => log.unavailable.push(uri),
    ...overrides,
  };
  const Workspace = createWorkspaceClass(FakeDefaultWorkspace, hooks, { waitMs: 100, stepMs: 5 });
  return { workspace: new Workspace(), log };
}

test("цель вне проекта: сообщаем и не переходим", async () => {
  const { workspace, log } = setup();

  const view = await workspace.displayFile("file:///typeshed/stdlib/builtins.pyi");

  assert.equal(view, null);
  assert.deepEqual(log.unavailable, ["file:///typeshed/stdlib/builtins.pyi"]);
  assert.deepEqual(log.opened, []);
});

test("файл уже открыт: возвращаем его редактор без переключения", async () => {
  const { workspace, log } = setup();
  const view = { name: "view" };
  workspace.files.push({ uri: `${ROOT}/main.py`, getView: () => view });

  assert.equal(await workspace.displayFile(`${ROOT}/main.py`), view);
  assert.deepEqual(log.opened, []);
});

test("другой файл проекта: переключаем файл и ждём появления редактора", async () => {
  const view = { name: "utils view" };
  let workspace;
  ({ workspace } = setup({
    openFile: async (path) => {
      assert.equal(path, "utils.py");
      // Редактор появляется не сразу, как и в приложении.
      setTimeout(() => workspace.files.push({ uri: `${ROOT}/utils.py`, getView: () => view }), 30);
    },
  }));

  assert.equal(await workspace.displayFile(`${ROOT}/utils.py`), view);
});

test("редактор не появился: null после ожидания", async () => {
  const { workspace, log } = setup();

  assert.equal(await workspace.displayFile(`${ROOT}/missing.py`), null);
  assert.deepEqual(log.opened, ["missing.py"]);
  assert.deepEqual(log.unavailable, []);
});
