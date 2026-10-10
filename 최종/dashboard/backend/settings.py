import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_PATH = Path(os.getenv('DATABASE_PATH', '/tmp/ott_pulse.sqlite3' if os.getenv('VERCEL') else str(ROOT / 'runtime' / 'ott_pulse.sqlite3')))
DATA_PATH = Path(os.getenv('DATA_JS_PATH', str(ROOT / 'data.js')))
WEB_DIST = ROOT / 'web' / 'dist'
ADMIN_TOKEN = os.getenv('ADMIN_TOKEN', '')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY', '')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-5.4-mini')
# Reasoning models (gpt-5.x, o-series) accept this; leave empty for gpt-4.x models.
OPENAI_REASONING_EFFORT = os.getenv('OPENAI_REASONING_EFFORT', 'low').strip()
OPENAI_CONNECT_TIMEOUT_SECONDS = float(os.getenv('OPENAI_CONNECT_TIMEOUT_SECONDS', '10'))
OPENAI_READ_TIMEOUT_SECONDS = float(os.getenv('OPENAI_READ_TIMEOUT_SECONDS', '90'))
OPENAI_MAX_RETRIES = max(0, min(2, int(os.getenv('OPENAI_MAX_RETRIES', '1'))))
# Public AI endpoints (strategy/chat/relations analyze) spend OpenAI credits: per-client-IP sliding window.
# AI_RATE_LIMIT=0 disables the limit.
AI_RATE_LIMIT = max(0, int(os.getenv('AI_RATE_LIMIT', '20')))
AI_RATE_WINDOW_SECONDS = max(1, int(os.getenv('AI_RATE_WINDOW_SECONDS', '600')))
# Use the first X-Forwarded-For hop as client IP only behind a trusted proxy (on by default on Vercel).
TRUST_PROXY_HEADERS = os.getenv('TRUST_PROXY_HEADERS', '1' if os.getenv('VERCEL') else '0').strip().lower() in ('1', 'true', 'yes')
ALLOWED_ORIGINS =[s.strip() for s in os.getenv('ALLOWED_ORIGINS', 'http://localhost:8000,http://127.0.0.1:8000').split(',') if s.strip()]
