import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

export type HttpResult = APIGatewayProxyResultV2 & { statusCode: number; body: string };

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function json(statusCode: number, body: unknown): HttpResult {
  return { statusCode, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

export function error(statusCode: number, code: string, message: string, details?: unknown): HttpResult {
  return json(statusCode, { error: { code, message, ...(details ? { details } : {}) } });
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const MAX_BODY_BYTES = 4096;

/** Parse and size-limit a JSON request body. Throws HttpError(400/413/415). */
export function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  const contentType = (event.headers?.['content-type'] ?? '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  if (!event.body) throw new HttpError(400, 'VALIDATION_ERROR', 'Request body is required');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request body must be valid JSON');
  }
}

/** Structured logger that never receives personal data – callers only pass ids and codes. */
export const log = {
  info: (msg: string, data: Record<string, unknown> = {}) => console.info(JSON.stringify({ level: 'INFO', msg, ...data })),
  warn: (msg: string, data: Record<string, unknown> = {}) => console.warn(JSON.stringify({ level: 'WARN', msg, ...data })),
  error: (msg: string, data: Record<string, unknown> = {}) =>
    console.error(JSON.stringify({ level: 'ERROR', msg, ...data })),
};

/** Wrap a handler so unexpected errors become a generic 500 without leaking internals. */
export function withErrorHandling(
  name: string,
  fn: (event: APIGatewayProxyEventV2) => Promise<HttpResult>,
): (event: APIGatewayProxyEventV2) => Promise<HttpResult> {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) {
        log.warn('request rejected', { handler: name, code: err.code, status: err.statusCode, requestId: event.requestContext?.requestId });
        return error(err.statusCode, err.code, err.message, err.details);
      }
      const e = err as Error;
      log.error('unhandled error', { handler: name, errorName: e?.name, errorMessage: e?.message, requestId: event.requestContext?.requestId });
      return error(500, 'INTERNAL_ERROR', 'An unexpected error occurred. Please try again.');
    }
  };
}
