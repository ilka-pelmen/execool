// Канал между главным потоком и воркером Python.
// Нужен, чтобы input() мог ЖДАТЬ строку из терминала: воркер засыпает в Atomics.wait,
// а главный поток пишет строку в общий буфер и будит его.
// Работает только на странице с cross-origin isolation (заголовки COOP/COEP, см. vite.config.js).

export const STATE = 0; // 0 - ждём, 1 - данные готовы
export const LENGTH = 1; // длина строки в байтах
export const EOF = 2; // 1 - поток ввода закрыт (Ctrl+D)

const INTERRUPT_OFFSET = 16; // байт для KeyboardInterrupt (SIGINT)
const DATA_OFFSET = 32;
const DATA_BYTES = 64 * 1024; // максимальная длина одной введённой строки

export function inputSupported() {
  return (
    typeof SharedArrayBuffer === "function" &&
    globalThis.crossOriginIsolated === true
  );
}

export function createChannelBuffer() {
  return new SharedArrayBuffer(DATA_OFFSET + DATA_BYTES);
}

export function openChannel(buffer) {
  return {
    control: new Int32Array(buffer, 0, 4),
    interrupt: new Uint8Array(buffer, INTERRUPT_OFFSET, 1),
    data: new Uint8Array(buffer, DATA_OFFSET, DATA_BYTES),
  };
}

export const MAX_LINE_BYTES = DATA_BYTES;
