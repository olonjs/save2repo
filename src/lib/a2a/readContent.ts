import { NextResponse } from "next/server";
import { readTenantContent } from "@/lib/tenantContentStore";
import {
  SubmitFormSchemaError,
  fetchPageContractSnapshot,
} from "@/lib/tenantSubmissionSchema";
import { a2aCorsHeaders, err, ok } from "@/lib/a2a/jsonRpc";

export async function executeA2aReadContent(params: {
  tenant: { id: string; slug: string };
  correlationId: string;
  id: string | number | null;
  args: Record<string, unknown>;
}): Promise<NextResponse> {
  const { tenant, correlationId, id, args } = params;

  const payload = await readTenantContent(tenant.id);
  const slug = typeof args.slug === "string" && args.slug.trim() ? args.slug.trim() : "home";
  const page = payload?.pages?.[slug] ?? null;

  let snapshot;
  try {
    snapshot = await fetchPageContractSnapshot({
      tenantId: tenant.id,
      slug,
      correlationId,
    });
  } catch (error) {
    if (error instanceof SubmitFormSchemaError) {
      return NextResponse.json(
        err(id, -32030, error.message, {
          code: error.code,
          slug,
          correlationId,
          ...(error.details ?? {}),
        }),
        { status: error.httpStatus, headers: a2aCorsHeaders }
      );
    }
    throw error;
  }

  return NextResponse.json(
    ok(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              tenantSlug: tenant.slug,
              slug,
              page,
              siteConfig: payload?.siteConfig ?? null,
              schemaBaseUrl: snapshot.baseUrl,
              sectionSubmissionSchemas: snapshot.sectionSubmissionSchemas,
              correlationId,
            },
            null,
            2
          ),
        },
      ],
    }),
    { headers: a2aCorsHeaders }
  );
}
