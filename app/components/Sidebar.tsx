"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "./ConnectButton";

const navLinks = [
  {
    label: "Markets",
    href: "/",
    icon: (
      <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5l4.5-4.5 4 4 4.5-5.5 4 4" />
        <rect x="3" y="3" width="18" height="18" rx="2" strokeOpacity="0.3" />
      </svg>
    ),
  },
  {
    label: "Open Market",
    href: "/create",
    icon: (
      <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <circle cx="12" cy="12" r="9" strokeOpacity="0.3" />
        <path strokeLinecap="round" d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    label: "Docs",
    href: "/docs",
    icon: (
      <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <rect x="4" y="3" width="16" height="18" rx="2" strokeOpacity="0.3" />
        <path strokeLinecap="round" d="M8 8h8M8 12h8M8 16h5" strokeOpacity="0.6" />
      </svg>
    ),
  },
  {
    label: "Trades",
    href: "/trades",
    icon: (
      <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      className="sidebar-desktop"
      style={{
        position: "fixed",
        top: "1rem",
        left: "1rem",
        bottom: "1rem",
        width: "220px",
        background: "var(--sidebar-bg)",
        border: "1px solid var(--border)",
        borderRadius: "16px",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,82,255,0.08)",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "1.25rem 1.25rem 1rem" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.4rem", textDecoration: "none" }}>
          <Image
            src="/logo-trimmed.png"
            alt="Outline"
            width={241}
            height={134}
            style={{ width: 48, height: "auto" }}
            className="rounded-lg"
            priority
          />
          <span
            style={{
              color: "var(--text-primary)",
              fontWeight: 700,
              fontSize: "1.2rem",
              letterSpacing: "0.06em",
            }}
          >
            Outline
          </span>
        </Link>
      </div>

      {/* Divider */}
      <div style={{ height: "1px", background: "var(--border)", margin: "0 1rem" }} />

      {/* Nav */}
      <nav style={{ flex: 1, padding: "0.75rem" }} className="flex flex-col gap-1">
        {navLinks.map((link) => {
          const active = link.href === "/" ? pathname === "/" : pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link
              key={link.href}
              href={link.href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.65rem",
                padding: "0.6rem 0.75rem",
                borderRadius: "10px",
                fontSize: "0.875rem",
                fontWeight: active ? 600 : 400,
                color: active ? "#fff" : "var(--text-secondary)",
                background: active ? "var(--accent)" : "transparent",
                boxShadow: active ? "0 0 16px rgba(0,82,255,0.35)" : "none",
                transition: "all 0.15s ease",
                textDecoration: "none",
              }}
            >
              {link.icon}
              {link.label}
            </Link>
          );
        })}
      </nav>

      {/* Wallet + network */}
      <div style={{ padding: "0.75rem" }}>
        <ConnectButton />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.4rem",
            marginTop: "0.6rem",
            color: "var(--text-muted)",
            fontSize: "0.7rem",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--green)",
              boxShadow: "0 0 6px var(--green)",
              display: "inline-block",
            }}
          />
          Base Sepolia
        </div>
      </div>
    </aside>
  );
}
