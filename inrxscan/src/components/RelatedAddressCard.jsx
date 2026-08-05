import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Check, ArrowRight, Info } from 'lucide-react';
import { formatAmount } from '../lib/format';

export default function RelatedAddressCard({ address, relatedAddress, balancesByNetwork }) {
  const [copied, setCopied] = useState(false);
  if (!relatedAddress) return null;

  const isViewingEvm = /^0x/i.test(address);
  const otherAddress = isViewingEvm ? relatedAddress.tronAddress : relatedAddress.evmAddress;
  if (!otherAddress || otherAddress.toLowerCase() === address.toLowerCase()) return null;

  const otherBalances = isViewingEvm
    ? balancesByNetwork?.filter(b => b.chain === 'tron')
    : balancesByNetwork?.filter(b => b.chain !== 'tron');

  return (
    <div className="border border-gold/25 bg-gold/[0.04] rounded-lg px-5 py-4 mb-6">
      <div className="flex items-start gap-2.5">
        <Info size={15} className="text-gold shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-paper-dim leading-relaxed">
            Same private key, {isViewingEvm ? 'Tron' : 'EVM'} form — if this wallet's key is reused
            across chains, its {isViewingEvm ? 'Tron Nile' : 'EVM'} address is:
          </p>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Link
              to={`/address/${otherAddress}`}
              className="font-mono text-sm text-indigo-glow hover:underline break-all"
            >
              {otherAddress}
            </Link>
            <button
              onClick={() => { navigator.clipboard.writeText(otherAddress); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              className="text-paper-faint hover:text-paper transition-colors shrink-0"
            >
              {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
            </button>
            <Link
              to={`/address/${otherAddress}`}
              className="inline-flex items-center gap-1 text-xs text-gold hover:underline shrink-0 ml-1"
            >
              view <ArrowRight size={12} />
            </Link>
          </div>

          {otherBalances?.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs font-mono">
              {otherBalances.map(b => (
                <span key={b.chain} className="text-paper-dim">
                  <span className="text-paper-faint">{b.chainLabel}:</span>{' '}
                  <span className="text-paper">{formatAmount(b.balance)} INRX</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}