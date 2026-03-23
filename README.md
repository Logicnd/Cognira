# Cognira: Local-First AI Intelligence System

Cognira is a high-performance, private, and cost-free alternative to cloud-based AI systems. It runs entirely on your local machine, ensuring complete data privacy and sub-second response times.

## Key Features

- **Local Model Deployment**: Optimized for Ollama (Llama 3, Mistral, etc.).
- **Real-Time Streaming**: Modern React UI with low-latency streaming.
- **Privacy First**: Zero data leaves your network.
- **Resource Monitoring**: Real-time CPU and memory tracking.
- **File Integration**: Upload and analyze local files securely.

## Prerequisites

- [Ollama](https://ollama.com/) installed and running.
- Python 3.10+
- Node.js 18+

## Quick Start

1. **Install Ollama**: Download and install from [ollama.com](https://ollama.com/).
2. **Setup Environment**:
   ```bash
   # Create virtual environment
   python -m venv venv
   .\venv\Scripts\activate
   
   # Install dependencies
   pip install -r api/requirements.txt
   npm install
   ```
3. **Download Model**:
   ```bash
   ollama pull llama3
   ```
4. **Launch Cognira**:
   ```bash
   npm run dev
   ```

5. **Run full health check**:
   ```bash
   npm run health:full
   ```

6. **Run predeploy parity check**:
   ```bash
   npm run predeploy:check
   ```

## Environment Variables

Use `.env` for local development. A committed `.env.example` template is included for deployment and CI setup.

### Required/important keys

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_LOW_RESOURCE_MODE`
- `NEXT_PUBLIC_DEFAULT_MODEL_LABEL`
- `USE_LOCAL`
- `DEFAULT_LOCAL_MODEL`
- `ENABLE_CLOUD_MODELS`
- `OLLAMA_URL`
- `DEFAULT_MODEL`
- `CHECKOUT_PROVIDER`
- `STRIPE_SECRET_KEY` (only needed when using `CHECKOUT_PROVIDER=stripe`)
- `STRIPE_WEBHOOK_SECRET` (required for Stripe webhook verification)
- `FRONTEND_BASE_URL`
- `STRIPE_SUCCESS_URL`
- `STRIPE_CANCEL_URL`
- `STRIPE_PRICE_ID_PLUS_MONTHLY`
- `STRIPE_PRICE_ID_BUSINESS_MONTHLY`
- `STRIPE_PRICE_ID_PRO_MONTHLY`
- `HF_API_TOKEN` (optional)

### Vercel redeploy

When deploying to Vercel, copy the same keys from `.env.example` into Vercel Project Settings -> Environment Variables for each target environment (Preview/Production).

### Stripe webhook endpoint

When `CHECKOUT_PROVIDER=stripe`, configure your Stripe webhook endpoint to:

- `POST /billing/webhook/stripe`

For local testing, this is usually:

- `http://localhost:8000/billing/webhook/stripe`

In production, use your deployed backend URL and set `STRIPE_WEBHOOK_SECRET` from Stripe.

## Architecture

- **Frontend**: Next.js 16 (React 19) + Tailwind CSS 4 + Framer Motion.
- **Backend**: FastAPI (Python) + LangChain.
- **Engine**: Ollama (serving local LLMs).

## Security & Privacy

Cognira is designed with a "local-only" architecture. All inference, file processing, and data storage happen within your machine's boundary. There are no telemetry scripts or external API calls to third-party AI providers.

## No-Paid-API Mode

You can run Cognira in strict local mode with no paid AI APIs.

### Current defaults

- `USE_LOCAL=true`
- `ENABLE_CLOUD_MODELS=false`
- `DEFAULT_LOCAL_MODEL=llama3`
- `NEXT_PUBLIC_DEFAULT_MODEL_LABEL=llama3 (Local)`

This keeps the model selection and chat routing local-first and blocks cloud model options from the API model list.

### How to run

1. Start Ollama.
2. Pull a local model:
   ```bash
   ollama pull llama3
   ```
3. Run Cognira:
   ```bash
   npm run dev
   ```

## Product Rollout Without Paid APIs

Use this sequence to build full product behavior before paying for external providers.

1. Services layer
- Build feature modules as internal services first (auth/session, billing state, campaign state, automation runner, agent runner).
- Keep each service behind an interface so providers can be swapped later.

2. Subscriptions
- Implement plans and entitlements locally in SQLite.
- Track `plan`, `status`, and `usage_limits` as app data first.
- Add real payment processors only after flows and limits are validated.

3. Marketing
- Use free/self-hosted tooling first (static landing pages, local analytics events, optional PostHog free tier).
- Capture campaign and funnel events in your own DB before external ad attribution.

4. Automation
- Use local scheduled jobs and deterministic rules.
- Keep triggers, actions, and run logs in SQLite so you can replay/debug without vendor lock-in.

5. Agent mode
- Start with tool-constrained local workflows (retrieve, summarize, transform).
- Add guardrails (allowed actions, max steps, timeout, audit logs) before enabling broader autonomy.
- Introduce paid model providers only when you need measured quality/latency gains.

---
Created by NIGHTSHADE for Cognira.
