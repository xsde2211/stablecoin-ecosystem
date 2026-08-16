import { useState } from 'react';

export function CopyableAddress({
  address, display, className = '',
}: { address: string; display?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: React.MouseEvent | React.KeyboardEvent) {
    e.stopPropagation(); // don't trigger a parent row's onClick (e.g. opening the holder overlay)
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard API unavailable (very old browser / non-HTTPS) — no-op,
      // the address text itself is still fully visible and selectable
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={handleCopy}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCopy(e); } }}
      title={copied ? 'Copied!' : `Click to copy ${address}`}
      // span, not button — this gets nested inside other clickable rows
      // elsewhere in the dashboard (e.g. ContractBalances' holder rows),
      // and a <button> inside a <button> is invalid HTML that silently
      // breaks click handling in some browsers.
      className={`font-mono hover:text-ivory hover:underline decoration-dotted underline-offset-2 transition-colors cursor-pointer inline-block ${className}`}
    >
      {copied ? 'Copied ✓' : (display ?? address)}
    </span>
  );
}