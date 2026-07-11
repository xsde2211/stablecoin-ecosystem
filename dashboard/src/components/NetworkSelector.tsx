import { CHAINS, ChainId } from '../lib/constants';

export function NetworkSelector({ value, onChange }: { value: ChainId; onChange: (id: ChainId) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Select network"
      className="inline-flex rounded-full border border-hairline bg-panel/60 p-1 gap-1"
    >
      {CHAINS.map((chain) => {
        const active = chain.id === value;
        return (
          <button
            key={chain.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chain.id)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors duration-200
              ${active
                ? 'bg-gold text-ink shadow-sm'
                : 'text-muted hover:text-ivory hover:bg-panel2'}`}
          >
            {chain.label}
          </button>
        );
      })}
    </div>
  );
}
