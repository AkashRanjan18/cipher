/**
 * A generic wallet mark rather than any single brand's logo.
 *
 * Phantom, Solflare, Backpack and the rest all appear behind this one button —
 * Privy's connector list handles picking between them — so showing one
 * vendor's icon would misrepresent what happens on click.
 *
 * Inherits currentColor so it works on any button background.
 */
export function WalletIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
      <path d="M3 7.5V17a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3" />
      <path d="M21 10.5h-4a2.25 2.25 0 0 0 0 4.5h4z" />
    </svg>
  );
}
