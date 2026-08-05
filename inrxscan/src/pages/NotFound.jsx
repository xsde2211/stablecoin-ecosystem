import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-24 text-center">
      <p className="font-mono text-gold text-sm mb-2">404</p>
      <h1 className="font-display text-2xl font-semibold text-paper mb-2">Nothing recorded here.</h1>
      <p className="text-paper-dim mb-6">This page isn't part of the ledger. Check the address or hash and try again.</p>
      <Link to="/" className="text-indigo-glow hover:underline text-sm">← Back to explorer home</Link>
    </div>
  );
}
