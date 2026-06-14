/**
 * DeadlineCountdown — live HH:MM:SS countdown to an order deadline.
 * Turns red when < 15 minutes remain.
 */
import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface DeadlineCountdownProps {
  /** ISO datetime string or HH:MM:SS time string (today's date assumed) */
  deadline: string;
  className?: string;
  showIcon?: boolean;
}

function secondsUntil(deadline: string): number {
  let target: Date;
  // If it looks like a time-only string (HH:MM or HH:MM:SS), combine with today
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(deadline)) {
    const today = new Date().toISOString().split('T')[0];
    target = new Date(`${today}T${deadline}`);
  } else {
    target = new Date(deadline);
  }
  return Math.max(0, Math.floor((target.getTime() - Date.now()) / 1000));
}

function formatSeconds(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function DeadlineCountdown({
  deadline,
  className = '',
  showIcon = true,
}: DeadlineCountdownProps) {
  const [seconds, setSeconds] = useState(() => secondsUntil(deadline));

  useEffect(() => {
    setSeconds(secondsUntil(deadline));
    const timer = setInterval(() => {
      setSeconds(secondsUntil(deadline));
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  const isExpired = seconds === 0;
  const isUrgent = seconds < 900 && !isExpired; // < 15 min

  if (isExpired) {
    return (
      <span className={`inline-flex items-center gap-1 text-danger-500 font-medium ${className}`}>
        {showIcon && <Clock className="w-3 h-3" />}
        Ordering closed
      </span>
    );
  }

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-mono font-medium tabular-nums
        transition-colors
        ${isUrgent ? 'text-danger-500 animate-pulse' : 'text-surface-500 dark:text-surface-400'}
        ${className}
      `}
    >
      {showIcon && <Clock className={`w-3 h-3 ${isUrgent ? 'text-danger-500' : ''}`} />}
      {formatSeconds(seconds)}
    </span>
  );
}
