// Общее ядро воркера для любого рантайма (Pyodide, wasm-программы на C++ и т. д.).
// Рантайм подключается адаптером:
//   adapter.name                  имя для сообщений об ошибках ("Python", "C++")
//   adapter.load(io)              загружает рантайм, подключает вывод к io.stdout / io.stderr,
//                                 возвращает экземпляр рантайма
//   adapter.run(instance, job)    выполняет проект job = { entry, files }, возвращает код выхода
//                                 (можно вернуть значение или промис)

function errorText(error) {
  return error?.message ?? String(error);
}

export function createWorkerCore({ adapter, post }) {
  let instancePromise = null;

  const io = {
    stdout: (text) => post({ type: "output", stream: "stdout", text }),
    stderr: (text) => post({ type: "output", stream: "stderr", text }),
  };

  function init() {
    if (!instancePromise) {
      post({ type: "status", status: "loading" });

      instancePromise = Promise.resolve()
        .then(() => adapter.load(io))
        .then((instance) => {
          post({ type: "status", status: "ready" });
          return instance;
        })
        .catch((error) => {
          instancePromise = null; // следующая попытка загрузит заново
          post({ type: "status", status: "error" });
          throw error;
        });
    }

    return instancePromise;
  }

  async function handle(message) {
    if (message.type === "init") {
      try {
        await init();
      } catch (error) {
        post({
          type: "fatal",
          message: `Не удалось загрузить ${adapter.name}: ${errorText(error)}`,
        });
      }
      return;
    }

    if (message.type !== "run") return;

    try {
      const instance = await init();
      post({ type: "status", status: "running" });

      const exitCode = await adapter.run(instance, {
        entry: message.entry,
        files: message.files,
      });

      post({ type: "result", id: message.id, exitCode });
      post({ type: "status", status: "ready" });
    } catch (error) {
      post({ type: "result", id: message.id, exitCode: 1, error: errorText(error) });
    }
  }

  return { handle };
}