/** plural(5, ["файл", "файла", "файлов"]) -> "файлов" */
export function plural(count, forms) {
  const n = Math.abs(count) % 100;
  const last = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

export function countFiles(count) {
  return `${count} ${plural(count, ["файл", "файла", "файлов"])}`;
}

const dateFormat = new Intl.DateTimeFormat("ru", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(timestamp) {
  return timestamp ? dateFormat.format(new Date(timestamp)) : "";
}
