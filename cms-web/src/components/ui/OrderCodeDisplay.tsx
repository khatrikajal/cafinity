/**
 * OrderCodeDisplay — large monospace order code with copy button.
 * Shows a QR code if qrcode.react is available.
 */
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface OrderCodeDisplayProps {
  code: string;
  showQr?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}

export default function OrderCodeDisplay({
  code,
  showQr = false,
  size = 'md',
  className = '',
}: OrderCodeDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available in some contexts
    }
  };

  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      {/* Code pill */}
      <div
        className={`
          inline-flex items-center gap-2 rounded-xl border
          bg-surface-50 dark:bg-surface-900
          border-surface-200 dark:border-surface-700
          ${size === 'lg' ? 'px-6 py-3' : 'px-4 py-2'}
        `}
      >
        <span
          className={`
            font-mono font-semibold tracking-widest text-surface-900 dark:text-surface-50
            ${size === 'lg' ? 'text-2xl' : 'text-lg'}
          `}
        >
          {code}
        </span>
        <button
          onClick={handleCopy}
          className="
            ml-1 p-1 rounded-lg text-surface-400 hover:text-brand-500
            hover:bg-brand-50 dark:hover:bg-brand-900/30
            transition-colors
          "
          aria-label="Copy order code"
        >
          {copied ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* QR Code — lazy import to avoid hard dependency */}
      {showQr && <QrBlock value={code} size={size === 'lg' ? 140 : 100} />}
    </div>
  );
}

function QrBlock({ value, size }: { value: string; size: number }) {
  // Dynamic import — gracefully degrades if qrcode.react isn't installed
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { QRCodeSVG } = require('qrcode.react');
    return (
      <div className="p-2 bg-white rounded-xl border border-surface-100">
        <QRCodeSVG value={value} size={size} level="M" />
      </div>
    );
  } catch {
    return null;
  }
}
