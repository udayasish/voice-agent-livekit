import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { AccessToken } from "livekit-server-sdk";
import { Room, RoomEvent, TrackKind, dispose } from "@livekit/rtc-node";
import env from "../src/lib/env.js";

describe("Phase 6 — LiveKit Server -> Agent -> Client End-to-End Test", () => {
  const roomName = `test-room-${Date.now().toString(36)}`;
  const clientIdentity = `client-tester-${Date.now().toString(36)}`;
  const livekitWsUrl = env.LIVEKIT_URL.replace(/^http/, "ws");

  it("dispatches room to agent worker and client receives agent audio track", async () => {
    // 1. Create client token with roomJoin and publish/subscribe grants
    const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
      identity: clientIdentity,
      name: "Browser Client Simulation",
      ttl: "5m",
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    const clientToken = await at.toJwt();

    // 2. Connect client room
    const clientRoom = new Room();

    let agentParticipantJoined = false;
    let agentAudioTrackSubscribed = false;

    const trackSubscribedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Timeout waiting for agent audio track. Agent joined: ${agentParticipantJoined}, Track subscribed: ${agentAudioTrackSubscribed}`,
          ),
        );
      }, 15000);

      clientRoom.on(RoomEvent.ParticipantConnected, (participant) => {
        // Agent participant detected
        agentParticipantJoined = true;
      });

      clientRoom.on(RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        if (track.kind === TrackKind.KIND_AUDIO) {
          agentAudioTrackSubscribed = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await clientRoom.connect(livekitWsUrl, clientToken);

    // If agent is already in room
    if (clientRoom.remoteParticipants.size > 0) {
      agentParticipantJoined = true;
    }

    // Wait for agent to join and publish its greeting track
    await trackSubscribedPromise;

    assert.ok(agentParticipantJoined, "Agent participant must join the room");
    assert.ok(agentAudioTrackSubscribed, "Client must receive agent's audio track subscription");

    // Cleanly disconnect client
    await clientRoom.disconnect();
  });

  after(async () => {
    await dispose();
  });
});
