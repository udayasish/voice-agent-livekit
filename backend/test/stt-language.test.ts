import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTick } from "node:timers/promises";
import { getEventListeners } from "node:events";
import { ReadableStream } from "node:stream/web";
import { WebSocketServer } from "ws";
import { stt, normalizeLanguage } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { STT, type STTOptions } from "@livekit/agents-plugin-deepgram";
import { attachSTTToAudio, type ManagedSTTStream } from "../src/agent/stt.js";

const baseline = { language: "as", smartFormat: true, punctuate: true };
class FakeStream implements ManagedSTTStream {
  options: Partial<STTOptions> = {};
  frames: AudioFrame[] = [];
  closes = 0;
  private events: stt.SpeechEvent[] = [];
  private wake: (() => void) | undefined;
  updateOptions(options: Partial<STTOptions>) { this.options = { ...options }; }
  pushFrame(frame: AudioFrame) { this.frames.push(frame); }
  close() { this.closes++; this.wake?.(); }
  emit(text: string) {
    this.events.push({ type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      alternatives: [{ text, language: normalizeLanguage(String(this.options.language)), confidence: 1, startTime: 0, endTime: 1 }] });
    this.wake?.();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<stt.SpeechEvent> {
    while (!this.closes || this.events.length) {
      const event = this.events.shift();
      if (event) yield event;
      else await new Promise<void>(resolve => { this.wake = resolve; });
    }
  }
}
function audioFixture() {
  let push!: (frame: AudioFrame) => void;
  let cancelled = 0;
  const audio = new ReadableStream<AudioFrame>({ start: controller => { push = frame => controller.enqueue(frame); }, cancel: () => { cancelled++; } });
  return { audio, push, get cancelled() { return cancelled; } };
}
function fakeProvider() {
  const streams: FakeStream[] = [];
  return { streams, stream() { const stream = new FakeStream(); streams.push(stream); return stream; } };
}
const frame = () => new AudioFrame(new Int16Array(320), 16000, 1, 320);

describe("Participant STT language switching", () => {
  it("changes only one participant to English digits and restores Assamese confirmation", async () => {
    const provider = fakeProvider(); const a = audioFixture(); const b = audioFixture();
    const modes: string[] = []; const texts: string[] = [];
    const first = attachSTTToAudio(provider, a.audio, { onInputModeChanged: (mode, language) => modes.push(`${mode}:${language}`),
      onFinalTranscript: event => { texts.push(event.alternatives?.[0]?.text ?? ""); } }, undefined, baseline);
    const second = attachSTTToAudio(provider, b.audio, {}, undefined, baseline);
    first.setInputMode("english-digits"); first.setInputMode("english-digits");
    assert.equal(provider.streams.length, 3);
    assert.deepEqual(provider.streams[2]?.options, { language: "en-IN", numerals: true, smartFormat: false, punctuate: false });
    assert.equal(second.inputMode, "conversation"); assert.equal(provider.streams[1]?.options.language, "as");
    first.setInputMode("conversation");
    assert.deepEqual(provider.streams[3]?.options, { ...baseline, numerals: false });
    provider.streams[3]?.emit("হয় শুদ্ধ"); await nextTick();
    assert.deepEqual(texts, ["হয় শুদ্ধ"]);
    assert.deepEqual(modes, ["english-digits:en-IN", "conversation:as"]);
    first.close(); second.close(); await nextTick();
    assert.equal(a.cancelled, 1); assert.equal(b.cancelled, 1);
  });
  it("keeps a single audio reader and routes new frames to the replacement", async () => {
    const provider = fakeProvider(); const audio = audioFixture();
    const subscription = attachSTTToAudio(provider, audio.audio, {}, undefined, baseline);
    const oldFrame = frame(); const newFrame = frame();
    audio.push(oldFrame); await nextTick();
    subscription.setInputMode("english-digits"); audio.push(newFrame); await nextTick();
    assert.deepEqual(provider.streams[0]?.frames, [oldFrame]);
    assert.deepEqual(provider.streams[1]?.frames, [newFrame]);
    assert.equal(audio.cancelled, 0); assert.equal(provider.streams[0]?.closes, 1);
    subscription.close(); await nextTick(); assert.equal(audio.cancelled, 1);
  });
  it("ignores already queued transcripts from a superseded recognizer", async () => {
    const provider = fakeProvider(); const audio = audioFixture(); const texts: string[] = [];
    const subscription = attachSTTToAudio(provider, audio.audio, { onFinalTranscript: event => { texts.push(event.alternatives?.[0]?.text ?? ""); } }, undefined, baseline);
    provider.streams[0]?.emit("old transcript");
    subscription.setInputMode("english-digits"); provider.streams[1]?.emit("seven zero"); await nextTick();
    assert.deepEqual(texts, ["seven zero"]);
    subscription.close(); await nextTick();
  });
  it("cleans up after abort and ignores mode updates after close", async () => {
    const provider = fakeProvider(); const audio = audioFixture(); const abort = new AbortController();
    const subscription = attachSTTToAudio(provider, audio.audio, {}, abort.signal, baseline);
    assert.equal(getEventListeners(abort.signal, "abort").length, 1);
    subscription.setInputMode("english-digits"); abort.abort(); subscription.close(); subscription.setInputMode("conversation");
    await nextTick(); assert.equal(provider.streams.length, 2); assert.equal(audio.cancelled, 1);
    assert.equal(getEventListeners(abort.signal, "abort").length, 0);
  });
  it("uses the real Deepgram SDK with English request parameters and Assamese restoration", async () => {
    const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await new Promise<void>(resolve => server.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const connections: URL[] = [];
    server.on("connection", (socket, request) => {
      const url = new URL(request.url ?? "/", "http://localhost"); connections.push(url);
      let answered = false;
      socket.on("message", (_data, binary) => {
        if (!binary || answered) return;
        answered = true;
        const transcript = url.searchParams.get("language") === "en-IN" ? "7 double 0 2 0 5 9 5 double 4" : "হয় শুদ্ধ";
        socket.send(JSON.stringify({ type: "Results", metadata: { request_id: "offline-test" }, is_final: true, speech_final: true,
          start: 0, duration: 0.1, channel: { alternatives: [{ transcript, confidence: 1, words: [] }] } }));
      });
    });
    const provider = new STT({ apiKey: "offline-test", baseUrl: `ws://127.0.0.1:${address.port}`, language: "as", model: "nova-3" });
    const audio = audioFixture(); const received: string[] = [];
    const subscription = attachSTTToAudio(provider, audio.audio, { onFinalTranscript: event => { received.push(event.alternatives?.[0]?.text ?? ""); } }, undefined, baseline);
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) { if (Date.now() > deadline) assert.fail("SDK stream did not produce the expected event"); await new Promise(resolve => setTimeout(resolve, 10)); }
    };
    try {
      await waitFor(() => connections.length === 1);
      subscription.setInputMode("english-digits");
      for (let i = 0; i < 5; i++) audio.push(frame());
      await waitFor(() => received.length === 1);
      assert.equal(connections[1]?.searchParams.get("language"), "en-IN");
      assert.equal(connections[1]?.searchParams.get("numerals"), "true");
      assert.equal(connections[1]?.searchParams.get("smart_format"), "false");
      assert.equal(received[0], "7 double 0 2 0 5 9 5 double 4");
      subscription.setInputMode("conversation");
      for (let i = 0; i < 5; i++) audio.push(frame());
      await waitFor(() => received.length === 2);
      assert.equal(connections[2]?.searchParams.get("language"), "as");
      assert.equal(received[1], "হয় শুদ্ধ");
    } finally {
      subscription.close(); await provider.close();
      for (const client of server.clients) client.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
