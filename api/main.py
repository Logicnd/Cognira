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
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta, UTC
from fastapi import FastAPI, HTTPException, UploadFile, File, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from urllib.parse import urljoin

try:
    import stripe
except Exception:
    stripe = None

try:
    from ddgs import DDGS
except Exception:
    DDGS = None

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("lumiora_backend.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("Lumiora")

load_dotenv()

app = FastAPI(title="Lumiora API", version="1.0.0")


@app.get("/")
async def root():
    return {
        "service": "Lumiora API",
        "status": "running",
        "health": "/health",
        "models": "/models",
        "chat": "/chat"
    }

# Database Setup
DB_PATH = "lumiora.db"

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
        body = (top.get("body") or "").strip()
        href = (top.get("href") or "").strip()
        snippet = re.sub(r"\s+", " ", body)
        snippet = snippet[:180] + ("..." if len(snippet) > 180 else "")

        if snippet and href:
            return f"{snippet}\n\nSource: {href}"
        if snippet:
            return snippet
        if href:
            return f"Source: {href}"
        return "I could not generate a concise fallback answer right now."

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

    def ensure_column(table: str, column: str, definition: str):
        cursor.execute(f"PRAGMA table_info({table})")
        existing = {row[1] for row in cursor.fetchall()}
        if column not in existing:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
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

    # Local subscription state (single-user local app profile).
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS subscriptions (
            user_id TEXT PRIMARY KEY,
            plan TEXT NOT NULL,
            status TEXT NOT NULL,
            billing_cycle TEXT NOT NULL,
            amount_gbp INTEGER NOT NULL,
            renewal_date TEXT,
            provider_customer_id TEXT,
            provider_subscription_id TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    ensure_column("subscriptions", "provider_customer_id", "TEXT")
    ensure_column("subscriptions", "provider_subscription_id", "TEXT")

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS usage_counters (
            user_id TEXT NOT NULL,
            period_month TEXT NOT NULL,
            messages_used INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, period_month)
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS billing_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            old_plan TEXT,
            new_plan TEXT,
            billing_cycle TEXT,
            provider TEXT,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cursor.execute("SELECT user_id FROM subscriptions WHERE user_id = ?", ("local-user",))
    if not cursor.fetchone():
        cursor.execute(
            """
            INSERT INTO subscriptions (user_id, plan, status, billing_cycle, amount_gbp, renewal_date)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            ("local-user", "plus", "active", "monthly", 20, (datetime.now(UTC) + timedelta(days=30)).date().isoformat())
        )
    
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


PLAN_PRICING_GBP = {
    "plus": 20,
    "business": 30,
    "pro": 200,
}

PLAN_ENTITLEMENTS = {
    "plus": {
        "monthly_messages": 1200,
        "allow_cloud": False,
        "allowed_model_tokens": ["llama", "mistral", "qwen", "phi", "free"],
    },
    "business": {
        "monthly_messages": 7000,
        "allow_cloud": True,
        "allowed_model_tokens": ["llama", "mistral", "qwen", "phi", "openai", "free"],
    },
    "pro": {
        "monthly_messages": -1,
        "allow_cloud": True,
        "allowed_model_tokens": ["*"],
    },
}


def _current_period_month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


def log_billing_event(
    event_type: str,
    old_plan: Optional[str] = None,
    new_plan: Optional[str] = None,
    billing_cycle: Optional[str] = None,
    provider: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
    user_id: str = "local-user",
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO billing_audit (user_id, event_type, old_plan, new_plan, billing_cycle, provider, details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            user_id,
            event_type,
            old_plan,
            new_plan,
            billing_cycle,
            provider,
            json.dumps(details or {}),
        ),
    )
    conn.commit()
    conn.close()


def get_usage_snapshot(user_id: str = "local-user") -> Dict[str, Any]:
    period_month = _current_period_month()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT messages_used FROM usage_counters
        WHERE user_id = ? AND period_month = ?
        """,
        (user_id, period_month),
    )
    row = cursor.fetchone()
    conn.close()
    return {
        "period_month": period_month,
        "messages_used": int(row[0]) if row else 0,
    }


def increment_usage_messages(user_id: str = "local-user", increment: int = 1):
    period_month = _current_period_month()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO usage_counters (user_id, period_month, messages_used, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, period_month) DO UPDATE SET
            messages_used = messages_used + excluded.messages_used,
            updated_at = CURRENT_TIMESTAMP
        """,
        (user_id, period_month, max(0, increment)),
    )
    conn.commit()
    conn.close()


def _is_model_allowed_for_plan(plan: str, model_name: str, use_local_model: bool) -> bool:
    entitlements = PLAN_ENTITLEMENTS.get(plan, PLAN_ENTITLEMENTS["plus"])
    normalized_model = strip_model_suffix(model_name).lower()

    if not use_local_model and not entitlements.get("allow_cloud", False):
        return False

    allowed_tokens = entitlements.get("allowed_model_tokens", [])
    if "*" in allowed_tokens:
        return True

    return any(token in normalized_model for token in allowed_tokens)


def get_entitlement_status(
    user_id: str = "local-user",
    requested_model: Optional[str] = None,
    use_local_model: Optional[bool] = None,
) -> Dict[str, Any]:
    subscription = get_subscription(user_id) or {
        "plan": "plus",
        "status": "active",
        "billing_cycle": "monthly",
        "amount_gbp": PLAN_PRICING_GBP["plus"],
    }
    plan = subscription.get("plan", "plus")
    entitlements = PLAN_ENTITLEMENTS.get(plan, PLAN_ENTITLEMENTS["plus"])
    usage = get_usage_snapshot(user_id)

    monthly_limit = int(entitlements.get("monthly_messages", 0))
    remaining = -1 if monthly_limit < 0 else max(0, monthly_limit - usage["messages_used"])
    model_allowed = True

    if requested_model and use_local_model is not None:
        model_allowed = _is_model_allowed_for_plan(plan, requested_model, use_local_model)

    return {
        "plan": plan,
        "status": subscription.get("status", "active"),
        "billing_cycle": subscription.get("billing_cycle", "monthly"),
        "usage": {
            "period_month": usage["period_month"],
            "messages_used": usage["messages_used"],
            "monthly_messages_limit": monthly_limit,
            "messages_remaining": remaining,
        },
        "rules": {
            "allow_cloud": bool(entitlements.get("allow_cloud", False)),
            "allowed_model_tokens": entitlements.get("allowed_model_tokens", []),
        },
        "model_allowed": model_allowed,
    }


def enforce_entitlements(user_id: str, requested_model: str, use_local_model: bool):
    status = get_entitlement_status(user_id, requested_model, use_local_model)

    if status["status"] != "active":
        log_billing_event(
            event_type="entitlement_blocked",
            old_plan=status["plan"],
            details={"reason": "subscription_inactive", "requested_model": requested_model},
            provider="entitlements",
            user_id=user_id,
        )
        raise HTTPException(status_code=402, detail="Subscription is not active. Update billing to continue.")

    if not status["model_allowed"]:
        log_billing_event(
            event_type="entitlement_blocked",
            old_plan=status["plan"],
            details={"reason": "model_not_allowed", "requested_model": requested_model},
            provider="entitlements",
            user_id=user_id,
        )
        raise HTTPException(
            status_code=403,
            detail=f"Model '{requested_model}' is not available on your {status['plan']} plan.",
        )

    limit = status["usage"]["monthly_messages_limit"]
    used = status["usage"]["messages_used"]
    if limit >= 0 and used >= limit:
        log_billing_event(
            event_type="entitlement_blocked",
            old_plan=status["plan"],
            details={"reason": "message_limit_reached", "limit": limit, "used": used},
            provider="entitlements",
            user_id=user_id,
        )
        raise HTTPException(
            status_code=429,
            detail=f"Monthly message limit reached ({used}/{limit}). Upgrade your plan to continue.",
        )


class CheckoutProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    def create_checkout_session(self, user_id: str, plan: str, billing_cycle: str) -> Dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def cancel_subscription(self, user_id: str) -> Dict[str, Any]:
        raise NotImplementedError


class LocalMockCheckoutProvider(CheckoutProvider):
    name = "mock"

    def create_checkout_session(self, user_id: str, plan: str, billing_cycle: str) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "checkout_session_id": f"mock_{user_id}_{plan}_{int(datetime.now(UTC).timestamp())}",
            "mode": "simulation",
            "status": "completed",
            "billing_cycle": billing_cycle,
        }

    def cancel_subscription(self, user_id: str) -> Dict[str, Any]:
        return {
            "provider": self.name,
            "cancellation_id": f"mock_cancel_{user_id}_{int(datetime.now(UTC).timestamp())}",
            "mode": "simulation",
            "status": "completed",
        }


class StripeCheckoutProvider(CheckoutProvider):
    name = "stripe"

    def __init__(self, secret_key: str):
        self.secret_key = secret_key
        if stripe is None:
            raise RuntimeError("Stripe SDK is not installed. Run pip install -r api/requirements.txt.")
        if self.secret_key:
            stripe.api_key = self.secret_key

    def _get_price_id(self, plan: str, billing_cycle: str) -> str:
        price_id = STRIPE_PRICE_IDS.get(plan, {}).get(billing_cycle, "")
        if not price_id and billing_cycle == "yearly":
            price_id = STRIPE_PRICE_IDS.get(plan, {}).get("monthly", "")
        if not price_id:
            raise RuntimeError(
                f"Missing Stripe price id for plan={plan}, billing_cycle={billing_cycle}. "
                "Set STRIPE_PRICE_ID_* environment variables."
            )
        return price_id

    def create_checkout_session(self, user_id: str, plan: str, billing_cycle: str) -> Dict[str, Any]:
        if not self.secret_key:
            raise RuntimeError("Stripe provider is not configured. Set STRIPE_SECRET_KEY.")

        price_id = self._get_price_id(plan, billing_cycle)
        session = stripe.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": price_id, "quantity": 1}],
            success_url=STRIPE_SUCCESS_URL,
            cancel_url=STRIPE_CANCEL_URL,
            metadata={
                "user_id": user_id,
                "plan": plan,
                "billing_cycle": billing_cycle,
            },
        )
        return {
            "provider": self.name,
            "checkout_session_id": session.get("id"),
            "checkout_url": session.get("url"),
            "mode": "live",
            "status": session.get("status", "created"),
            "billing_cycle": billing_cycle,
        }

    def cancel_subscription(self, user_id: str) -> Dict[str, Any]:
        if not self.secret_key:
            raise RuntimeError("Stripe provider is not configured. Set STRIPE_SECRET_KEY.")

        subscription = get_subscription(user_id)
        provider_subscription_id = (subscription or {}).get("provider_subscription_id")
        if not provider_subscription_id:
            raise RuntimeError(
                "No Stripe subscription id stored for this user yet. "
                "Complete checkout first (webhook) before cancellation."
            )

        cancelled = stripe.Subscription.delete(provider_subscription_id)
        return {
            "provider": self.name,
            "cancellation_id": cancelled.get("id"),
            "mode": "live",
            "status": cancelled.get("status", "cancelled"),
        }


CHECKOUT_PROVIDER = os.getenv("CHECKOUT_PROVIDER", "mock").strip().lower()
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_BASE_URL = os.getenv("FRONTEND_BASE_URL", "http://localhost:3000")
STRIPE_SUCCESS_URL = os.getenv("STRIPE_SUCCESS_URL", urljoin(FRONTEND_BASE_URL, "/admin/billing?checkout=success"))
STRIPE_CANCEL_URL = os.getenv("STRIPE_CANCEL_URL", urljoin(FRONTEND_BASE_URL, "/admin/billing?checkout=cancelled"))

STRIPE_PRICE_IDS: Dict[str, Dict[str, str]] = {
    "plus": {
        "monthly": os.getenv("STRIPE_PRICE_ID_PLUS_MONTHLY", ""),
        "yearly": os.getenv("STRIPE_PRICE_ID_PLUS_YEARLY", ""),
    },
    "business": {
        "monthly": os.getenv("STRIPE_PRICE_ID_BUSINESS_MONTHLY", ""),
        "yearly": os.getenv("STRIPE_PRICE_ID_BUSINESS_YEARLY", ""),
    },
    "pro": {
        "monthly": os.getenv("STRIPE_PRICE_ID_PRO_MONTHLY", ""),
        "yearly": os.getenv("STRIPE_PRICE_ID_PRO_YEARLY", ""),
    },
}


def get_checkout_provider() -> CheckoutProvider:
    if CHECKOUT_PROVIDER == "stripe":
        return StripeCheckoutProvider(STRIPE_SECRET_KEY)
    return LocalMockCheckoutProvider()


def get_subscription(user_id: str = "local-user"):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT plan, status, billing_cycle, amount_gbp, renewal_date, updated_at
               , provider_customer_id, provider_subscription_id
        FROM subscriptions
        WHERE user_id = ?
        """,
        (user_id,),
    )
    row = cursor.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "user_id": user_id,
        "plan": row[0],
        "status": row[1],
        "billing_cycle": row[2],
        "amount_gbp": row[3],
        "renewal_date": row[4],
        "updated_at": row[5],
        "provider_customer_id": row[6],
        "provider_subscription_id": row[7],
    }


