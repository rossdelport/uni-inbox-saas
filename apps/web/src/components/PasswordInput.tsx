import { useId, useState, type InputHTMLAttributes } from "react";

// Password field with a show/hide eye. Wraps the kit's .field input so it
// keeps the same height, radius and focus ring; only the right padding
// changes to make room for the toggle.
export function PasswordInput({
  style,
  wrapperStyle,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** Layout for the wrapper, which is the real flex/grid child now. */
  wrapperStyle?: React.CSSProperties;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <div className="pw-wrap" style={wrapperStyle}>
      <input
        {...props}
        id={props.id ?? id}
        type={shown ? "text" : "password"}
        // paddingRight is applied last so it survives a caller passing the
        // `padding` shorthand, which would otherwise reset it and let the
        // eye sit on top of the text.
        style={{ ...style, paddingRight: 42 }}
      />
      <button
        // type="button" matters: these live inside forms and the default
        // submit type would try to connect the account on every peek.
        type="button"
        className="pw-eye"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"}
        tabIndex={-1}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

const S = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" {...S}>
      <path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.8 17.8 0 0 1-3.1 4.1M6.2 6.2A17.6 17.6 0 0 0 2 12s3.6 7 10 7a10.8 10.8 0 0 0 5.8-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
