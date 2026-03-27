import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import MobileNav from "./components/MobileNav";
import Providers from "./components/Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Outline Markets",
  description: "Range prediction markets with yield on Base",
  icons: {
    icon: "/bluelogo.jpg",
    apple: "/bluelogo.jpg",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full antialiased">
        <Providers>
          <Sidebar />
          <TopBar />
          <MobileNav />
          <div className="main-content">
            <div style={{ flex: 1 }}>{children}</div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
