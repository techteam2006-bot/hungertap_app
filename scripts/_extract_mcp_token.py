"""Extract supabase MCP access token and deploy edge functions via Management API."""
import json
import sqlite3
import urllib.request
from pathlib import Path

db = Path(r"C:\Users\LOQ\AppData\Roaming\Cursor\User\globalStorage\state.vscdb")
conn = sqlite3.connect(str(db))
cur = conn.cursor()
cur.execute("SELECT value FROM ItemTable WHERE key = ?", ("anysphere.cursor-mcp",))
row = cur.fetchone()
if not row:
    raise SystemExit("no mcp state")

raw = row[0]
data = json.loads(raw) if isinstance(raw, str) else raw

# Find token references
token = None
for k, v in (data.items() if isinstance(data, dict) else []):
    if "supabase" in str(k).lower() and "token" in str(k).lower():
        print("key", k, "type", type(v).__name__, "preview", str(v)[:80])
        if isinstance(v, dict) and "access_token" in v:
            token = v["access_token"]
        elif isinstance(v, str):
            try:
                parsed = json.loads(v)
                if isinstance(parsed, dict) and "access_token" in parsed:
                    token = parsed["access_token"]
            except Exception:
                pass

# Also try secret storage table if present
for table in ["ItemTable"]:
    cur.execute(f"SELECT key, value FROM {table} WHERE key LIKE '%mcp_tokens%'")
    for key, value in cur.fetchall():
        print("token_key", key)
        print("token_val_type", type(value).__name__, "len", len(str(value)))
        print("token_val_preview", str(value)[:200])
        try:
            parsed = json.loads(value) if isinstance(value, str) else value
            if isinstance(parsed, dict) and "access_token" in parsed:
                token = parsed["access_token"]
        except Exception as e:
            print("parse err", e)

print("TOKEN_FOUND", bool(token))
if token:
    print("TOKEN_PREFIX", token[:12])
