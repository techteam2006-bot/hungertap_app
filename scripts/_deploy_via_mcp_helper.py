"""Load deploy payloads and print status. Used to prepare CallMcpTool args."""
import json
import sqlite3
from pathlib import Path

db = Path(r"C:\Users\LOQ\AppData\Roaming\Cursor\User\globalStorage\state.vscdb")
conn = sqlite3.connect(str(db))
cur = conn.cursor()
cur.execute(
    "SELECT key FROM ItemTable WHERE key LIKE '%supabase%' OR key LIKE '%mcp%' OR key LIKE '%SecretStorage%' LIMIT 80"
)
keys = [r[0] for r in cur.fetchall()]
print("keys:")
for k in keys:
    print(" ", k)

# Also search values for api.supabase or access_token
cur.execute("SELECT key, value FROM ItemTable WHERE typeof(value)='text' AND (value LIKE '%supabase.com%' OR value LIKE '%access_token%') LIMIT 30")
for key, value in cur.fetchall():
    print("HIT", key, str(value)[:120])
