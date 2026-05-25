/**
 * Thin Ajv wrapper for validating MCP `submit-form` payloads against the
 * JSON Schema published by the tenant in its page contract
 * (`sectionSubmissionSchemas[sectionType]`).
 *
 * Per ADR-0001, validation happens at the MCP gateway boundary *before* the
 * payload is forwarded to `/api/v1/forms/submit`. Validation errors produce
 * JSON-RPC `-32602` with the Ajv error list in `data.validationErrors`.
 *
 * Compiled validators are memoised by schema identity (object reference) so
 * that repeated submissions against the same cached schema do not pay the
 * compilation cost.
 */
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

let ajvInstance: Ajv2020 | null = null;

function getAjv(): Ajv2020 {
  if (ajvInstance) return ajvInstance;
  const instance = new Ajv2020({
    allErrors: true,
    strict: false,
    // Tenant schemas may include defaults (ADR-0002 allows it); do not mutate
    // the agent-supplied payload by applying them. The downstream endpoint
    // remains permissive.
    useDefaults: false,
    coerceTypes: false,
    removeAdditional: false,
  });
  addFormats(instance);
  ajvInstance = instance;
  return instance;
}

const compiledCache = new WeakMap<Record<string, unknown>, ValidateFunction>();

export type SubmitFormValidationResult =
  | { ok: true }
  | { ok: false; errors: Array<{ path: string; message: string; params?: Record<string, unknown> }> };

function formatErrors(errors: readonly ErrorObject[] | null | undefined): SubmitFormValidationResult {
  if (!errors || errors.length === 0) {
    return { ok: false, errors: [{ path: "", message: "Unknown validation error" }] };
  }
  return {
    ok: false,
    errors: errors.map((entry) => ({
      path: entry.instancePath || "/",
      message: entry.message ?? "invalid",
      params: entry.params as Record<string, unknown> | undefined,
    })),
  };
}

/**
 * Validate `data` against `schema`. Returns `{ ok: true }` on success or
 * `{ ok: false, errors }` with normalised Ajv errors suitable for embedding
 * in a JSON-RPC error payload (`data.validationErrors`).
 *
 * The validator compilation is cached by schema-object identity. Callers
 * should reuse the same schema object across submissions (already true when
 * schemas come from the TTL cache in `tenantSubmissionSchema.ts`).
 */
export function validateSubmissionPayload(
  schema: Record<string, unknown>,
  data: unknown
): SubmitFormValidationResult {
  let validate = compiledCache.get(schema);
  if (!validate) {
    try {
      validate = getAjv().compile(schema);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        errors: [{ path: "", message: `Schema compilation failed: ${message}` }],
      };
    }
    compiledCache.set(schema, validate);
  }
  const valid = validate(data);
  if (valid) return { ok: true };
  return formatErrors(validate.errors);
}
