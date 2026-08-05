export function truncateHash(hash, lead = 8, tail = 6) {
  if (!hash) return '';
  if (hash.length <= lead + tail + 3) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function formatAmount(n) {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return num.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function isLikelyTxHash(q) {
  return /^0x[0-9a-fA-F]{64}$/.test(q.trim());
}

export function isLikelyAddress(q) {
  const v = q.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(v) ||          // EVM
    /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v);          // Tron base58
}
