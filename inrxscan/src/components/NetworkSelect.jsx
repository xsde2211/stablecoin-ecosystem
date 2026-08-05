import { useNetworks } from '../context/NetworksContext';

export default function NetworkSelect({ value, onChange, compact = false }) {
  const { networks, keys } = useNetworks();

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded-md border border-ink-line-2 bg-ink-raised text-paper outline-none
        focus:border-indigo-glow transition-colors font-mono
        ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-sm'}`}
    >
      <option value="all">All Networks</option>
      {keys.map(k => (
        <option key={k} value={k}>{networks[k]?.label ?? k}</option>
      ))}
    </select>
  );
}
