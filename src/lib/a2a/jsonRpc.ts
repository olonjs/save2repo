export type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export const a2aCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  "Access-Control-Allow-Headers": "Content-Type, X-Correlation-Id",
};

export function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export function extractToolArguments(params: Record<string, unknown> | undefined): Record<string, unknown> {
  const maybe = params?.arguments;
  return typeof maybe === "object" && maybe !== null && !Array.isArray(maybe) ? (maybe as Record<string, unknown>) : {};
}

export function resolveSlug(input: unknown): string {
  if (typeof input !== "string") return "home";
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9/_-]/g, "-").replace(/^\/+|\/+$/g, "");
  return normalized || "home";
}
