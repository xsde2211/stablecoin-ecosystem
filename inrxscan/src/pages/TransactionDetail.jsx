import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { TypeBadge, StatusBadge, ChainTag } from '../components/Badges';
import ErrorState from '../components/ErrorState';
import { formatAmount } from '../lib/format';
import { explorer } from '../lib/api';

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-1 sm:gap-4 py-4 border-b border-ink-line last:border-b-0">
      <div className="text-xs uppercase tracking-wider text-paper-faint pt-0.5">{label}</div>
      <div className="text-sm text-paper break-all">{children}</div>
    </div>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
      className="inline-flex items-center text-paper-faint hover:text-paper transition-colors ml-2 align-middle"
      title="Copy"
    >
      {copied ? <Check size={13} className="text-mint" /> : <Copy size={13} />}
    </button>
  );
}

export default function TransactionDetail() {
  const { hash } = useParams();
  const [tx, setTx] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setTx(null);
    setError(null);
    explorer.transaction(hash).then(setTx).catch(setError);
  }, [hash]);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-4 lg:px-8 py-10">
        <ErrorState message={error.status === 404 ? `No transaction found for ${hash}.` : error.message} />
      </div>
    );
  }

  if (!tx) {
    return <div className="mx-auto max-w-4xl px-4 lg:px-8 py-16 text-paper-dim text-sm">Loading transaction…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 lg:px-8 py-10">
      <h1 className="font-display text-xl font-semibold text-paper mb-1">Transaction Details</h1>
      <div className="border border-ink-line rounded-lg bg-ink-raised/40 px-5 mt-4">
        <Row label="Transaction Hash">
          <span className="font-mono">{tx.txHash}</span>
          <CopyBtn text={tx.txHash} />
        </Row>
        <Row label="Status"><StatusBadge status={tx.status} /></Row>
        <Row label="Type"><TypeBadge type={tx.type} /></Row>
        <Row label="Network"><ChainTag label={tx.chainLabel ?? tx.chain} /></Row>
        {tx.blockNumber != null && (
          <Row label="Block"><span className="font-mono text-paper-dim">{tx.blockNumber.toLocaleString('en-IN')}</span></Row>
        )}
        <Row label="From">
          <Link to={`/address/${tx.fromAddress}`} className="font-mono text-indigo-glow hover:underline">{tx.fromAddress}</Link>
          <CopyBtn text={tx.fromAddress} />
        </Row>
        <Row label="To">
          <Link to={`/address/${tx.toAddress}`} className="font-mono text-indigo-glow hover:underline">{tx.toAddress}</Link>
          <CopyBtn text={tx.toAddress} />
        </Row>
        <Row label="Amount">
          <span className="font-mono text-paper">{formatAmount(tx.amount)} {tx.tokenSymbol}</span>
        </Row>
        <Row label="Txn Fee">
          <span className="font-mono text-paper-dim">
            {tx.fee ? `${tx.fee.amount} ${tx.fee.symbol}` : 'Not available for this transaction'}
          </span>
        </Row>
        <Row label="Timestamp">
          <span className="text-paper-dim">{new Date(tx.createdAt).toUTCString()}</span>
        </Row>
        {tx.explorerUrl && (
          <Row label="Verify on-chain">
            <a
              href={tx.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-indigo-glow hover:underline"
            >
              View on {tx.chainLabel ?? tx.chain} scan <ExternalLink size={13} />
            </a>
          </Row>
        )}
      </div>
    </div>
  );
}
