import { useEffect } from "preact/hooks";

/** Закрывает всплывающее меню по клику снаружи и по Escape. */
export function useDismiss(open, onClose, ref) {
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
}
