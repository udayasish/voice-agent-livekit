import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTick } from "node:timers/promises";
import { getEventListeners } from "node:events";
import { ReadableStream } from "node:stream/web";
import { WebSocketServer } from "ws";
import { stt, normalizeLanguage } from "@livekit/agents";
import { AudioFrame } from "@livekit/rtc-node";
import { STT, type STTOptions } from "@livekit/agents-plugin-deepgram";
import { attachSTTToAudio, conversationRecognitionLanguage, type ManagedSTTStream } from "../src/agent/stt.js";
import type { TranscriptAudioRange } from "../src/agent/turn-collector.js";

const baseline = { language: "as", smartFormat: true, punctuate: true };
class FakeStream implements ManagedSTTStream {
  options: Partial<STTOptions> = {};
  frames: AudioFrame[] = [];
  closes = 0;
  flushes = 0;
  private events: stt.SpeechEvent[] = [];
  private wake: (() => void) | undefined;
  updateOptions(options: Partial<STTOptions>) { this.options = { ...options }; }
  pushFrame(frame: AudioFrame) { this.frames.push(frame); }
  flush() { this.flushes++; }
  close() { this.closes++; this.wake?.(); }
  emit(text: string) {
    this.events.push({ type: stt.SpeechEventType.FINAL_TRANSCRIPT,
      alternatives: [{ text, language: normalizeLanguage(String(this.options.language)), confidence: 1, startTime: 0, endTime: 1 }] });
    this.wake?.();
  }
  endInput() { this.emit("আগৰ নম্বৰটো শুদ্ধ"); this.close(); }
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
  it("keeps experimental multilingual recognition across ordinary replies and restores it after a critical confirmation", async () => {
    const provider = fakeProvider(), audio = audioFixture();
    const subscription = attachSTTToAudio(provider, audio.audio, {}, undefined, { ...baseline, language: "multi" });
    const next = (language: string, critical = false) => subscription.setInputMode("conversation", conversationRecognitionLanguage(language, critical, "multi"));
    try {
      next("as"); next("hi"); next("en");
      assert.equal(provider.streams.length, 1);
      assert.equal(provider.streams[0]?.options.language, "multi");
      subscription.setInputMode("english-digits", conversationRecognitionLanguage("as", false, "multi"));
      assert.equal(provider.streams[1]?.options.language, "en-IN");
      next("as", true);
      assert.equal(provider.streams[2]?.options.language, "as");
      next("as");
      assert.equal(provider.streams[3]?.options.language, "multi");
      assert.equal(conversationRecognitionLanguage("hi", false, "as"), "hi");
      assert.equal(conversationRecognitionLanguage("as", true, "as"), "as");
    } finally { subscription.close(); await nextTick(); }
  });
  it("uses the trusted confirmation language within multi and restores baseline without duplicate streams", async () => {
    const provider = fakeProvider(), audio = audioFixture(), modes: string[] = [];
    const subscription = attachSTTToAudio(provider, audio.audio, { onInputModeChanged: (mode, language) => modes.push(`${mode}:${language}`) },
      undefined, { ...baseline, language: "multi" });
    try {
      assert.equal(provider.streams[0]?.options.language, "multi");
      subscription.setInputMode("english-digits", "as");
      assert.equal(provider.streams[1]?.options.language, "en-IN");
      subscription.setInputMode("conversation", "as"); subscription.setInputMode("conversation", "as");
      assert.equal(provider.streams[2]?.options.language, "as"); assert.equal(provider.streams.length, 3);
      subscription.setInputMode("conversation");
      assert.equal(provider.streams[3]?.options.language, "multi"); assert.equal(provider.streams[2]?.closes, 1);
      subscription.setInputMode("conversation", "hi");
      assert.equal(provider.streams[4]?.options.language, "hi");
      assert.deepEqual(modes, ["english-digits:en-IN", "conversation:as", "conversation:multi", "conversation:hi"]);
    } finally { subscription.close(); }
  });
  it("reports first audio readiness once and finalizes without closing or replacing the recognizer", async () => {
    const provider = fakeProvider(), audio = audioFixture(); let ready = 0;
    const texts: string[] = [];
    const subscription = attachSTTToAudio(provider, audio.audio, { onAudioReady: () => { ready++; },
      onFinalTranscript: event => { texts.push(event.alternatives?.[0]?.text ?? ""); } }, undefined, baseline);
    try {
      assert.equal(ready, 0);
      audio.push(frame()); audio.push(frame()); await nextTick();
      assert.equal(ready, 1);
      subscription.requestFinalTranscript();
      assert.equal(provider.streams[0]?.flushes, 1); assert.equal(provider.streams[0]?.closes, 0);
      provider.streams[0]?.emit("হেল্ল'"); await nextTick();
      assert.deepEqual(texts, ["হেল্ল'"]); assert.equal(provider.streams.length, 1);
      audio.push(frame()); await nextTick(); assert.equal(ready, 1);
    } finally { subscription.close(); await nextTick(); }
    subscription.requestFinalTranscript(); assert.equal(provider.streams[0]?.flushes, 1);
  });
  it("keeps word timing on one audio timeline when recognizers restart", async () => {
    const provider = fakeProvider(), audio = audioFixture(), ranges: Array<TranscriptAudioRange | undefined> = [];
    const subscription = attachSTTToAudio(provider, audio.audio, {
      onFinalTranscript: (_event, _latency, range) => { ranges.push(range); },
    }, undefined, baseline);
    try {
      audio.push(frame()); audio.push(frame()); await nextTick();
      provider.streams[0]?.emit("hello"); await nextTick();
      subscription.setInputMode("english-digits");
      audio.push(frame()); await nextTick(); provider.streams[1]?.emit("seven"); await nextTick();
      subscription.setInputMode("conversation");
      provider.streams[2]?.emit("হয়"); await nextTick();
      assert.deepEqual(ranges, [{ startMs: 0, endMs: 1000 }, { startMs: 40, endMs: 1040 }, { startMs: 60, endMs: 1060 }]);
    } finally { subscription.close(); await nextTick(); }
  });
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
  for (const language of ["as", "multi"]) {
    it(`uses the real Deepgram SDK with English digits and restores ${language}`, async () => {
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
      const provider = new STT({ apiKey: "offline-test", baseUrl: `ws://127.0.0.1:${address.port}`, language, model: "nova-3" });
      const audio = audioFixture(); const received: string[] = [];
      const subscription = attachSTTToAudio(provider, audio.audio, { onFinalTranscript: event => { received.push(event.alternatives?.[0]?.text ?? ""); } }, undefined, { ...baseline, language });
      const waitFor = async (predicate: () => boolean) => {
        const deadline = Date.now() + 5000;
        while (!predicate()) { if (Date.now() > deadline) assert.fail("SDK stream did not produce the expected event"); await new Promise(resolve => setTimeout(resolve, 10)); }
      };
      try {
        await waitFor(() => connections.length === 1);
        assert.equal(connections[0]?.searchParams.get("language"), language);
        if (language === "multi") {
          const ordinaryStream = subscription.stream;
          subscription.setInputMode("conversation", conversationRecognitionLanguage("as", false, language));
          assert.equal(subscription.stream, ordinaryStream);
        }
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
        assert.equal(connections[2]?.searchParams.get("language"), language);
        assert.equal(received[1], "হয় শুদ্ধ");
        if (language === "multi") {
          subscription.setInputMode("conversation", conversationRecognitionLanguage("as", true, language));
          for (let i = 0; i < 5; i++) audio.push(frame());
          await waitFor(() => received.length === 3);
          assert.equal(connections[3]?.searchParams.get("language"), "as");
          subscription.setInputMode("conversation", conversationRecognitionLanguage("as", false, language));
          for (let i = 0; i < 5; i++) audio.push(frame());
          await waitFor(() => received.length === 4);
          assert.equal(connections[4]?.searchParams.get("language"), "multi");
        }
      } finally {
        subscription.close(); await provider.close();
        for (const client of server.clients) client.terminate();
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });
  }
});


