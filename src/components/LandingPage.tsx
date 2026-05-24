"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OlonMark } from "@/components/ui/logo/OlonMark";
import { supabase } from "@/lib/supabase";

const GitHubIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.62-3.37-1.2-3.37-1.2-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.63.07-.63 1 .07 1.53 1.05 1.53 1.05.89 1.57 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.08 0-1.12.39-2.04 1.03-2.76-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.86c.85 0 1.7.12 2.5.36 1.9-1.33 2.74-1.05 2.74-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.64 1.03 2.76 0 3.95-2.34 4.82-4.57 5.07.36.32.68.95.68 1.92 0 1.39-.01 2.5-.01 2.84 0 .27.18.6.69.49A10.28 10.28 0 0 0 22 12.23C22 6.58 17.52 2 12 2z" />
  </svg>
);

const JsonPagesLogo = () => (
  <div className="flex items-center gap-3">
    <OlonMark size={40} />
    <div className="flex flex-col">
      <span className="font-sans text-xl font-bold tracking-tight text-white">Olon</span>
    </div>
  </div>
);

export default function LandingPage() {
  const handleAuth = async () => {
    const next = new URLSearchParams(window.location.search).get("next");
    const nextPath = next && next.startsWith("/") ? next : "/dashboard";
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
    });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 text-foreground sm:px-6">
      <Card className="w-full max-w-md border border-border bg-card">
        <CardContent className="flex flex-col items-center gap-8 p-8">
          <JsonPagesLogo />
          <Button
            type="button"
            variant="brand-outline"
            className="h-12 w-[320px] justify-center gap-2 rounded-xl px-4 text-base font-semibold tracking-tight"
            onClick={handleAuth}
          >
            <span className="pointer-events-none flex items-center gap-2">
              <GitHubIcon />
              <span className="text-[17px] leading-none">Continue with GitHub</span>
            </span>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
