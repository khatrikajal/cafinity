/**
 * OrderStatusBadge — status chip for CMS order lifecycle states.
 */
import type { CmsOrderStatus } from '@hooks/useCanteen';

interface OrderStatusBadgeProps {
  status: CmsOrderStatus;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

const STATUS_CONFIG: Record<
  CmsOrderStatus,
  { label: string; classes: string; dot: string }
> = {
  PENDING:   { label: 'Pending',   classes: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700/30',   dot: 'bg-amber-400' },
  ACCEPTED:  { label: 'Accepted',  classes: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700/30',         dot: 'bg-blue-400' },
  PREPARING: { label: 'Preparing', classes: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-700/30', dot: 'bg-orange-400 animate-pulse' },
  PREPARED:  { label: 'Ready',     classes: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700/30', dot: 'bg-emerald-400' },
  COLLECTED: { label: 'Collected', classes: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-300 dark:border-green-700/30',   dot: 'bg-green-500' },
  CANCELLED: { label: 'Cancelled', classes: 'bg-surface-100 text-surface-500 border-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:border-surface-700', dot: 'bg-surface-400' },
};

const SIZE_CLASSES = {
  xs: 'px-1.5 py-0.5 text-2xs gap-1',
  sm: 'px-2 py-0.5 text-xs gap-1',
  md: 'px-2.5 py-1 text-sm gap-1.5',
};

export default function OrderStatusBadge({
  status,
  size = 'sm',
  className = '',
}: OrderStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.CANCELLED;

  return (
    <span
      className={`
        inline-flex items-center border rounded-full font-medium
        ${cfg.classes} ${SIZE_CLASSES[size]} ${className}
      `}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}
