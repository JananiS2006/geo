# AI Visibility Analyzer v4

## Quick start on Windows (easiest)
1. Right-click the zip, choose **Extract All**, and extract it to your Desktop.
   You should get `Desktop\ai_visibility_analyzer_v4\` with `backend` and `frontend` inside.
2. Double-click **`1_start_backend.bat`**. On the first run it creates the Python environment, installs packages,
   checks your Gemini key, starts the server and opens the app at **http://localhost:8000**. Keep the window open.

That's all you need: the built React app is included in `backend/static` and served by the backend.
`2_start_frontend.bat` (React dev server on port 5173) is only for changing the frontend code.

You need **Python 3.10+** (python.org; tick "Add python.exe to PATH" during setup). Node.js LTS is only needed
to edit the frontend.
API keys go in `backend\.env`. Never share or upload that file.

## Manual start (any OS)
Backend:
```
cd backend
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt      (macOS/Linux: .venv/bin/python)
.venv\Scripts\python.exe check_gemini.py
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```
Frontend:
```
cd frontend
npm install
npm run dev
```

---


## Deploy to Vercel
The backend folder deploys as one Vercel project: FastAPI serves both the API and the built React app.

**Before deploying:** if you changed the frontend, rebuild it into the backend: `cd frontend`, `npm run build:backend`.

**Option A: Vercel CLI (no GitHub needed)**
```
npm install -g vercel
cd backend
vercel                      # log in, accept the defaults; creates the project and a preview URL
vercel env add GEMINI_API_KEY        # paste your key; choose Production (and Preview)
vercel env add WRITER_PROVIDER       # type: gemini
vercel --prod               # deploy to your production URL
```

**Option B: GitHub**
Push the project to GitHub (`.gitignore` keeps `.env` out), then in vercel.com: **Add New → Project**, import the
repository, set **Root Directory** to `backend`, add `GEMINI_API_KEY` and `WRITER_PROVIDER=gemini` under
**Environment Variables**, and click **Deploy**.

**Notes**
- Keys are set in Vercel's Environment Variables, never uploaded: `backend/.vercelignore` excludes `.env`.
  After changing a variable, redeploy for it to take effect.
- `backend/vercel.json` allows each request up to 300 seconds, enough for an analysis or a blog. If your plan
  rejects that value, lower `maxDuration`, and use fewer prompts per keyword.
- Your deployed URL is public, and every visit uses your API quota. Share it only with people you trust, or turn
  on Deployment Protection in the Vercel project settings.
- Check a deployment at `https://<your-project>.vercel.app/api/health`.

## What's in this folder
```
backend/app/
  llm_writer.py, query_generator.py, citation_gap.py, content_advisor.py   # advisor
  blog_writer.py               # Content Studio: multi-step, streamed article writer
  listing_finder.py            # where to get listed: web search + AI + niche/region matching
  result_builder.py            # turns raw AI answers into the JSON the React app reads
  routes/analyze_v2.py         # complete /api/analyze (4 assistants, crawl, scoring, advisor)
  routes/advisor.py            # /api/queries/generate, /api/advisor/blog, /api/advisor/status ...
frontend/                      # React + Vite + TypeScript + Tailwind
  src/pages/NewAnalysis.tsx    # form, prompt-depth controls, prompt preview, progress
  src/pages/Dashboard.tsx      # scores, per-assistant chart, GEO breakdown, 5 tabs
  src/pages/Competitors.tsx    # side-by-side scores, ranking, share of voice
  src/pages/ContentStudio.tsx  # AI blog writer
  src/lib/types.ts             # the API contract (matches result_builder.py)
```

## Data modes (always labelled in the UI)
| Situation | What you see |
|---|---|
| Backend running with keys | Live results |
| Some keys missing | Live results + banner saying how many answers were simulated |
| No keys | Full pipeline on simulated answers, banner says so |
| Backend not running | Frontend demo data, banner says so |

For the review, run with real keys so the panel sees live answers.

## Using your own modules instead
`analyze_v2.py` has its own lightweight crawler and REST clients so it runs out of the box.
To use your existing `llm_clients.py`, `crawler.py` and `geo_scorer.py`, replace
`ask_provider()` and `crawl_signals()` in `analyze_v2.py`. Nothing else needs to change.

## Scoring (matches the deck)
AI Visibility = 70% mention rate + 30% citation rate + sentiment bonus (±8), computed on
discovery prompts only (prompts that never name the brand). Branded prompts are used for
sentiment only. With repeats > 1, each answer uses the majority outcome and the dashboard
shows a stability percentage.

## Content Studio (blog writer)
Writes a real article in five streamed steps, shown live in the UI:
1. **Reads your website** (homepage + up to 3 about/product/pricing pages) and extracts brand facts.
2. **Researches the topic** with Perplexity and keeps the source URLs (needs `PERPLEXITY_API_KEY`).
3. **Plans** an outline for the chosen article type: listicle, honest assessment, comparison, how-to or buyer's guide
   ("Auto" picks one from the question).
4. **Writes** the intro, every section and the conclusion in parallel; each section appears as soon as it's ready.
5. **Checks** keyword placement, the GEO checklist, unverified facts, and builds the FAQ JSON-LD.

The writer may only state facts found on your site or in the research; anything else becomes a highlighted
`[STAT: ...]` placeholder. Hover any section to rewrite it ("make it shorter", "add an example", or your own
instruction) and undo if needed.

A real article needs a writer key (`WRITER_PROVIDER` + its key). Without one the studio shows a labelled offline
template. Endpoints: `POST /api/advisor/blog/stream` (NDJSON events), `POST /api/advisor/blog/rewrite`.
Tune with `WRITER_MODEL` and `WRITER_WORKERS` (parallel section writers, default 4).

## Where to get listed (input-driven)
Two lists, both built from the analysis input:
- **Observed**: sites the AI assistants actually cited in this run when competitors won (live answers only;
  simulated answers never invent citations).
- **Where else to get listed**: ranked from three sources: a live Perplexity web search about where people
  research your keywords in your region, AI suggestions from the writer model (domains validated), and an
  offline niche match (baby products, food, software, health, education, travel, fashion and beauty, finance,
  local services) with India-specific or global platforms. Sites found by more than one method rank higher, and
  each card shows which methods found it and why it matters.

Brand matching also accepts spacing variants (slurrpfarm.com matches "Slurrp Farm").

## Gemini setup and blog quality
`app/gemini_client.py` is shared by the analyzer, advisor and blog writer. It auto-detects the endpoint
(Google AI Studio or Vertex AI express), falls back through current models (2.5 Pro → 2.5 Flash → latest
aliases) when one is retired or out of free-tier quota, retries rate limits, and sends the key in a header,
never in the URL. With only a Gemini key, Google Search grounding provides the web research and sources for
blogs and for "where to get listed".

Blog quality steps: brand facts from your site → web research with sources → an outline where every section has
a distinct job, a concrete example and assigned facts → sections written against a style example → an editor
pass over the whole article that removes repetition and smooths flow (rejected automatically if it breaks
structure, links or length). Turn the editor off per request with `"edit_pass": false`.

Never commit `backend/.env`; it holds your keys.
