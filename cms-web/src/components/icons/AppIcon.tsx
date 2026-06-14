/**
 * AppIcon — Apple-style rounded-square gradient icon container.
 * Used throughout the Canteen module for slot categories, status indicators, etc.
 */
import React from 'react';

type IconSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZE_CLASSES: Record<IconSize, string> = {
  xs: 'w-6 h-6 rounded-lg text-xs',
  sm: 'w-8 h-8 rounded-xl text-sm',
  md: 'w-10 h-10 rounded-2xl text-base',
  lg: 'w-14 h-14 rounded-3xl text-xl',
};

export type AppIconCategory =
  | 'meal'
  | 'tea'
  | 'snack'
  | 'order'
  | 'billing'
  | 'kitchen'
  | 'counter'
  | 'settings'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'default';

const CATEGORY_GRADIENTS: Record<AppIconCategory, string> = {
  meal:     'from-orange-400 to-amber-500',
  tea:      'from-teal-400 to-cyan-500',
  snack:    'from-pink-400 to-rose-500',
  order:    'from-brand-400 to-brand-600',
  billing:  'from-violet-400 to-purple-600',
  kitchen:  'from-red-400 to-orange-500',
  counter:  'from-green-400 to-emerald-600',
  settings: 'from-slate-400 to-slate-600',
  success:  'from-green-400 to-emerald-500',
  warning:  'from-yellow-400 to-amber-500',
  danger:   'from-red-400 to-rose-600',
  info:     'from-sky-400 to-blue-500',
  default:  'from-surface-300 to-surface-400',
};

interface AppIconProps {
  icon: React.ReactNode;
  category?: AppIconCategory;
  size?: IconSize;
  className?: string;
}

export default function AppIcon({
  icon,
  category = 'default',
  size = 'md',
  className = '',
}: AppIconProps) {
  const gradient = CATEGORY_GRADIENTS[category];

  return (
    <div
      className={`
        inline-flex items-center justify-center
        bg-gradient-to-br ${gradient}
        text-white shadow-sm flex-shrink-0
        ${SIZE_CLASSES[size]}
        ${className}
      `}
    >
      {icon}
    </div>
  );
}
