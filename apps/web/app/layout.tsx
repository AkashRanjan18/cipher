import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { Privy } from "./providers/privy";
import "./globals.css";

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

// Every number in this product is a number someone is comparing to another
// number, so the mono face carries tabular figures and gets used for all of them.
const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cipher — from thought to trade",
  description:
    "Say what you want to happen. cipher compiles it into a live order and executes it while you're not watching.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <Privy>{children}</Privy>
      </body>
    </html>
  );
}
