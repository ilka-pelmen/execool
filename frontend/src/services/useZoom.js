import { useEffect, useRef, useState } from "preact/hooks";

import { usePersistentState } from "./usePersistentState.js";

const WHEEL_STEP = 60; // сколько «прокрутки» нужно на один шаг; обычная засечка колеса ≈ 100

/**
 * Масштаб отдельной панели: Ctrl + колесо мыши (или щипок на тачпаде), Ctrl + «+» / «-»,
 * Ctrl + 0 - сброс. Размер шрифта хранится отдельно для каждой панели.
 *
 * Использование: ref повесить на корневой элемент панели, size подставить в font-size.
 * Браузерный масштаб страницы при этом не срабатывает, пока курсор над панелью.
 */
export function useZoom(key, { base, min, max, step = 1 }) {
  const [size, setSize] = usePersistentState(
    `execool:zoom:${key}`,
    base,
    (value) => typeof value === "number" && value >= min && value <= max
  );
  const [badgeVisible, setBadgeVisible] = useState(false);

  const ref = useRef(null);
  const accumulated = useRef(0);
  const timer = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const clamp = (value) => Math.min(max, Math.max(min, value));

    function flash() {
      setBadgeVisible(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBadgeVisible(false), 1400);
    }

    function change(delta) {
      setSize((current) => clamp(current + delta));
      flash();
    }

    function onWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();

      // deltaMode 1 - строки (Firefox), 2 - страницы.
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1;
      accumulated.current += -event.deltaY * unit;

      const steps = Math.trunc(accumulated.current / WHEEL_STEP);
      if (steps !== 0) {
        accumulated.current -= steps * WHEEL_STEP;
        change(steps * step);
      }
    }

    function onKeyDown(event) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        change(step);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        change(-step);
      } else if (event.key === "0") {
        event.preventDefault();
        setSize(base);
        flash();
      }
    }

    element.addEventListener("wheel", onWheel, { passive: false, capture: true });
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("wheel", onWheel, { capture: true });
      element.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer.current);
    };
  }, []);

  return {
    ref,
    size,
    scale: Math.round((size / base) * 100),
    badgeVisible,
    reset: () => {
      setSize(base);
      setBadgeVisible(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setBadgeVisible(false), 1400);
    },
  };
}
