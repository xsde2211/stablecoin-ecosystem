export default function StatTile({ label, value, sub, icon: Icon, accent = 'indigo' }) {
  const styles = {
    indigo: { text: 'text-indigo-glow', badge: 'bg-indigo/15 border-indigo/25' },
    gold:   { text: 'text-gold',        badge: 'bg-gold/15 border-gold/25' },
    mint:   { text: 'text-mint',        badge: 'bg-mint/15 border-mint/25' },
  }[accent];

  return (
    <div className="card-lift flex-1 min-w-[200px] border border-ink-line bg-ink-raised/70 rounded-xl px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] uppercase tracking-wider text-paper-faint font-medium">{label}</span>
        {Icon && (
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg border ${styles.badge}`}>
            <Icon size={14} className={styles.text} />
          </span>
        )}
      </div>
      <div className="font-display text-2xl font-semibold text-paper tracking-tight">{value}</div>
      {sub && <div className="text-xs text-paper-dim mt-1.5">{sub}</div>}
    </div>
  );
}