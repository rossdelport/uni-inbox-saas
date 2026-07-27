/** Account colour palette (mirrors the server's PALETTE for auto-assign). */
export const ACCOUNT_COLORS = [
  "#EA4335", "#0078D4", "#3693F3", "#00B050", "#6001D2", "#EF5DA8", "#F5A623", "#0E7490",
];

/**
 * Premium tinted-avatar treatment: soft wash of the account color with the
 * initial in the full-strength color, ringed by a faint stroke. Expects a
 * 6-digit hex (the account palette is all hex); the suffixes are alpha.
 */
export function tint(color: string): { backgroundColor: string; borderColor: string; fg: string } {
  return {
    backgroundColor: `${color}1C`,
    borderColor: `${color}3D`,
    fg: color,
  };
}
