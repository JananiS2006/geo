"""
New API endpoints. Register in main.py:
    from app.routes import advisor
    app.include_router(advisor.router)
"""
import json
import os
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..blog_writer import ARTICLE_TYPES, generate_blog_events, rewrite_part, write_blog_v2
from ..content_advisor import citation_gaps_with_suggestions, run_advisor
from ..llm_writer import TextGenerator
from ..query_generator import estimate_api_calls, generate_queries

router = APIRouter(prefix="/api", tags=["advisor"])


class QueryGenRequest(BaseModel):
    url: str
    keywords: List[str]
    competitors: List[str] = []
    industry: Optional[str] = None
    region: Optional[str] = None
    per_keyword: int = Field(8, ge=1, le=15)
    branded_per_keyword: int = Field(2, ge=0, le=4)
    llm_expand: int = Field(0, ge=0, le=10)
    providers: int = Field(3, ge=1, le=5)
    repeats: int = Field(1, ge=1, le=5)


class LLMResponseIn(BaseModel):
    provider: str
    query: str
    text: str
    citations: List[str] = []
    keyword: Optional[str] = None


class AdvisorRequest(BaseModel):
    url: str
    competitors: List[str] = []
    industry: str = ""
    keywords: List[str] = []
    region: Optional[str] = None
    scores: Dict[str, float] = {}
    signals: Dict = {}
    responses: List[LLMResponseIn]


class BlogRequest(BaseModel):
    topic: str
    url: str
    keywords: List[str]
    industry: str = ""
    competitors: List[str] = []
    audience: str = ""
    tone: str = "helpful and expert"
    target_words: int = Field(1500, ge=600, le=3500)
    article_type: str = "auto"      # auto | listicle | honest_assessment | comparison | how_to | buyers_guide
    use_research: bool = True       # web research with sources (Perplexity, or Gemini with Google Search)
    edit_pass: bool = True          # final editor pass over the whole article
    region: Optional[str] = None


class RewriteRequest(BaseModel):
    markdown: str
    instruction: str
    title: str
    url: str


@router.post("/queries/generate")
def queries_generate(req: QueryGenRequest):
    qs = generate_queries(req.keywords, req.url, req.competitors, req.industry, req.region,
                          req.per_keyword, req.branded_per_keyword, req.llm_expand, TextGenerator())
    return {
        "count": len(qs),
        "discovery": sum(q.family == "discovery" for q in qs),
        "branded": sum(q.family == "branded" for q in qs),
        "estimated_api_calls": estimate_api_calls(len(qs), req.providers, req.repeats),
        "queries": [q.to_dict() for q in qs],
    }


@router.post("/advisor/run")
def advisor_run(req: AdvisorRequest):
    return run_advisor([r.model_dump() for r in req.responses], req.url, req.competitors,
                       req.industry, req.keywords, req.scores, req.signals, region=req.region or "")


@router.post("/advisor/citation-gaps")
def advisor_citation_gaps(req: AdvisorRequest):
    return citation_gaps_with_suggestions([r.model_dump() for r in req.responses], req.url, req.competitors,
                                          req.industry, req.keywords, req.region or "")


@router.post("/advisor/blog")
def advisor_blog(req: BlogRequest):
    return write_blog_v2(req.model_dump())


@router.post("/advisor/blog/stream")
def advisor_blog_stream(req: BlogRequest):
    """Newline-delimited JSON events: status, brand, research, plan, part (one per section), done."""
    def events():
        try:
            for ev in generate_blog_events(req.model_dump()):
                yield json.dumps(ev, ensure_ascii=False) + "\n"
        except Exception as e:  # surface the failure to the UI instead of a broken stream
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"
    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/advisor/blog/rewrite")
def advisor_blog_rewrite(req: RewriteRequest):
    try:
        return {"markdown": rewrite_part(req.markdown, req.instruction, req.title, req.url)}
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/advisor/status")
def advisor_status():
    g = TextGenerator()
    return {"writer_provider": g.provider, "model": g.model, "mode": "live" if g.available else "mock",
            "research": bool(os.getenv("PERPLEXITY_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
            "article_types": {k: v["label"] for k, v in ARTICLE_TYPES.items()}}
