export default function StatTile({ label, value, sub, icon: Icon, accent = 'indigo' }) {
  const accentClass = {
    indigo: 'text-indigo-glow',
    gold: 'text-gold',
    mint: 'text-mint',
  }[accent];

  return (
    <div className="card-lift flex-1 min-w-[180px] border border-ink-line bg-ink-raised/70 rounded-lg px-5 py-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] uppercase tracking-wider text-paper-faint">{label}</span>
        {Icon && <Icon size={15} className={accentClass} />}
      </div>
      <div className="font-display text-xl font-semibold text-paper">{value}</div>
      {sub && <div className="text-xs text-paper-dim mt-1">{sub}</div>}
    </div>
  );
}