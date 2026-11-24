// Общее ядро воркера для любого рантайма (Pyodide, wasm-программы на C++ и т. д.).
// Рантайм подключается адаптером:
//   adapter.name                  имя для сообщений об ошибках ("Python", "C++")
//   adapter.load(io)              загружает рантайм, подключает вывод к io.stdout / io.stderr
//                                 и ввод к io.stdin, возвращает экземпляр рантайма
//   adapter.run(instance, job)    выполняет проект job = { entry, files }, возвращает код выхода
//                                 (можно вернуть значение или промис)
//
// io.stdin() блокирует воркер, пока пользователь не введёт строку в терминале.
// Возвращает строку (без перевода строки) или null, если ввод закрыт / недоступен.
// io.getInterrupt() даёт байт для прерывания выполнения (или null).

import { EOF, LENGTH, STATE, openChannel } from "./inputChannel.js";

function errorText(error) {
  return error?.message ?? String(error);
}

const NO_INPUT_MESSAGE =
  "[Ввод недоступен: страница открыта без cross-origin isolation. " +
  "Нужны заголовки COOP/COEP, см. vite.config.js]\n";

export function createWorkerCore({ adapter, post }) {
  let instancePromise = null;
  let channel = null;
  let warnedNoInput = false;
  const decoder = new TextDecoder();

  function readLine() {
    if (!channel) {
      if (!warnedNoInput) {
        warnedNoInput = true;
        post({ type: "output", stream: "stderr", text: NO_INPUT_MESSAGE });
      }
      return null;
    }

    const { control, data } = channel;
    Atomics.store(control, STATE, 0);
    post({ type: "input-request" });

    // Ждём данные (1), прерывание (2) или закрытие ввода. Значение 0 - ещё ждём.
    while (Atomics.load(control, STATE) === 0) {
      Atomics.wait(control, STATE, 0);
    }

    // Прерывание: возвращаем пустую строку, KeyboardInterrupt поднимет интерпретатор
    if (Atomics.load(control, STATE) === 2) return "";

    if (Atomics.load(control, EOF) === 1) return null;

    const length = Atomics.load(control, LENGTH);
    return decoder.decode(data.slice(0, length));
  }

  const io = {
    stdout: (text) => post({ type: "output", stream: "stdout", text }),
    stderr: (text) => post({ type: "output", stream: "stderr", text }),
    stdin: readLine,
    getInterrupt: () => channel?.interrupt ?? null,
  };

  function attachChannel(message) {
    if (message.channel && !channel) {
      channel = openChannel(message.channel);
    }
  }

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
    attachChannel(message);

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
      warnedNoInput = false;
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
