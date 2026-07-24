// Drag grip on a panel's right edge. Widths live in CSS variables on the
// root element and persist to localStorage per browser.
export function PaneResizer({
  cssVar,
  storageKey,
  min,
  max,
  fallback,
}: {
  cssVar: string;
  storageKey: string;
  min: number;
  max: number;
  fallback: number;
}) {
  function onDown(e: React.MouseEvent) {
    e.preventDefault();
    const root = document.documentElement;
    const startX = e.clientX;
    const start =
      parseFloat(getComputedStyle(root).getPropertyValue(cssVar)) ||
      parseFloat(localStorage.getItem(storageKey) ?? "") ||
      fallback;
    let width = start;
    function move(ev: MouseEvent) {
      width = Math.min(max, Math.max(min, start + ev.clientX - startX));
      root.style.setProperty(cssVar, `${width}px`);
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
      localStorage.setItem(storageKey, String(Math.round(width)));
    }
    document.body.classList.add("resizing");
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }
  return <div className="pane-grip" onMouseDown={onDown} title="Drag to resize" />;
}

/** Restore persisted panel widths (called once from Layout). */
export function restorePaneWidths() {
  const root = document.documentElement;
  for (const [key, cssVar] of [
    ["oi-side-w", "--side-w"],
    ["oi-list-w", "--list-w"],
  ] as const) {
    const stored = parseFloat(localStorage.getItem(key) ?? "");
    if (stored) root.style.setProperty(cssVar, `${stored}px`);
  }
}