def set_subscription(
    plan: str,
    billing_cycle: str = "monthly",
    user_id: str = "local-user",
    provider_customer_id: Optional[str] = None,
    provider_subscription_id: Optional[str] = None,
):
    normalized_plan = (plan or "").strip().lower()
    if normalized_plan not in PLAN_PRICING_GBP:
        raise ValueError("invalid plan")

    normalized_cycle = "yearly" if (billing_cycle or "").strip().lower() == "yearly" else "monthly"
    amount = PLAN_PRICING_GBP[normalized_plan]
    if normalized_cycle == "yearly":
        amount *= 12

    renewal_delta = timedelta(days=365 if normalized_cycle == "yearly" else 30)
    renewal_date = (datetime.now(UTC) + renewal_delta).date().isoformat()

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO subscriptions (
            user_id,
            plan,
            status,
            billing_cycle,
            amount_gbp,
            renewal_date,
            provider_customer_id,
            provider_subscription_id,
            updated_at
        )
        VALUES (?, ?, 'active', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            plan=excluded.plan,
            status='active',
            billing_cycle=excluded.billing_cycle,
            amount_gbp=excluded.amount_gbp,
            renewal_date=excluded.renewal_date,
            provider_customer_id=COALESCE(excluded.provider_customer_id, subscriptions.provider_customer_id),
            provider_subscription_id=COALESCE(excluded.provider_subscription_id, subscriptions.provider_subscription_id),
            updated_at=CURRENT_TIMESTAMP
        """,
        (
            user_id,
            normalized_plan,
            normalized_cycle,
            amount,
            renewal_date,
            provider_customer_id,
            provider_subscription_id,
        ),
    )
    conn.commit()
    conn.close()


def cancel_subscription(user_id: str = "local-user"):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE subscriptions
        SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
        """,
        (user_id,),
    )
    conn.commit()
    conn.close()