describe("Bounded conversation-language recognition recovery", () => {
  it("replays copied digit-mode PCM once without replacing the live recognizer or duplicating callbacks", async () => {
    const provider = fakeProvider(), audio = audioFixture(), live: string[] = [];
    const subscription = attachSTTToAudio(provider, audio.audio, { onFinalTranscript: e => { live.push(e.alternatives?.[0]?.text ?? ""); } }, undefined, baseline);
    try {
      subscription.setInputMode("english-digits"); audio.push(frame()); audio.push(frame()); await nextTick();
      const digitStream = subscription.stream;
      const result = await subscription.recoverSpeech({ startMs: 0, endMs: 40 }, new AbortController().signal);
      assert.equal(result?.text, "আগৰ নম্বৰটো শুদ্ধ"); assert.equal(result?.language, "as");
      assert.equal(provider.streams[2]?.options.language, "as"); assert.equal(provider.streams[2]?.frames.length, 2);
      assert.equal(subscription.stream, digitStream); assert.equal(subscription.inputMode, "english-digits"); assert.equal(audio.cancelled, 0);
      assert.deepEqual(live, []);
      assert.equal(await subscription.recoverSpeech({ startMs: 0, endMs: 40 }, new AbortController().signal), undefined);
      assert.equal(provider.streams.length, 3);
      audio.push(frame()); await nextTick(); assert.equal(provider.streams[1]?.frames.length, 3);
    } finally { subscription.close(); }
  });
  it("rejects absent/truncated PCM and aborts pending replay without closing the track", async () => {
    const provider = fakeProvider(), audio = audioFixture();
    const subscription = attachSTTToAudio(provider, audio.audio, {}, undefined, baseline);
    try {
      subscription.setInputMode("english-digits"); audio.push(frame()); await nextTick();
      assert.equal(await subscription.recoverSpeech({ startMs: 0, endMs: 100 }, new AbortController().signal), undefined);
      audio.push(frame()); await nextTick();
      const controller = new AbortController();
      const pending = subscription.recoverSpeech({ startMs: 0, endMs: 40 }, controller.signal); controller.abort();
      await assert.rejects(pending, { name: "AbortError" });
      assert.equal(audio.cancelled, 0); assert.ok(provider.streams[2]?.closes);
    } finally { subscription.close(); }
  });
  it("clears retained PCM when discarded or closed", async () => {
    const provider = fakeProvider(), audio = audioFixture();
    const subscription = attachSTTToAudio(provider, audio.audio, {}, undefined, baseline);
    subscription.setInputMode("english-digits"); audio.push(frame()); await nextTick(); subscription.discardRecoveryAudio();
    assert.equal(await subscription.recoverSpeech({ startMs: 0, endMs: 20 }, new AbortController().signal), undefined);
    subscription.close(); assert.equal(await subscription.recoverSpeech({ startMs: 0, endMs: 40 }, new AbortController().signal), undefined);
  });
});


