import type { Server } from "node:http";
import * as jose from "jose";
import { App } from "../src/app.js";
import { redis } from "../src/lib/redis.js";
import { pool } from "../src/lib/db/db.js";
import env from "../src/lib/env.js";

const TEST_PORT = 4006;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}/api/v1`;

let server: Server;

async function runTests() {
  console.log("==================================================");
  console.log("🧪 Running Phase 5 LiveKit Token Integration Tests");
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
    let validOrgId = "";

    // Setup: Log in to get credentials
    await test("0. Setup - Authenticate Admin User", async () => {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "admin@brahmaputrahealth.com",
          password: "Password123!",
        }),
      });

      if (res.status !== 200) {
        throw new Error(`Login failed with status ${res.status}`);
      }

      const body = (await res.json()) as {
        success: boolean;
        data: { accessToken: string; organizations: Array<{ id: string }> };
      };
      if (!body.success || !body.data.accessToken) {
        throw new Error("Failed to extract access token from login");
      }

      savedAccessToken = body.data.accessToken;
      validOrgId = body.data.organizations[0]!.id;
    });

    // Test 1: Reject unauthenticated request
    await test("1. Rejection of Unauthenticated Request - POST /api/v1/livekit/token", async () => {
      const res = await fetch(`${BASE_URL}/livekit/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (res.status !== 401) {
        throw new Error(`Expected status 401, got ${res.status}`);
      }

      const body = (await res.json()) as { success: boolean; error: { code: string } };
      if (body.success || body.error.code !== "UNAUTHORIZED") {
        throw new Error(`Expected UNAUTHORIZED error code, got: ${JSON.stringify(body)}`);
      }
    });

    // Test 2: Reject request without x-organization-id header
    await test("2. Rejection of Request Missing Organization Header", async () => {
      const res = await fetch(`${BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedAccessToken}`,
        },
        body: JSON.stringify({}),
      });

      if (res.status !== 400) {
        throw new Error(`Expected status 400, got ${res.status}`);
      }

      const body = (await res.json()) as { success: boolean; error: { code: string } };
      if (body.success || body.error.code !== "MISSING_ORGANIZATION_ID") {
        throw new Error(`Expected MISSING_ORGANIZATION_ID code, got: ${JSON.stringify(body)}`);
      }
    });

    // Test 3: Reject unauthorized organization ID
    await test("3. Rejection of Unauthorized Organization ID", async () => {
      const res = await fetch(`${BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedAccessToken}`,
          "x-organization-id": "00000000-0000-0000-0000-000000000000",
        },
        body: JSON.stringify({}),
      });

      if (res.status !== 403) {
        throw new Error(`Expected status 403, got ${res.status}`);
      }

      const body = (await res.json()) as { success: boolean; error: { code: string } };
      if (body.success || body.error.code !== "FORBIDDEN") {
        throw new Error(`Expected FORBIDDEN code, got: ${JSON.stringify(body)}`);
      }
    });

    // Test 4: Reject invalid agent ID format (empty string)
    await test("4. Rejection of Invalid Agent ID Format (Zod validation)", async () => {
      const res = await fetch(`${BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedAccessToken}`,
          "x-organization-id": validOrgId,
        },
        body: JSON.stringify({
          agentId: "",
        }),
      });

      if (res.status !== 400) {
        throw new Error(`Expected status 400 for empty agentId, got ${res.status}`);
      }
    });

    // Test 5: Successful token generation with default options
    let generatedToken = "";
    let generatedRoomName = "";
    await test("5. Successful LiveKit Token Generation with Defaults", async () => {
      const res = await fetch(`${BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedAccessToken}`,
          "x-organization-id": validOrgId,
        },
        body: JSON.stringify({}),
      });

      if (res.status !== 200) {
        throw new Error(`Expected status 200, got ${res.status}`);
      }

      const body = (await res.json()) as {
        success: boolean;
        data: {
          token: string;
          url: string;
          roomName: string;
          participantIdentity: string;
          participantName: string;
        };
      };

      if (!body.success || !body.data.token) {
        throw new Error(`Failed to generate token: ${JSON.stringify(body)}`);
      }

      generatedToken = body.data.token;
      generatedRoomName = body.data.roomName;

      if (!body.data.url) {
        throw new Error("Expected LiveKit URL in response data");
      }
      if (!body.data.roomName.startsWith("room-")) {
        throw new Error(`Unexpected room name prefix: ${body.data.roomName}`);
      }
      if (!body.data.participantIdentity.startsWith("user-")) {
        throw new Error(`Unexpected identity prefix: ${body.data.participantIdentity}`);
      }
    });

    // Test 6: Verify JWT Claims and Video Grants
    await test("6. Cryptographic Token Verification & Video Grants", async () => {
      const claims = jose.decodeJwt(generatedToken) as {
        iss: string;
        sub: string;
        video: {
          room: string;
          roomJoin: boolean;
          canPublish: boolean;
          canSubscribe: boolean;
          canPublishData: boolean;
        };
        metadata: string;
      };

      if (claims.iss !== env.LIVEKIT_API_KEY) {
        throw new Error(`Expected issuer ${env.LIVEKIT_API_KEY}, got ${claims.iss}`);
      }
      if (claims.video.room !== generatedRoomName) {
        throw new Error(`Expected room grant ${generatedRoomName}, got ${claims.video.room}`);
      }
      if (claims.video.roomJoin !== true) {
        throw new Error("Expected roomJoin: true");
      }
      if (claims.video.canPublish !== true) {
        throw new Error("Expected canPublish: true");
      }
      if (claims.video.canSubscribe !== true) {
        throw new Error("Expected canSubscribe: true");
      }

      const metadata = JSON.parse(claims.metadata) as { organizationId: string; userId: string };
      if (metadata.organizationId !== validOrgId) {
        throw new Error(`Metadata organizationId mismatch: expected ${validOrgId}, got ${metadata.organizationId}`);
      }
    });

    // Test 7: Custom room name and participant name
    await test("7. Successful Token Generation with Custom Room & Participant", async () => {
      const customRoom = "opd-custom-testing-room";
      const customParticipant = "Dr. Phukan";
      const customAgentId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

      const res = await fetch(`${BASE_URL}/livekit/token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${savedAccessToken}`,
          "x-organization-id": validOrgId,
        },
        body: JSON.stringify({
          roomName: customRoom,
          participantName: customParticipant,
          agentId: customAgentId,
        }),
      });

      if (res.status !== 200) {
        throw new Error(`Expected status 200, got ${res.status}`);
      }

      const body = (await res.json()) as {
        success: boolean;
        data: {
          token: string;
          roomName: string;
          participantName: string;
        };
      };

      if (body.data.roomName !== customRoom) {
        throw new Error(`Expected room ${customRoom}, got ${body.data.roomName}`);
      }
      if (body.data.participantName !== customParticipant) {
        throw new Error(`Expected participant ${customParticipant}, got ${body.data.participantName}`);
      }

      const claims = jose.decodeJwt(body.data.token) as {
        video: { room: string };
        name: string;
        metadata: string;
      };

      if (claims.video.room !== customRoom) {
        throw new Error(`Claim room mismatch: ${claims.video.room}`);
      }
      if (claims.name !== customParticipant) {
        throw new Error(`Claim name mismatch: ${claims.name}`);
      }

      const metadata = JSON.parse(claims.metadata) as { agentId: string };
      if (metadata.agentId !== customAgentId) {
        throw new Error(`Expected agentId ${customAgentId} in metadata, got ${metadata.agentId}`);
      }
    });
  } finally {
    console.log("==================================================");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("==================================================");

    server.close();
    await redis.quit();
    await pool.end();

    if (failed > 0) {
      process.exit(1);
    }
  }
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
