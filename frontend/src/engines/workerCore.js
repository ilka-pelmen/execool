// Логика воркера без привязки к браузеру: загрузчик Pyodide и канал сообщений приходят снаружи.

function errorText(error) {
  return error?.message ?? String(error);
}

export function createWorkerCore({ loadPyodide, runnerSource, post }) {
  let pyodidePromise = null;

  function init() {
    if (!pyodidePromise) {
      post({ type: "status", status: "loading" });

      pyodidePromise = (async () => {
        const pyodide = await loadPyodide();

        pyodide.setStdout({
          batched: (text) => post({ type: "output", stream: "stdout", text }),
        });
        pyodide.setStderr({
          batched: (text) => post({ type: "output", stream: "stderr", text }),
        });

        pyodide.runPython(runnerSource);
        post({ type: "status", status: "ready" });
        return pyodide;
      })().catch((error) => {
        pyodidePromise = null; // следующая попытка загрузит заново
        post({ type: "status", status: "error" });
        throw error;
      });
    }

    return pyodidePromise;
  }

  async function handle(message) {
    if (message.type === "init") {
      try {
        await init();
      } catch (error) {
        post({ type: "fatal", message: `Не удалось загрузить Python: ${errorText(error)}` });
      }
      return;
    }

    if (message.type !== "run") return;

    try {
      const pyodide = await init();
      post({ type: "status", status: "running" });

      const runner = pyodide.globals.get("execool_run");
      let exitCode;
      try {
        exitCode = runner(message.entry, JSON.stringify(message.files));
      } finally {
        runner.destroy?.();
      }

      post({ type: "result", id: message.id, exitCode });
      post({ type: "status", status: "ready" });
    } catch (error) {
      post({ type: "result", id: message.id, exitCode: 1, error: errorText(error) });
    }
  }

  return { handle };
}
