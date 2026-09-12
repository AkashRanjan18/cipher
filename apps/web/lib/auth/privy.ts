import { PrivyClient } from "@privy-io/server-auth";

/**
 * The server-side Privy client.
 *
 * Its own file because two different concerns now talk to Privy from the
 * server — verifying a session (lib/auth/session.ts) and provisioning a wallet
 * (app/api/wallet/route.ts) — and a second `new PrivyClient(...)` in the
 * second one is how an app ends up with two clients holding the same secret
 * and drifting in their options.
 *
 * THIS MODULE MUST NEVER BE IMPORTED FROM A CLIENT COMPONENT. It reads
 * PRIVY_APP_SECRET, which has no NEXT_PUBLIC_ prefix, so Next would replace it
 * with undefined in the browser bundle rather than leaking it — the failure is
 * a confusing runtime error, not an exposure, but it is still a bug.
 */

let client: PrivyClient | null = null;

export function privy(): PrivyClient {
  if (client) return client;

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "PRIVY_APP_SECRET and NEXT_PUBLIC_PRIVY_APP_ID must be set to reach Privy from the server",
    );
  }

  client = new PrivyClient(appId, appSecret);
  return client;
}
