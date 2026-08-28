import { PrivyClient } from "@privy-io/server-auth";
import { cookies } from "next/headers";

/**
 * Server-side session verification.
 *
 * Every gated API route calls requireUser(). Never trust a user id sent by the
 * client — verify the Privy access token and take the id from the claims.
 */

let client: PrivyClient | null = null;

function privy(): PrivyClient {
  if (client) return client;
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "PRIVY_APP_SECRET and NEXT_PUBLIC_PRIVY_APP_ID must be set to verify sessions",
    );
  }
  client = new PrivyClient(appId, appSecret);
  return client;
}

export interface Session {
  userId: string;
}

/** Returns the session, or null if the caller is not signed in. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get("privy-token")?.value;
  if (!token) return null;

  try {
    const claims = await privy().verifyAuthToken(token);
    return { userId: claims.userId };
  } catch {
    // Expired, tampered, or signed by a different app. All the same to us.
    return null;
  }
}

/** Use in gated route handlers. Throws if unauthenticated. */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor() {
    super("not signed in");
    this.name = "UnauthorizedError";
  }
}
