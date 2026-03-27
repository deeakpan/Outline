"use client";

const links = [
  { label: "Docs", href: "#" },
  { label: "Resources", href: "#" },
  { label: "Audit", href: "#" },
  { label: "X", href: "#" },
];

export default function BottomLinks() {
  return (
    <div style={{
      display: "flex",
      gap: "1.25rem",
    }}>
      {links.map(({ label, href }) => (
        <a
          key={label}
          href={href}
          style={{
            color: "var(--text-muted)",
            fontSize: "0.72rem",
            fontWeight: 500,
            textDecoration: "none",
            letterSpacing: "0.04em",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-secondary)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          {label}
        </a>
      ))}
    </div>
  );
}
