export const env = {
  apiUrl: process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:4000",
  livekitUrl: process.env["NEXT_PUBLIC_LIVEKIT_URL"] ?? "ws://localhost:7880",
} as const;
