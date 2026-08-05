import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { TypeBadge, StatusBadge, ChainTag } from './Badges';
import { truncateHash, timeAgo, formatAmount } from '../lib/format';

export default function TxTable({ rows, loading }) {
  if (loading) {
    return (
      <div className="divide-y divide-ink-line">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse bg-white/[0.02]" />
        ))}
      </div>
    );
  }

  if (!rows?.length) {
    return (
      <div className="py-16 text-center text-paper-dim text-sm">
        No transactions match this view yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto pb-2 -mb-2">
      <table className="w-full text-sm min-w-[1240px]">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-paper-faint border-b border-ink-line">
            <th className="py-3 pr-4 font-medium w-[160px]">Tx Hash</th>
            <th className="py-3 pr-4 font-medium w-[110px]">Type</th>
            <th className="py-3 pr-4 font-medium w-[110px]">Status</th>
            <th className="py-3 pr-4 font-medium w-[140px]">Network</th>
            <th className="py-3 pr-4 font-medium text-right w-[100px]">Block</th>
            <th className="py-3 pr-4 font-medium w-[130px]">From</th>
            <th className="py-3 pr-4 font-medium w-[24px]"></th>
            <th className="py-3 pr-4 font-medium w-[130px]">To</th>
            <th className="py-3 pr-4 font-medium text-right w-[150px]">Amount (INRX)</th>
            <th className="py-3 pr-4 font-medium text-right w-[150px]">Txn Fee</th>
            <th className="py-3 pl-4 font-medium text-right w-[90px]">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-line">
          {rows.map((tx) => (
            <tr key={`${tx.txHash}-${tx.type}`} className="hover:bg-white/[0.02] transition-colors">
              <td className="py-3 pr-4 font-mono text-indigo-glow whitespace-nowrap">
                <Link to={`/tx/${tx.txHash}`} className="hover:underline">{truncateHash(tx.txHash)}</Link>
              </td>
              <td className="py-3 pr-4 whitespace-nowrap"><TypeBadge type={tx.type} /></td>
              <td className="py-3 pr-4 whitespace-nowrap"><StatusBadge status={tx.status} /></td>
              <td className="py-3 pr-4 whitespace-nowrap"><ChainTag label={tx.chainLabel ?? tx.chain} /></td>
              <td className="py-3 pr-4 text-right font-mono text-paper-dim whitespace-nowrap">
                {tx.blockNumber != null ? tx.blockNumber.toLocaleString('en-IN') : '—'}
              </td>
              <td className="py-3 pr-4 font-mono text-paper-dim whitespace-nowrap">
                <Link to={`/address/${tx.fromAddress}`} className="hover:text-paper hover:underline">{truncateHash(tx.fromAddress, 6, 4)}</Link>
              </td>
              <td className="py-3 pr-4 text-paper-faint"><ArrowRight size={13} /></td>
              <td className="py-3 pr-4 font-mono text-paper-dim whitespace-nowrap">
                <Link to={`/address/${tx.toAddress}`} className="hover:text-paper hover:underline">{truncateHash(tx.toAddress, 6, 4)}</Link>
              </td>
              <td className="py-3 pr-4 text-right font-mono text-paper whitespace-nowrap">{formatAmount(tx.amount)}</td>
              <td className="py-3 pr-4 text-right font-mono text-paper-faint whitespace-nowrap">
                {tx.fee ? `${tx.fee.amount} ${tx.fee.symbol}` : '—'}
              </td>
              <td className="py-3 pl-4 text-right text-paper-faint whitespace-nowrap">{timeAgo(tx.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}