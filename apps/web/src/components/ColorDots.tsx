import { ACCOUNT_COLORS } from "../lib/colors.js";

// Simple swatch-row colour picker used wherever an account colour is chosen.
export function ColorDots({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (color: string) => void;
}) {
  return (
    <span className="cdots">
      {ACCOUNT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Colour ${c}`}
          className={`cdot ${value === c ? "sel" : ""}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </span>
  );
}
