import { randomUUID } from 'node:crypto';

const CORRELATION_HEADER = 'x-correlation-id';

type CorrelationSource =
  | string
  | null
  | undefined
  | Request
  | { headers?: Headers | null };

/**
 * Resolve a correlation id, honoring an inbound `x-correlation-id` header when
 * present and otherwise minting a new UUID. Accepts either a raw header value
 * (the common parent jsonpages-platform call style) or a Request-like object
 * from which the header is extracted.
 *
 * Use the returned value in every log line + response envelope so save2repo
 * flows stay traceable across SSE streams and remote agents.
 */
export function resolveCorrelationId(source: CorrelationSource): string {
  // string overload: caller already did `req.headers.get('x-correlation-id')`
  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (trimmed.length > 0) return trimmed;
    return randomUUID();
  }

  // request-like overload
  try {
    const headers = source && typeof source === 'object' ? (source as { headers?: Headers | null }).headers : null;
    const inbound = headers && typeof headers.get === 'function' ? headers.get(CORRELATION_HEADER) : null;
    if (inbound && typeof inbound === 'string' && inbound.trim().length > 0) {
      return inbound.trim();
    }
  } catch {
    // header shape weirdness — fall through to fresh uuid
  }

  return randomUUID();
}

export const CORRELATION_ID_HEADER = CORRELATION_HEADER;
