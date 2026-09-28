# Assamese AI Voice Agent Platform — Technology & SDK Stack

## 1. Core Stack

| Layer | Technology | Purpose |
|---|---|---|
| Web dashboard | Next.js + React + TypeScript | Admin/business dashboard |
| Styling | Tailwind CSS | UI styling |
| UI components | shadcn/ui | Reusable accessible components |
| Server/API data | Native fetch + centralized API service modules + small custom request hooks | Simple API access without a server-state library |
| Forms | React Hook Form + Zod | Form state and validation |
| Icons | lucide-react | Consistent icons |
| Charts | Recharts | Dashboard analytics |
| Voice client | `livekit-client` | Browser realtime audio / room connection |
| Voice server | LiveKit | Realtime media infrastructure |
| Voice agent | `@livekit/agents` | Node.js realtime agent |
| VAD | Silero VAD via LiveKit | Speech activity / turn detection |
| STT | Deepgram Nova-3 | Streaming Assamese speech recognition; IndicConformer remains fallback |
| TTS | AI4Bharat IndicF5 | Assamese/Indian-language speech synthesis |
| LLM | Hugging Face Inference Providers + Qwen3.5-4B | Open-source model inference for development; provider remains replaceable |
| API | Node.js + Express + TypeScript | Business/API backend |
| DB | PostgreSQL | Persistent application data |
| ORM | Drizzle ORM | Type-safe DB access |
| Cache/state | Redis | Active call/session state |
| Validation | Zod | Runtime input validation |
| Logging | Winston | Structured application/server logs; reuse/adapt ConexusCRM-BE conventions |
| Jobs | node-cron initially | Lightweight scheduled jobs |
| Containers | Docker + Compose | Local and initial deployment |
| Reverse proxy | Nginx/Caddy as needed | Production routing/TLS |
| Python runtime | Python + FastAPI | AI model services |
| Package manager | npm or pnpm | Use one consistently |

## 2. Frontend SDK Usage

### Next.js
Use for:
- routing
- layouts
- server components
- page rendering
- metadata
- protected dashboard structure

Do not put business API logic directly inside random page components.

### `livekit-client`
Use only where the browser needs a realtime LiveKit connection:
- voice test page
- live agent testing
- optional live call monitor
- future browser-based call console

Do not use it for ordinary CRUD API calls.

### API data fetching
Use:
- native `fetch`
- centralized API service modules
- small custom request hooks where repeated loading/error behavior exists

Do not add TanStack Query.

### React Hook Form + Zod
Use for:
- login
- agent configuration
- business configuration
- doctor forms
- schedule forms
- tool configuration
- phone number configuration

### Zustand
Use only for small client-only UI state if required:
- sidebar state
- selected call
- temporary UI preferences

Do NOT use Zustand as a global cache for every API response.

### shadcn/ui
Use for:
- buttons
- inputs
- dialogs
- dropdowns
- tables
- tabs
- sheets
- forms
- cards
- badges
- alerts
- command menus

Do not create duplicate primitives when an existing component is suitable.

### Recharts
Use for:
- call volume
- call duration
- appointment conversion
- transfer rate
- daily/weekly trends

Analytics should be added after core workflows work.

## 3. Backend SDK Usage

### `@livekit/agents`
Use for:
- agent sessions
- agent lifecycle
- realtime pipeline
- custom STT node
- custom TTS node
- interruption handling
- tool integration

### `livekit-client` / LiveKit server SDKs
Use only where server or browser interaction with LiveKit is needed.

### Drizzle
Use for all PostgreSQL access.

### Zod
Validate:
- HTTP input
- tool arguments
- configuration
- AI-generated structured data before execution

### Redis
Use for:
- active call state
- temporary conversation state
- short-lived locks
- idempotency where useful

PostgreSQL remains the source of truth for permanent business data.

## 4. AI SDK / Provider Strategy

The system must use provider interfaces.

Example:

