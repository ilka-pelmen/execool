// Всплывающий индикатор масштаба панели; клик сбрасывает масштаб.
export default function ZoomBadge({ zoom }) {
  return (
    <button
      type="button"
      className={`zoom-badge${zoom.badgeVisible ? " visible" : ""}`}
      onClick={zoom.reset}
      title="Сбросить масштаб (Ctrl+0)"
      tabIndex={-1}
    >
      {zoom.scale}%
    </button>
  );
}
