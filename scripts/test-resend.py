#!/usr/bin/env python3
"""Diagnose Resend send without printing secrets."""
import json
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
env = {}
for line in (ROOT / "site-design" / ".env").read_text(encoding="utf-8").splitlines():
    if not line.strip() or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip().strip('"').strip("'")

key = env.get("RESEND_API_KEY")
mail_from = env.get("MAIL_FROM") or "Expanding Edge <info@expandingedge.ca>"
print("key prefix", key[:6] if key else None, "len", len(key or ""))
print("from", mail_from)

# 1) domains list
for path in ("/domains", "/api-keys"):
    req = urllib.request.Request(
        "https://api.resend.com" + path,
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode())
            print(path, "OK", json.dumps(data)[:500])
    except urllib.error.HTTPError as e:
        print(path, "HTTP", e.code, e.read().decode()[:400])

# 2) try send with domain from + fallbacks
froms = [
    mail_from,
    "Expanding Edge <onboarding@resend.dev>",
    "Resilience Quiz <onboarding@resend.dev>",
]
to = "delivered@resend.dev"  # Resend test sink
for fr in froms:
    body = json.dumps({
        "from": fr,
        "to": [to],
        "subject": "Resilience quiz delivery test",
        "html": "<p>Test report body from Expanding Edge quiz.</p>",
    }).encode()
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("SEND OK from", fr, r.read().decode()[:200])
            break
    except urllib.error.HTTPError as e:
        print("SEND FAIL from", fr, e.code, e.read().decode()[:400])
