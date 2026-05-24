import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 shrink-0 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:       'bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]',
        secondary:     'bg-secondary text-secondary-foreground border border-border hover:bg-elevated active:scale-[0.98]',
        outline:       'bg-transparent text-foreground border border-border hover:bg-elevated active:scale-[0.98]',
        ghost:         'bg-transparent text-muted-foreground hover:text-foreground hover:bg-elevated active:scale-[0.98]',
        accent:        'bg-accent text-accent-foreground hover:opacity-90 active:scale-[0.98]',
        destructive:   'bg-destructive text-destructive-foreground border border-destructive-border hover:opacity-90 active:scale-[0.98]',
        brand:         'btn-brand active:scale-[0.98]',
        'brand-outline': 'btn-brand-outline active:scale-[0.98]',
      },
      size: {
        default: 'h-9 px-4 text-sm rounded-md',
        sm:      'h-8 px-3.5 text-sm rounded-md',
        lg:      'h-10 px-5 text-base rounded-md',
        icon:    'h-9 w-9 rounded-md',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = 'Button'

export { Button, buttonVariants }