def update_subscription_status(
    user_id: str,
    status: str,
    provider_customer_id: Optional[str] = None,
    provider_subscription_id: Optional[str] = None,
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE subscriptions
        SET
            status = ?,
            provider_customer_id = COALESCE(?, provider_customer_id),
            provider_subscription_id = COALESCE(?, provider_subscription_id),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
        """,
        (status, provider_customer_id, provider_subscription_id, user_id),
    )
    conn.commit()
    conn.close()


def get_user_by_provider_customer_id(provider_customer_id: str) -> Optional[str]:
    if not provider_customer_id:
        return None

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT user_id FROM subscriptions
        WHERE provider_customer_id = ?
        LIMIT 1
        """,
        (provider_customer_id,),
    )
    row = cursor.fetchone()
    conn.close()
    return row[0] if row else None

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
DEFAULT_LOCAL_MODEL = os.getenv("DEFAULT_LOCAL_MODEL", "llama3")
ENABLE_CLOUD_MODELS = os.getenv("ENABLE_CLOUD_MODELS", "true").lower() == "true"
HF_INFERENCE_MODEL = os.getenv("HF_INFERENCE_MODEL", "TinyLlama/TinyLlama-1.1B-Chat-v1.0")
HF_API_TOKEN = os.getenv("HF_API_TOKEN", "")
FREE_MODEL_CANDIDATES = [
    model.strip() for model in os.getenv(
        "FREE_MODEL_CANDIDATES",
        f"{HF_INFERENCE_MODEL},Qwen/Qwen2.5-1.5B-Instruct,google/flan-t5-base"
    ).split(",") if model.strip()
]