it("replays digit audio through the real Deepgram SDK into a separate Assamese WebSocket", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); if (!address || typeof address === "string") assert.fail("Missing local address");
  const connections: URL[] = [];
  server.on("connection", (socket, request) => {
    connections.push(new URL(request.url!, "http://localhost"));
    socket.on("message", (bytes, binary) => {
      if (binary) return;
      const message = JSON.parse(bytes.toString()) as { type?: string };
      if (message.type === "CloseStream") {
        socket.send(JSON.stringify({ type: "Results", metadata: { request_id: "offline-replay" }, is_final: true, speech_final: true,
          start: 0, duration: 0.1, channel: { alternatives: [{ transcript: "আগৰ নম্বৰটো শুদ্ধ", confidence: 1, words: [] }] } }));
        socket.close();
      }
    });
  });
  const provider = new STT({ apiKey: "offline-test", baseUrl: `ws://127.0.0.1:${address.port}`, language: "as", model: "nova-3" });
  const audio = audioFixture(), live: string[] = [];
  const subscription = attachSTTToAudio(provider, audio.audio, { onFinalTranscript: e => { live.push(e.alternatives?.[0]?.text ?? ""); } }, undefined, baseline);
  try {
    subscription.setInputMode("english-digits");
    for (let n = 0; n < 5; n++) audio.push(frame()); await nextTick();
    const result = await subscription.recoverSpeech({ startMs: 0, endMs: 100 }, new AbortController().signal);
    assert.equal(result?.text, "আগৰ নম্বৰটো শুদ্ধ", JSON.stringify({ languages: connections.map(url => url.searchParams.get("language")), audioCancelled: audio.cancelled })); assert.equal(result?.language, "as");
    assert.ok(connections.some(url => url.searchParams.get("language") === "en-IN"));
    assert.ok(connections.some(url => url.searchParams.get("language") === "as"));
    assert.equal(subscription.inputMode, "english-digits"); assert.deepEqual(live, []); assert.equal(audio.cancelled, 0);
  } finally {
    subscription.close(); await provider.close();
    for (const client of server.clients) client.terminate(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});


it("bounds a silent recovery recognizer to three seconds and closes it", async () => {
  const provider = fakeProvider(), original = provider.stream.bind(provider), audio = audioFixture();
  provider.stream = () => { const stream = original(); stream.endInput = () => {}; return stream; };
  const subscription = attachSTTToAudio(provider, audio.audio, {}, undefined, baseline);
  try {
    subscription.setInputMode("english-digits"); audio.push(frame()); await nextTick();
    const started = Date.now();
    assert.equal(await subscription.recoverSpeech({ startMs: 0, endMs: 20 }, new AbortController().signal), undefined);
    assert.ok(Date.now() - started >= 2900); assert.ok(Date.now() - started < 4500);
    assert.ok(provider.streams[2]?.closes); assert.equal(audio.cancelled, 0);
  } finally { subscription.close(); }
});
