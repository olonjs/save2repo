import { redirect } from "next/navigation";
import Login from "@/components/login";
import { createSupabaseServerClient } from "@/lib/supabaseServer";

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const nextPath =
    typeof resolvedSearchParams.next === "string" && resolvedSearchParams.next.startsWith("/")
      ? resolvedSearchParams.next
      : "/dashboard";
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      redirect(nextPath);
    }
  }
  return <Login nextPath={nextPath} />;
}