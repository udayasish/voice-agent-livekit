import { defineAgent, type JobContext, WorkerOptions, cli } from "@livekit/agents";
import { RoomEvent } from "@livekit/rtc-node";
import { fileURLToPath } from "node:url";
import path from "node:path";
import env from "../lib/env.js";
import { playDeterministicGreeting } from "./greeting.js";
import { logLifecycle, registerShutdownHandlers } from "./lifecycle.js";

/**
 * Node.js LiveKit Agent definition.
 * Connects to dispatched rooms and plays a deterministic audio greeting
 * to prove server-to-browser WebRTC audio streaming.
 */
const agent = defineAgent({
  entry: async (ctx: JobContext) => {
    const targetRoomName = ctx.job?.room?.name ?? ctx.room.name ?? "unnamed-room";
    const jobId = ctx.job?.id;

    logLifecycle("job_assigned", `Worker assigned job for room: ${targetRoomName}`, {
      jobId,
      roomName: targetRoomName,
    });

    // Step 1: Connect to the room
    logLifecycle("room_connecting", `Connecting to room: ${targetRoomName}...`, {
      jobId,
      roomName: targetRoomName,
    });

    await ctx.connect();

    const roomName = ctx.room.name || targetRoomName;
    const localIdentity = ctx.room.localParticipant?.identity ?? "agent-assistant";
    const initialParticipantsCount = ctx.room.remoteParticipants.size;

    logLifecycle(
      "room_connected",
      `Agent connected to room '${roomName}' as participant '${localIdentity}' with ${initialParticipantsCount} existing remote participant(s)`,
      {
        jobId,
        roomName,
        participantIdentity: localIdentity,
        participantsCount: initialParticipantsCount,
      },
    );

    // Register room lifecycle listeners
    ctx.room.on(RoomEvent.ParticipantConnected, (participant) => {
      logLifecycle(
        "participant_joined",
        `Remote participant connected: ${participant.identity} (${participant.name || "unnamed"})`,
        {
          roomName: ctx.room.name,
          participantIdentity: participant.identity,
          participantName: participant.name,
          participantsCount: ctx.room.remoteParticipants.size,
        },
      );
    });

    ctx.room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      logLifecycle(
        "participant_left",
        `Remote participant disconnected: ${participant.identity}`,
        {
          roomName: ctx.room.name,
          participantIdentity: participant.identity,
          participantsCount: ctx.room.remoteParticipants.size,
        },
      );
    });

    ctx.room.on(RoomEvent.Disconnected, () => {
      logLifecycle("room_disconnected", `Room '${ctx.room.name}' was disconnected`, {
        roomName: ctx.room.name,
      });
    });

    // Step 2: Ensure a remote participant is present before streaming greeting
    if (ctx.room.remoteParticipants.size === 0) {
      logLifecycle(
        "greeting_started",
        `Waiting for remote user participant to join room '${roomName}'...`,
        { roomName },
      );
      await ctx.waitForParticipant();
    }

    // Step 3: Stream deterministic harmonic greeting chime into the room
    try {
      logLifecycle("greeting_started", `Streaming deterministic greeting chime in room '${roomName}'`, {
        roomName,
        participantsCount: ctx.room.remoteParticipants.size,
      });

      await playDeterministicGreeting(ctx);

      logLifecycle(
        "greeting_completed",
        `Deterministic greeting successfully streamed to room '${roomName}'`,
        {
          roomName,
        },
      );
    } catch (error) {
      logLifecycle(
        "agent_error",
        `Failed to play deterministic greeting: ${error instanceof Error ? error.message : String(error)}`,
        {
          roomName,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  },
});

export default agent;

// Register process signal handlers for clean shutdown
registerShutdownHandlers(async (signal) => {
  logLifecycle("worker_shutdown", `Agent worker process cleanly terminated on ${signal}`, { signal });
});

// Run CLI worker if invoked directly
const currentFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (
  invokedFile &&
  (invokedFile === currentFile ||
    invokedFile.endsWith("src\\agent\\index.ts") ||
    invokedFile.endsWith("src/agent/index.ts") ||
    invokedFile.endsWith("dist\\agent\\index.js") ||
    invokedFile.endsWith("dist/agent/index.js"))
) {
  const wsURL = env.LIVEKIT_URL.replace(/^http/, "ws");
  logLifecycle("worker_started", "Starting LiveKit Agent worker process", {
    wsURL,
    agentName: env.LIVEKIT_AGENT_NAME || "(all rooms)",
  });

  cli.runApp(
    new WorkerOptions({
      agent: currentFile,
      wsURL,
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      agentName: env.LIVEKIT_AGENT_NAME || "",
      requestFunc: async (jobRequest) => {
        await jobRequest.accept("Assamese Voice Assistant", "agent-assistant");
      },
    }),
  );
}
