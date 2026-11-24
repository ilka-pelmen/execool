import { createWorkerCore } from "./workerCore.js";
import runnerSource from "./runner.py?raw";

// Рантайм Pyodide раздаётся как статика из public/pyodide (копируется скриптом scripts/copy-pyodide.mjs).
const PYODIDE_URL = `${import.meta.env.BASE_URL}pyodide/`;

// Всё, что знает про Pyodide и про runner.py, живёт здесь.
function createPyodideAdapter(runnerSource) {
  let io = null;

  // Вывод отдаём сразу, как только он появился (без ожидания конца строки):
  // иначе приглашение input("Имя: ") не показалось бы до ввода.
  const streamTo = (send) => {
    const decoder = new TextDecoder();
    return {
      write(buffer) {
        const text = decoder.decode(buffer, { stream: true });
        if (text) send(text);
        return buffer.length;
      },
    };
  };

  return {
    name: "Python",

    async load(workerIo) {
      io = workerIo;

      const pyodide = await (async () => {
        const { loadPyodide } = await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`);
        return loadPyodide({ indexURL: PYODIDE_URL });
      })();

      pyodide.setStdout(streamTo(io.stdout));
      pyodide.setStderr(streamTo(io.stderr));
      pyodide.setStdin({ stdin: () => io.stdin() });

      const interrupt = io.getInterrupt();
      if (interrupt) pyodide.setInterruptBuffer(interrupt);

      pyodide.runPython(runnerSource);

      return pyodide;
    },

    async run(pyodide, { entry, files }) {
      const interrupt = io?.getInterrupt();
      if (interrupt) interrupt[0] = 0; // сбрасываем прерывание прошлого запуска

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
  adapter: createPyodideAdapter(runnerSource),
});

self.onmessage = (event) => {
  core.handle(event.data);
};
