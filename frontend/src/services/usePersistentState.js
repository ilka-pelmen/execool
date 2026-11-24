import { useEffect, useState } from "preact/hooks";

/** useState, который запоминает значение в localStorage. validate отбрасывает мусор. */
export function usePersistentState(key, initial, validate = () => true) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw);
        if (validate(parsed)) return parsed;
      }
    } catch {
      // хранилище недоступно или значение битое
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // настройка просто не запомнится
    }
  }, [key, value]);

  return [value, setValue];
}
