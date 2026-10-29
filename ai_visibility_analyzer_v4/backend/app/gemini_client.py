"""
Shared Gemini client used by the analyzer, the advisor and the blog writer.

Robust by design, because Gemini setups differ a lot between students:
  * Two endpoints: Google AI Studio (generativelanguage.googleapis.com) and Vertex AI express mode
    (aiplatform.googleapis.com). Whichever accepts the key is remembered.
  * Model fallback: if a model is retired, unavailable or out of free-tier quota, the next one is tried.
  * Rate limits: 429 responses are retried after the delay Google asks for.
  * Thinking models: their hidden reasoning counts against maxOutputTokens, so extra room is added;
    otherwise long sections come back cut off or empty.
  * The key is sent in the x-goog-api-key header, never in the URL, so it doesn't end up in logs.

Configure in backend/.env:
  GEMINI_API_KEY=...
  GEMINI_MODEL=...         (optional: model for analysis answers, tried first)
  WRITER_MODEL=...         (optional: model for blog writing, tried first)
  GEMINI_ENDPOINT=ai_studio | vertex   (optional: skip auto-detection)
Run `python check_gemini.py` from the backend folder to test your key.
"""
from __future__ import annotations

import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional, Tuple

import requests

ENDPOINTS = {
    "ai_studio": "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
    "vertex": "https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:generateContent",
}
# Best first. Stable names are preferred; "-latest" aliases are a safety net.
WRITING_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-pro-latest", "gemini-flash-latest"]
FAST_MODELS = ["gemini-2.5-flash", "gemini-flash-latest", "gemini-2.5-flash-lite"]

_lock = threading.Lock()
_state: Dict[str, object] = {"endpoint": None, "dead_models": set()}


class GeminiError(RuntimeError):
    pass


def api_key() -> Optional[str]:
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")


def _endpoint_order() -> List[str]:
    forced = os.getenv("GEMINI_ENDPOINT", "").strip().lower()
    if forced in ENDPOINTS:
        return [forced]
    known = _state["endpoint"]
    if known:
        return [known]  # type: ignore[list-item]
    key = api_key() or ""
    # Classic AI Studio keys start with "AIza"; other formats are tried on Vertex first.
    return ["ai_studio", "vertex"] if key.startswith("AIza") else ["vertex", "ai_studio"]


def _retry_delay(resp: requests.Response) -> float:
    try:
        for d in resp.json().get("error", {}).get("details", []):
            if "retryDelay" in d:
                return float(str(d["retryDelay"]).rstrip("s"))
    except Exception:
        pass
    return 8.0


def _classify(resp: requests.Response) -> str:
    text = resp.text.lower()
    if resp.status_code in (401, 403) or "api key not valid" in text or "api_key_invalid" in text \
            or "unauthenticated" in text or "permission_denied" in text:
        return "auth"
    if resp.status_code == 404 or "not found" in text or "is not supported" in text or "unknown model" in text:
        return "model"
    if resp.status_code == 429:
        return "quota_day" if re.search(r"per ?day|perday|daily", text) else "rate"
    if resp.status_code >= 500:
        return "server"
    return "other"


