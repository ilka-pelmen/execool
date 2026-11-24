import {
  EOF,
  LENGTH,
  MAX_LINE_BYTES,
  STATE,
  createChannelBuffer,
  inputSupported,
  openChannel,
} from "./inputChannel.js";

const MAX_OUTPUT_LINES = 20000;
const MAX_OUTPUT_CHARS = 5_000_000;
const INTERRUPT_GRACE_MS = 1500; // сколько ждём KeyboardInterrupt, прежде чем убить воркер

const encoder = new TextEncoder();

function countNewlines(text) {
  let count = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) count++;
  return count;
}

/**
 * Запускает Python-проект в Web Worker с Pyodide.
 * run() всегда завершается объектом { exitCode, error?, reason? },
 * reason: "timeout" | "stopped" | "output-limit".
 *
 * Ввод: writeInput(строка) / sendEof(). Строки, введённые раньше, чем программа
 * дошла до input(), ждут в очереди. Таймаут не тикает, пока программа ждёт ввод.
 */
export class PyodideEngine {
  #worker = null;
  #pending = null;
  #nextId = 1;
  #lines = 0;
  #chars = 0;

  #sab = null;
  #channel = null;
  #waiting = false;
  #queue = [];
  #eof = false;

  constructor({ onOutput, onStatus, onWaiting = () => {} }) {
    this.onOutput = onOutput;
    this.onStatus = onStatus;
    this.onWaiting = onWaiting;

    if (inputSupported()) {
      this.#sab = createChannelBuffer();
      this.#channel = openChannel(this.#sab);
    }
  }

  /** Можно ли вводить данные в программу (нужна cross-origin isolation). */
  get interactive() {
    return this.#channel !== null;
  }

  /** Заранее загружает Pyodide, чтобы первый запуск был быстрым. */
  preload() {
    try {
      this.#ensureWorker().postMessage({ type: "init", channel: this.#sab });
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
    this.#chars = 0;
    this.#resetInput();

    return new Promise((resolve) => {
      this.#pending = {
        id,
        timeoutMs,
        remaining: timeoutMs,
        startedAt: 0,
        started: false,
        timer: null,
        graceTimer: null,
        resolve,
      };
      worker.postMessage({ type: "run", id, files, entry, channel: this.#sab });
    });
  }

  /** Передаёт строку в input(). Возвращает false, если программа не запущена. */
  writeInput(line) {
    if (!this.#pending || !this.#channel) return false;
    this.#queue.push(line);
    this.#deliver();
    return true;
  }

  /** Закрывает ввод (Ctrl+D): input() получит EOFError. */
  sendEof() {
    if (!this.#pending || !this.#channel) return;
    this.#eof = true;
    this.#deliver();
  }

  /**
   * Мягкая остановка (Ctrl+C): в программе вылетает KeyboardInterrupt, Python остаётся
   * загруженным. Если программа не отзывается, воркер убивается.
   */
  interrupt() {
  const pending = this.#pending;
  if (!pending) return;

  // Нет канала: прервать нельзя, убиваем воркер
  if (!this.#channel) {
    this.#abort("stopped");
    return;
  }

  this.#channel.interrupt[0] = 2; // SIGINT для интерпретатора

  if (this.#waiting) {
    this.#queue = [];
    // Будим воркер, только если он всё ещё ждёт (0 -> 2)
    Atomics.compareExchange(this.#channel.control, STATE, 0, 2);
    Atomics.notify(this.#channel.control, STATE);
    this.#setWaiting(false);
    this.#armTimer(); // время выполнения снова идёт
  }

  clearTimeout(pending.graceTimer);
  pending.graceTimer = setTimeout(() => this.#abort("stopped"), INTERRUPT_GRACE_MS);
}


  /** Жёсткая остановка: воркер завершается, следующий запуск создаст новый. */
  stop() {
    this.#abort("stopped");
  }

  #resetInput() {
    this.#queue = [];
    this.#eof = false;
    this.#setWaiting(false);

    if (this.#channel) {
      const { control, interrupt } = this.#channel;
      Atomics.store(control, STATE, 0);
      Atomics.store(control, LENGTH, 0);
      Atomics.store(control, EOF, 0);
      interrupt[0] = 0;
    }
  }

  #setWaiting(value) {
    if (this.#waiting === value) return;
    this.#waiting = value;
    this.onWaiting(value);
  }

  // Отдаёт воркеру следующую строку (или EOF), если он ждёт ввод.
  #deliver() {
    if (!this.#waiting || !this.#channel) return;
    const { control, data } = this.#channel;

    if (this.#queue.length > 0) {
      const bytes = encoder.encode(this.#queue.shift());
      const length = Math.min(bytes.length, MAX_LINE_BYTES);
      data.set(bytes.subarray(0, length));
      Atomics.store(control, LENGTH, length);
      Atomics.store(control, EOF, 0);
    } else if (this.#eof) {
      Atomics.store(control, LENGTH, 0);
      Atomics.store(control, EOF, 1);
    } else {
      return;
    }

    this.#setWaiting(false);
    this.#armTimer();
    Atomics.store(control, STATE, 1);
    Atomics.notify(control, STATE);
  }

  // Таймаут считаем от начала выполнения, без времени загрузки Pyodide и ожидания ввода.
  #armTimer() {
    const pending = this.#pending;
    if (!pending || !pending.started || pending.timer) return;

    pending.startedAt = performance.now();
    pending.timer = setTimeout(
      () => this.#abort("timeout"),
      Math.max(0, pending.remaining)
    );
  }

  #pauseTimer() {
    const pending = this.#pending;
    if (!pending || !pending.timer) return;

    clearTimeout(pending.timer);
    pending.timer = null;
    pending.remaining -= performance.now() - pending.startedAt;
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
        if (message.status === "running" && this.#pending && !this.#pending.started) {
          this.#pending.started = true;
          this.#armTimer();
        }
        break;

      case "input-request":
        if (!this.#pending) break;
        this.#pauseTimer();
        this.#setWaiting(true);
        this.#deliver(); // вдруг строка уже ждёт в очереди
        break;

      case "output":
        this.onOutput(message.stream, message.text);
        if (this.#pending) {
          this.#chars += message.text.length;
          this.#lines += countNewlines(message.text);
          if (this.#lines > MAX_OUTPUT_LINES || this.#chars > MAX_OUTPUT_CHARS) {
            this.#abort("output-limit");
          }
        }
        break;

      case "fatal":
        this.onOutput("stderr", `${message.message}\n`);
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
    this.#setWaiting(false);
    this.onStatus("idle");
  }

  #finish(result) {
    const pending = this.#pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    clearTimeout(pending.graceTimer);
    this.#pending = null;
    this.#setWaiting(false);
    pending.resolve(result);
  }
}
