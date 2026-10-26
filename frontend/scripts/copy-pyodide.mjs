// Рантайм Pyodide должен лежать в public/pyodide (pyodide.mjs, pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json).
// Если папки ещё нет, но пакет pyodide установлен через npm, копируем его оттуда.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "public/pyodide");

if (existsSync(resolve(target, "pyodide.mjs"))) {
  console.log("Pyodide: public/pyodide уже на месте, пропускаю копирование");
  process.exit(0);
}

const candidates = [
  resolve(root, "node_modules/pyodide"),
  resolve(root, "node_modules/pyodide/dist"),
];
const source = candidates.find((dir) => existsSync(resolve(dir, "pyodide.mjs")));

if (!source) {
  console.error(
    "Pyodide не найден. Положи файлы рантайма в public/pyodide или выполни: npm install pyodide"
  );
  process.exit(1);
}

mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Pyodide: ${source} -> ${target}`);
