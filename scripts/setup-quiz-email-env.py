#!/usr/bin/env python3
"""Load RESEND key from site-design/.env and push to Vercel resilience-quiz project (no secret prints)."""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / "site-design" / ".env"


def parse_env(path: Path) -> dict:
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        out[k.strip()] = v
    return out


def main():
    if not ENV_PATH.exists():
        print("Missing", ENV_PATH)
        sys.exit(1)
    env = parse_env(ENV_PATH)
    key = env.get("RESEND_API_KEY") or env.get("RESEND_KEY")
    if not key:
        print("No RESEND_API_KEY in site-design/.env")
        sys.exit(1)
    print("Found RESEND_API_KEY len=", len(key), "prefix=", key[:5] + "…")

    mail_from = env.get("MAIL_FROM") or "Expanding Edge <info@expandingedge.ca>"
    mail_bcc = env.get("MAIL_BCC") or env.get("RESEND_FALLBACK_TO") or ""

    # Write temp files for vercel env add --stdin if available, else echo pipe
    pairs = {
        "RESEND_API_KEY": key,
        "MAIL_FROM": mail_from,
    }
    if mail_bcc:
        pairs["MAIL_BCC"] = mail_bcc
        print("MAIL_BCC set (hidden)")
    print("MAIL_FROM:", mail_from)

    for name, value in pairs.items():
        for target in ("production", "preview", "development"):
            # Remove existing if present (ignore errors)
            subprocess.run(
                ["vercel.cmd", "env", "rm", name, target, "--yes"],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            p = subprocess.run(
                ["vercel.cmd", "env", "add", name, target],
                cwd=ROOT,
                input=value + "\n",
                capture_output=True,
                text=True,
            )
            if p.returncode != 0:
                print(f"FAIL {name} {target}:", (p.stderr or p.stdout)[:300])
            else:
                print(f"OK {name} → {target}")


if __name__ == "__main__":
    main()
