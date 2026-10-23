import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../src/middleware";
import { apiGet, apiPost, ApiError } from "../src/services/api/client";

const unauthorized = () => Response.json({ success: false, error: { code: "UNAUTHORIZED", message: "Session expired" } }, { status: 401 });
const success = (data: unknown) => Response.json({ success: true, data });

test("login remains reachable with stale or revoked cookies", () => {
  const result = middleware(new NextRequest("http://localhost:3000/login", {
    headers: { cookie: "access_token=expired; refresh_token=revoked" },
  }));
  assert.equal(result.headers.get("location"), null);
});

test("protected routes without cookies redirect to login; cookies still require API verification", () => {
  assert.equal(middleware(new NextRequest("http://localhost:3000/agents")).headers.get("location"), "http://localhost:3000/login");
  assert.equal(middleware(new NextRequest("http://localhost:3000/agents", {
    headers: { cookie: "refresh_token=unverified" },
  })).headers.get("location"), null);
});

test("valid session loads without token rotation", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => success({ user: "staff" }));
  assert.deepEqual(await apiGet("/api/v1/me"), { user: "staff" });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("expired access session refreshes cookies and retries the original request", async (t) => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, options?: RequestInit) => {
    paths.push(String(url));
    assert.equal(options?.credentials, "include");
    if (paths.length === 1) return unauthorized();
    return success(paths.length === 2 ? {} : { user: "staff" });
  });
  assert.deepEqual(await apiGet("/api/v1/me"), { user: "staff" });
  assert.deepEqual(paths.map((url) => new URL(url).pathname), ["/api/v1/me", "/api/v1/auth/refresh", "/api/v1/me"]);
});

test("concurrent expired requests share one refresh-token rotation", async (t) => {
  let refreshed = false;
  let rotations = 0;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (String(url).endsWith("/auth/refresh")) {
      rotations++;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      refreshed = true;
      return success({});
    }
    return refreshed ? success({ ok: true }) : unauthorized();
  });
  await Promise.all([apiGet("/api/v1/me"), apiGet("/api/v1/me")]);
  assert.equal(rotations, 1);
});

test("revoked refresh fails cleanly and permits a later fresh attempt", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => unauthorized());
  await assert.rejects(apiGet("/api/v1/me"), (error: unknown) => error instanceof ApiError && error.statusCode === 401);
  assert.equal(mock.mock.callCount(), 2);
  await assert.rejects(apiGet("/api/v1/me"), ApiError);
  assert.equal(mock.mock.callCount(), 4);
});

test("a second unauthorized response cannot cause an endless refresh loop", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 2 ? success({}) : unauthorized());
  await assert.rejects(apiGet("/api/v1/me"), ApiError);
  assert.equal(calls, 3);
});

test("invalid login credentials never trigger refresh", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => unauthorized());
  await assert.rejects(apiPost("/api/v1/auth/login", {}), ApiError);
  assert.equal(mock.mock.callCount(), 1);
});

test("network and server failures do not rotate tokens or pretend the session expired", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network unavailable"); });
  await assert.rejects(apiGet("/api/v1/me"), TypeError);
  assert.equal(mock.mock.callCount(), 1);
  mock.mock.mockImplementation(async () => Response.json({ success: false, error: { code: "INTERNAL_ERROR", message: "Please retry" } }, { status: 500 }));
  await assert.rejects(apiGet("/api/v1/me"), (error: unknown) => error instanceof ApiError && error.statusCode === 500);
  assert.equal(mock.mock.callCount(), 2);
});
