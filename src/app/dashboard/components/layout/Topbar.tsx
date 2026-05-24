"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogOut, Menu } from "lucide-react";
import { OlonLogo } from "./OlonLogo";

type TopbarProps = {
  user: User | null;
  onSignOut: () => void | Promise<void>;
};

const NAV_ITEMS = [
  {
    id: "projects",
    label: "Projects",
    href: "/dashboard",
  },
] as const;

export function Topbar({ user, onSignOut }: TopbarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isProjectsActive = pathname === "/dashboard" || pathname?.startsWith("/dashboard/");

  const handleNavClick = () => {
    setMobileOpen(false);
  };

  const handleSignOutClick = async () => {
    setMobileOpen(false);
    await onSignOut();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card">
      <div className="mx-auto flex h-[52px] max-w-screen-xl items-center gap-4 px-5">
        {/* Left: Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <OlonLogo />
        </Link>

        {/* Center: nav (desktop) */}
        <nav className="ml-6 hidden flex-1 items-center justify-center gap-1 sm:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              onClick={handleNavClick}
              className={`inline-flex items-center rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                isProjectsActive
                  ? "bg-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-elevated"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right: user + actions */}
        <div className="ml-auto flex items-center gap-2">
          {user && (
            <div className="hidden items-center gap-3 sm:flex">
              {user.user_metadata?.avatar_url && (
                <img
                  src={user.user_metadata.avatar_url}
                  alt="Avatar"
                  className="h-8 w-8 rounded-full border border-border"
                />
              )}
              <div className="flex min-w-0 flex-col">
                <p className="truncate text-xs font-medium leading-tight">{user.user_metadata?.full_name}</p>
                <p className="truncate text-[10px] text-muted-foreground leading-tight">{user.email}</p>
              </div>
              <button
                type="button"
                onClick={handleSignOutClick}
                className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          )}

          {/* Mobile: hamburger + minimal menu */}
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-elevated hover:text-foreground sm:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="Open navigation"
          >
            <Menu size={16} />
          </button>
        </div>
      </div>

      {/* Mobile sheet-style menu */}
      {mobileOpen && (
        <div className="border-t border-border bg-card px-5 pb-3 pt-2 sm:hidden">
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                onClick={handleNavClick}
                className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                  isProjectsActive ? "bg-elevated text-foreground" : "text-muted-foreground hover:bg-elevated hover:text-foreground"
                }`}
              >
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          {user && (
            <div className="mt-3 border-t border-border/70 pt-3">
              <button
                type="button"
                onClick={handleSignOutClick}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-elevated hover:text-foreground"
              >
                <LogOut size={13} />
                Sign out
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

