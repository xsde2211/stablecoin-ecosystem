export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  const decimals = Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatInr(value: number): string {
  const decimals = Math.abs(value) < 1 ? 4 : 2;
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatToken(value: number, symbol: string): string {
  return `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${symbol}`;
}

export function formatCompactAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export function shortAddress(addr: string): string {
  if (!addr) return '';
  return addr.length > 14 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
