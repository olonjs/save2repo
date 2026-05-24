'use client'

import { cn } from '@/lib/utils'

interface OlonMarkProps {
    size?: number
    variant?: 'default' | 'mono'
    className?: string
}

export function OlonMark({ size = 32, variant = 'default', className }: OlonMarkProps) {
    const gid = `olon-ring-${size}`

    if (variant === 'mono') {
        return (
            <svg
                viewBox="0 0 100 100"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                width={size}
                height={size}
                aria-label="Olon mark"
                className={cn('flex-shrink-0', className)}>
                <circle cx="50" cy="50" r="38" stroke="currentColor" strokeWidth="20" />
                <circle cx="50" cy="50" r="15" fill="currentColor" />
            </svg>
        )
    }

    return (
        <svg
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            aria-label="Olon mark"
            className={cn('flex-shrink-0', className)}>
            <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--mark-ring-top)" />
                    <stop offset="100%" stopColor="var(--mark-ring-bottom)" />
                </linearGradient>
            </defs>
            <circle cx="50" cy="50" r="38" stroke={`url(#${gid})`} strokeWidth="20" />
            <circle cx="50" cy="50" r="15" fill="var(--mark-nucleus)" />
        </svg>
    )
}
