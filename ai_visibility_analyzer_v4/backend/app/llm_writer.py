"""
Text-generation helper used by the Advisor and the Blog Writer.

Separate from llm_clients.py on purpose: llm_clients.py *measures* visibility
(it must send prompts exactly like a real user would), while this module *writes*
content and recommendations (it needs system prompts, JSON output, longer text).

Provider is chosen by env var WRITER_PROVIDER = openai | gemini | anthropic.
If no API key is set, `available` is False and callers use their mock fallback,
so the whole pipeline still runs for free during development.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any, Optional

import requests

DEFAULT_MODELS = {
    # Override with WRITER_MODEL - check the provider docs for current model names.
    "openai": "gpt-4o-mini",
    "gemini": "auto",  # gemini_client picks the best available model (see gemini_client.WRITING_MODELS)
    "anthropic": "claude-sonnet-5-5",
}


class TextGenerator:
    def __init__(self, provider: Optional[str] = None, model: Optional[str] = None, timeout: int = 90):
        self.provider = (provider or os.getenv("WRITER_PROVIDER", "openai")).lower()
        self.model = model or os.getenv("WRITER_MODEL") or DEFAULT_MODELS.get(self.provider, "")
        self.timeout = timeout
        key_env = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY",
                   "anthropic": "ANTHROPIC_API_KEY"}.get(self.provider)
        self.api_key = os.getenv(key_env) if key_env else None
        if self.provider == "gemini" and not self.api_key:
            self.api_key = os.getenv("GOOGLE_API_KEY")

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def complete(self, system: str, user: str, temperature: float = 0.4,
                 max_tokens: int = 3000, json_mode: bool = False) -> str:
        if not self.available:
            raise RuntimeError("No API key for writer provider - use mock fallback")
        if self.provider == "openai":
            return self._openai(system, user, temperature, max_tokens, json_mode)
        if self.provider == "gemini":
            return self._gemini(system, user, temperature, max_tokens, json_mode)
        if self.provider == "anthropic":
            return self._anthropic(system, user, temperature, max_tokens, json_mode)
        raise ValueError(f"Unknown WRITER_PROVIDER: {self.provider}")

    def complete_json(self, system: str, user: str, temperature: float = 0.3,
                      max_tokens: int = 3000) -> Any:
        raw = self.complete(system, user, temperature, max_tokens, json_mode=True)
        return extract_json(raw)

    # ---- providers (plain REST, so SDK version changes don't break the project) ----
    def _openai(self, system, user, temperature, max_tokens, json_mode):
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        r = requests.post("https://api.openai.com/v1/chat/completions",
                          headers={"Authorization": f"Bearer {self.api_key}"},
                          json=body, timeout=self.timeout)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    def _gemini(self, system, user, temperature, max_tokens, json_mode):
        from . import gemini_client
        models = ([self.model] if self.model and self.model != "auto" else []) + gemini_client.writing_models()
        return gemini_client.generate(system, user, models=models, temperature=temperature,
                                      max_tokens=max_tokens, json_mode=json_mode)

    def _anthropic(self, system, user, temperature, max_tokens, json_mode):
        if json_mode:
            system += "\nRespond with valid JSON only, no prose and no code fences."
        r = requests.post("https://api.anthropic.com/v1/messages", timeout=self.timeout,
                          headers={"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
                          json={"model": self.model, "max_tokens": max_tokens, "temperature": temperature,
                                "system": system, "messages": [{"role": "user", "content": user}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json()["content"] if b.get("type") == "text")


def extract_json(text: str) -> Any:
    """Parse JSON even if the model wrapped it in ```json fences or added chatter."""
    text = re.sub(r"```(?:json)?", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start, end = text.find(open_c), text.rfind(close_c)
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError("Model did not return valid JSON")
