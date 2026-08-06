import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Wallet, Menu, X } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { truncateHash } from '../lib/format';
import SearchBar from './SearchBar';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2.5 shrink-0 group">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-gold/40 bg-gradient-to-br from-gold/20 to-gold/5 font-mono text-gold text-sm font-semibold shadow-[0_0_0_1px_rgba(220,177,58,0.08)] group-hover:from-gold/30 transition-colors">
        ₹
      </span>
      <span className="font-display text-lg font-semibold tracking-tight text-paper">
        INRX<span className="text-gold">Scan</span>
      </span>
      <span className="hidden sm:inline-flex items-center rounded-full border border-ink-line-2 px-2 py-0.5 text-[10px] font-mono text-paper-faint tracking-wide">
        TESTNET
      </span>
    </Link>
  );
}

const navLink = ({ isActive }) =>
  `relative text-sm font-medium transition-colors py-1 ${
    isActive
      ? 'text-paper after:absolute after:-bottom-[13px] after:left-0 after:right-0 after:h-[2px] after:bg-gold after:rounded-full'
      : 'text-paper-dim hover:text-paper'
  }`;

export default function Navbar() {
  const { address, connect, connecting, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 lg:px-8">
        <Logo />

        <nav className="hidden lg:flex items-center gap-6 shrink-0">
          <NavLink to="/" end className={navLink}>Home</NavLink>
          <NavLink to="/txs" className={navLink}>Transactions</NavLink>
        </nav>

        <div className="hidden md:block flex-1 max-w-md">
          <SearchBar />
        </div>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          {address ? (
            <button
              onClick={disconnect}
              className="hidden sm:flex items-center gap-2 rounded-md border border-mint/30 bg-mint/10 px-3 py-1.5 text-xs font-mono text-mint hover:bg-mint/15 transition-colors"
              title="Click to disconnect"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-mint pulse-dot" />
              {truncateHash(address, 6, 4)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="hidden sm:flex items-center gap-2 rounded-md bg-indigo hover:bg-indigo-soft transition-colors px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 shadow-[0_0_0_1px_rgba(67,97,201,0.3)]"
            >
              <Wallet size={14} />
              {connecting ? 'Connecting…' : 'Connect Wallet'}
            </button>
          )}

          <button className="lg:hidden text-paper-dim" onClick={() => setMobileOpen(o => !o)}>
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="lg:hidden border-t border-ink-line px-4 py-4 space-y-4">
          <SearchBar />
          <nav className="flex flex-col gap-3">
            <NavLink to="/" end className={navLink} onClick={() => setMobileOpen(false)}>Home</NavLink>
            <NavLink to="/txs" className={navLink} onClick={() => setMobileOpen(false)}>Transactions</NavLink>
          </nav>
          <div className="pt-2 border-t border-ink-line">
            {address ? (
              <button onClick={disconnect} className="text-left text-xs font-mono text-mint">{truncateHash(address, 6, 4)} · disconnect</button>
            ) : (
              <button onClick={connect} className="text-left text-sm text-paper-dim flex items-center gap-2"><Wallet size={14}/> Connect Wallet</button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}