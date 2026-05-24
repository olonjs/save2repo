"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { User } from "@supabase/supabase-js";
import { Topbar } from "./components/layout/Topbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push("/");
        return;
      }
      setUser(user);
    });
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <Topbar user={user} onSignOut={handleLogout} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
