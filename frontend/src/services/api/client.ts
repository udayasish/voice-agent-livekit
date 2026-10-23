import { env } from "../../lib/env";

export type ApiSuccess<T = unknown> = {
  success: true;
  data: T;
};

export type ApiErrorPayload = {
  success: false;
  error: {
    code: string;
    message: string;
  };
};

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiErrorPayload;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${env.apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    credentials: "include",
  });

  const body = (await response.json()) as ApiResponse<T>;

  if (!body.success) {
    throw new ApiError(
      body.error.message,
      body.error.code,
      response.status,
    );
  }

  return body.data;
}

let refreshInFlight: Promise<unknown> | null = null;

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, options);
  } catch (error) {
    // Auth endpoints must never refresh themselves or retry invalid credentials.
    if (!(error instanceof ApiError) || error.statusCode !== 401 || path.startsWith("/api/v1/auth/")) {
      throw error;
    }
    // Share token rotation between concurrent requests (including Strict Mode).
    if (!refreshInFlight) {
      refreshInFlight = request("/api/v1/auth/refresh", {
        method: "POST",
        body: "{}",
      }).finally(() => { refreshInFlight = null; });
    }
    await refreshInFlight;
    // Retry once only. A second 401 must reach the caller rather than loop.
    return request<T>(path, options);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

export async function apiPost<TBody, TData>(path: string, body: TBody): Promise<TData> {
  return apiRequest<TData>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function apiPatch<TBody, TData>(path: string, body: TBody): Promise<TData> {
  return apiRequest<TData>(path, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function apiDelete<TData>(path: string): Promise<TData> {
  return apiRequest<TData>(path, { method: "DELETE" });
}
