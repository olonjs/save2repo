import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        /* ── DS variants ─────────────────────────────────────── */
        default:  'bg-primary-900 text-primary-light border border-primary rounded-sm',
        outline:  'bg-elevated text-muted-foreground border border-border rounded-sm',
        accent:   'text-accent border border-border-strong rounded-sm',
        solid:    'bg-primary text-primary-foreground rounded-sm',
        pill:     'bg-elevated text-muted-foreground border border-border rounded-full gap-1.5',

        /* ── Platform-specific variants (semantic token–only) ── */
        success: 'bg-success text-success-foreground border border-success-border rounded-full',
        warning: 'bg-warning text-warning-foreground border border-warning-border rounded-full',
        danger:  'bg-destructive text-destructive-foreground border border-destructive-border rounded-full',
        info:    'bg-info text-info-foreground border border-info-border rounded-full',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { badgeVariants }
