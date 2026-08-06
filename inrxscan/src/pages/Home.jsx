import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Coins, Activity, Users, IndianRupee, ArrowUpRight, ShieldCheck, Copy, Check, ExternalLink } from 'lucide-react';
import SearchBar from '../components/SearchBar';
import StatTile from '../components/StatTile';
import TxTable from '../components/TxTable';
import ErrorState from '../components/ErrorState';
import { truncateHash } from '../lib/format';
import { explorer } from '../lib/api';

function ContractRow({ c }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card-lift flex items-center justify-between gap-3 border border-ink-line bg-ink-raised/70 rounded-lg px-4 py-3">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-wider text-paper-faint mb-1">{c.chainLabel}</div>
        <div className="font-mono text-xs text-paper truncate" title={c.address}>{truncateHash(c.address, 10, 8)}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => { navigator.clipboard.writeText(c.address); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="text-paper-faint hover:text-paper transition-colors"
          title="Copy address"
        >
          {copied ? <Check size={14} className="text-mint" /> : <Copy size={14} />}
        </button>
        {c.explorerUrl && (
          <a href={c.explorerUrl} target="_blank" rel="noopener noreferrer" className="text-paper-faint hover:text-gold transition-colors" title={`View on ${c.chainLabel} scan`}>
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const [stats, setStats] = useState(null);
  const [txs, setTxs] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [txError, setTxError] = useState(null);

  useEffect(() => {
    explorer.stats().then(setStats).catch(setStatsError);
    explorer.transactions({ limit: 12 }).then(r => setTxs(r.data)).catch(setTxError);
  }, []);

  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative border-b border-ink-line overflow-hidden">
        <div className="ambient-glow absolute inset-0 pointer-events-none" />
        <div className="relative mx-auto max-w-7xl px-4 lg:px-8 py-16 text-center">
          <p className="font-mono text-xs tracking-widest text-gold uppercase mb-4">
            The public ledger for INRX
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-paper max-w-2xl mx-auto">
            Every INRX transfer, verified and searchable.
          </h1>
          <p className="text-paper-dim mt-4 max-w-lg mx-auto">
            Look up any transaction, wallet, or mint &amp; burn event across every network INRX
            runs on — in real time, with nothing hidden.
          </p>
          <div className="mt-8 max-w-xl mx-auto">
            <SearchBar large />
          </div>

          {/* Trust row — real signals, not decoration */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/25 bg-mint/10 px-3 py-1 text-xs font-mono text-mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint pulse-dot" /> Live on-chain data
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-line-2 px-3 py-1 text-xs font-mono text-paper-dim">
              <ShieldCheck size={12} className="text-gold" /> {stats ? stats.chains.length : '5'} networks tracked
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-line-2 px-3 py-1 text-xs font-mono text-paper-dim">
              Testnet environment
            </span>
          </div>
        </div>
      </section>

      {/* ── Stat strip ───────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 lg:px-8 -mt-1">
        {statsError ? (
          <div className="py-6"><ErrorState message={statsError.message} /></div>
        ) : (
          <div className="flex flex-wrap gap-3 py-6">
            <StatTile
              label="Circulating Supply"
              value={stats ? `₹${stats.circulatingSupply}` : '—'}
              sub="INRX in circulation"
              icon={IndianRupee}
              accent="gold"
            />
            <StatTile
              label="Networks"
              value={stats ? stats.chains.length : '—'}
              sub={stats ? stats.chains.join(' · ') : '—'}
              icon={Coins}
              accent="mint"
            />
            <StatTile
              label="Transactions (24h)"
              value={stats ? stats.tx24h.toLocaleString('en-IN') : '—'}
              sub={stats ? `${stats.totalTxCount.toLocaleString('en-IN')} all-time` : '—'}
              icon={Activity}
              accent="indigo"
            />
            <StatTile
              label="Active Wallets"
              value={stats ? stats.activeWallets.toLocaleString('en-IN') : '—'}
              sub="wallets with INRX activity"
              icon={Users}
              accent="indigo"
            />
          </div>
        )}
      </section>

      {/* ── Verified contracts ───────────────────────────── */}
      {stats?.contracts?.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 lg:px-8 pb-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-gold" />
            <h2 className="font-display text-lg font-semibold text-paper">Verified INRX Contracts</h2>
          </div>
          <p className="text-xs text-paper-dim mb-3 max-w-2xl">
            The deployed INRX token contract on each network — check any of these directly on
            that chain's own block explorer.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {stats.contracts.map(c => <ContractRow key={c.chain} c={c} />)}
          </div>
        </section>
      )}

      {/* ── Bridge liquidity ─────────────────────────────── */}
      {stats?.bridgeLockedByNetwork?.length > 0 && (
        <section className="mx-auto max-w-7xl px-4 lg:px-8 pb-4 pt-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-lg font-semibold text-paper">INRX Locked in Bridge Contracts</h2>
            <span className="text-xs text-paper-faint font-mono">total: ₹{stats.totalBridgeLocked}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {stats.bridgeLockedByNetwork.map(b => (
              <div key={b.chain} className="card-lift border border-ink-line bg-ink-raised/70 rounded-lg px-5 py-4 min-w-[180px]">
                <div className="text-[11px] uppercase tracking-wider text-paper-faint mb-1">{b.chainLabel}</div>
                <div className="font-display text-lg font-semibold text-paper">{Number(b.balance).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</div>
                <div className="text-[10px] text-paper-faint font-mono mt-1 truncate" title={b.address}>{b.address}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Latest transactions ──────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-lg font-semibold text-paper">Latest Transactions</h2>
          <Link to="/txs" className="inline-flex items-center gap-1 text-xs text-indigo-glow hover:underline font-mono">
            view all <ArrowUpRight size={13} />
          </Link>
        </div>
        <div className="border border-ink-line rounded-lg bg-ink-raised/50 px-4">
          {txError ? <ErrorState message={txError.message} /> : <TxTable rows={txs} loading={txs === null} />}
        </div>
      </section>
    </div>
  );
}