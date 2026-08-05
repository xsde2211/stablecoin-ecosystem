import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="border-t border-ink-line mt-20">
      <div className="mx-auto max-w-7xl px-4 lg:px-8 py-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded border border-gold/40 bg-gold/10 font-mono text-gold text-xs">₹</span>
          <span className="font-display text-sm font-semibold text-paper-dim">
            INRX<span className="text-gold">Scan</span>
          </span>
          <span className="text-xs text-paper-faint ml-2">· independent explorer for the INRX ledger</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-paper-dim">
          <Link to="/txs" className="hover:text-paper transition-colors">Transactions</Link>
          <a href="#" className="hover:text-paper transition-colors">API docs</a>
          <a href="#" className="hover:text-paper transition-colors">Status</a>
          <a href="#" className="hover:text-paper transition-colors">Terms</a>
        </nav>
      </div>
    </footer>
  );
}
