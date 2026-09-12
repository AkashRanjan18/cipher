import { NextResponse } from "next/server";
import type { User } from "@privy-io/server-auth";
import { privy } from "@/lib/auth/privy";
import { getSession } from "@/lib/auth/session";

/**
 * Give this user a Solana wallet.
 *
 * WHY THIS ROUTE EXISTS, because the config that should have done it looks
 * like it works and does not. `embeddedWallets.solana.createOnLogin` in
 * app/providers/privy.tsx is ignored for apps that drive login through the
 * headless hooks instead of Privy's own dialog — which cipher does, because
 * the login screen is the product's, not the vendor's. Privy documents this in
 * one line and reports the setting back to the client as "off". No warning, no
 * error, no wallet: the app spent weeks asking for one in a way that could
 * never produce one.
 *
 * The supported path for a whitelabel login is to create the wallet yourself,
 * and doing it here rather than in the browser is the better shape anyway. The
 * server decides who gets a wallet. A browser can be told anything.
 *
 * This is also cipher's first real backend endpoint. Everything the Solana leg
 * needs later — the relayer, delegate authority, the audit trail — assumes a
 * server that knows which wallet belongs to whom. This is where that starts.
 */

/**
 * The embedded Solana wallet on a user, if there is one.
 *
 * walletClientType narrows it to the one Privy custodies. An external wallet
 * the user linked themselves is also type "wallet" with chainType "solana",
 * and is not an account cipher can act for.
 */
function embeddedSolanaAddress(user: User): string | null {
  const wallet = user.linkedAccounts.find(
    (a) => a.type === "wallet" && a.chainType === "solana" && a.walletClientType === "privy",
  );
  return wallet && "address" in wallet ? wallet.address : null;
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  try {
    /*
     * Read before writing, so calling this twice is harmless.
     *
     * The client only calls this when it can see no wallet, but the client is
     * not the authority on that and two tabs can ask at once. Creating a
     * second wallet for someone who has one would be the worst possible bug in
     * this file: funds would sit in an address the app had stopped showing.
     *
     * cipher: a check-then-create is not atomic — two simultaneous calls can
     * both pass the check. Privy rejects the duplicate, so the loser gets a
     * 502 and retries into the wallet the winner made. When this app owns a
     * users table, the upgrade is a row lock on the user, not a smarter check.
     *
     * cipher: getUser(userId) is rate-limited by Privy and meant to be
     * replaced by getUser({idToken}) at scale. It runs once per user, ever,
     * so the ceiling is signups per minute rather than requests per minute.
     * The upgrade is to send the identity token from the client and pass it
     * here instead of the id.
     */
    const user = await privy().getUser(session.userId);

    const existing = embeddedSolanaAddress(user);
    if (existing) {
      return NextResponse.json({ address: existing, created: false });
    }

    const updated = await privy().createWallets({
      userId: session.userId,
      createSolanaWallet: true,
    });

    const address = embeddedSolanaAddress(updated);
    if (!address) {
      // Privy accepted the call and returned a user with no Solana wallet on
      // it. Nothing sensible to do with that, and pretending otherwise would
      // hand the client an address that does not exist.
      console.error("[cipher] createWallets returned no Solana wallet for", session.userId);
      return NextResponse.json({ error: "wallet not created" }, { status: 502 });
    }

    return NextResponse.json({ address, created: true });
  } catch (e) {
    /*
     * The caller gets a status; the log gets the reason.
     *
     * Wallet provisioning fails for genuinely different causes — a bad app
     * secret, an app whose plan does not allow Solana, a user id that no
     * longer exists — and flattening them into one client-visible string is
     * how the last three hours went.
     */
    console.error("[cipher] wallet provisioning failed:", e);
    return NextResponse.json({ error: "could not create wallet" }, { status: 502 });
  }
}
