import { NextRequest, NextResponse } from "next/server";
import { tenantContentPayloadToRepoFiles } from "@/lib/saveStoreToRepoMap";
import { readTenantContent, type TenantContentPayload } from "@/lib/tenantContentStore";
import { hasScope, type McpGatewayTenantContext } from "@/lib/mcpGatewayAuth";
import {
  SubmitFormSchemaError,
  fetchPageContractSnapshot,
  requireSubmissionSchema,
} from "@/lib/tenantSubmissionSchema";
import { validateSubmissionPayload } from "@/lib/tenantSubmissionValidator";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export const mcpCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Correlation-Id",
};

export function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

function extractToolArguments(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const maybe = params?.arguments;
  return typeof maybe === "object" && maybe !== null && !Array.isArray(maybe) ? (maybe as Record<string, unknown>) : {};
}

function resolveSlug(input: unknown): string {
  if (typeof input !== "string") return "home";
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9/_-]/g, "-").replace(/^\/+|\/+$/g, "");
  return normalized || "home";
}

const pendingColdSaveBySession = new Map<string, TenantContentPayload>();

function pendingColdSaveSessionKey(tenantId: string, credentialId: string): string {
  return `${tenantId}:${credentialId}`;
}

function setPendingColdSaveContent(tenantId: string, credentialId: string, payload: TenantContentPayload) {
  pendingColdSaveBySession.set(pendingColdSaveSessionKey(tenantId, credentialId), payload);
}

function getPendingColdSaveContent(tenantId: string, credentialId: string): TenantContentPayload | null {
  return pendingColdSaveBySession.get(pendingColdSaveSessionKey(tenantId, credentialId)) ?? null;
}

function clearPendingColdSaveContent(tenantId: string, credentialId: string) {
  pendingColdSaveBySession.delete(pendingColdSaveSessionKey(tenantId, credentialId));
}

