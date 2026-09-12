import { cookies } from "next/headers";
import { privy } from "./privy";

/**
 * Server-side session verification.
 *
 * Every gated API route calls requireUser(). Never trust a user id sent by the
 * client — verify the Privy access token and take the id from the claims.
 */

export interface Session {
  userId: string;
}

/**
 * The token, from wherever it is.
 *
 * TWO SOURCES, ON PURPOSE. The cookie is what a plain page navigation carries
 * and needs nothing from the caller. The Authorization header is what a fetch
 * from a client component sends after calling getAccessToken(), and it is the
 * one that always works: the cookie depends on Privy's cookie behaviour and on
 * the browser's same-site rules, neither of which cipher controls.
 *
 * Header first, because a caller that went to the trouble of attaching a token
 * means that token.
 */
function tokenFrom(request: Request | undefined, cookie: string | undefined): string | null {
  const header = request?.headers.get("authorization");
  if (header?.startsWith("Bearer ")) {
    const bearer = header.slice("Bearer ".length).trim();
    if (bearer) return bearer;
  }
  return cookie ?? null;
}

/**
 * Returns the session, or null if the caller is not signed in.
 *
 * Pass the Request in a route handler. Omit it in a server component, where
 * there is no request object to hand and the cookie is the only source.
 */
export async function getSession(request?: Request): Promise<Session | null> {
  const token = tokenFrom(request, (await cookies()).get("privy-token")?.value);
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
export async function requireUser(request?: Request): Promise<Session> {
  const session = await getSession(request);
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
