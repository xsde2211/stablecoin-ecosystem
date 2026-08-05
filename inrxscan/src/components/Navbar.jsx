import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Wallet, Menu, X } from 'lucide-react';
import { useWallet } from '../context/WalletContext';
import { truncateHash } from '../lib/format';
import SearchBar from './SearchBar';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 shrink-0 group">
      <span className="flex h-8 w-8 items-center justify-center rounded border border-gold/40 bg-gold/10 font-mono text-gold text-sm font-semibold group-hover:bg-gold/15 transition-colors">
        ₹
      </span>
      <span className="font-display text-lg font-semibold tracking-tight text-paper">
        INRX<span className="text-gold">Scan</span>
      </span>
    </Link>
  );
}

const navLink = ({ isActive }) =>
  `text-sm font-medium transition-colors ${isActive ? 'text-paper' : 'text-paper-dim hover:text-paper'}`;

export default function Navbar() {
  const { address, connect, connecting, disconnect } = useWallet();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 lg:px-8">
        <Logo />

        <nav className="hidden lg:flex items-center gap-5 shrink-0">
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
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              {truncateHash(address, 6, 4)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="hidden sm:flex items-center gap-2 rounded-md bg-indigo hover:bg-indigo-soft transition-colors px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
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
