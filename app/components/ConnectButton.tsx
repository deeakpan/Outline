"use client";

import { ConnectKitButton } from "connectkit";

export default function ConnectButton({ compact }: { compact?: boolean }) {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, truncatedAddress, ensName }) => (
        <button
          onClick={show}
          style={{
            display: "block",
            width: compact ? "auto" : "100%",
            padding: compact ? "0.35rem 0.75rem" : "0.65rem",
            borderRadius: compact ? "8px" : "10px",
            background: "var(--accent)",
            color: "#fff",
            fontWeight: 600,
            fontSize: compact ? "0.78rem" : "0.875rem",
            textAlign: "center",
            cursor: "pointer",
            boxShadow: "0 0 20px rgba(0,82,255,0.3)",
            border: "none",
            whiteSpace: "nowrap",
          }}
        >
          {isConnected ? (ensName ?? truncatedAddress) : "Connect"}
        </button>
      )}
    </ConnectKitButton.Custom>
  );
}
