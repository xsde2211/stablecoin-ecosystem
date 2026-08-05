export default function DateRangeFilter({ from, to, onChange }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <label className="flex items-center gap-1.5 text-paper-dim">
        From
        <input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => onChange({ from: e.target.value, to })}
          className="rounded-md border border-ink-line-2 bg-ink-raised px-2 py-1.5 font-mono text-paper outline-none focus:border-indigo-glow transition-colors"
        />
      </label>
      <label className="flex items-center gap-1.5 text-paper-dim">
        To
        <input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => onChange({ from, to: e.target.value })}
          className="rounded-md border border-ink-line-2 bg-ink-raised px-2 py-1.5 font-mono text-paper outline-none focus:border-indigo-glow transition-colors"
        />
      </label>
      {(from || to) && (
        <button
          onClick={() => onChange({ from: '', to: '' })}
          className="text-paper-faint hover:text-rust transition-colors underline decoration-dotted"
        >
          clear
        </button>
      )}
    </div>
  );
}