def generate_raw(system: str, user: str, *, models: List[str], temperature: float = 0.5,
                 max_tokens: int = 2000, json_mode: bool = False, tools: Optional[list] = None,
                 timeout: int = 180) -> Tuple[dict, str]:
    """Returns (response_json, model_used). Raises GeminiError with a readable message."""
    key = api_key()
    if not key:
        raise GeminiError("GEMINI_API_KEY is not set in backend/.env")
    cfg = {"temperature": temperature, "maxOutputTokens": max_tokens + 6000}  # room for thinking tokens
    if json_mode and not tools:  # Google doesn't allow JSON mode together with search grounding
        cfg["responseMimeType"] = "application/json"
    body = {"contents": [{"role": "user", "parts": [{"text": user}]}], "generationConfig": cfg}
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    if tools:
        body["tools"] = tools
    headers = {"x-goog-api-key": key, "Content-Type": "application/json"}

    candidates = [m for m in dict.fromkeys(models) if m and m not in _state["dead_models"]] or list(models)
    errors = []
    for endpoint in _endpoint_order():
        auth_failed = net_failed = False
        for model in candidates:
            for attempt in range(3):
                try:
                    r = requests.post(ENDPOINTS[endpoint].format(model=model), headers=headers, json=body, timeout=timeout)
                except requests.RequestException as e:
                    errors.append(f"{endpoint}/{model}: network error ({type(e).__name__})")
                    if attempt >= 1:  # the endpoint itself is unreachable; other models won't help
                        net_failed = True
                        break
                    time.sleep(2)
                    continue
                if r.ok:
                    with _lock:
                        _state["endpoint"] = endpoint
                    return r.json(), model
                kind = _classify(r)
                errors.append(f"{endpoint}/{model}: HTTP {r.status_code} {r.text[:160]}")
                if kind == "rate" and attempt < 2:
                    time.sleep(min(_retry_delay(r), 30))
                    continue
                if kind == "server" and attempt < 1:
                    time.sleep(3)
                    continue
                if kind in ("model", "quota_day"):
                    with _lock:
                        _state["dead_models"].add(model)  # type: ignore[union-attr]
                if kind == "auth":
                    auth_failed = True
                break
            if auth_failed or net_failed:
                break  # this endpoint rejects the key or can't be reached; try the other endpoint
    hint = ""
    if errors and all("network error" in e for e in errors):
        hint = " Couldn't reach Google's servers: check your internet connection, VPN or firewall."
    elif any("401" in e or "403" in e or "api key not valid" in e.lower() for e in errors):
        hint = " Google rejected the key on both endpoints: check GEMINI_API_KEY in backend/.env."
    elif any("429" in e for e in errors):
        hint = " Rate limit or free-tier quota reached: wait a minute, or lower WRITER_WORKERS."
    raise GeminiError("Gemini request failed." + hint + " Details: " + " | ".join(errors[-3:]))


def response_text(data: dict) -> str:
    cands = data.get("candidates") or []
    if not cands:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "no candidates returned")
        raise GeminiError(f"Gemini returned no answer ({reason}).")
    parts = (cands[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if not text.strip():
        raise GeminiError(f"Gemini returned an empty answer (finishReason: {cands[0].get('finishReason')}).")
    return text


def generate(system: str, user: str, *, models: List[str], **kw) -> str:
    data, _ = generate_raw(system, user, models=models, **kw)
    return response_text(data)


def _resolve(url: str) -> str:
    """Grounding links are Google redirect URLs; follow one hop to the real page."""
    if "grounding-api-redirect" not in url:
        return url
    try:
        r = requests.get(url, allow_redirects=False, timeout=8, stream=True)
        return r.headers.get("Location", url)
    except requests.RequestException:
        return url


def grounded_search(prompt: str, models: Optional[List[str]] = None) -> Tuple[str, List[Dict[str, str]]]:
    """Answer a question using Google Search grounding. Returns (text, [{"url", "title"}])."""
    data, _ = generate_raw("", prompt, models=models or FAST_MODELS, temperature=0.2, max_tokens=1500,
                           tools=[{"google_search": {}}])
    text = response_text(data)
    meta = (data.get("candidates") or [{}])[0].get("groundingMetadata") or {}
    chunks = [c.get("web") or {} for c in meta.get("groundingChunks", [])]
    raw = [(c.get("uri"), c.get("title", "")) for c in chunks if c.get("uri")]
    with ThreadPoolExecutor(max_workers=6) as pool:
        urls = list(pool.map(_resolve, [u for u, _ in raw]))
    sources, seen = [], set()
    for (_, title), url in zip(raw, urls):
        if url not in seen:
            seen.add(url)
            sources.append({"url": url, "title": title})
    # Grounded text carries no inline markers by default; strip any stray ones
    return re.sub(r"\s*\[\d+(?:,\s*\d+)*\]", "", text), sources


def writing_models() -> List[str]:
    return [m for m in [os.getenv("WRITER_MODEL")] if m] + WRITING_MODELS


def fast_models() -> List[str]:
    return [m for m in [os.getenv("GEMINI_MODEL")] if m] + FAST_MODELS
