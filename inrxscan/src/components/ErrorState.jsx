import { AlertTriangle } from 'lucide-react';

export default function ErrorState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <AlertTriangle size={20} className="text-rust" />
      <p className="text-sm text-paper-dim max-w-sm">
        {message || "Couldn't load this from the explorer API. It may be temporarily unavailable."}
      </p>
    </div>
  );
}
