import React from 'react';

type Variant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: Variant;
}

const styles: Record<Variant, React.CSSProperties> = {
  success: { background: '#e6f3ef', color: '#0d6e54' },
  warning: { background: '#fef3dc', color: '#9a6200' },
  error:   { background: '#fdecea', color: '#c0392b' },
  info:    { background: '#e8f0fe', color: '#1a56a0' },
  neutral: { background: '#f0efe9', color: '#6b6961' },
};

export function Badge({ children, variant = 'neutral' }: BadgeProps) {
  return (
    <span style={{
      ...styles[variant],
      display:      'inline-flex',
      alignItems:   'center',
      padding:      '2px 8px',
      borderRadius: '20px',
      fontSize:     '11px',
      fontWeight:   600,
      letterSpacing: '0.2px',
    }}>
      {children}
    </span>
  );
}