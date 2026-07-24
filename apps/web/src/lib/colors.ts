import type { CSSProperties } from "react";

/** Account colour palette (mirrors the server's PALETTE for auto-assign). */
export const ACCOUNT_COLORS = [
  "#EA4335", "#0078D4", "#3693F3", "#00B050", "#6001D2", "#EF5DA8", "#F5A623", "#0E7490",
];

/**
 * Premium tinted-avatar treatment: soft wash of the account color with the
 * initial in the full-strength color, ringed by a faint inset stroke.
 * Expects a 6-digit hex (the account color palette is all hex).
 */
export function tint(color: string): CSSProperties {
  return {
    background: `${color}1c`,
    color,
    boxShadow: `inset 0 0 0 1.5px ${color}3d`,
  };
}
