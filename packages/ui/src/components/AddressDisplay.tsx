import React, { useState } from 'react';

interface AddressDisplayProps {
  address:  string;
  chars?:   number;   // how many chars to show on each side, default 6
  showCopy?: boolean;
}

export function AddressDisplay({
  address,
  chars    = 6,
  showCopy = true,
}: AddressDisplayProps) {
  const [copied, setCopied] = useState(false);

  const shortened = address.length > chars * 2 + 3
    ? `${address.slice(0, chars)}...${address.slice(-4)}`
    : address;

  const copy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <code style={{
        fontFamily: 'monospace',
        fontSize:   13,
        color:      'inherit',
      }}>
        {shortened}
      </code>
      {showCopy && (
        <button
          onClick={copy}
          title="Copy full address"
          style={{
            background: 'none',
            border:     'none',
            cursor:     'pointer',
            fontSize:   13,
            padding:    '0 2px',
            color:      copied ? '#0d6e54' : '#9e9c96',
          }}
        >
          {copied ? '✓' : '⎘'}
        </button>
      )}
    </span>
  );
}