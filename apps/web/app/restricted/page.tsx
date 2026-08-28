export const metadata = {
  title: "Not available here — cipher",
  robots: { index: false },
};

export default function Restricted() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-16">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500">
        cipher.family
      </p>

      <h1 className="text-3xl font-semibold tracking-tight">
        Trading isn&rsquo;t available in your region
      </h1>

      <p className="text-neutral-400">
        cipher does not offer trading to users in the United States or in
        sanctioned jurisdictions. This isn&rsquo;t a temporary outage — we
        don&rsquo;t hold the licences that would let us serve you, and
        we&rsquo;d rather say so plainly than let you sign up and find out
        later.
      </p>

      <p className="text-neutral-400">
        The wallet scanner stays open to everyone. It reads public on-chain
        history and shows you what a position was worth at its best moment
        versus what you walked away with. No account, no funds, no signup.
      </p>

      <a
        href="/"
        className="w-fit rounded border border-neutral-700 px-4 py-2 font-mono text-sm hover:border-neutral-500 focus-visible:outline focus-visible:outline-2"
      >
        Open the scanner
      </a>
    </main>
  );
}
