import Image from "next/image";
import Link from "next/link";

const navLinks = [
  { label: "Markets", href: "/markets" },
  { label: "Portfolio", href: "/portfolio" },
];

export default function Navbar() {
  return (
    <header
      style={{
        backgroundColor: "var(--bg-secondary)",
        borderBottom: "1px solid var(--border)",
      }}
      className="sticky top-0 z-50 w-full"
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        {/* Logo + wordmark */}
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <Image
            src="/logo.png"
            alt="Outline logo"
            width={32}
            height={32}
            className="rounded-sm"
            priority
          />
          <span
            style={{
              color: "var(--text-primary)",
              fontFamily: "var(--font-geist-sans)",
              letterSpacing: "0.08em",
              fontWeight: 600,
              fontSize: "1.15rem",
            }}
          >
            Outline
          </span>
        </Link>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{ color: "var(--text-secondary)" }}
              className="rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-white/5 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Connect wallet — placeholder for now */}
        <button
          style={{
            backgroundColor: "var(--accent)",
            color: "#fff",
          }}
          className="rounded-lg px-4 py-2 text-sm font-semibold transition-opacity hover:opacity-90 active:opacity-80"
        >
          Connect Wallet
        </button>
      </div>
    </header>
  );
}
