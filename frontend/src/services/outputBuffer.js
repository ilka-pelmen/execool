// Вывод терминала хранится как список кусков { stream, text }:
// stream - "stdout" | "stderr" | "stdin" (эхо того, что ввёл пользователь).

export const MAX_OUTPUT_CHARS = 400_000;

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Убирает цветовые коды и приводит переводы строк к \n. */
export function cleanOutput(text) {
  return String(text).replace(ANSI, "").replace(/\r\n/g, "\n");
}

function trimOutput(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.text.length;
  if (total <= MAX_OUTPUT_CHARS) return chunks;

  let excess = total - MAX_OUTPUT_CHARS;
  const next = [];
  for (const chunk of chunks) {
    if (excess <= 0) {
      next.push(chunk);
    } else if (chunk.text.length > excess) {
      next.push({ ...chunk, text: chunk.text.slice(excess) });
      excess = 0;
    } else {
      excess -= chunk.text.length;
    }
  }
  return next;
}

/** Дописывает куски, склеивая соседние одного потока. Старое обрезается по лимиту. */
export function appendChunks(current, added) {
  const next = current.slice();
  for (const chunk of added) {
    const last = next[next.length - 1];
    if (last && last.stream === chunk.stream) {
      next[next.length - 1] = { ...last, text: last.text + chunk.text };
    } else {
      next.push(chunk);
    }
  }
  return trimOutput(next);
}

/**
 * Делит вывод на законченные строки и незаконченную последнюю (например, приглашение input()).
 * Поле ввода рисуется сразу после незаконченной строки.
 */
export function splitPartial(chunks) {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    const index = chunk.text.lastIndexOf("\n");
    if (index === -1) continue;

    const done = [...chunks.slice(0, i), { ...chunk, text: chunk.text.slice(0, index + 1) }];
    const partial = [{ ...chunk, text: chunk.text.slice(index + 1) }, ...chunks.slice(i + 1)].filter(
      (part) => part.text
    );
    return { done, partial };
  }
  return { done: [], partial: chunks };
}
