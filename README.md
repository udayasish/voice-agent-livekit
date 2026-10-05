# Assamese AI Voice Agent Platform

Production-grade multi-tenant AI voice-agent platform for businesses in Assam and Northeast India, with Assamese as the primary language.

---

## Architecture Overview

```
Voice Inbound (Browser/Phone)
        │
        ▼
   LiveKit Media Server (Port 7880)
        │
        ▼
   Backend & Agent Engine (Port 4000)
   ├── Silero VAD (via LiveKit)
   ├── Deepgram Nova-3 (Cloud STT)
   ├── Hugging Face Inference Providers (External Cloud API - Qwen3.5-4B)
   ├── Tools Engine (Booking, Slots, Clinic Data)
   └── IndicF5 TTS (Python FastAPI Service)
        │
   PostgreSQL 16 (DB) + Redis 7 (Cache/State)
```

---

## Local Infrastructure (Phase 1)

Local development runs at **₹0 cost** using Docker Compose for infrastructure and managed cloud free tiers for AI models.

### Services in Docker Compose

| Service | Container Name | Port | Health Check | Persistence |
|---|---|---|---|---|
| **PostgreSQL 16** | `voice-agent-postgres` | `5432` | `pg_isready` | `voice_agent_postgres_data` volume |
| **Redis 7** | `voice-agent-redis` | `6379` | `redis-cli ping` | `voice_agent_redis_data` volume |
| **LiveKit Server** | `voice-agent-livekit` | `7880` (HTTP/WS), `7881` (TCP), `7882` (UDP) | HTTP `/` probe | Stateless in dev mode |

> **Important:** Hugging Face Inference Providers are an **external cloud API**. They must **NOT** be added as a local Docker service. The application communicates securely with the Hugging Face router via HTTPS using your API token.

---

## Quickstart

### 1. Start Local Infrastructure
```bash
# Start Postgres, Redis, and LiveKit in background
docker compose up -d

# Check service status and healthchecks
docker compose ps
```

### 2. Verify Connectivity

```bash
# Test PostgreSQL
docker compose exec postgres pg_isready -U postgres -d voice_agent

# Test Redis
docker compose exec redis redis-cli ping

# Test LiveKit availability
curl -s http://localhost:7880/
```

### 3. Start Backend & AI Engine
```bash
cd backend
npm install
npm run dev
```

Visit the consolidated infrastructure health check at:
```bash
curl http://localhost:4000/api/v1/health
```

Expected response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "voice-agent-backend",
    "infrastructure": {
      "postgres": "connected",
      "redis": "connected",
      "livekit": "reachable"
    },
    "llm": {
      "provider": "huggingface-inference-providers",
      "deployment": "external-api",
      "model": "Qwen/Qwen3.5-4B",
      "baseURL": "https://router.huggingface.co/v1",
      "configured": false
    }
  }
}
```

### 4. API Testing (Bruno Collection)

The repository includes a ready-to-run [Bruno](https://usebruno.com) API collection under `backend/bruno-collection/`:
1. Open Bruno and select **Open Collection** -> choose `backend/bruno-collection/`.
2. Select the **Local** environment (`http://localhost:4000`).
3. Run `Auth/Login` — it automatically extracts the `accessToken` and `organizationId` into collection variables for subsequent requests.
4. Test protected endpoints under `Organizations/` and `Auth/`.

### 5. Stop Local Infrastructure
```bash
docker compose down
```
*(To wipe persistent volumes: `docker compose down -v`)*
