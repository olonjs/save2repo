'use client'

import { cn } from '@/lib/utils'

interface OlonWordmarkProps {
    markSize?: number
    className?: string
}

export function OlonWordmark({ markSize = 48, className }: OlonWordmarkProps) {
    const scale = markSize / 48
    const w = 168 * scale
    const h = 52 * scale

    return (
        <svg
            width={w}
            height={h}
            viewBox="0 0 168 52"
            fill="none"
            overflow="visible"
            aria-label="Olon"
            className={cn('shrink-0', className)}>
            <defs>
                <linearGradient id="olon-wm-ring" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--mark-ring-top)" />
                    <stop offset="100%" stopColor="var(--mark-ring-bottom)" />
                </linearGradient>
            </defs>

            {/* Mark */}
            <circle cx="24" cy="24" r="18.24" stroke="url(#olon-wm-ring)" strokeWidth="9.6" />
            <circle cx="24" cy="24" r="7.2" fill="var(--mark-nucleus)" />

            {/* "Olon" — centro visivo allineato al centro del mark (cy=24) */}
            <text
                x="57"
                y="24"
                dominantBaseline="central"
                fill="var(--accent)"
                style={{
                    fontFamily:            'var(--wordmark-font)',
                    fontSize:              '48px',
                    letterSpacing:         'var(--wordmark-tracking)',
                    fontWeight:            'var(--wordmark-weight)',
                    fontVariationSettings: '"wdth" var(--wordmark-width)',
                    fontStretch:           'calc(var(--wordmark-width) * 1%)',
                }}>
                Olon
            </text>
        </svg>
    )
}
