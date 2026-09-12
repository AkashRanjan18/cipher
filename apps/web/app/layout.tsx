import type { Metadata } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { Privy } from "./providers/privy";
import { LoginModalProvider } from "@/components/auth/login-modal";
import { EnsureWallet } from "@/components/auth/ensure-wallet";
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

/*
 * IBM Plex Sans, self-hosted for the same reason as the display face above.
 *
 * next/font/google downloads at build time, and when it cannot reach
 * fonts.googleapis.com it blocks for the full network timeout on every
 * compile before silently falling back to a system font — twelve seconds of
 * dead air, and the wrong typeface rendered. It failed exactly that way here
 * while curl reached the same host in 0.19s, so the network is not reliably
 * the problem and a build should not depend on it.
 *
 * This is the latin subset of Google's variable file, which is why one file
 * covers the whole 400-500 range rather than needing a weight each.
 */
const sans = localFont({
  src: "./fonts/IBMPlexSans-latin.woff2",
  variable: "--font-sans",
  weight: "400 500",
  display: "swap",
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
          <LoginModalProvider>
            {/* Renders nothing. Present on every page because the page a
                new user lands on after Google is "/", not the terminal. */}
            <EnsureWallet />
            {children}
          </LoginModalProvider>
        </Privy>
      </body>
    </html>
  );
}
