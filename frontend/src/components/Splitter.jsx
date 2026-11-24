import { useState } from "preact/hooks";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Перетаскиваемая граница между панелями.
 * axis: "x" - вертикальная линия (двигаем влево-вправо), "y" - горизонтальная.
 * reverse: панель лежит по другую сторону (терминал снизу растёт при движении вверх).
 * Двойной клик - вернуть размер по умолчанию; стрелки на клавиатуре тоже работают.
 */
export default function Splitter({ axis, value, min, max, reverse = false, onChange, onReset, label }) {
  const [dragging, setDragging] = useState(false);

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();

    const element = event.currentTarget;
    const origin = axis === "x" ? event.clientX : event.clientY;
    const startValue = value;

    element.setPointerCapture(event.pointerId);
    document.body.classList.add(axis === "x" ? "is-resizing-x" : "is-resizing-y");
    setDragging(true);

    const move = (moveEvent) => {
      const current = axis === "x" ? moveEvent.clientX : moveEvent.clientY;
      const delta = reverse ? origin - current : current - origin;
      onChange(clamp(startValue + delta, min, max));
    };
    const finish = () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", finish);
      element.removeEventListener("pointercancel", finish);
      document.body.classList.remove("is-resizing-x", "is-resizing-y");
      setDragging(false);
    };

    element.addEventListener("pointermove", move);
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
  }

  function handleKeyDown(event) {
    const grow = axis === "x" ? "ArrowRight" : "ArrowDown";
    const shrink = axis === "x" ? "ArrowLeft" : "ArrowUp";
    if (event.key !== grow && event.key !== shrink) return;

    event.preventDefault();
    const step = event.shiftKey ? 64 : 16;
    const direction = (event.key === grow ? 1 : -1) * (reverse ? -1 : 1);
    onChange(clamp(value + direction * step, min, max));
  }

  return (
    <div
      className={`splitter splitter-${axis}${dragging ? " is-active" : ""}`}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Потяни, чтобы изменить размер. Двойной клик - сбросить"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      onDblClick={onReset}
    />
  );
}
