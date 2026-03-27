"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  {
    label: "Markets",
    href: "/",
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" strokeOpacity="0.3" />
        <path d="M3 13.5l4.5-4.5 4 4 4.5-5.5 4 4" />
      </svg>
    ),
  },
  {
    label: "Create",
    href: "/create",
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    label: "Trades",
    href: "/trades",
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 16V4m0 0L3 8m4-4l4 4" />
        <path d="M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
  {
    label: "Portfolio",
    href: "/portfolio",
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
        <rect x="3" y="7" width="18" height="14" rx="2" strokeOpacity="0.3" />
        <path d="M8 7V5a2 2 0 014 0v2" />
        <path d="M8 12h8M8 16h5" strokeOpacity="0.6" />
      </svg>
    ),
  },
];

export default function MobileNav() {
  const pathname = usePathname();

  return (
    <nav
      className="mobile-nav"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        background: "rgba(10,10,10,0.96)",
        borderTop: "1px solid var(--border)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        padding: "0.5rem 0 calc(0.5rem + env(safe-area-inset-bottom))",
        alignItems: "center",
        justifyContent: "space-around",
      }}
    >
      {navLinks.map(link => {
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.35rem 1rem",
              borderRadius: 10,
              color: active ? "var(--accent)" : "var(--text-muted)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
          >
            {link.icon}
            <span style={{ fontSize: "0.62rem", fontWeight: active ? 700 : 500, letterSpacing: "0.04em" }}>
              {link.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
