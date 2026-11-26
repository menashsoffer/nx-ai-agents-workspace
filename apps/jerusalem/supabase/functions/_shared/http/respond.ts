// Responses shared by every Edge Function. The site calls the functions from
// another origin with a bearer token (no cookies), so a permissive CORS policy
// exposes nothing that the token itself does not already grant.

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

export function failure(error: string, status: number): Response {
  return json({ error }, status);
}

/** Answers a CORS preflight, or null when the request is not one. */
export function preflight(request: Request): Response | null {
  return request.method === 'OPTIONS'
    ? new Response(null, { status: 204, headers: CORS_HEADERS })
    : null;
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/iu.exec(header);
  return match?.[1] ?? null;
}

/** Reads a JSON object body, or null when the body is missing or not an object. */
export async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
