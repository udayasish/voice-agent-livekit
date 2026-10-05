import { App } from "../src/app.js";
import { redis } from "../src/lib/redis.js";
import { pool } from "../src/lib/db/db.js";
import type { Server } from "node:http";

const TEST_PORT = 4005;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api/v1`;

let server: Server;

async function runTests() {
  console.log("==================================================");
  console.log("🧪 Running Phase 4 Authentication & Organization Tests");
  console.log("==================================================");

  const appInstance = new App();
  server = appInstance.listen(TEST_PORT);

  // Allow server and Redis to initialize
  await new Promise((resolve) => setTimeout(resolve, 1000));

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed++;
    } catch (err: unknown) {
      console.error(`❌ FAIL: ${name}`, err);
      failed++;
    }
  }

  try {
    let savedAccessToken = "";
    let savedRefreshToken = "";
    let savedAccessCookie = "";
    let savedRefreshCookie = "";
    let validOrgId = "";

    // Test 1: Successful Login
    await test("1. Successful Login - POST /api/v1/auth/login", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@brahmaputrahealth.com",
          password: "Password123!",
        }),
      });

      if (res.status !== 200) {
        throw new Error(`Expected status 200, got ${res.status}`);
      }

      const body = (await res.json()) as any;
      if (!body.success || !body.data?.user?.email) {
        throw new Error(`Response envelope failed: ${JSON.stringify(body)}`);
      }

      if (body.data.user.email !== "admin@brahmaputrahealth.com") {
        throw new Error(`Expected email admin@brahmaputrahealth.com, got ${body.data.user.email}`);
      }

      if (!Array.isArray(body.data.organizations) || body.data.organizations.length === 0) {
        throw new Error("Expected organizations array with at least 1 membership");
      }

      validOrgId = body.data.organizations[0].id;
      savedAccessToken = body.data.accessToken;

      // Extract cookies from Set-Cookie headers
      const setCookies = res.headers.getSetCookie();
      for (const cookie of setCookies) {
        if (cookie.startsWith("access_token=")) {
          savedAccessCookie = cookie.split(";")[0]!;
        }
        if (cookie.startsWith("refresh_token=")) {
          savedRefreshCookie = cookie.split(";")[0]!;
          savedRefreshToken = savedRefreshCookie.replace("refresh_token=", "");
        }
      }

      if (!savedAccessCookie || !savedRefreshCookie) {
        throw new Error("Expected both access_token and refresh_token Set-Cookie headers");
      }
    });

    // Test 2: Invalid Credentials
    await test("2. Invalid Credentials - POST /api/v1/auth/login with wrong password", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@brahmaputrahealth.com",
          password: "WrongPassword!",
        }),
      });

      if (res.status !== 401) {
        throw new Error(`Expected status 401, got ${res.status}`);
      }

      const body = (await res.json()) as any;
      if (body.success !== false || body.error?.code !== "UNAUTHORIZED") {
        throw new Error(`Expected UNAUTHORIZED error envelope, got: ${JSON.stringify(body)}`);
      }
    });

    // Test 3: Expired / Invalid Token
    await test("3. Expired / Invalid Token - GET /api/v1/me with invalid Bearer token", async () => {
      const res = await fetch(`${BASE_URL}/me`, {
        method: "GET",
        headers: {
          Authorization: "Bearer invalid.jwt.token",
        },
      });

      if (res.status !== 401) {
        throw new Error(`Expected status 401, got ${res.status}`);
      }

      const body = (await res.json()) as any;
      if (body.success !== false || body.error?.code !== "UNAUTHORIZED") {
        throw new Error(`Expected UNAUTHORIZED error envelope, got: ${JSON.stringify(body)}`);
      }
    });

    // Test 4: Protected API Access
    await test("4. Protected API Access - GET /api/v1/organizations (no token vs valid token)", async () => {
      // 4a: Without token -> 401
      const unauthRes = await fetch(`${BASE_URL}/organizations`, {
        method: "GET",
      });
      if (unauthRes.status !== 401) {
        throw new Error(`Expected status 401 without auth, got ${unauthRes.status}`);
      }

      // 4b: With cookie -> 200
      const cookieRes = await fetch(`${BASE_URL}/organizations`, {
        method: "GET",
        headers: {
          Cookie: savedAccessCookie,
        },
      });
      if (cookieRes.status !== 200) {
        throw new Error(`Expected status 200 with cookie auth, got ${cookieRes.status}`);
      }
      const cookieBody = (await cookieRes.json()) as any;
      if (!cookieBody.success || !Array.isArray(cookieBody.data)) {
        throw new Error(`Expected success envelope with array: ${JSON.stringify(cookieBody)}`);
      }

      // 4c: With Bearer header -> 200
      const bearerRes = await fetch(`${BASE_URL}/organizations`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${savedAccessToken}`,
        },
      });
      if (bearerRes.status !== 200) {
        throw new Error(`Expected status 200 with Bearer auth, got ${bearerRes.status}`);
      }
    });

    // Test 5: Unauthorized Organization Access
    await test("5. Unauthorized Organization Access - GET /api/v1/organizations/:id", async () => {
      // 5a: Accessing own organization -> 200
      const ownOrgRes = await fetch(`${BASE_URL}/organizations/${validOrgId}`, {
        method: "GET",
        headers: {
          Cookie: savedAccessCookie,
        },
      });
      if (ownOrgRes.status !== 200) {
        throw new Error(`Expected status 200 for member org, got ${ownOrgRes.status}`);
      }

      // 5b: Accessing unauthorized organization (random UUID or Guwahati Dental Clinic) -> 403
      const fakeOrgId = "00000000-0000-0000-0000-000000000000";
      const unauthorizedRes = await fetch(`${BASE_URL}/organizations/${fakeOrgId}`, {
        method: "GET",
        headers: {
          Cookie: savedAccessCookie,
        },
      });
      if (unauthorizedRes.status !== 403) {
        throw new Error(`Expected status 403 for unauthorized org, got ${unauthorizedRes.status}`);
      }
      const unauthBody = (await unauthorizedRes.json()) as any;
      if (unauthBody.success !== false || unauthBody.error?.code !== "FORBIDDEN") {
        throw new Error(`Expected FORBIDDEN error code, got: ${JSON.stringify(unauthBody)}`);
      }
    });

    // Test 6: Token Refresh (Rotation) and Logout
    await test("6. Token Refresh & Logout - POST /api/v1/auth/refresh and /auth/logout", async () => {
      // 6a: Refresh with cookie -> 200
      const refreshRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          Cookie: savedRefreshCookie,
        },
      });
      if (refreshRes.status !== 200) {
        throw new Error(`Expected status 200 on refresh, got ${refreshRes.status}`);
      }
      const refreshBody = (await refreshRes.json()) as any;
      if (!refreshBody.success || !refreshBody.data?.accessToken) {
        throw new Error(`Expected new access token: ${JSON.stringify(refreshBody)}`);
      }

      // Extract new cookies from rotated refresh
      let rotatedRefreshCookie = "";
      for (const cookie of refreshRes.headers.getSetCookie()) {
        if (cookie.startsWith("refresh_token=")) {
          rotatedRefreshCookie = cookie.split(";")[0]!;
        }
      }

      // Old refresh token must now be revoked (token rotation)
      const replayRes = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          Cookie: savedRefreshCookie,
        },
      });
      if (replayRes.status !== 401) {
        throw new Error(`Expected old rotated refresh token to be revoked (401), got ${replayRes.status}`);
      }

      // 6b: Logout -> 200
      const logoutRes = await fetch(`${BASE_URL}/auth/logout`, {
        method: "POST",
        headers: {
          Cookie: `${savedAccessCookie}; ${rotatedRefreshCookie}`,
        },
      });
      if (logoutRes.status !== 200) {
        throw new Error(`Expected status 200 on logout, got ${logoutRes.status}`);
      }

      // Verify clear-cookie headers
      const logoutCookies = logoutRes.headers.getSetCookie();
      const hasClearedAccess = logoutCookies.some((c) => c.includes("access_token=;") || c.includes("Max-Age=0") || c.includes("expires="));
      if (!hasClearedAccess) {
        throw new Error("Expected logout to clear cookies");
      }

      // 6c: Refresh after logout must fail
      const postLogoutRefresh = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: {
          Cookie: rotatedRefreshCookie,
        },
      });
      if (postLogoutRefresh.status !== 401) {
        throw new Error(`Expected 401 on refresh after logout, got ${postLogoutRefresh.status}`);
      }
    });

  } finally {
    server.close();
    await pool.end();
    if (redis.isOpen) {
      await redis.quit();
    }
  }

  console.log("==================================================");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
