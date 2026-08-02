import {
  useEffect,
  useId,
  useMemo,
  useState,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
} from "react";
import { useContacts } from "../lib/queries.js";

type ContactAutocompleteProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "onKeyDown" | "onFocus" | "onBlur"
> & {
  value: string;
  onChange: (value: string) => void;
  accountId?: string | null;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
};

function currentToken(value: string): string {
  const match = /(?:^|[,;\s])([^\s,;]*)$/.exec(value);
  return match?.[1] ?? "";
}

function currentTokenStart(value: string): number {
  const token = currentToken(value);
  return value.length - token.length;
}

/**
 * A small, keyboard-friendly recipient input. It keeps the stored value as a
 * normal comma-separated address string so the existing send API remains
 * unchanged, while suggestions show the friendlier name beside each email.
 */
export function ContactAutocompleteInput({
  value,
  onChange,
  accountId = null,
  onKeyDown,
  onFocus,
  onBlur,
  ...inputProps
}: ContactAutocompleteProps) {
  const suggestionId = `contact-suggestions-${useId().replace(/:/g, "")}`;
  const [focused, setFocused] = useState(false);
  const [lookup, setLookup] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const token = useMemo(() => currentToken(value), [value]);

  // Wait for a short pause so a fast-typed address does not issue one request
  // per character. The React Query cache then makes repeated lookups instant.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLookup(token);
      setActiveIndex(0);
    }, 140);
    return () => window.clearTimeout(timer);
  }, [token]);

  const { data } = useContacts(lookup, accountId);
  const suggestions = focused ? data?.contacts ?? [] : [];

  function choose(email: string) {
    const start = currentTokenStart(value);
    onChange(`${value.slice(0, start)}${email}, ${value.slice(value.length)}`);
    setFocused(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && suggestions[activeIndex]) {
        event.preventDefault();
        choose(suggestions[activeIndex].email);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setFocused(false);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div className="contact-autocomplete">
      <input
        {...inputProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          // Give a suggestion click time to run before hiding the menu.
          window.setTimeout(() => setFocused(false), 140);
          onBlur?.(event);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={suggestions.length > 0}
        aria-controls={suggestionId}
      />
      {suggestions.length > 0 ? (
        <div className="contact-suggestions" id={suggestionId} role="listbox">
          {suggestions.map((contact, index) => (
            <button
              key={contact.email}
              type="button"
              className={`contact-suggestion ${index === activeIndex ? "active" : ""}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(contact.email)}
            >
              <span className="contact-suggestion-main">
                <span className="contact-suggestion-name">{contact.display_name || contact.email}</span>
                {contact.display_name ? <span className="contact-suggestion-email">{contact.email}</span> : null}
              </span>
              {contact.frequency > 1 ? (
                <span className="contact-suggestion-count">{contact.frequency} emails</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
