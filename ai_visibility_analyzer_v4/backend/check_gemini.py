"""
Checks your Gemini key end to end. Run from the backend folder:
    python check_gemini.py
It never prints your full key.
"""
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

import requests  # noqa: E402

from app import gemini_client as g  # noqa: E402

key = g.api_key()
if not key:
    raise SystemExit("No key found. Add GEMINI_API_KEY=... to backend/.env (copy .env.example to .env first).")
print(f"Key loaded: {key[:4]}…{key[-4:]} ({len(key)} characters)")
if key.startswith("AIza"):
    print("Format: Google AI Studio key")
else:
    print("Format: not a classic AI Studio key (those start with 'AIza'). Will try both Google endpoints.")

# 1. Which models can this key see? (AI Studio only)
try:
    r = requests.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
                     headers={"x-goog-api-key": key}, timeout=30)
    if r.ok:
        names = [m["name"].split("/")[-1] for m in r.json().get("models", [])
                 if "generateContent" in m.get("supportedGenerationMethods", [])]
        gem = sorted(n for n in names if n.startswith("gemini"))
        print(f"\nAI Studio lists {len(gem)} Gemini text models, e.g.: {', '.join(gem[:12])}")
    else:
        print(f"\nAI Studio model list: HTTP {r.status_code} (normal for Vertex-only keys)")
except requests.RequestException as e:
    print(f"\nAI Studio model list: network error {e}")

# 2. A real generation through the same code the app uses
print("\nTesting text generation…")
try:
    data, model = g.generate_raw("", "Reply with exactly: OK", models=g.writing_models(), max_tokens=20)
    print(f"  Works: endpoint={g._state['endpoint']}, model={model}, reply={g.response_text(data).strip()[:40]!r}")
except g.GeminiError as e:
    raise SystemExit(f"  Failed: {e}")

# 3. Google Search grounding (used for blog research and 'where to get listed')
print("\nTesting Google Search grounding…")
try:
    text, sources = g.grounded_search("Name two popular baby food brands in India.")
    print(f"  Works: {len(sources)} sources, e.g. {sources[0]['url'] if sources else '(none)'}")
except g.GeminiError as e:
    print(f"  Not available with this key ({str(e)[:160]}). Blogs will still be written, without web research.")

print(f"\nAll set. Optional: pin these in backend/.env to skip auto-detection:\n"
      f"  GEMINI_ENDPOINT={g._state['endpoint']}\n  WRITER_MODEL={model}")
