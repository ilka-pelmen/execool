import { createWorkerCore } from "./workerCore.js";
import runnerSource from "./runner.py?raw";

// Рантайм Pyodide раздаётся как статика из public/pyodide (копируется скриптом scripts/copy-pyodide.mjs).
const PYODIDE_URL = `${import.meta.env.BASE_URL}pyodide/`;

const core = createWorkerCore({
  runnerSource,
  post: (message) => self.postMessage(message),
  loadPyodide: async () => {
    const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
    return loadPyodide({ indexURL: PYODIDE_URL });
  },
});

self.onmessage = (event) => {
  core.handle(event.data);
};
