const MAX_OUTPUT_LINES = 20000;

/**
 * Запускает Python-проект в Web Worker с Pyodide.
 * run() всегда завершается объектом { exitCode, error?, reason? },
 * reason: "timeout" | "stopped" | "output-limit".
 */
export class PyodideEngine {
  #worker = null;
  #pending = null;
  #nextId = 1;
  #lines = 0;

  constructor({ onOutput, onStatus }) {
    this.onOutput = onOutput;
    this.onStatus = onStatus;
  }

  /** Заранее загружает Pyodide, чтобы первый запуск был быстрым. */
  preload() {
    try {
      this.#ensureWorker().postMessage({ type: "init" });
    } catch {
      this.onStatus("error");
    }
  }

  run(files, entry, { timeoutMs = 30000 } = {}) {
    if (this.#pending) {
      return Promise.resolve({ exitCode: 1, error: "Выполнение уже идёт" });
    }

    let worker;
    try {
      worker = this.#ensureWorker();
    } catch (error) {
      this.onStatus("error");
      return Promise.resolve({
        exitCode: 1,
        error: `Не удалось запустить среду выполнения: ${error.message}`,
      });
    }

    const id = this.#nextId++;
    this.#lines = 0;

    return new Promise((resolve) => {
      this.#pending = { id, timeoutMs, timer: null, resolve };
      worker.postMessage({ type: "run", id, files, entry });
    });
  }

  /** Прерывает выполнение: воркер завершается, следующий запуск создаст новый. */
  stop() {
    this.#abort("stopped");
  }

  #ensureWorker() {
    if (this.#worker) return this.#worker;

    const worker = new Worker(new URL("./pyodide.worker.js", import.meta.url), {
      type: "module",
    });

    worker.onmessage = (event) => this.#handle(worker, event.data);
    worker.onerror = (event) => {
      if (worker !== this.#worker) return;
      this.#terminateWorker();
      this.onStatus("error");
      this.#finish({ exitCode: 1, error: event.message || "Ошибка среды выполнения" });
    };

    this.#worker = worker;
    return worker;
  }

  #handle(worker, message) {
    if (worker !== this.#worker) return; // сообщение от уже остановленного воркера

    switch (message.type) {
      case "status":
        this.onStatus(message.status);
        // Таймаут считаем от начала выполнения, без времени загрузки Pyodide.
        if (message.status === "running" && this.#pending && !this.#pending.timer) {
          this.#pending.timer = setTimeout(
            () => this.#abort("timeout"),
            this.#pending.timeoutMs
          );
        }
        break;

      case "output":
        this.onOutput(message.stream, message.text);
        if (this.#pending && ++this.#lines > MAX_OUTPUT_LINES) {
          this.#abort("output-limit");
        }
        break;

      case "fatal":
        this.onOutput("stderr", message.message);
        break;

      case "result":
        if (this.#pending && this.#pending.id === message.id) {
          this.#finish({ exitCode: message.exitCode, error: message.error });
        }
        break;
    }
  }

  #abort(reason) {
    this.#terminateWorker();
    this.#finish({ exitCode: null, reason });
  }

  #terminateWorker() {
    if (!this.#worker) return;
    this.#worker.terminate();
    this.#worker = null;
    this.onStatus("idle");
  }

  #finish(result) {
    const pending = this.#pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    pending.resolve(result);
  }
}
