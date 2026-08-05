import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { isLikelyTxHash, isLikelyAddress } from '../lib/format';

export default function SearchBar({ large = false }) {
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  function submit(e) {
    e.preventDefault();
    const query = q.trim();
    if (!query) return;
    if (isLikelyTxHash(query)) {
      navigate(`/tx/${query}`);
    } else if (isLikelyAddress(query)) {
      navigate(`/address/${query}`);
    } else {
      setErr('Enter a full transaction hash (0x + 64 hex) or wallet address (0x + 40 hex).');
      return;
    }
    setErr('');
    setQ('');
  }

  return (
    <form onSubmit={submit} className="w-full">
      <div className={`flex items-center gap-2 rounded-lg border border-ink-line-2 bg-ink-raised/80 px-3 backdrop-blur
        ${large ? 'py-3' : 'py-2'} focus-within:border-indigo-glow transition-colors`}>
        <Search size={large ? 20 : 16} className="text-paper-faint shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by transaction hash or wallet address"
          className={`w-full bg-transparent outline-none placeholder:text-paper-faint font-mono
            ${large ? 'text-base' : 'text-sm'}`}
        />
        <button
          type="submit"
          className={`shrink-0 rounded-md bg-indigo hover:bg-indigo-soft transition-colors font-medium
            ${large ? 'px-4 py-2 text-sm' : 'px-3 py-1 text-xs'}`}
        >
          Search
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-rust font-mono">{err}</p>}
    </form>
  );
}