```ts
interface LLMProvider {
  generate(input: AgentInput): Promise<AgentResponse>;
}

interface STTProvider {
  transcribe(audio: AsyncIterable<AudioFrame>): AsyncIterable<SpeechEvent>;
}

interface TTSProvider {
  synthesize(text: AsyncIterable<string>): AsyncIterable<AudioFrame>;
}
```

The initial providers are:

```env
STT_PROVIDER=deepgram
TTS_PROVIDER=indicf5
LLM_PROVIDER=huggingface
LLM_MODEL=Qwen/Qwen3.5-4B
```

Later providers can be added without rewriting the Agent Engine.

## 5. Version Rule

Do not hard-code old package versions into architecture documents.

At project initialization:
1. install current stable compatible versions
2. record exact versions in lockfile/package manifests
3. verify compatibility
4. update `TECH_STACK.md` only when a deliberate stack change occurs

## 6. Official Documentation References

Next.js:
https://nextjs.org/docs/app

LiveKit Agents:
https://docs.livekit.io/agents/

LiveKit JS Client:
https://docs.livekit.io/reference/client-sdk-js/

Zod:
https://zod.dev/

shadcn/ui:
https://ui.shadcn.com/docs/installation/next

AI4Bharat IndicConformer:
https://github.com/AI4Bharat/IndicConformerASR

AI4Bharat IndicF5:
https://github.com/AI4Bharat/IndicF5


## Provider Decisions

### Speech-to-Text — Deepgram Nova-3

Deepgram added Assamese (`as`, `as-IN`) to Nova-3 for both batch and streaming on August 27, 2026. This makes Deepgram a valid candidate for realtime Assamese STT. citeturn3search0

However, the project must not assume quality from language support alone. Assamese telephone audio, accents, code-switching, names, clinic names and noisy calls must be benchmarked against representative project audio before making Deepgram the production STT.

If accepted:
```text
LiveKit → Deepgram streaming STT → Agent
```

No Python STT service is required.

### Text-to-Speech — Deepgram is NOT suitable for Assamese

Deepgram's current TTS language catalog lists English, Spanish, German, French, Dutch, Italian and Japanese for Aura-2; Assamese is not supported. Flux TTS is currently English-only. citeturn1search1turn1search2

Therefore:

```text
STT  = Deepgram Nova-3
TTS  = AI4Bharat IndicF5
```

The Python TTS service remains necessary unless a later Assamese-capable Node-compatible TTS provider is validated.

### Deepgram Free Usage

Deepgram currently advertises a free signup with $200 in credits and no credit card required. That is **free introductory credit, not unlimited free production usage**. citeturn1search4turn1search3

The documentation must therefore describe Deepgram as:
- free for development within the available credits
- paid after credits are consumed
- not a permanently free production STT service

### LLM / Agent SDK

Use the OpenAI Agents SDK as the primary agent orchestration SDK.

It provides:
- agents
- function tools
- typed Zod tool parameters
- context passed into tools
- sessions
- handoffs
- guardrails
- tracing
- custom model providers citeturn0search1turn0search3turn2search0

The SDK also supports custom `Model` / `ModelProvider` implementations, and it has an adapter for Vercel AI SDK models. citeturn2search0turn2search11

This lets us keep:

```text
Agent orchestration
        ↓
OpenAI Agents SDK
        ↓
Provider/model adapter
        ↓
Hugging Face Inference Providers during development; use vLLM with the same model for self-hosted inference when GPU infrastructure is available
or hosted LLM in production
```

Do not build a second custom agent framework unless a concrete LiveKit integration requirement makes it necessary.

### Vercel AI SDK

Do not use Vercel AI SDK as the primary agent orchestration layer.

It remains a useful provider/model adapter and can be introduced later if we need broader model-provider support. The OpenAI Agents SDK already documents an AI SDK adapter. citeturn2search11

### Claude SDK

Do not make the Claude SDK the primary abstraction at this stage. Keep Anthropic as a future provider option behind the model/provider boundary.

