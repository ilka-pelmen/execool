// Чтение ZIP без библиотек: центральный каталог + DecompressionStream для deflate.
// Поддерживаются методы 0 (без сжатия) и 8 (deflate). ZIP64 и шифрование - нет.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function decodeName(bytes, flags) {
  if (flags & 0x0800) return new TextDecoder("utf-8").decode(bytes);

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Архивы из Проводника Windows с русскими именами лежат в CP866.
    try {
      return new TextDecoder("ibm866").decode(bytes);
    } catch {
      return new TextDecoder("latin1").decode(bytes);
    }
  }
}

/**
 * Список записей архива: [{ name, size, compressedSize, method, flags, offset, isDirectory }].
 * bytes: Uint8Array со всем архивом.
 */
export function listZipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocd = -1;
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("это не ZIP-архив");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error("ZIP64 не поддерживается");
  }

  const entries = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("архив повреждён");
    }

    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);

    const name = decodeName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      flags
    );

    entries.push({
      name,
      size,
      compressedSize,
      method,
      flags,
      offset: localOffset,
      isDirectory: name.endsWith("/"),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Содержимое одной записи как Uint8Array. */
export async function readZipEntry(bytes, entry) {
  if (entry.flags & 0x0001) throw new Error("архив защищён паролем");
  if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff) {
    throw new Error("ZIP64 не поддерживается");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.offset, true) !== LOCAL_SIGNATURE) {
    throw new Error("архив повреждён");
  }

  const nameLength = view.getUint16(entry.offset + 26, true);
  const extraLength = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`метод сжатия ${entry.method} не поддерживается`);
}
