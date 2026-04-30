import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type SearchableSelectOption = {
  value: string;
  label: string;
};

export function SearchableSelect(props: {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
  menuClassName?: string;
  searchPlaceholder?: string;
}) {
  const {
    value,
    onChange,
    options,
    placeholder = "Select option",
    className = "",
    menuClassName = "",
    searchPlaceholder = "Search...",
  } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );
  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current) return;
      if (event.target instanceof Node && rootRef.current.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    searchRef.current?.focus();
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`flex w-full items-center justify-between gap-2 bg-transparent px-2.5 py-1.5 text-left text-xs text-text-primary outline-none ${className}`}
        style={{
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-sm)",
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown size={14} strokeWidth={1.6} className={open ? "rotate-180" : ""} />
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 w-full overflow-hidden ${menuClassName}`}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            background: "var(--color-bg-elevated)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
          }}
        >
          <div className="p-1.5">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent px-2 py-1 text-xs text-text-primary outline-none placeholder:text-text-muted"
              style={{
                border: "1px solid var(--color-border-subtle)",
                borderRadius: "var(--radius-sm)",
              }}
            />
          </div>
          <div className="fancy-scroll max-h-56 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-text-muted">No matches</div>
            ) : (
              filteredOptions.map((option) => {
                const active = option.value === value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-white/5"
                    style={{
                      background: active ? "rgba(251,117,252,0.14)" : "transparent",
                    }}
                    role="option"
                    aria-selected={active}
                  >
                    <span className="truncate">{option.label}</span>
                    {active ? <Check size={13} strokeWidth={1.8} /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
