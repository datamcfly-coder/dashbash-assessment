// Shared helpers for the reporting API. Keeps every route thin and guarantees
// the two things all four endpoints must do: never cache (numbers are always
// live) and use a consistent error shape.

/** JSON response that is never cached. */
export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init?.headers },
  });
}

/** Consistent error body: `{ error, ...extra }` with the given status. */
export function apiError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...extra }, { status });
}
