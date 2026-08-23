#!/usr/bin/env python3
"""Probe the configured OpenAI-compatible endpoint. Never prints the API key."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def request_json(url: str, api_key: str, body: dict | None = None) -> tuple[int, dict]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        text = exc.read().decode("utf-8", "ignore")[:240]
        return exc.code, {"error": text}


def main() -> None:
    env = load_env(Path(__file__).resolve().parents[1] / ".env")
    base = env["LLM_BASE_URL"].rstrip("/")
    key = env["LLM_API_KEY"]
    model = env["LLM_MODEL"]
    print("base", base)
    print("model", model)

    code, payload = request_json(f"{base}/models", key)
    if code == 200:
        ids = [item.get("id") for item in payload.get("data") or []]
        print("models", len(ids))
        for item in ids[:20]:
            print(" -", item)
    else:
        print("models_status", code)

    for name in [model, "gpt-5.6-sol", "openai/gpt-5.6-sol"]:
        code, payload = request_json(
            f"{base}/chat/completions",
            key,
            {
                "model": name,
                "temperature": 0,
                "max_tokens": 32,
                "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
            },
        )
        content = ((payload.get("choices") or [{}])[0].get("message") or {}).get("content")
        print("chat", name, code, (content or str(payload.get("error", payload)))[:160])

    code, payload = request_json(
        f"{base}/responses",
        key,
        {"model": model, "input": "Reply with exactly: ok"},
    )
    print("responses", code, str(payload)[:180])


if __name__ == "__main__":
    main()
