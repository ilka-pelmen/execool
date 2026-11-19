import { createWorkerCore } from "./workerCore.js";
import runnerSource from "./runner.py?raw";

// Рантайм Pyodide раздаётся как статика из public/pyodide (копируется скриптом scripts/copy-pyodide.mjs).
const PYODIDE_URL = `${import.meta.env.BASE_URL}pyodide/`;

// Всё, что знает про Pyodide и про runner.py, живёт здесь.
function createPyodideAdapter(runnerSource) {
  return {
    name: "Python",

    async load(io) {
      const pyodide = await (async () => {
        const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
        return loadPyodide({ indexURL: PYODIDE_URL });
      })();

      pyodide.setStdout({ batched: io.stdout });
      pyodide.setStderr({ batched: io.stderr });
      pyodide.runPython(runnerSource);

      return pyodide;
    },

    async run(pyodide, { entry, files }) {
      const runner = pyodide.globals.get("execool_run");
      try {
        return runner(entry, JSON.stringify(files));
      } finally {
        runner.destroy?.();
      }
    },
  };
}

const core = createWorkerCore({
  post: (message) => self.postMessage(message),
  adapter: createPyodideAdapter(runnerSource)
});

self.onmessage = (event) => {
  core.handle(event.data);
};
