"use client";

import { useState, useRef, useEffect } from "react";

export default function FilterSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: number;
  onChange: (i: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = value !== 0;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.45rem 0.85rem",
          background: active ? "var(--accent-dim)" : "var(--bg-secondary)",
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          borderRadius: 8,
          color: active ? "var(--accent)" : "var(--text-primary)",
          fontSize: "0.8rem",
          fontWeight: active ? 600 : 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        {options[value]}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 6px)",
          left: 0,
          zIndex: 100,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          overflow: "hidden",
          minWidth: 140,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => { onChange(i); setOpen(false); }}
              style={{
                width: "100%",
                padding: "0.55rem 1rem",
                background: value === i ? "var(--accent-dim)" : "transparent",
                border: "none",
                borderBottom: i < options.length - 1 ? "1px solid var(--border-subtle)" : "none",
                color: value === i ? "var(--accent)" : "var(--text-secondary)",
                fontSize: "0.8rem",
                fontWeight: value === i ? 600 : 400,
                cursor: "pointer",
                textAlign: "left",
              }}
              onMouseEnter={e => { if (value !== i) (e.currentTarget as HTMLElement).style.background = "var(--bg-secondary)"; }}
              onMouseLeave={e => { if (value !== i) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
