"use client";

import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoginButtonProps {
  label?: string;
  planCode?: "starter" | "pro" | "business";
  intent?: "subscribe" | "login";
  tenantId?: string;
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}

export default function LoginButton({
  label = "Login to Cloud",
  planCode,
  intent = "login",
  tenantId,
  className,
  variant = "outline",
  size = "default",
}: LoginButtonProps) {
  const searchParams = useSearchParams();
  const nextParam = searchParams?.get("next");

  const handleLogin = async () => {
    let redirectPath: string;
    if (nextParam && nextParam.startsWith("/")) {
      redirectPath = nextParam.includes("%") ? decodeURIComponent(nextParam) : nextParam;
    } else {
      const query = new URLSearchParams();
      if (intent === "subscribe" && planCode) {
        query.set("intent", "subscribe");
        query.set("plan", planCode);
        if (tenantId) query.set("tenant_id", tenantId);
      }
      redirectPath = query.toString() ? `/dashboard?${query.toString()}` : "/dashboard";
    }

    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectPath)}`,
      },
    });
  };

  return (
    <Button
      onClick={handleLogin}
      variant={variant}
      size={size}
      className={cn("w-full", className)}
    >
      {label} <ArrowRight size={18} />
    </Button>
  );
}