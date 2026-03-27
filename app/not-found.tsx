import Link from "next/link";
import Image from "next/image";

export default function NotFound() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem",
      textAlign: "center",
      position: "relative",
      overflow: "hidden",
    }}>

      {/* Ambient glow */}
      <div style={{
        position: "absolute",
        top: "30%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 500,
        height: 500,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,82,255,0.07) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      {/* Logo */}
      <div style={{ marginBottom: "2.5rem", opacity: 0.9 }}>
        <Image src="/logo-trimmed.png" alt="Outline" width={48} height={48} style={{ borderRadius: 12 }} />
      </div>

      {/* Big error code */}
      <div style={{
        fontFamily: "var(--font-geist-mono)",
        fontSize: "clamp(5rem, 18vw, 10rem)",
        fontWeight: 800,
        lineHeight: 0.9,
        letterSpacing: "-0.05em",
        background: "linear-gradient(180deg, #333 0%, #1a1a1a 100%)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
        marginBottom: "2rem",
        userSelect: "none",
      }}>
        404
      </div>

      {/* Headline */}
      <div style={{
        fontWeight: 800,
        fontSize: "clamp(1rem, 3vw, 1.4rem)",
        letterSpacing: "0.25em",
        color: "var(--text-primary)",
        textTransform: "uppercase",
        marginBottom: "0.75rem",
      }}>
        BEYOND THE BAND
      </div>

      {/* Subtext */}
      <div style={{
        color: "var(--text-muted)",
        fontSize: "0.875rem",
        lineHeight: 1.7,
        maxWidth: 320,
        marginBottom: "2.5rem",
      }}>
        This page drifted outside the range.<br />
        No oracle can locate it.
      </div>

      {/* Divider */}
      <div style={{
        width: 40,
        height: 1,
        background: "var(--border)",
        marginBottom: "2.5rem",
      }} />

      <Link href="/" style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.5rem",
        background: "var(--accent)",
        color: "#fff",
        border: "none",
        borderRadius: 10,
        padding: "0.7rem 1.75rem",
        fontWeight: 700,
        fontSize: "0.875rem",
        textDecoration: "none",
        boxShadow: "0 0 24px rgba(0,82,255,0.3)",
        letterSpacing: "0.03em",
        transition: "opacity 0.15s",
      }}>
        Back to markets
      </Link>
    </div>
  );
}
