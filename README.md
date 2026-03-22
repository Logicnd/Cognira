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

## Architecture

- **Frontend**: Next.js 16 (React 19) + Tailwind CSS 4 + Framer Motion.
- **Backend**: FastAPI (Python) + LangChain.
- **Engine**: Ollama (serving local LLMs).

## Security & Privacy

Cognira is designed with a "local-only" architecture. All inference, file processing, and data storage happen within your machine's boundary. There are no telemetry scripts or external API calls to third-party AI providers.

---
Created by NIGHTSHADE for Cognira.
