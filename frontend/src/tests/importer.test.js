import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";

import { createZip } from "../services/export_zip.js";
import { listZipEntries, readZipEntry } from "../services/zip_reader.js";
import {
  buildImport,
  mergeFiles,
  normalizeImportPath,
  sourcesFromFileList,
} from "../services/importer.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

const source = (path, content) => {
  const bytes = typeof content === "string" ? enc.encode(content) : content;
  return { path, size: bytes.length, read: async () => bytes };
};

// ZIP с методом deflate (createZip пишет без сжатия).
function deflatedZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(text);
    const packed = deflateRawSync(raw);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 8, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 8, true);
    entry.setUint32(20, packed.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);

    parts.push(new Uint8Array(local.buffer), nameBytes, packed);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }

  const centralSize = central.reduce((sum, p) => sum + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(files).length, true);
  end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Uint8Array(
    Buffer.concat([...parts, ...central, new Uint8Array(end.buffer)])
  );
}

test("normalizeImportPath чистит пути и отбрасывает небезопасные", () => {
  assert.equal(normalizeImportPath("./a\\b/c.py"), "a/b/c.py");
  assert.equal(normalizeImportPath("/abs/x.py"), "abs/x.py");
  assert.equal(normalizeImportPath("../evil.py"), null);
  assert.equal(normalizeImportPath("a/../../evil.py"), null);
  assert.equal(normalizeImportPath(""), null);
});

test("ZIP без сжатия читается обратно", async () => {
  const blob = createZip([
    { path: "main.py", content: "print(1)\n" },
    { path: "pkg/util.py", content: "x = 'Привет'\n" },
  ]);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const entries = listZipEntries(bytes);
  assert.deepEqual(entries.map((e) => e.name), ["main.py", "pkg/util.py"]);
  assert.equal(dec.decode(await readZipEntry(bytes, entries[1])), "x = 'Привет'\n");
});

test("ZIP с deflate читается обратно", async () => {
  const text = "print('hello')\n".repeat(50);
  const bytes = deflatedZip({ "main.py": text });
  const [entry] = listZipEntries(bytes);

  assert.equal(entry.method, 8);
  assert.equal(dec.decode(await readZipEntry(bytes, entry)), text);
});

test("не ZIP даёт понятную ошибку", () => {
  assert.throws(() => listZipEntries(enc.encode("просто текст, не архив")), /ZIP/);
});

test("buildImport: ZIP с общей папкой, мусор и бинарники пропускаются", async () => {
  const zipBytes = deflatedZip({
    "proj/main.py": "print(1)\r\n",
    "proj/lib/helpers.py": "def f(): pass\n",
    "proj/__pycache__/main.cpython-312.pyc": "junk",
    "proj/.git/config": "x",
    "proj/logo.png": "png",
    "proj/data.bin": "x",
  });

  const result = await buildImport([source("proj.zip", zipBytes)], { stripRoot: true });

  assert.equal(result.name, "proj");
  assert.deepEqual(result.files.map((f) => f.path), ["lib/helpers.py", "main.py"]);
  assert.equal(result.files.find((f) => f.path === "main.py").content, "print(1)\n");
  assert.deepEqual(result.skipped.map((s) => s.path).sort(), ["data.bin", "logo.png"].sort());
});

test("buildImport без stripRoot сохраняет папку", async () => {
  const result = await buildImport(
    [source("src/a.py", "a = 1\n"), source("src/b.py", "b = 2\n")],
    { stripRoot: false }
  );
  assert.deepEqual(result.files.map((f) => f.path), ["src/a.py", "src/b.py"]);
  assert.equal(result.name, "src");
});

test("buildImport пропускает бинарные и не-UTF-8 файлы, срезает BOM", async () => {
  const result = await buildImport([
    source("ok.py", "\ufeffprint(1)\n"),
    source("nul.txt", new Uint8Array([104, 105, 0, 1, 2])),
    source("cp1251.txt", new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2])),
  ]);

  assert.deepEqual(result.files, [{ path: "ok.py", content: "print(1)\n" }]);
  assert.equal(result.skipped.length, 2);
});

test("buildImport отбрасывает пути с ..", async () => {
  const result = await buildImport([source("../x.py", "x"), source("a.py", "a")]);
  assert.deepEqual(result.files.map((f) => f.path), ["a.py"]);
  assert.equal(result.skipped[0].reason, "недопустимый путь");
});

test("buildImport не принимает слишком большие файлы", async () => {
  const big = "a".repeat(1_000_001);
  const result = await buildImport([source("big.txt", big), source("s.py", "1")]);
  assert.deepEqual(result.files.map((f) => f.path), ["s.py"]);
  assert.match(result.skipped[0].reason, /1 МБ/);
});

test("mergeFiles: добавляет, заменяет, ловит конфликт файла и папки", () => {
  const existing = [
    { path: "main.py", content: "old" },
    { path: "util", content: "i am a file" },
  ];
  const incoming = [
    { path: "main.py", content: "new" },
    { path: "lib/a.py", content: "a" },
    { path: "util/x.py", content: "x" },
  ];

  const { files, added, replaced, conflicts } = mergeFiles(existing, incoming);

  assert.deepEqual(added, ["lib/a.py"]);
  assert.deepEqual(replaced, ["main.py"]);
  assert.deepEqual(conflicts, ["util/x.py"]);
  assert.equal(files.find((f) => f.path === "main.py").content, "new");
  assert.equal(files.length, 3);
});

test("sourcesFromFileList берёт webkitRelativePath", async () => {
  const file = new File(["x = 1\n"], "a.py");
  Object.defineProperty(file, "webkitRelativePath", { value: "proj/a.py" });

  const [item] = sourcesFromFileList([file]);
  assert.equal(item.path, "proj/a.py");
  assert.equal(dec.decode(await item.read()), "x = 1\n");
});
