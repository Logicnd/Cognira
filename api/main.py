import os
import json
import asyncio
import httpx
import psutil
import logging
import sqlite3
import socket
import re
import ast
import operator
from typing import List, Optional
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv

try:
    from ddgs import DDGS
except Exception:
    DDGS = None

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("cognira_backend.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("Cognira")

load_dotenv()

app = FastAPI(title="Cognira API", version="1.0.0")


@app.get("/")
async def root():
    return {
        "service": "Cognira API",
        "status": "running",
        "health": "/health",
        "models": "/models",
        "chat": "/chat"
    }

# Database Setup
DB_PATH = "cognira.db"

SUPPORTED_CLOUD_MODELS = [
    {"name": "free (Cloud)", "provider": "huggingface"},
    {"name": "openai (Cloud)", "provider": "pollinations"},
    {"name": "mistral (Cloud)", "provider": "pollinations"},
]

MODEL_ALIASES = {
    "free": "free",
    "hf": "free",
    "huggingface": "free",
    "openai": "openai",
    "gpt-4o-mini": "openai",
    "claude-3-haiku": "openai",
    "mistral": "mistral",
    "mixtral-8x7b": "mistral",
    "llama-3.3": "mistral",
}

def prune_empty_sessions(cursor: sqlite3.Cursor):
    cursor.execute("""
        DELETE FROM sessions
        WHERE id NOT IN (
            SELECT DISTINCT session_id
            FROM messages
            WHERE session_id IS NOT NULL
        )
    """)

def normalize_model_name(model_name: str) -> str:
    clean_model = model_name.split(" (")[0].strip().lower()
    return MODEL_ALIASES.get(clean_model, "free")

def should_use_local_model(model_name: str) -> bool:
    return USE_LOCAL or model_name.lower().endswith("(local)")

def strip_model_suffix(model_name: str) -> str:
    return model_name.split(" (")[0].strip()


_SAFE_MATH_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}


