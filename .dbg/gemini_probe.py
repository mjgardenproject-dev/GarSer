from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def load_env(path: str = ".env") -> dict[str, str]:
    values: dict[str, str] = {}
    env_path = Path(path)
    if not env_path.exists():
        return values
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def invoke(payload: dict[str, object]) -> dict[str, object]:
    env = load_env()
    url = env["VITE_SUPABASE_URL"].rstrip("/") + "/functions/v1/ai-pricing-estimator"
    key = env.get("VITE_SUPABASE_ANON_KEY") or env.get("VITE_SUPABASE_PUBLISHABLE_KEY")
    if not key:
      raise RuntimeError("Missing Supabase public key in .env")

    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
            return {
                "http_status": response.status,
                "body": body,
            }
    except urllib.error.HTTPError as error:
        return {
            "http_error": error.code,
            "body": error.read().decode("utf-8"),
        }


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python3 .dbg/gemini_probe.py '<json-payload>'")

    payload = json.loads(sys.argv[1])
    result = invoke(payload)
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
