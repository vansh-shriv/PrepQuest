import type { LoginResponse } from "@prepquest/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /** Per-field validation messages from a 422 response, keyed by field name. */
  get fields(): Record<string, string> {
    const d = this.details as { fields?: Record<string, string>; field?: string } | undefined;
    if (d?.fields) return d.fields;
    if (d?.field) return { [d.field]: this.message };
    return {};
  }
}

// The access token lives only in memory (never localStorage). The refresh cookie is httpOnly.
let accessToken: string | null = null;
let inflightRefresh: Promise<LoginResponse | null> | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

async function request(path: string, init: RequestInit & { json?: unknown }): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.json !== undefined) headers.set("content-type", "application/json");
  if (accessToken && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${accessToken}`);
  }
  return fetch(`${API_URL}/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
}

async function toError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as {
      error?: { code: string; message: string; details?: unknown };
    };
    if (body.error)
      return new ApiError(res.status, body.error.code, body.error.message, body.error.details);
  } catch {
    /* non-JSON error body */
  }
  return new ApiError(res.status, "UNKNOWN", `Request failed (${res.status})`);
}

/**
 * Exchanges the refresh cookie for a new access token. Concurrent callers share one request, which
 * matters because refresh tokens rotate and a second parallel use would look like token theft.
 */
export function refreshSession(): Promise<LoginResponse | null> {
  inflightRefresh ??= (async () => {
    try {
      const res = await request("/auth/refresh", { method: "POST", json: {} });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const body = (await res.json()) as LoginResponse;
      accessToken = body.accessToken;
      return body;
    } catch {
      return null; // network error: stay signed out for now
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  json?: unknown;
}

/** JSON API call. Retries once after a silent token refresh when the access token has expired. */
export async function api<T = void>(path: string, options: ApiOptions = {}): Promise<T> {
  const send = () => request(path, { method: options.method ?? "GET", json: options.json });
  let res = await send();
  if (res.status === 401 && accessToken && !path.startsWith("/auth/")) {
    if (await refreshSession()) res = await send();
  }
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
