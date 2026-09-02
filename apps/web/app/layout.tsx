import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { IBM_Plex_Sans } from "next/font/google";
import { Privy } from "./providers/privy";
import { LoginModalProvider } from "@/components/auth/login-modal";
import "./globals.css";

/*
 * Caacupé One by Magdalena Alonso Rebollo, OFL.
 *
 * Self-hosted rather than pulled from next/font/google, because Next 16's
 * font list predates this family and the import does not exist. The woff2
 * is the same file Google serves; self-hosting is what next/font does
 * internally anyway, and it removes a runtime request to a third party.
 *
 * SINGLE WEIGHT. There is no light or bold — never put font-light or
 * font-bold on display text or the browser synthesises one and it looks wrong.
 */
const display = localFont({
  src: "./fonts/CaacupeOne.woff2",
  variable: "--font-display",
  display: "swap",
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
        <Privy>
          <LoginModalProvider>{children}</LoginModalProvider>
        </Privy>
      </body>
    </html>
  );
}
