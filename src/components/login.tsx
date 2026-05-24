'use client'

import { Button } from '@/components/ui/button'
import { OlonWordmark } from '@/components/ui/logo/OlonWordmark'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'

const GitHub = () => (
    <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.86c.85 0 1.7.12 2.5.36 1.9-1.33 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.64 1.03 2.76 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.84 0 .27.18.6.69.49A10.28 10.28 0 0 0 22 12.23C22 6.58 17.52 2 12 2z" />
    </svg>
)

export default function Login({ nextPath }: { nextPath?: string }) {
    const nextParam = nextPath && nextPath.startsWith('/') ? nextPath : null

    const handleGitHubLogin = async () => {
        const nextPath = nextParam && nextParam.startsWith('/') ? nextParam : '/dashboard'
        await supabase.auth.signInWithOAuth({
            provider: 'github',
            options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
        })
    }

    return (
        <main className="bg-background">
            <div className="grid min-h-dvh lg:grid-cols-2">

                {/* ── Hero — left 50% ─────────────────────────────── */}
                <div className="relative hidden lg:block">
                    <Image
                        src="/images/signup/signup-hero-olon-graded.png"
                        alt="Olon"
                        fill
                        className="object-cover object-center"
                        priority
                    />
                    {/* right-edge fade: blends image into the form panel */}
                    <div className="hero-image-fade-right absolute inset-0" aria-hidden="true" />
                    {/* bottom-edge vignette */}
                    <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent" aria-hidden="true" />

                    <div className="absolute bottom-10 left-10 right-14 z-10">
                        <blockquote className="space-y-3">
                            <p className="text-balance text-xl font-display italic text-white/95 leading-snug tracking-tight">
                                "The best way to predict the future is to create it."
                            </p>
                            <footer className="text-xs uppercase tracking-widest text-accent/70">
                                — Peter Drucker
                            </footer>
                        </blockquote>
                    </div>
                </div>

                {/* ── Form panel — right 50% ───────────────────────── */}
                <div className="panel-brand-glow flex flex-col p-6 lg:p-12">

                    {/* Wordmark */}
                    <Link href="#" aria-label="go home">
                        <OlonWordmark markSize={32} />
                    </Link>

                    {/* Form content */}
                    <div className="m-auto w-full max-w-xs">
                        <div className="mb-8 space-y-2">
                            <p className="text-xs uppercase tracking-widest text-accent/80 mb-4">
                            Between light and structure,
                            systems begin.
                            </p>
                            <h1 className="text-2xl font-display">Enter the boundary.</h1>
                            <p className="text-muted-foreground">Shape the system.</p>
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-1 gap-3">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    className="w-full"
                                    onClick={handleGitHubLogin}>
                                    <GitHub />
                                    GitHub
                                </Button>
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-auto text-center text-xs text-muted-foreground">
                        By signing in, you agree to our{' '}
                        <Link href="#" className="hover:text-foreground underline">
                            Terms of Service
                        </Link>{' '}
                        and{' '}
                        <Link href="#" className="hover:text-foreground underline">
                            Privacy Policy
                        </Link>
                    </div>
                </div>

            </div>
        </main>
    )
}
