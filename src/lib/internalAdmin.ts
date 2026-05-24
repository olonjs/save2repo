import { NextRequest } from "next/server";
import { requireRequestUser } from "@/lib/serverAuth";

function parseCsv(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export function isDomainsAdminUiEnabled(): boolean {
  return process.env.DOMAINS_ADMIN_UI_ENABLED === "1";
}

export async function requireDomainsAdmin(
  req: NextRequest
): Promise<
  | { ok: true; data: { userId: string; email: string | null } }
  | { ok: false; status: number; error: string; code: string }
> {
  if (!isDomainsAdminUiEnabled()) {
    return { ok: false, status: 404, error: "Not found", code: "ERR_DOMAINS_ADMIN_DISABLED" };
  }

  const auth = await requireRequestUser(req);
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.data.status,
      error: auth.data.error,
      code: "ERR_UNAUTHORIZED",
    };
  }

  const allowedIds = parseCsv(process.env.INTERNAL_ADMIN_USER_IDS);
  const allowedEmails = parseCsv(process.env.INTERNAL_ADMIN_EMAILS);
  const userId = auth.data.user.id;
  const email = auth.data.user.email ?? null;
  const byId = allowedIds.has(userId);
  const byEmail = email ? allowedEmails.has(email) : false;

  if (!byId && !byEmail) {
    return {
      ok: false,
      status: 403,
      error: "Forbidden",
      code: "ERR_ADMIN_FORBIDDEN",
    };
  }

  return { ok: true, data: { userId, email } };
}
