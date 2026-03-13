import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";

export interface DropdownOption {
  value: string;
  label: string;
  /** Optional colored dot shown before the label */
  dot?: string;
  /** Optional icon URL shown before the label (takes precedence over dot) */
  iconUrl?: string;
}

interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  /** Align the menu to the right edge of the trigger (default: true) */
  alignRight?: boolean;
}

export default function Dropdown({
  value,
  onChange,
  options,
  placeholder = "Select...",
  alignRight = true,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px 5px 10px",
          borderRadius: 8,
          border: open ? "1px solid var(--accent)" : "1px solid var(--border)",
          background: "var(--bg-tertiary)",
          color: selected && selected.value !== options[0]?.value
            ? "var(--text-primary)"
            : "var(--text-muted)",
          fontSize: 12, fontWeight: 500,
          fontFamily: "inherit",
          cursor: "pointer", outline: "none",
          transition: "border-color 0.12s",
          whiteSpace: "nowrap",
        }}
      >
        {selected?.iconUrl ? (
          <img src={selected.iconUrl} alt="" style={{
            width: 14, height: 14, flexShrink: 0, borderRadius: 2,
            filter: "var(--icon-filter, none)",
          }} />
        ) : selected?.dot ? (
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: selected.dot, flexShrink: 0,
          }} />
        ) : null}
        <span>{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={12}
          style={{
            color: "var(--text-muted)", flexShrink: 0,
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.18s ease",
          }}
        />
      </button>

      {/* Menu */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          ...(alignRight ? { right: 0 } : { left: 0 }),
          minWidth: "100%",
          maxHeight: 220, overflowY: "auto",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          boxShadow: "var(--shadow-lg)",
          zIndex: 50,
          padding: 4,
          animation: "fade-in 0.1s ease-out",
        }}>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  width: "100%",
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "none",
                  background: active ? "var(--bg-hover)" : "transparent",
                  color: active ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  textAlign: "left",
                  whiteSpace: "nowrap",
                  transition: "background 0.06s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                {opt.iconUrl ? (
                  <img src={opt.iconUrl} alt="" style={{
                    width: 14, height: 14, flexShrink: 0, borderRadius: 2,
                    filter: "var(--icon-filter, none)",
                  }} />
                ) : opt.dot ? (
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: opt.dot, flexShrink: 0,
                  }} />
                ) : null}
                <span style={{ flex: 1 }}>{opt.label}</span>
                {active && (
                  <span style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0 }}>&#10003;</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
