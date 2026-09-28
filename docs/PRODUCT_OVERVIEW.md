# Assamese AI Voice Agent Platform — Product Overview

## 1. Product

A multi-tenant B2B AI voice-agent platform for businesses that need phone/voice-based customer interactions.

Primary launch market:
- Assam / Northeast India
- Assamese-first
- Hindi + English support
- Natural Assamese/Hindi/English code-switching

Initial business:
- Clinic / hospital appointment booking

Future business configurations:
- Hotel reception / room booking
- Restaurant reservations
- Salon/service bookings
- Diagnostic-centre appointments
- Other structured booking workflows

## 2. Core Product Idea

We build ONE reusable voice-agent engine.

We do NOT build one separate AI implementation per business.

Business-specific behavior comes from:
- business configuration
- agent configuration
- enabled tools
- system instructions
- business data
- working hours
- escalation rules

Example:

Clinic:
`get_doctors -> get_slots -> book_appointment -> cancel_appointment`

Hotel:
`get_rooms -> get_room_availability -> book_room -> cancel_room`

The voice pipeline remains the same.

## 3. End-to-End Flow

### Development

Browser microphone / SIP softphone
-> LiveKit
-> LiveKit Agent
-> Silero VAD
-> Deepgram Nova-3 STT
-> Agent Engine
-> Hugging Face Inference — Qwen3.5-4B
-> Business Tool
-> Agent Engine
-> IndicF5 TTS
-> LiveKit
-> Browser / SIP softphone

### Production

Phone
-> SIP/PSTN provider
-> LiveKit SIP
-> LiveKit Room
-> LiveKit Agent
-> VAD
-> STT
-> LLM
-> Tools
-> TTS
-> LiveKit SIP
-> Phone

## 4. Responsibilities

### LiveKit
Owns realtime media transport, rooms, participants, audio, interruptions and SIP integration.

### LiveKit Agent
Runs the realtime agent session and connects the audio pipeline to our agent logic.

### Agent Engine
Owns:
- conversation state
- business configuration
- prompt construction
- intent handling
- tool selection/execution
- human handoff
- response policy

### STT service
Uses Deepgram Nova-3 for Assamese speech-to-text and returns text.

Deepgram is the initial STT provider. AI4Bharat IndicConformer remains a fallback option only if the Assamese STT benchmark shows that Deepgram is not sufficient.

### LLM
Initially Hugging Face Inference Providers with Qwen3.5-4B.
The provider must remain replaceable.

### TTS service
Runs AI4Bharat IndicF5 and returns speech audio.

### API
Owns authentication, organizations, agents, business data, calls, appointments and administrative operations.

### Dashboard
Allows business operators/admins to configure and monitor the platform.

## 5. Important Architecture Rule

The LLM NEVER directly accesses PostgreSQL.

Correct:

LLM
-> structured tool call
-> Node.js tool executor
-> validated service
-> PostgreSQL/API
-> tool result
-> LLM

## 6. Multi-Tenant Rule

Every organization-owned record must be scoped to an organization.

Never trust an `organizationId` supplied by a browser request without validating that the authenticated user belongs to that organization.

Tenant isolation is a core security requirement.

## 7. Cost Rule

Development should remain as close to ₹0 as practical:
- self-hosted LiveKit
- local browser microphone
- local SIP softphone
- Hugging Face Inference Providers when free/low-cost access is available
- local IndicF5
- PostgreSQL
- Redis
- Docker

Hugging Face Inference Providers are an external inference service and are not a local Docker service. If external inference cost becomes a constraint, the same Qwen model can later be self-hosted with vLLM.

Real PSTN/mobile calls are a production dependency and may incur telephony charges.

## 8. First Production Target

Do not optimize for many tenants first.

Initial pilot:
- 1 organization
- 1 clinic
- 1 agent
- 1 phone number
- low concurrency

Measure real Assamese call quality before scaling infrastructure.

## 9. Non-Goals for V1

Do not add these unless the current phase requires them:
- Kubernetes
- microservice orchestration platforms
- complex event buses
- multiple LLM providers at runtime
- unnecessary analytics
- autonomous unrestricted agents
- direct database access from the LLM
- n8n workflows

## 10. Source of Truth

The following documents are part of the product specification:

- `docs/PRODUCT_OVERVIEW.md`
- `docs/TECH_STACK.md`
- `docs/BACKEND_ARCHITECTURE.md`
- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/VOICE_AI_ARCHITECTURE.md`
- `docs/DATA_MODEL_AND_API_CONTRACT.md`
- `docs/PHASES.md`
- `docs/AGENTS.md`
- `docs/PROGRESS.md`
- `docs/PROMPTS.md`

Before implementing a feature, read the relevant documents and the current progress.
