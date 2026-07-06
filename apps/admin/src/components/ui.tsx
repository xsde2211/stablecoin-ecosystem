import { type ReactNode } from 'react';

// ─── Badge ──────────────────────────────────────────────────────────────────
const BADGE_STYLES: Record<string, string> = {
  success: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/20',
  warning: 'bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/25',
  error:   'bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/25',
  info:    'bg-sky-500/10 text-sky-700 ring-1 ring-inset ring-sky-500/25',
  neutral: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300',
};

export function Badge({ label, variant = 'neutral' }: { label: string; variant?: keyof typeof BADGE_STYLES }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE_STYLES[variant]}`}>
      {label}
    </span>
  );
}

export function statusVariant(status?: string): keyof typeof BADGE_STYLES {
  const s = (status ?? '').toUpperCase();
  if (['CONFIRMED', 'APPROVED', 'COMPLETED', 'ACTIVE'].includes(s)) return 'success';
  if (['PENDING', 'SUBMITTED', 'LOCKED', 'AWAITING_PAYMENT'].includes(s)) return 'warning';
  if (['FAILED', 'REJECTED', 'REVERTED', 'CANCELLED', 'SUSPENDED'].includes(s)) return 'error';
  return 'neutral';
}

// ─── Button ─────────────────────────────────────────────────────────────────
type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
};

export function Button({
  children, onClick, variant = 'primary', size = 'md', disabled, loading, type = 'button', className = '',
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  const variants: Record<string, string> = {
    primary:   'bg-teal-600 text-white hover:bg-teal-700 shadow-sm',
    secondary: 'bg-white text-ink-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
    danger:    'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
    ghost:     'text-slate-600 hover:bg-slate-100',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${sizes} ${variants[variant]} ${className}`}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}

// ─── Spinner ────────────────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg className="animate-spin" style={{ width: size, height: size }} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex h-full min-h-[40vh] items-center justify-center text-teal-600">
      <Spinner size={28} />
    </div>
  );
}

// ─── Card / StatCard ────────────────────────────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white ring-1 ring-slate-200 ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({
  label, value, sub, accent = 'teal',
}: { label: string; value: string | number; sub?: string; accent?: 'teal' | 'amber' | 'rose' | 'sky' }) {
  const accentColor: Record<string, string> = {
    teal: 'text-teal-600', amber: 'text-amber-600', rose: 'text-rose-600', sky: 'text-sky-600',
  };
  return (
    <Card className="p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 font-[family-name:var(--font-display)] text-3xl font-semibold ${accentColor[accent]}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </Card>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────
export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-16 text-center">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

// ─── Pagination ─────────────────────────────────────────────────────────────
export function Pagination({
  page, totalPages, onChange,
}: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
      <p className="text-xs text-slate-500">
        Page <span className="font-medium text-slate-700">{page}</span> of{' '}
        <span className="font-medium text-slate-700">{totalPages}</span>
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────
export function Modal({
  open, onClose, title, children,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl ring-1 ring-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Input ──────────────────────────────────────────────────────────────────
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-ink-900 placeholder:text-slate-400 focus:border-teal-500 ${props.className ?? ''}`}
    />
  );
}

export function Select({
  value, onChange, options, placeholder,
}: { value: string; onChange: (v: string) => void; options: { label: string; value: string }[]; placeholder?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-teal-500"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function mono(text?: string | null, len = 10) {
  if (!text) return '—';
  return text.length > len + 6 ? `${text.slice(0, len)}…${text.slice(-4)}` : text;
}

export function formatDate(d?: string | Date | null) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}