def _build_free_prompt(messages: List[Message]) -> str:
    # Keep a compact prompt to improve latency for free providers.
    prompt_parts = [
        "You are Lumiora. Give direct, practical, and concise answers.",
        "If the user asks for translation, return the translated phrase first."
    ]

    recent = messages[-8:]
    for msg in recent:
        role = "User" if msg.role == "user" else "Assistant"
        prompt_parts.append(f"{role}: {msg.content}")
    prompt_parts.append("Assistant:")
    return "\n".join(prompt_parts)


def _clean_free_model_output(prompt: str, text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return ""

    # Remove prompt echoes if provider ignored return_full_text.
    if cleaned.startswith(prompt):
        cleaned = cleaned[len(prompt):].strip()

    for prefix in ("Assistant:", "assistant:", "Answer:", "answer:"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):].strip()

    # Collapse overly long outputs in free mode for better UX consistency.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    if len(cleaned) > 1400:
        cleaned = cleaned[:1400].rstrip() + "..."

    return cleaned


async def generate_free_llm_answer(messages: List[Message]) -> Optional[str]:
    prompt = _build_free_prompt(messages)
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
            for candidate_model in FREE_MODEL_CANDIDATES:
                endpoint = f"https://api-inference.huggingface.co/models/{candidate_model}"
                try:
                    response = await client.post(endpoint, headers=headers, json=payload)
                    if response.status_code >= 400:
                        logger.warning(
                            f"HF model {candidate_model} failed with status {response.status_code}: {response.text[:180]}"
                        )
                        continue

                    data = response.json()
                    if isinstance(data, dict) and data.get("error"):
                        logger.warning(f"HF model {candidate_model} error: {data.get('error')}")
                        continue

                    if isinstance(data, list) and data:
                        first = data[0]
                        text = ""
                        if isinstance(first, dict):
                            text = (first.get("generated_text") or first.get("summary_text") or "").strip()
                        cleaned_text = _clean_free_model_output(prompt, text)
                        if cleaned_text:
                            logger.info(f"HF free model success: {candidate_model}")
                            return cleaned_text
                except Exception as model_error:
                    logger.warning(f"HF model {candidate_model} request failed: {model_error}")
                    continue
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


