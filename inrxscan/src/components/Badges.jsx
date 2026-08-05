const TYPE_STYLES = {
  MINT:         'text-mint bg-mint/10 border-mint/25',
  SEND:         'text-indigo-glow bg-indigo/10 border-indigo/30',
  BURN:         'text-rust bg-rust/10 border-rust/25',
  SWAP:         'text-gold bg-gold/10 border-gold/25',
  BRIDGE_LOCK:  'text-gold bg-gold/10 border-gold/25',
  BRIDGE_MINT:  'text-gold bg-gold/10 border-gold/25',
};

export function TypeBadge({ type }) {
  const cls = TYPE_STYLES[type] || 'text-paper-dim bg-white/5 border-ink-line-2';
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-mono font-medium tracking-wide ${cls}`}>
      {type}
    </span>
  );
}

export function StatusBadge({ status }) {
  if (status === 'CONFIRMED') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-mint">
        <span className="h-1.5 w-1.5 rounded-full bg-mint" /> confirmed
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-gold">
        <span className="h-1.5 w-1.5 rounded-full bg-gold pulse-dot" /> pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-rust">
      <span className="h-1.5 w-1.5 rounded-full bg-rust" /> failed
    </span>
  );
}

export function ChainTag({ label }) {
  return (
    <span className="inline-flex items-center rounded bg-white/5 border border-ink-line-2 px-2 py-0.5 text-[11px] font-mono text-paper-dim whitespace-nowrap">
      {label}
    </span>
  );
}
