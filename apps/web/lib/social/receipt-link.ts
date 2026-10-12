/**
 * Where a devnet receipt can be read.
 *
 * Its own file, with no imports, because the browser needs this one line and
 * lib/chain/devnet.ts pulls in node:crypto, which a client bundle cannot
 * carry.
 */
export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}
