import { GroqLLMProvider } from "../src/components/agent/providers/llm/groq.js";
import { createVoiceSystemPrompt } from "../src/agent/llm.js";

async function main() {
  const provider = new GroqLLMProvider();
  const sysPrompt = createVoiceSystemPrompt();

  const messages = [
    { role: "user", content: "মোৰ নাম উদয়চিছ বৰা।" },
    { role: "assistant", content: "ঠিক আছে, উদয়চিছ বৰা। আপোনাৰ ফোন নম্বৰটো দিব পাৰিবনে?" },
    { role: "user", content: "ছেভেন ডাবল জিৰ' টু জিৰ' ফাইভ নাইন ফাইভ ডাবল ফ'ৰ।" }
  ];

  console.log("Testing Groq chat with phone number...");
  const res = await provider.chat(messages, { systemPrompt: sysPrompt });
  console.log("Response text:", JSON.stringify(res.text));
  console.log("Finish reason:", res.finishReason);

  console.log("Testing Groq streaming with phone number...");
  const stream = provider.generate(messages, { systemPrompt: sysPrompt });
  let text = "";
  for await (const chunk of stream) {
    if (chunk.type === "text") {
      text += chunk.delta;
      console.log("Chunk delta:", JSON.stringify(chunk.delta));
    }
  }
  console.log("Streamed text:", JSON.stringify(text));
}

main().catch(console.error);
