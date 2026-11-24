import test from "node:test";
import assert from "node:assert/strict";

function installStorage(limit = Infinity) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (String(v).length > limit) throw new Error("QuotaExceeded");
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
  return data;
}

const storage = await import("../services/storage.js");
const { createProject } = await import("../projects/types.js");

test("сохранение, список и загрузка нескольких проектов", () => {
  installStorage();

  const a = createProject("python", "A");
  const b = createProject("python", "B");
  assert.ok(a.id && b.id && a.id !== b.id);

  assert.equal(storage.saveProject(a), true);
  assert.equal(storage.saveProject(b), true);

  const list = storage.listProjects();
  assert.equal(list.length, 2);
  assert.deepEqual(new Set(list.map((p) => p.name)), new Set(["A", "B"]));
  assert.equal(list[0].fileCount, 1);

  assert.equal(storage.loadProject(a.id).name, "A");
  assert.equal(storage.loadProject("нет-такого"), null);
});

test("повторное сохранение обновляет запись, а не дублирует", () => {
  installStorage();
  const p = createProject("python", "A");
  storage.saveProject(p);
  storage.saveProject({ ...p, name: "Renamed" });

  const list = storage.listProjects();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Renamed");
});

test("удаление проекта", () => {
  installStorage();
  const p = createProject("python", "A");
  storage.saveProject(p);
  storage.setLastProject(p.id);

  storage.deleteProject(p.id);
  assert.equal(storage.listProjects().length, 0);
  assert.equal(storage.loadProject(p.id), null);
  assert.equal(storage.getLastProject(), null);
});

test("старый единственный проект переезжает в список", () => {
  const data = installStorage();
  data.set(
    "execool:project:v1",
    JSON.stringify({ type: "python", name: "old", files: [{ path: "main.py", content: "1" }] })
  );

  const list = storage.listProjects();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "old");
  assert.equal(data.has("execool:project:v1"), false);
  assert.equal(storage.loadProject(list[0].id).files[0].path, "main.py");
});

test("переполнение хранилища даёт false, а не исключение", () => {
  installStorage(50);
  const p = createProject("python", "A", [{ path: "big.py", content: "x".repeat(500) }]);
  assert.equal(storage.saveProject(p), false);
});
