/**
 * GlassCard — frosted glass panel primitive.
 * Implements the macOS-style glass morphism design spec.
 */
import React from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: React.ReactNode;
  /** Extra blur / opacity overrides */
  variant?: 'default' | 'lighter' | 'darker' | 'solid';
  /** Remove padding */
  noPadding?: boolean;
  /** Remove border */
  noBorder?: boolean;
  hoverable?: boolean;
  className?: string;
}

const VARIANT_CLASSES = {
  default:  'backdrop-blur-xl bg-white/70 dark:bg-zinc-900/70',
  lighter:  'backdrop-blur-2xl bg-white/85 dark:bg-zinc-900/50',
  darker:   'backdrop-blur-xl bg-white/50 dark:bg-zinc-900/85',
  solid:    'bg-white dark:bg-zinc-900',
};

export default function GlassCard({
  children,
  variant = 'default',
  noPadding = false,
  noBorder = false,
  hoverable = false,
  className = '',
  ...motionProps
}: GlassCardProps) {
  return (
    <motion.div
      {...motionProps}
      className={`
        ${VARIANT_CLASSES[variant]}
        ${!noBorder ? 'border border-white/20 dark:border-white/10' : ''}
        ${!noPadding ? 'p-4' : ''}
        rounded-2xl shadow-sm
        ${hoverable ? 'cursor-pointer transition-shadow hover:shadow-md hover:border-white/40' : ''}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
