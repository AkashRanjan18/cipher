import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Jost, IBM_Plex_Sans } from "next/font/google";
import { Privy } from "./providers/privy";
import "./globals.css";

/*
 * Jost stands in for Champagne & Limousines, which isn't on Google Fonts.
 * Both are thin geometric sans faces with wide, open letterforms. To swap:
 * drop the .ttf into app/fonts/, replace this with next/font/local, and
 * nothing else in the codebase changes because everything reads the
 * --font-display variable rather than the family name.
 */
const display = Jost({
  variable: "--font-display",
  weight: ["200", "300"],
  subsets: ["latin"],
});

const sans = IBM_Plex_Sans({
  variable: "--font-sans",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "cipher",
  description: "From thoughts to trade.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} h-full`}>
      <body className="min-h-full antialiased">
        <Privy>{children}</Privy>
      </body>
    </html>
  );
}
