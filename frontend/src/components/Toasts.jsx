import { Icon } from "./Icons.jsx";

export default function Toasts({ toasts, onDismiss }) {
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <div className="toast-body">
            <div className="toast-text">{toast.text}</div>
            {toast.detail?.length > 0 && (
              <ul className="toast-detail">
                {toast.detail.slice(0, 4).map((line) => (
                  <li key={line}>{line}</li>
                ))}
                {toast.detail.length > 4 && <li>…и ещё {toast.detail.length - 4}</li>}
              </ul>
            )}
          </div>
          <button
            type="button"
            className="icon-btn icon-btn-small"
            onClick={() => onDismiss(toast.id)}
            aria-label="Закрыть"
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