def _safe_eval_math(node: ast.AST) -> float:
    if isinstance(node, ast.Expression):
        return _safe_eval_math(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return float(node.value)
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        value = _safe_eval_math(node.operand)
        return value if isinstance(node.op, ast.UAdd) else -value
    if isinstance(node, ast.BinOp) and type(node.op) in _SAFE_MATH_OPERATORS:
        left = _safe_eval_math(node.left)
        right = _safe_eval_math(node.right)
        if isinstance(node.op, ast.Div) and right == 0:
            raise ValueError("division by zero")
        return _SAFE_MATH_OPERATORS[type(node.op)](left, right)
    raise ValueError("unsupported expression")


def generate_fast_answer(user_query: str) -> Optional[str]:
    if not user_query:
        return None

    normalized = re.sub(r"\s+", " ", user_query.strip().lower())

    # Keep frequent tiny prompts instant and concise.
    short_map = {
        "1+1": "2",
        "1 + 1": "2",
        "what is 1+1": "2",
        "what is 1 + 1": "2",
        "hi": "Hi.",
        "hello": "Hello.",
        "thanks": "You're welcome.",
        "thank you": "You're welcome.",
    }
    if normalized in short_map:
        return short_map[normalized]

    # Generic arithmetic detector for expressions like:
    # 3*7, (12 + 8) / 2, what is 14-6?
    expr_candidate = normalized
    expr_candidate = re.sub(r"^(what is|calculate|compute)\s+", "", expr_candidate)
    expr_candidate = expr_candidate.rstrip("?.!")

    if re.fullmatch(r"[0-9\s\+\-\*\/\(\)\.%]+", expr_candidate):
        try:
            parsed = ast.parse(expr_candidate, mode="eval")
            value = _safe_eval_math(parsed)
            if abs(value - round(value)) < 1e-9:
                return str(int(round(value)))
            return f"{value:.6f}".rstrip("0").rstrip(".")
        except Exception:
            return None

    return None


async def generate_web_fallback_answer(user_query: str, concise: bool = False) -> Optional[str]:
    if not user_query or DDGS is None:
        return None

    normalized_query = user_query.strip().lower()
    normalized_query = re.sub(r"\s+", " ", normalized_query)

    small_talk_replies = {
        "hi": "Hi there. I am online and ready to help. Ask me anything.",
        "hello": "Hello. I am here and ready to help.",
        "hey": "Hey. I am ready when you are.",
        "hi there": "Hi there. I am online and ready to help.",
        "yo": "Yo. I am here and ready to help.",
        "thanks": "You are welcome.",
        "thank you": "You are welcome.",
        "ok": "Got it. Tell me what you want to do next.",
        "okay": "Got it. Tell me what you want to do next.",
    }

    if normalized_query in small_talk_replies:
        return small_talk_replies[normalized_query]

    # Fast deterministic fallback for common translation asks.
    if "russian" in normalized_query:
        translation_map = {
            "hi": "Privet",
            "hello": "Privet",
            "thank you": "Spasibo",
            "thanks": "Spasibo",
            "yes": "Da",
            "no": "Net"
        }

        phrase = ""
        for candidate in translation_map.keys():
            if candidate in normalized_query:
                phrase = candidate
                break

        if phrase:
            return f"In Russian, '{phrase}' is '{translation_map[phrase]}'."
        return "I can translate to Russian. Tell me the exact phrase, for example: 'How are you?'"

    if normalized_query.endswith("?") and len(normalized_query.split()) <= 4:
        return "I can help with that. Please add one more detail so I can give a precise answer."

    def _search() -> list:
        return list(DDGS().text(user_query, max_results=5))

    try:
        results = await asyncio.to_thread(_search)
    except Exception as e:
        logger.warning(f"DDGS fallback failed: {e}")
        return None

    if not results:
        return None

    if concise:
        top = results[0]
        title = (top.get("title") or "Untitled").strip()
        body = (top.get("body") or "").strip()
        href = (top.get("href") or "").strip()
        snippet = body[:140] + ("..." if len(body) > 140 else "")
        parts = [
            "Cloud AI is unavailable right now.",
            f"Quick web answer: {title}."
        ]
        if snippet:
            parts.append(snippet)
        if href:
            parts.append(f"Source: {href}")
        return "\n".join(parts)

    lines = [
        "I could not reach cloud AI providers, but I found relevant web results:",
        ""
    ]

    for idx, item in enumerate(results[:3], start=1):
        title = (item.get("title") or "Untitled").strip()
        body = (item.get("body") or "").strip()
        href = (item.get("href") or "").strip()
        snippet = body[:280] + ("..." if len(body) > 280 else "")
        lines.append(f"{idx}. {title}")
        if snippet:
            lines.append(f"   {snippet}")
        if href:
            lines.append(f"   Source: {href}")
        lines.append("")

    lines.append("If you want, ask a narrower follow-up and I can refine these results.")
    return "\n".join(lines).strip()

async def get_local_models() -> List[str]:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{OLLAMA_URL}/tags")
            if response.status_code != 200:
                return []
            ollama_models = response.json().get("models", [])
            return [m.get("name", "") for m in ollama_models if m.get("name")]
    except Exception:
        return []

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    # Messages table with indexing
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            role TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_session_id ON messages(session_id)")
    
    # Sessions metadata table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Files index table for fast keyword search
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS file_index (
            filename TEXT PRIMARY KEY,
            content_preview TEXT,
            keywords TEXT
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS file_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            chunk_index INTEGER,
            content TEXT
        )
    """)
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_file_chunks_filename ON file_chunks(filename)")
    
    # Check if we need to migrate existing data from messages to sessions
    cursor.execute("SELECT DISTINCT session_id FROM messages")
    old_sessions = cursor.fetchall()
    for s_id_tuple in old_sessions:
        s_id = s_id_tuple[0]
        cursor.execute("SELECT id FROM sessions WHERE id = ?", (s_id,))
        if not cursor.fetchone():
            cursor.execute("SELECT content FROM messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT 1", (s_id,))
            first_msg = cursor.fetchone()
            title = first_msg[0][:40] + "..." if first_msg else "Old Session"
            cursor.execute("INSERT INTO sessions (id, title) VALUES (?, ?)", (s_id, title))

    prune_empty_sessions(cursor)
    conn.commit()
    conn.close()

init_db()

def save_message(session_id: str, role: str, content: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Update or create session metadata
    cursor.execute("SELECT id FROM sessions WHERE id = ?", (session_id,))
    if not cursor.fetchone():
        # Use first message as title (truncated)
        title = content[:40] + ("..." if len(content) > 40 else "")
        cursor.execute("INSERT INTO sessions (id, title) VALUES (?, ?)", (session_id, title))
    else:
        cursor.execute("UPDATE sessions SET last_updated = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
    
    # Save the message
    cursor.execute("INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)", 
                   (session_id, role, content))
    conn.commit()
    conn.close()

def get_history(session_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT role, content FROM messages WHERE session_id = ? ORDER BY timestamp ASC, id ASC", (session_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"role": row[0], "content": row[1]} for row in rows]

def get_sessions():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, last_updated FROM sessions ORDER BY last_updated DESC")
    rows = cursor.fetchall()
    conn.close()
    return [{"id": row[0], "title": row[1], "updated": row[2]} for row in rows]

# CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api")
DEFAULT_MODEL = os.getenv("DEFAULT_MODEL", "free")
USE_LOCAL = os.getenv("USE_LOCAL", "false").lower() == "true"
HF_INFERENCE_MODEL = os.getenv("HF_INFERENCE_MODEL", "TinyLlama/TinyLlama-1.1B-Chat-v1.0")
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")


def _build_free_prompt(messages: List[Message]) -> str:
    # Keep a compact prompt to improve latency for free providers.
    prompt_parts = [
        "You are Cognira. Give direct, practical, and concise answers.",
        "If the user asks for translation, return the translated phrase first."
    ]

    recent = messages[-8:]
    for msg in recent:
        role = "User" if msg.role == "user" else "Assistant"
        prompt_parts.append(f"{role}: {msg.content}")
    prompt_parts.append("Assistant:")
    return "\n".join(prompt_parts)


async def generate_free_llm_answer(messages: List[Message]) -> Optional[str]:
    prompt = _build_free_prompt(messages)
    endpoint = f"https://api-inference.huggingface.co/models/{HF_INFERENCE_MODEL}"
    headers = {"Content-Type": "application/json"}
    if HF_API_TOKEN:
        headers["Authorization"] = f"Bearer {HF_API_TOKEN}"

    payload = {
        "inputs": prompt,
        "parameters": {
            "max_new_tokens": 220,
            "temperature": 0.25,
            "return_full_text": False
        }
    }

    try:
        async with httpx.AsyncClient(timeout=40.0) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
            if response.status_code >= 400:
                logger.warning(f"HF inference failed with status {response.status_code}: {response.text[:180]}")
                return None

            data = response.json()
            if isinstance(data, dict) and data.get("error"):
                logger.warning(f"HF inference provider error: {data.get('error')}")
                return None

            if isinstance(data, list) and data:
                first = data[0]
                text = ""
                if isinstance(first, dict):
                    text = (first.get("generated_text") or first.get("summary_text") or "").strip()
                if text:
                    return text
            return None
    except Exception as e:
        logger.warning(f"HF free LLM fallback failed: {e}")
        return None

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    model: Optional[str] = DEFAULT_MODEL
    messages: List[Message]
    stream: Optional[bool] = True
    session_id: Optional[str] = "default"
    concise_mode: Optional[bool] = False


class CommandSuggestionRequest(BaseModel):
    query: str

@app.get("/history/{session_id}")
async def get_chat_history(session_id: str):
    return {"messages": get_history(session_id)}

@app.get("/sessions")
async def list_chat_sessions():
    return {"sessions": get_sessions()}

@app.delete("/history/{session_id}")
async def clear_chat_history(session_id: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    cursor.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    prune_empty_sessions(cursor)
    conn.commit()
    conn.close()
    return {"status": "cleared"}

@app.get("/health")
async def health_check():
    cpu_usage = psutil.cpu_percent()
    memory_usage = psutil.virtual_memory().percent
    return {
        "status": "healthy",
        "cpu": cpu_usage,
        "memory": memory_usage,
        "ollama_connected": await check_ollama_connection()
    }

async def check_ollama_connection():
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{OLLAMA_URL.replace('/api', '')}")
            return response.status_code == 200
    except Exception:
        return False

@app.post("/chat")
async def chat(request: ChatRequest):
    requested_model = request.model or DEFAULT_MODEL
    use_local_model = should_use_local_model(requested_model)
    logger.info(f"Received chat request for model: {requested_model} (Local: {use_local_model})")
    
    # Save user message
    if request.messages:
        last_msg = request.messages[-1]
        save_message(request.session_id, last_msg.role, last_msg.content)

    if use_local_model:
        payload = {
            "model": strip_model_suffix(requested_model),
            "messages": [m.dict() for m in request.messages],
            "stream": request.stream
        }
        url = f"{OLLAMA_URL}/chat"
    else:
        selected_cloud_model = normalize_model_name(requested_model)
        pollinations_model = selected_cloud_model if selected_cloud_model in {"openai", "mistral"} else "openai"
        
        # Primary: Pollinations AI
        payload = {
            "messages": [m.dict() for m in request.messages],
            "model": pollinations_model,
            "jsonMode": False
        }
        # Developer Mode Enhancement: Inject System Prompt for more detailed reasoning
        if "developer" in request.session_id.lower() or "dev" in requested_model.lower():
            payload["messages"].insert(0, {
                "role": "system", 
                "content": "You are Cognira, a high-performance AI in Developer Mode. Provide extremely detailed, technical, and accurate responses. Break down complex logic and provide raw reasoning where possible."
            })
            
        url = "https://text.pollinations.ai/"

    async def generate():
        last_user_query = ""
        for msg in reversed(request.messages):
            if msg.role == "user":
                last_user_query = msg.content
                break

        fast_answer = generate_fast_answer(last_user_query)
        if fast_answer:
            save_message(request.session_id, "assistant", fast_answer)
            fast_chunk = json.dumps({"message": {"role": "assistant", "content": fast_answer}})
            yield f"data: {fast_chunk}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"
            return

        async with httpx.AsyncClient(timeout=60.0) as client:
            cloud_failure_reasons: List[str] = []
            yield f"data: {json.dumps({'status': 'Thinking...', 'phase': 'init'})}\n\n"
            # --- PRIMARY ATTEMPT: Free cloud LLM (Hugging Face inference) ---
            try:
                if not use_local_model:
                    selected_cloud_model = normalize_model_name(requested_model)
                    if selected_cloud_model == "free":
                        yield f"data: {json.dumps({'status': 'Trying free AI provider...', 'phase': 'cloud'})}\n\n"
                        free_answer = await generate_free_llm_answer(request.messages)
                        if free_answer:
                            save_message(request.session_id, "assistant", free_answer)
                            free_chunk = json.dumps({"message": {"role": "assistant", "content": free_answer}})
                            yield f"data: {free_chunk}\n\n"
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            return
                        cloud_failure_reasons.append("free: unavailable or rate-limited")

                    # Secondary cloud attempt: Pollinations for additional resilience.
                    yield f"data: {json.dumps({'status': 'Contacting cloud model...', 'phase': 'cloud'})}\n\n"
                    backup_model = "mistral" if payload["model"] != "mistral" else "openai"
                    attempt_models = [payload["model"]]
                    if backup_model not in attempt_models:
                        attempt_models.append(backup_model)

                    for cloud_model in attempt_models:
                        try:
                            yield f"data: {json.dumps({'status': f'Trying {cloud_model}...', 'phase': 'cloud-attempt'})}\n\n"
                            current_payload = {**payload, "model": cloud_model}
                            full_content = ""
                            logger.info(f"Attempting Pollinations with model: {cloud_model}...")
                            async with client.stream("POST", url, json=current_payload) as response:
                                if response.status_code != 200:
                                    raise Exception(f"Pollinations HTTP {response.status_code}")

                                async for line in response.aiter_lines():
                                    if not line:
                                        continue

                                    if line.startswith('{"error":'):
                                        error_data = json.loads(line)
                                        raise Exception(f"Pollinations Error: {error_data.get('error')}")

                                    full_content += line
                                    chunk_data = json.dumps({"message": {"role": "assistant", "content": line + "\n"}})
                                    yield f"data: {chunk_data}\n\n"

                            if not full_content.strip():
                                raise Exception("Pollinations returned an empty response")

                            save_message(request.session_id, "assistant", full_content)
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            return
                        except Exception as cloud_error:
                            logger.warning(f"Pollinations attempt failed for {cloud_model}: {cloud_error}")
                            cloud_failure_reasons.append(f"{cloud_model}: {cloud_error}")

                    # Fallback to a local model if cloud is unavailable.
                    yield f"data: {json.dumps({'status': 'Cloud unavailable. Checking local runtime...', 'phase': 'local-fallback'})}\n\n"
                    local_models = await get_local_models()
                    if local_models:
                        fallback_local_model = local_models[0]
                        logger.info(f"Falling back to local model after cloud failure: {fallback_local_model}")
                        yield f"data: {json.dumps({'status': f'Using local model {fallback_local_model}...', 'phase': 'local-chat'})}\n\n"

                        local_payload = {
                            "model": fallback_local_model,
                            "messages": [m.dict() for m in request.messages],
                            "stream": request.stream
                        }
                        local_url = f"{OLLAMA_URL}/chat"

                        full_content = ""
                        async with client.stream("POST", local_url, json=local_payload) as response:
                            if response.status_code != 200:
                                raise Exception(f"Ollama fallback HTTP {response.status_code}")

                            async for line in response.aiter_lines():
                                if line:
                                    data = json.loads(line)
                                    if "message" in data and "content" in data["message"]:
                                        full_content += data["message"]["content"]
                                    yield f"data: {line}\\n\\n"

                            if not full_content.strip():
                                raise Exception("Ollama fallback returned an empty response")

                            save_message(request.session_id, "assistant", full_content)
                            yield f"data: {json.dumps({'done': True})}\\n\\n"
                            return
                else:
                    # LOCAL OLLAMA logic
                    yield f"data: {json.dumps({'status': 'Using local model...', 'phase': 'local-chat'})}\n\n"
                    full_content = ""
                    async with client.stream("POST", url, json=payload) as response:
                        if response.status_code != 200:
                            raise Exception(f"Ollama HTTP {response.status_code}")

                        async for line in response.aiter_lines():
                            if line:
                                data = json.loads(line)
                                if "message" in data and "content" in data["message"]:
                                    full_content += data["message"]["content"]
                                yield f"data: {line}\n\n"

                        if not full_content.strip():
                            raise Exception("Ollama returned an empty response")

                        save_message(request.session_id, "assistant", full_content)
                        yield f"data: {json.dumps({'done': True})}\n\n"
                        return

            except Exception as e:
                logger.error(f"Chat streaming failed: {e}")

            # --- TOTAL FAILURE ---
            if use_local_model:
                error_message = "The selected local model is unavailable. Start Ollama or pick a cloud model."
            else:
                cloud_reason = "; ".join(cloud_failure_reasons[-2:]) if cloud_failure_reasons else "no provider details available"
                error_message = (
                    "Free/cloud providers are unavailable right now and no local Ollama model is ready. "
                    "Start Ollama, run 'ollama pull llama3' (or another model), then retry. "
                    f"Details: {cloud_reason}"
                )

            # Lightweight web fallback for low-resource environments when AI providers are down.
            yield f"data: {json.dumps({'status': 'Switching to web-assisted fallback...', 'phase': 'web-fallback'})}\n\n"
            web_fallback = await generate_web_fallback_answer(
                last_user_query,
                concise=bool(request.concise_mode)
            )
            if web_fallback:
                save_message(request.session_id, "assistant", web_fallback)
                web_chunk = json.dumps({"message": {"role": "assistant", "content": web_fallback}})
                yield f"data: {web_chunk}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
                return

            degraded_reply = (
                "Cognira is running in degraded mode because external AI providers are temporarily unavailable.\n\n"
                f"Reason: {error_message}\n\n"
                "Your message was received. Please retry in a moment, or install/start a local model runtime for reliable local responses."
            )
            save_message(request.session_id, "assistant", degraded_reply)
            degraded_chunk = json.dumps({"message": {"role": "assistant", "content": degraded_reply}})
            yield f"data: {degraded_chunk}\n\n"
            yield f"data: {json.dumps({'done': True})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/models")
async def list_models():
    models = []
    # 1. Local Models (Ollama)
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            response = await client.get(f"{OLLAMA_URL}/tags")
            if response.status_code == 200:
                ollama_models = response.json().get("models", [])
                models.extend([{"name": f"{m['name']} (Local)", "provider": "local"} for m in ollama_models])
    except Exception:
        pass # Ollama not running

    # 2. Cloud Models (Pollinations)
    models.extend(SUPPORTED_CLOUD_MODELS)
    
    return {"models": models}

@app.post("/files/upload")
async def upload_file(file: UploadFile = File(...)):
    upload_dir = "uploads"
    if not os.path.exists(upload_dir):
        os.makedirs(upload_dir)
    
    file_path = os.path.join(upload_dir, file.filename)
    content = await file.read()
    with open(file_path, "wb") as buffer:
        buffer.write(content)
    
    # Basic Indexing (No external dependencies)
    try:
        text_content = content.decode("utf-8", errors="ignore")
        preview = text_content[:200]
        # Basic keyword extraction: frequent words > 4 chars
        import re
        words = re.findall(r'\w{5,}', text_content.lower())
        from collections import Counter
        common_words = ",".join([w for w, _ in Counter(words).most_common(10)])
        
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("REPLACE INTO file_index (filename, content_preview, keywords) VALUES (?, ?, ?)", 
                       (file.filename, preview, common_words))
        cursor.execute("DELETE FROM file_chunks WHERE filename = ?", (file.filename,))

        chunk_size = 650
        chunks = [text_content[i:i + chunk_size] for i in range(0, len(text_content), chunk_size)]
        for idx, chunk in enumerate(chunks):
            if chunk.strip():
                cursor.execute(
                    "INSERT INTO file_chunks (filename, chunk_index, content) VALUES (?, ?, ?)",
                    (file.filename, idx, chunk)
                )

        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"Indexing failed for {file.filename}: {e}")
    
    logger.info(f"File uploaded and indexed: {file.filename}")
    return {"filename": file.filename, "path": file_path}

@app.get("/files/search")
async def search_files(q: str):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    query = f"%{q.lower()}%"
    cursor.execute("SELECT filename, content_preview FROM file_index WHERE filename LIKE ? OR keywords LIKE ? OR content_preview LIKE ?", 
                   (query, query, query))
    rows = cursor.fetchall()
    results = [{"filename": row[0], "preview": row[1]} for row in rows]

    cursor.execute(
        "SELECT filename, chunk_index, content FROM file_chunks WHERE LOWER(content) LIKE ? LIMIT 8",
        (query,)
    )
    chunk_rows = cursor.fetchall()
    citations = [
        {
            "filename": row[0],
            "chunk": row[1],
            "snippet": row[2][:260] + ("..." if len(row[2]) > 260 else "")
        }
        for row in chunk_rows
    ]

    conn.close()
    return {"results": results, "citations": citations}

@app.get("/files/list")
async def list_files():
    upload_dir = "uploads"
    if not os.path.exists(upload_dir):
        return {"files": []}
    return {"files": os.listdir(upload_dir)}

@app.get("/files/read/{filename}")
async def read_file(filename: str):
    file_path = os.path.join("uploads", filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    return {"filename": filename, "content": content}

@app.post("/tools/system")
async def system_tool(command: str):
    # DANGEROUS: Only for local use as requested
    import subprocess
    try:
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        return {"stdout": result.stdout, "stderr": result.stderr}
    except Exception as e:
        return {"error": str(e)}


@app.post("/tools/suggest-command")
async def suggest_command(request: CommandSuggestionRequest):
    prompt = (request.query or "").strip().lower()
    suggestions = []

    if not prompt:
        return {"suggestions": []}

    if "install" in prompt or "dependency" in prompt:
        suggestions.extend([
            {"label": "Install npm dependencies", "command": "npm install"},
            {"label": "Install Python dependencies", "command": "venv\\Scripts\\pip install -r api\\requirements.txt"}
        ])
    if "run" in prompt or "start" in prompt or "dev" in prompt:
        suggestions.extend([
            {"label": "Start backend", "command": "npm run dev:lite"},
            {"label": "Start frontend (lite)", "command": "npm run dev:ui:lite"}
        ])
    if "test" in prompt:
        suggestions.extend([
            {"label": "Run frontend lint", "command": "npm run lint"},
            {"label": "Syntax check backend", "command": "venv\\Scripts\\python -m py_compile api\\main.py"}
        ])
    if "port" in prompt or "address in use" in prompt:
        suggestions.append(
            {"label": "See listeners on 3000/8000", "command": "Get-NetTCPConnection -LocalPort 3000,8000 -State Listen"}
        )

    if not suggestions:
        suggestions = [
            {"label": "Show project files", "command": "Get-ChildItem"},
            {"label": "Check backend health", "command": "Invoke-WebRequest -Uri http://localhost:8000/health -UseBasicParsing"}
        ]

    return {"suggestions": suggestions[:6]}

if __name__ == "__main__":
    import uvicorn

    def _port_is_in_use(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            return sock.connect_ex(("127.0.0.1", port)) == 0

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    if _port_is_in_use(port):
        logger.warning(
            "Port %s is already in use. Backend may already be running. "
            "Set PORT to a different value if you want a second instance.",
            port,
        )
    else:
        uvicorn.run(app, host=host, port=port)
