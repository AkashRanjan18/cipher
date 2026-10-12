import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { base58Encode, devnetRpcUrl, sendMemo, signerFrom } from "../lib/chain/devnet.ts";

/**
 * cipher's devnet key: make it, fund it, prove it.
 *
 *   node --experimental-strip-types scripts/devnet-key.ts          address and balance
 *   node --experimental-strip-types scripts/devnet-key.ts new      create one in .env.local
 *   node --experimental-strip-types scripts/devnet-key.ts airdrop  ask the faucet for 1 SOL
 *   node --experimental-strip-types scripts/devnet-key.ts memo     write a test memo
 *
 * Run from apps/web. THE SECRET IS NEVER PRINTED — only the address, which is
 * public. It is a devnet key and holds nothing of value, but a habit of
 * echoing keys is how the mainnet one leaks later.
 */

const ENV = ".env.local";

function secret(): string | null {
  if (!existsSync(ENV)) return null;
  const line = readFileSync(ENV, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("CIPHER_DEVNET_KEY="));
  return line ? line.slice("CIPHER_DEVNET_KEY=".length).trim() || null : null;
}

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(devnetRpcUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "rpc error");
  return body.result;
}

const command = process.argv[2] ?? "show";

if (command === "new") {
  if (secret()) {
    console.log("CIPHER_DEVNET_KEY is already set in .env.local — not replacing it.");
  } else {
    const seed = base58Encode(Uint8Array.from(randomBytes(32)));
    appendFileSync(
      ENV,
      `\n# cipher's devnet key: signs the receipts in lib/chain/receipts.ts. Devnet only.\nCIPHER_DEVNET_KEY=${seed}\n`,
    );
    console.log("Created. Address:", signerFrom(seed).address);
  }
} else {
  const s = secret();
  if (!s) {
    console.log("No CIPHER_DEVNET_KEY in .env.local. Run with `new` first.");
    process.exit(1);
  }
  const signer = signerFrom(s);
  console.log("Address:", signer.address);

  if (command === "airdrop") {
    const sig = await rpc("requestAirdrop", [signer.address, 1_000_000_000]);
    console.log("Airdrop requested:", sig);
  } else if (command === "memo") {
    const sig = await sendMemo(signer, `cipher:v1 test=1 at=${Math.floor(Date.now() / 1000)} paper=1`);
    console.log("Memo sent:", sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  }

  const balance = (await rpc("getBalance", [signer.address])) as { value: number };
  console.log("Balance:", balance.value / 1e9, "SOL");
}