async function executeHotSave(params: {
  req: NextRequest;
  correlationId: string;
  tenantApiKey: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(new URL("/api/v1/hotSave", params.req.nextUrl.origin), {
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

function parseSseEvents(raw: string): Array<{ event: string; data: unknown }> {
  const chunks = raw.split("\n\n");
  const events: Array<{ event: string; data: unknown }> = [];
  for (const chunk of chunks) {
    const lines = chunk
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
    }
    const rawData = dataLines.join("\n");
    let data: unknown = rawData;
    try {
      data = rawData ? JSON.parse(rawData) : null;
    } catch {
      data = rawData;
    }
    events.push({ event, data });
  }
  return events;
}

async function executeFormsSubmit(params: {
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

async function executeColdSave(params: {
  req: NextRequest;
  correlationId: string;
  tenantApiKey: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(new URL("/api/v1/save-stream", params.req.nextUrl.origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.tenantApiKey}`,
      "X-Correlation-Id": params.correlationId,
    },
    body: JSON.stringify(params.body),
  });
  const raw = await response.text();
  const events = parseSseEvents(raw);
  const doneEvent = [...events].reverse().find((entry) => entry.event === "done");
  const errorEvent = [...events].reverse().find((entry) => entry.event === "error");
  return {
    response,
    events,
    done: doneEvent?.data ?? null,
    error: errorEvent?.data ?? null,
  };
}

async function executeReadContentTool(params: {
  req: NextRequest;
  context: McpGatewayTenantContext;
  correlationId: string;
  id: string | number | null;
  args: Record<string, unknown>;
}): Promise<NextResponse> {
  const { context, correlationId, id, args } = params;

  if (!hasScope(context.credential.scopes, "read")) {
    return NextResponse.json(err(id, -32003, "Forbidden: missing read scope"), { status: 403, headers: mcpCorsHeaders });
  }

  const payload = await readTenantContent(context.tenant.id);
  const slug = typeof args.slug === "string" && args.slug.trim() ? args.slug.trim() : "home";
  const page = payload?.pages?.[slug] ?? null;

  let snapshot;
  try {
    snapshot = await fetchPageContractSnapshot({
      tenantId: context.tenant.id,
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
        { status: error.httpStatus, headers: mcpCorsHeaders }
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
              tenantId: context.tenant.id,
              tenantSlug: context.tenant.slug,
              credentialLabel: context.credential.label,
              clientId: context.credential.client_id,
              authMode: context.authMode,
              slug,
              page,
              siteConfig: payload?.siteConfig ?? null,
              schemaBaseUrl: snapshot.baseUrl,
              sectionSchemas: snapshot.sectionSchemas,
              sectionSubmissionSchemas: snapshot.sectionSubmissionSchemas,
              correlationId,
            },
            null,
            2
          ),
        },
      ],
    }),
    { headers: mcpCorsHeaders }
  );
}

async function executeSubmitFormTool(params: {
  req: NextRequest;
  context: McpGatewayTenantContext;
  correlationId: string;
  id: string | number | null;
  args: Record<string, unknown>;
}): Promise<NextResponse> {
  const { req, context, correlationId, id, args } = params;

  if (!hasScope(context.credential.scopes, "submit-form")) {
    return NextResponse.json(
      err(id, -32003, "Forbidden: missing submit-form scope"),
      { status: 403, headers: mcpCorsHeaders }
    );
  }

  const slug = resolveSlug(args.slug);
  const sectionId = typeof args.sectionId === "string" ? args.sectionId.trim() : "";
  const rawData =
    typeof args.data === "object" && args.data !== null && !Array.isArray(args.data)
      ? (args.data as Record<string, unknown>)
      : null;
  if (!sectionId || !rawData) {
    return NextResponse.json(
      err(id, -32602, "Invalid params: sectionId and object data are required"),
      { status: 400, headers: mcpCorsHeaders }
    );
  }

  const payload = await readTenantContent(context.tenant.id);
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
      { status: 404, headers: mcpCorsHeaders }
    );
  }

  const section = sections.find((entry) => entry?.id === sectionId) ?? null;
  if (!section) {
    return NextResponse.json(
      err(id, -32021, `Section '${sectionId}' not found in page '${slug}'`),
      { status: 404, headers: mcpCorsHeaders }
    );
  }

  const sectionType = typeof section.type === "string" ? section.type : "";
  if (!sectionType) {
    return NextResponse.json(
      err(id, -32021, `Section '${sectionId}' has no declared type`),
      { status: 409, headers: mcpCorsHeaders }
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
      tenantId: context.tenant.id,
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
        { status: error.httpStatus, headers: mcpCorsHeaders }
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
      { status: 400, headers: mcpCorsHeaders }
    );
  }

  const { recipientEmail: _ignoredRecipient, _meta: _ignoredMeta, ...safeData } = rawData;
  void _ignoredRecipient;
  void _ignoredMeta;

  const forwardedBody: Record<string, unknown> = {
    ...safeData,
    _meta: {
      submittedViaMcp: true,
      credentialId: context.credential.id,
      tenantId: context.tenant.id,
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

  const submitResult = await executeFormsSubmit({
    req,
    correlationId,
    tenantApiKey: context.tenant.api_key,
    body: forwardedBody,
  });

  if (!submitResult.response.ok) {
    return NextResponse.json(
      err(id, -32012, "forms/submit failed", {
        status: submitResult.response.status,
        payload: submitResult.payload,
        correlationId,
      }),
      { status: 502, headers: mcpCorsHeaders }
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
              tenantId: context.tenant.id,
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
    { headers: mcpCorsHeaders }
  );
}

export async function handleMcpJsonRpc(params: {
  req: NextRequest;
  context: McpGatewayTenantContext;
  correlationId: string;
  bodyOverride?: JsonRpcRequest;
}): Promise<NextResponse> {
  const { req, context, correlationId, bodyOverride } = params;
  const body = bodyOverride ?? ((await req.json().catch(() => ({}))) as JsonRpcRequest);
  const id = body.id ?? null;
  const method = body.method ?? "";

  if (!method) {
    return NextResponse.json(err(id, -32600, "Invalid request"), { status: 400, headers: mcpCorsHeaders });
  }

  // MCP notifications (method prefix "notifications/", e.g. `notifications/initialized`,
  // `notifications/cancelled`, `notifications/progress`) are one-way messages per
  // JSON-RPC 2.0 + MCP Streamable HTTP transport: the server MUST NOT send a
  // JSON-RPC response. Return HTTP 202 Accepted with empty body and move on.
  // Responding with -32601 (as before) was a protocol violation that Cursor
  // treats as fatal and caused the post-initialize connection to drop.
  if (method.startsWith("notifications/")) {
    return new NextResponse(null, { status: 202, headers: mcpCorsHeaders });
  }

  if (method === "initialize") {
    return NextResponse.json(
      ok(id, {
        protocolVersion: body.params?.protocolVersion ?? "2024-11-05",
        serverInfo: { name: "olon-mcp-gateway", version: "0.2.0" },
        capabilities: { tools: {} },
        correlationId,
      }),
      { headers: mcpCorsHeaders }
    );
  }

  if (method === "tools/list") {
    const tools = [
      {
        name: "whoami",
        description:
          "Show which tenant this MCP session is authenticated for, along with the credential label and granted scopes. Use this when the user asks \"which site am I connected to?\" or when you want to confirm the working context before making any change.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: {
          title: "Identify the current tenant and credential",
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "read-content",
        description:
          "Fetch the current content of a tenant page by slug, including every section and its data. The response is authoritative: it always includes `sectionSchemas` (editable shape of each section, keyed by section type — plan update-section against this) and `sectionSubmissionSchemas` (input shape of form-capable sections, keyed by section type — plan submit-form against this). Always call this first when the user asks about a page, before editing a section, or before submitting a form.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug to read (default: home). Example values: home, about, contatti." },
          },
          additionalProperties: false,
        },
        annotations: {
          title: "Read a tenant page's current content",
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "hot-save",
        description:
          "Persist the current draft to the live tenant site, making the change visible to visitors immediately. Use this for quick content edits the user wants published right away. For changes that should flow through code review and a proper deploy, prefer cold-save instead.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug being saved, or the config target identifier." },
            type: { type: "string", enum: ["page", "config"], description: "Whether the payload is a page or site-level config." },
            data: { description: "Content payload to persist (page JSON or config JSON)." },
            page: { description: "Alias for data when type=page." },
            siteConfig: { description: "Alias for data when type=config." },
          },
          required: ["slug"],
          additionalProperties: true,
        },
        annotations: {
          title: "Persist draft content to live storage",
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "cold-save",
        description:
          "Commit the tenant's current content to its git repository as a new version, triggering the normal deploy pipeline. Use this when the user wants a reviewable, versioned change rather than an immediate live edit.",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string", description: "Optional commit message. If omitted, a sensible default is generated." },
          },
          additionalProperties: false,
        },
        annotations: {
          title: "Commit content to the tenant's git repo",
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      {
        name: "navigate-to-page",
        description:
          "Declare which page you'll be working on next. This is a stateless acknowledgement used to scope subsequent read-content, update-section, or submit-form calls. Use when the user says \"open the about page\" or similar.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug to target (for example: home, about, contatti)." },
          },
          required: ["slug"],
          additionalProperties: false,
        },
        annotations: {
          title: "Set the working page context",
          readOnlyHint: true,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      {
        name: "update-section",
        description:
          "Change the content of one section on a page and save it live. Use this to update text, images, lists, or any other data inside a section. Changes are persisted immediately and become visible to visitors. The `data` payload must validate against the section's editable schema — discover it via read-content under `sectionSchemas[sectionType]`.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Page slug containing the section (default: home)." },
            sectionId: { type: "string", description: "Concrete section instance id to update." },
            data: { type: "object", description: "Full replacement payload for the section, conforming to sectionSchemas[sectionType]." },
          },
          required: ["sectionId", "data"],
          additionalProperties: true,
        },
        annotations: {
          title: "Update one section of a page",
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      {
        name: "submit-form",
        description:
          "Submit a contact, booking, or inquiry form on the tenant's website on the user's behalf. Use this when the user asks to send a message, request a quote, book a reservation, or otherwise submit any form visible on the site. The exact shape of the fields each form expects is returned by read-content under `sectionSubmissionSchemas[sectionType]` — always read-content the target page first to plan the `data` payload. The destination email address is configured by the tenant and cannot be changed by the agent.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Slug of the page hosting the form (default: home)." },
            sectionId: { type: "string", description: "Concrete section instance id of the form to submit against." },
            data: {
              type: "object",
              description:
                "Submission payload collected from the user. Must conform to sectionSubmissionSchemas[sectionType] from the tenant page contract. Do not include recipientEmail — it is resolved server-side from the section config.",
            },
          },
          required: ["sectionId", "data"],
          additionalProperties: false,
        },
        annotations: {
          title: "Submit a form on the tenant site",
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
    ];
    return NextResponse.json(ok(id, { tools, correlationId }), { headers: mcpCorsHeaders });
  }

  if (method === "tools/call") {
    const toolName = typeof body.params?.name === "string" ? body.params.name : "";
    const args = extractToolArguments(body.params);

    if (toolName === "whoami") {
      return NextResponse.json(
        ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tenantId: context.tenant.id,
                  tenantSlug: context.tenant.slug,
                  credentialId: context.credential.id,
                  credentialLabel: context.credential.label,
                  clientId: context.credential.client_id,
                  scopes: context.credential.scopes,
                  authMode: context.authMode,
                  correlationId,
                },
                null,
                2
              ),
            },
          ],
        }),
        { headers: mcpCorsHeaders }
      );
    }

    if (toolName === "read-content") {
      return executeReadContentTool({ req, context, correlationId, id, args });
    }

    if (toolName === "hot-save") {
      if (!hasScope(context.credential.scopes, "write")) {
        return NextResponse.json(err(id, -32003, "Forbidden: missing write scope"), { status: 403, headers: mcpCorsHeaders });
      }

      const hotSaveBody: Record<string, unknown> = {};
      if (typeof args.slug === "string") hotSaveBody.slug = args.slug;
      if (typeof args.type === "string") hotSaveBody.type = args.type;
      if (Object.prototype.hasOwnProperty.call(args, "data")) hotSaveBody.data = args.data;
      if (Object.prototype.hasOwnProperty.call(args, "page")) hotSaveBody.page = args.page;
      if (Object.prototype.hasOwnProperty.call(args, "siteConfig")) hotSaveBody.siteConfig = args.siteConfig;

      const hotSaveResult = await executeHotSave({
        req,
        correlationId,
        tenantApiKey: context.tenant.api_key,
        body: hotSaveBody,
      });
      if (!hotSaveResult.response.ok) {
        return NextResponse.json(
          err(id, -32010, "hotSave failed", {
            status: hotSaveResult.response.status,
            payload: hotSaveResult.payload,
            correlationId,
          }),
          { status: 502, headers: mcpCorsHeaders }
        );
      }

      return NextResponse.json(
        ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  tenantId: context.tenant.id,
                  result: hotSaveResult.payload,
                  correlationId,
                },
                null,
                2
              ),
            },
          ],
        }),
        { headers: mcpCorsHeaders }
      );
    }

    if (toolName === "navigate-to-page") {
      if (!hasScope(context.credential.scopes, "read")) {
        return NextResponse.json(err(id, -32003, "Forbidden: missing read scope"), { status: 403, headers: mcpCorsHeaders });
      }
      const slug = resolveSlug(args.slug);
      return NextResponse.json(
        ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  slug,
                  note: "Remote MCP is stateless; use slug in subsequent tool calls.",
                  correlationId,
                },
                null,
                2
              ),
            },
          ],
        }),
        { headers: mcpCorsHeaders }
      );
    }

    if (toolName === "update-section") {
      if (!hasScope(context.credential.scopes, "write")) {
        return NextResponse.json(err(id, -32003, "Forbidden: missing write scope"), { status: 403, headers: mcpCorsHeaders });
      }

      const slug = resolveSlug(args.slug);
      const sectionId = typeof args.sectionId === "string" ? args.sectionId.trim() : "";
      const nextData = typeof args.data === "object" && args.data !== null && !Array.isArray(args.data) ? args.data : null;
      if (!sectionId || !nextData) {
        return NextResponse.json(err(id, -32602, "Invalid params: sectionId and object data are required"), {
          status: 400,
          headers: mcpCorsHeaders,
        });
      }

      const payload = await readTenantContent(context.tenant.id);
      const pageCandidate = payload?.pages?.[slug];
      const pageObject =
        typeof pageCandidate === "object" && pageCandidate !== null && !Array.isArray(pageCandidate)
          ? (pageCandidate as Record<string, unknown>)
          : null;
      const sections = Array.isArray(pageObject?.sections) ? (pageObject.sections as Array<Record<string, unknown>>) : null;
      if (!pageObject || !sections) {
        return NextResponse.json(err(id, -32020, `Page not found or invalid sections for slug '${slug}'`), {
          status: 404,
          headers: mcpCorsHeaders,
        });
      }

      let updated = false;
      const nextSections = sections.map((section) => {
        if (section?.id === sectionId) {
          updated = true;
          return {
            ...section,
            data: nextData,
          };
        }
        return section;
      });

      if (!updated) {
        return NextResponse.json(err(id, -32021, `Section '${sectionId}' not found in page '${slug}'`), {
          status: 404,
          headers: mcpCorsHeaders,
        });
      }

      const nextPage = {
        ...pageObject,
        sections: nextSections,
      };

      setPendingColdSaveContent(context.tenant.id, context.credential.id, {
        siteConfig: payload?.siteConfig ?? null,
        pages: {
          ...(payload?.pages ?? {}),
          [slug]: nextPage,
        },
      });

      return NextResponse.json(
        ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  tenantId: context.tenant.id,
                  slug,
                  sectionId,
                  page: nextPage,
                  correlationId,
                },
                null,
                2
              ),
            },
          ],
        }),
        { headers: mcpCorsHeaders }
      );
    }

    if (toolName === "cold-save") {
      if (!hasScope(context.credential.scopes, "write")) {
        return NextResponse.json(err(id, -32003, "Forbidden: missing write scope"), { status: 403, headers: mcpCorsHeaders });
      }

      const payload = getPendingColdSaveContent(context.tenant.id, context.credential.id);
      if (!payload) {
        return NextResponse.json(
          err(id, -32011, "cold-save failed", {
            code: "ERR_COLD_SAVE_PAYLOAD_MISSING",
            message: "No pending MCP content to cold-save. Call update-section first.",
            correlationId,
          }),
          { status: 409, headers: mcpCorsHeaders }
        );
      }

      const files = tenantContentPayloadToRepoFiles(payload);
      if (files.length === 0) {
        return NextResponse.json(
          err(id, -32011, "cold-save failed", {
            code: "ERR_STORE_EMPTY",
            message: "Tenant content store produced no repository files for cold-save",
            correlationId,
          }),
          { status: 409, headers: mcpCorsHeaders }
        );
      }

      const bodyPayload: Record<string, unknown> = {
        files,
        message:
          typeof args.message === "string" && args.message.trim()
            ? args.message.trim()
            : "Cold save via MCP [build]",
      };

      const coldSaveResult = await executeColdSave({
        req,
        correlationId,
        tenantApiKey: context.tenant.api_key,
        body: bodyPayload,
      });

      if (!coldSaveResult.response.ok || coldSaveResult.error) {
        return NextResponse.json(
          err(id, -32011, "cold-save failed", {
            status: coldSaveResult.response.status,
            error: coldSaveResult.error,
            correlationId,
          }),
          { status: 502, headers: mcpCorsHeaders }
        );
      }

      clearPendingColdSaveContent(context.tenant.id, context.credential.id);

      return NextResponse.json(
        ok(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  tenantId: context.tenant.id,
                  result: coldSaveResult.done ?? { message: "cold-save completed without done payload" },
                  correlationId,
                },
                null,
                2
              ),
            },
          ],
        }),
        { headers: mcpCorsHeaders }
      );
    }

    if (toolName === "submit-form") {
      return executeSubmitFormTool({ req, context, correlationId, id, args });
    }

    return NextResponse.json(err(id, -32601, `Unknown tool: ${toolName}`), { status: 404, headers: mcpCorsHeaders });
  }

  return NextResponse.json(err(id, -32601, `Unsupported method: ${method}`), { status: 404, headers: mcpCorsHeaders });
}
