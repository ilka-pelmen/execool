// Мелкие линейные иконки 16x16. fill: true - сплошная заливка (play).
const PATHS = {
  file: "M4 1.8h5l3 3V14H4z M9 1.8v3h3",
  folder: "M1.8 4.2h4l1.4 1.6h7v7.4H1.8z",
  chevron: "M6 3.5l4.5 4.5L6 12.5",
  chevronDown: "M3.5 6l4.5 4.5L12.5 6",
  plus: "M8 3v10M3 8h10",
  upload: "M8 11V2.5M4.8 5.5L8 2.3l3.2 3.2M2.5 11v2.7h11V11",
  download: "M8 2.5V11M4.8 8L8 11.2 11.2 8M2.5 11v2.7h11V11",
  trash: "M3 4.5h10M6.2 4.5V3h3.6v1.5M4.3 4.5l.6 8.7h6.2l.6-8.7",
  play: "M5 3l8 5-8 5z",
  stop: "M4 4h8v8H4z",
  x: "M3.5 3.5l9 9M12.5 3.5l-9 9",
  sun: "M8 5.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9L13 13M13 3l-1.1 1.1M4.1 11.9L3 13",
  moon: "M13 9.5A5.5 5.5 0 116.5 3a4.3 4.3 0 006.5 6.5z",
  sliders: "M2.5 4.5h6M12 4.5h1.5M2.5 11.5h1.5M7 11.5h6.5M10 3v3M5 10v3",
  terminal: "M2 3h12v10H2z M4.8 6.3L7 8.5l-2.2 2.2 M8.5 10.7h2.7",
  sidebar: "M2 3h12v10H2z M6 3v10",
  check: "M3 8.5l3.2 3.2L13 4.8",
  clear: "M8 2a6 6 0 100 12A6 6 0 008 2z M3.8 12.2l8.4-8.4",
  folderPlus: "M1.8 4.2h4l1.4 1.6h7v7.4H1.8z M8 8v3.2M6.4 9.6h3.2",
};

const FILLED = new Set(["play", "stop"]);

export function Icon({ name, size = 16 }) {
  const filled = FILLED.has(name);
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
