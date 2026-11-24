import { useRef, useState } from "preact/hooks";

import { useDismiss } from "../services/useDismiss.js";
import { Icon } from "./Icons.jsx";

/**
 * Кнопка с выпадающим списком действий.
 * items: [{ label, icon, hint, onClick, disabled, danger }] или { separator: true }.
 */
export default function Menu({ icon, title, items, align = "left", label = null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useDismiss(open, () => setOpen(false), ref);

  return (
    <div className="menu-wrap" ref={ref}>
      <button
        type="button"
        className={label ? "btn btn-ghost" : "icon-btn"}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name={icon} />
        {label}
      </button>

      {open && (
        <div className={`menu menu-${align}`} role="menu">
          {items.map((item, index) =>
            item.separator ? (
              <div className="menu-sep" key={`sep-${index}`} />
            ) : (
              <button
                type="button"
                role="menuitem"
                key={item.label}
                className={`menu-item${item.danger ? " menu-item-danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                <span className="menu-item-main">
                  <span className="menu-item-title">{item.label}</span>
                  {item.hint && <span className="menu-item-hint">{item.hint}</span>}
                </span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
