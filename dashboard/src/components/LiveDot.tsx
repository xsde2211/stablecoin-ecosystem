export function LiveDot({ ok = true }: { ok?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-live animate-pulseLive' : 'bg-down'}`}
        aria-hidden
      />
      <span className={`text-[10px] uppercase tracking-[0.14em] ${ok ? 'text-live/80' : 'text-down/80'}`}>
        {ok ? 'live' : 'stale'}
      </span>
    </span>
  );
}
