"""
AI Visibility Analyzer v4 - FastAPI entry point.

Local:   python -m uvicorn app.main:app --reload --port 8000   (then open http://localhost:8000)
Vercel:  deploy the backend folder; Vercel detects this file automatically.
API docs: /docs   Health check: /api/health
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
# Load API keys from backend/.env when running locally. On Vercel, keys come from Environment Variables.
load_dotenv(BACKEND_DIR / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from app.llm_writer import TextGenerator  # noqa: E402
from app.routes import advisor, analyze_v2  # noqa: E402

app = FastAPI(title="AI Visibility Analyzer", version="4.0")

# Only needed when the React dev server (port 5173) calls the API directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analyze_v2.router)
app.include_router(advisor.router)


@app.get("/api/health")
def health():
    keys = {name: bool(os.getenv(env)) for name, env in [
        ("ChatGPT", "OPENAI_API_KEY"), ("Gemini", "GEMINI_API_KEY"),
        ("Perplexity", "PERPLEXITY_API_KEY"), ("Claude", "ANTHROPIC_API_KEY")]}
    w = TextGenerator()
    return {"status": "ok", "assistants_with_keys": keys,
            "writer": f"{w.provider} ({'ready' if w.available else 'no key: offline template'})",
            "docs": "/docs"}


# ---------------------------------------------------------------------------
# Serve the built React app (backend/static) from the same URL as the API.
# Build it with:  cd frontend && npm run build:backend
# ---------------------------------------------------------------------------
STATIC_DIR = BACKEND_DIR / "static"

if (STATIC_DIR / "index.html").exists():
    if (STATIC_DIR / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        if full_path.startswith(("api/", "docs", "openapi.json", "redoc")):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        file = (STATIC_DIR / full_path).resolve()
        if full_path and file.is_file() and STATIC_DIR in file.parents:
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")  # client-side routes like /dashboard
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {**health(), "note": "Frontend not built. Run `npm run build:backend` in the frontend folder, "
                                    "or start the dev server with `npm run dev`."}
