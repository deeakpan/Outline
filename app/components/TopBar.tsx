"use client";

import Image from "next/image";
import Link from "next/link";
import ConnectButton from "./ConnectButton";

export default function TopBar() {
  return (
    <>
      {/* Desktop: connect button top-right */}
      <div
        className="topbar-desktop"
        style={{ position: "fixed", top: "1rem", right: "1.5rem", zIndex: 40 }}
      >
        <ConnectButton />
      </div>

      {/* Mobile: full-width top bar with logo + connect */}
      <header
        className="mobile-topbar"
        style={{
          position: "fixed", top: 0, left: 0, right: 0, height: 52, zIndex: 60,
          background: "rgba(10,10,10,0.96)", borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          alignItems: "center", justifyContent: "space-between", padding: "0 1rem",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.4rem", textDecoration: "none" }}>
          <Image src="/logo-trimmed.png" alt="Outline" width={241} height={134}
            style={{ width: 28, height: "auto", borderRadius: 6 }} priority />
          <span style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1rem", letterSpacing: "0.06em" }}>
            Outline
          </span>
        </Link>
        <ConnectButton compact />
      </header>
    </>
  );
}