class SubscriptionUpdateRequest(BaseModel):
    plan: str
    billing_cycle: Optional[str] = "monthly"

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


@app.get("/billing/subscription")
async def billing_subscription():
    subscription = get_subscription()
    if not subscription:
        raise HTTPException(status_code=404, detail="Subscription not found")
    return {"subscription": subscription}


@app.get("/billing/entitlements")
async def billing_entitlements():
    return {"entitlements": get_entitlement_status()}


@app.get("/billing/audit")
async def billing_audit(limit: int = 100):
    safe_limit = max(1, min(limit, 500))
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, user_id, event_type, old_plan, new_plan, billing_cycle, provider, details, created_at
        FROM billing_audit
        ORDER BY id DESC
        LIMIT ?
        """,
        (safe_limit,),
    )
    rows = cursor.fetchall()
    conn.close()

    events = []
    for row in rows:
        details = {}
        if row[7]:
            try:
                details = json.loads(row[7])
            except Exception:
                details = {"raw": row[7]}

        events.append({
            "id": row[0],
            "user_id": row[1],
            "event_type": row[2],
            "old_plan": row[3],
            "new_plan": row[4],
            "billing_cycle": row[5],
            "provider": row[6],
            "details": details,
            "created_at": row[8],
        })

    return {"events": events}


@app.get("/billing/provider")
async def billing_provider():
    provider = get_checkout_provider()
    return {
        "provider": provider.name,
        "stripe_sdk_available": stripe is not None,
        "stripe_configured": bool(STRIPE_SECRET_KEY),
        "stripe_webhook_configured": bool(STRIPE_WEBHOOK_SECRET),
    }


@app.post("/billing/subscribe")
async def billing_subscribe(request: SubscriptionUpdateRequest):
    previous_subscription = get_subscription()
    previous_plan = previous_subscription["plan"] if previous_subscription else None
    provider = get_checkout_provider()

    normalized_cycle = "yearly" if (request.billing_cycle or "").strip().lower() == "yearly" else "monthly"

    try:
        checkout_result = provider.create_checkout_session(
            user_id="local-user",
            plan=request.plan,
            billing_cycle=normalized_cycle,
        )

        if provider.name == "stripe":
            log_billing_event(
                event_type="checkout_session_created",
                old_plan=previous_plan,
                new_plan=request.plan,
                billing_cycle=normalized_cycle,
                provider=provider.name,
                details={"checkout": checkout_result},
            )
            return {
                "status": "pending_checkout",
                "provider": provider.name,
                "checkout": checkout_result,
            }

        set_subscription(request.plan, normalized_cycle)
        updated_subscription = get_subscription()
        log_billing_event(
            event_type="plan_changed",
            old_plan=previous_plan,
            new_plan=updated_subscription["plan"] if updated_subscription else request.plan,
            billing_cycle=updated_subscription["billing_cycle"] if updated_subscription else normalized_cycle,
            provider=provider.name,
            details={"checkout": checkout_result},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    subscription = get_subscription()
    return {"status": "updated", "subscription": subscription, "provider": provider.name}


@app.post("/billing/cancel")
async def billing_cancel():
    provider = get_checkout_provider()
    previous_subscription = get_subscription()

    try:
        cancellation = provider.cancel_subscription("local-user")
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    cancel_subscription()
    subscription = get_subscription()
    log_billing_event(
        event_type="subscription_cancelled",
        old_plan=previous_subscription["plan"] if previous_subscription else None,
        new_plan=subscription["plan"] if subscription else None,
        billing_cycle=subscription["billing_cycle"] if subscription else None,
        provider=provider.name,
        details={"cancellation": cancellation},
    )
    return {"status": "cancelled", "subscription": subscription, "provider": provider.name}


@app.post("/billing/webhook/stripe")
async def billing_stripe_webhook(
    request: Request,
    stripe_signature: Optional[str] = Header(default=None, alias="Stripe-Signature"),
):
    if stripe is None:
        raise HTTPException(status_code=400, detail="Stripe SDK is not installed.")

    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=400, detail="Stripe webhook is not configured. Set STRIPE_WEBHOOK_SECRET.")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload=payload, sig_header=stripe_signature, secret=STRIPE_WEBHOOK_SECRET)
    except Exception as webhook_error:
        logger.warning(f"Stripe webhook signature validation failed: {webhook_error}")
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature")

    event_type = event.get("type", "unknown")
    data_object = (event.get("data") or {}).get("object", {})

    if event_type == "checkout.session.completed":
        metadata = data_object.get("metadata") or {}
        user_id = metadata.get("user_id", "local-user")
        plan = (metadata.get("plan") or "plus").lower()
        billing_cycle = (metadata.get("billing_cycle") or "monthly").lower()
        provider_customer_id = data_object.get("customer")
        provider_subscription_id = data_object.get("subscription")

        try:
            set_subscription(
                plan=plan,
                billing_cycle=billing_cycle,
                user_id=user_id,
                provider_customer_id=provider_customer_id,
                provider_subscription_id=provider_subscription_id,
            )
            log_billing_event(
                event_type="stripe_checkout_completed",
                old_plan=None,
                new_plan=plan,
                billing_cycle=billing_cycle,
                provider="stripe",
                details={
                    "event_id": event.get("id"),
                    "checkout_session_id": data_object.get("id"),
                    "provider_customer_id": provider_customer_id,
                    "provider_subscription_id": provider_subscription_id,
                },
                user_id=user_id,
            )
        except Exception as apply_error:
            logger.error(f"Failed to apply stripe checkout completion: {apply_error}")
            raise HTTPException(status_code=500, detail="Failed to apply checkout completion")

    elif event_type in {"customer.subscription.deleted", "customer.subscription.updated"}:
        provider_customer_id = data_object.get("customer")
        provider_subscription_id = data_object.get("id")
        status = (data_object.get("status") or "cancelled").lower()
        user_id = get_user_by_provider_customer_id(provider_customer_id) or "local-user"

        normalized_status = "cancelled" if status in {"canceled", "cancelled", "unpaid"} else status
        update_subscription_status(
            user_id=user_id,
            status=normalized_status,
            provider_customer_id=provider_customer_id,
            provider_subscription_id=provider_subscription_id,
        )
        log_billing_event(
            event_type="stripe_subscription_status_updated",
            old_plan=None,
            new_plan=(get_subscription(user_id) or {}).get("plan"),
            billing_cycle=(get_subscription(user_id) or {}).get("billing_cycle"),
            provider="stripe",
            details={
                "event_id": event.get("id"),
                "provider_customer_id": provider_customer_id,
                "provider_subscription_id": provider_subscription_id,
                "status": normalized_status,
            },
            user_id=user_id,
        )
    else:
        logger.info(f"Stripe webhook ignored event type: {event_type}")

    return {"received": True, "event_type": event_type}

@app.post("/chat")
async def chat(request: ChatRequest):
    requested_model = request.model or DEFAULT_MODEL
    use_local_model = should_use_local_model(requested_model)

    # Hard guardrail for no-paid/no-cloud mode.
    if not use_local_model and not ENABLE_CLOUD_MODELS:
        requested_model = f"{DEFAULT_LOCAL_MODEL} (Local)"
        use_local_model = True

    enforce_entitlements("local-user", requested_model, use_local_model)
    increment_usage_messages("local-user", 1)

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
                "content": "You are Lumiora, a high-performance AI in Developer Mode. Provide extremely detailed, technical, and accurate responses. Break down complex logic and provide raw reasoning where possible."
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
                    # Free mode prioritizes higher-quality cloud models first.
                    if selected_cloud_model == "free":
                        yield f"data: {json.dumps({'status': 'Trying free cloud models...', 'phase': 'cloud'})}\n\n"
                        attempt_models = ["openai", "mistral"]
                        if not any(m.get("role") == "system" for m in payload.get("messages", [])):
                            payload["messages"].insert(0, {
                                "role": "system",
                                "content": "You are Lumiora. Give a direct, accurate answer first. Avoid unnecessary verbosity."
                            })
                    else:
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

                    # Tertiary fallback for free mode: Hugging Face inference.
                    if selected_cloud_model == "free":
                        yield f"data: {json.dumps({'status': 'Trying backup free provider...', 'phase': 'cloud-attempt'})}\n\n"
                        free_answer = await generate_free_llm_answer(request.messages)
                        if free_answer:
                            save_message(request.session_id, "assistant", free_answer)
                            free_chunk = json.dumps({"message": {"role": "assistant", "content": free_answer}})
                            yield f"data: {free_chunk}\n\n"
                            yield f"data: {json.dumps({'done': True})}\n\n"
                            return
                        cloud_failure_reasons.append("hf-free: unavailable or low quality")

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
                if ENABLE_CLOUD_MODELS:
                    error_message = "The selected local model is unavailable. Start Ollama or pick a cloud model."
                else:
                    error_message = (
                        "The selected local model is unavailable and cloud providers are disabled by configuration. "
                        f"Start Ollama and pull a model such as '{DEFAULT_LOCAL_MODEL}'."
                    )
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
                "Lumiora is running in degraded mode because external AI providers are temporarily unavailable.\n\n"
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

    # 2. Cloud models are optional and can be disabled in no-paid mode.
    if ENABLE_CLOUD_MODELS:
        models.extend(SUPPORTED_CLOUD_MODELS)

    if not models:
        models.append({"name": f"{DEFAULT_LOCAL_MODEL} (Local)", "provider": "local-default"})

    entitlement = get_entitlement_status()
    plan = entitlement["plan"]
    filtered_models = []
    for model in models:
        model_name = model.get("name", "")
        model_is_local = model_name.lower().endswith("(local)") or model.get("provider", "").startswith("local")
        if _is_model_allowed_for_plan(plan, model_name, model_is_local):
            filtered_models.append(model)

    if not filtered_models:
        filtered_models.append({"name": f"{DEFAULT_LOCAL_MODEL} (Local)", "provider": "local-default"})
    
    return {"models": filtered_models, "entitlements": entitlement}

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
