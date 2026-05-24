import { NextRequest, NextResponse } from "next/server";
import { readTenantContent } from "@/lib/tenantContentStore";
import {
  SubmitFormSchemaError,
  requireSubmissionSchema,
} from "@/lib/tenantSubmissionSchema";
import { validateSubmissionPayload } from "@/lib/tenantSubmissionValidator";
import { a2aCorsHeaders, err, ok, resolveSlug } from "@/lib/a2a/jsonRpc";

async function postFormsSubmit(params: {
  req: NextRequest;
  correlationId: string;
  tenantApiKey: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(new URL("/api/v1/forms/submit", params.req.nextUrl.origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.tenantApiKey}`,
      "X-Correlation-Id": params.correlationId,
    },
    body: JSON.stringify(params.body),
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

export async function executeA2aSubmitForm(params: {
  req: NextRequest;
  tenant: { id: string; slug: string; api_key: string };
  correlationId: string;
  id: string | number | null;
  args: Record<string, unknown>;
}): Promise<NextResponse> {
  const { req, tenant, correlationId, id, args } = params;

  const slug = resolveSlug(args.slug);
  const sectionId = typeof args.sectionId === "string" ? args.sectionId.trim() : "";
  const rawData =
    typeof args.data === "object" && args.data !== null && !Array.isArray(args.data)
      ? (args.data as Record<string, unknown>)
      : null;
  if (!sectionId || !rawData) {
    return NextResponse.json(
      err(id, -32602, "Invalid params: sectionId and object data are required"),
      { status: 400, headers: a2aCorsHeaders }
    );
  }

  const payload = await readTenantContent(tenant.id);
  const pageCandidate = payload?.pages?.[slug];
  const pageObject =
    typeof pageCandidate === "object" && pageCandidate !== null && !Array.isArray(pageCandidate)
      ? (pageCandidate as Record<string, unknown>)
      : null;
  const sections = Array.isArray(pageObject?.sections)
    ? (pageObject.sections as Array<Record<string, unknown>>)
    : null;
  if (!pageObject || !sections) {
    return NextResponse.json(
      err(id, -32020, `Page not found or invalid sections for slug '${slug}'`),
      { status: 404, headers: a2aCorsHeaders }
    );
  }

  const section = sections.find((entry) => entry?.id === sectionId) ?? null;
  if (!section) {
    return NextResponse.json(
      err(id, -32021, `Section '${sectionId}' not found in page '${slug}'`),
      { status: 404, headers: a2aCorsHeaders }
    );
  }

  const sectionType = typeof section.type === "string" ? section.type : "";
  if (!sectionType) {
    return NextResponse.json(
      err(id, -32021, `Section '${sectionId}' has no declared type`),
      { status: 409, headers: a2aCorsHeaders }
    );
  }

  const sectionData =
    typeof section.data === "object" && section.data !== null && !Array.isArray(section.data)
      ? (section.data as Record<string, unknown>)
      : {};
  const sectionRecipientEmail =
    typeof sectionData.recipientEmail === "string" && sectionData.recipientEmail.trim()
      ? sectionData.recipientEmail.trim()
      : null;

  let schemaResult: { baseUrl: string; schema: Record<string, unknown> };
  try {
    schemaResult = await requireSubmissionSchema({
      tenantId: tenant.id,
      slug,
      sectionType,
      correlationId,
    });
  } catch (error) {
    if (error instanceof SubmitFormSchemaError) {
      const jsonRpcCode =
        error.code === "ERR_SECTION_SCHEMA_NOT_DECLARED" ? -32033 : -32030;
      return NextResponse.json(
        err(id, jsonRpcCode, error.message, {
          code: error.code,
          correlationId,
          ...error.details,
        }),
        { status: error.httpStatus, headers: a2aCorsHeaders }
      );
    }
    throw error;
  }

  const validation = validateSubmissionPayload(schemaResult.schema, rawData);
  if (!validation.ok) {
    return NextResponse.json(
      err(id, -32602, "Invalid submission payload", {
        code: "ERR_SUBMISSION_VALIDATION_FAILED",
        correlationId,
        validationErrors: validation.errors,
      }),
      { status: 400, headers: a2aCorsHeaders }
    );
  }

  // Strip fields the agent is not allowed to control: `recipientEmail`
  // (resolved server-side from section config) and `_meta` (platform-set).
  const { recipientEmail: _ignoredRecipient, _meta: _ignoredMeta, ...safeData } = rawData;
  void _ignoredRecipient;
  void _ignoredMeta;

  const forwardedBody: Record<string, unknown> = {
    ...safeData,
    _meta: {
      submittedVia: "a2a",
      tenantId: tenant.id,
      slug,
      sectionId,
      sectionType,
      schemaBaseUrl: schemaResult.baseUrl,
      correlationId,
    },
  };
  if (sectionRecipientEmail) {
    forwardedBody.recipientEmail = sectionRecipientEmail;
  }

  const submitResult = await postFormsSubmit({
    req,
    correlationId,
    tenantApiKey: tenant.api_key,
    body: forwardedBody,
  });

  if (!submitResult.response.ok) {
    return NextResponse.json(
      err(id, -32012, "forms/submit failed", {
        status: submitResult.response.status,
        payload: submitResult.payload,
        correlationId,
      }),
      { status: 502, headers: a2aCorsHeaders }
    );
  }

  return NextResponse.json(
    ok(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              ok: true,
              tenantSlug: tenant.slug,
              slug,
              sectionId,
              sectionType,
              result: submitResult.payload,
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
