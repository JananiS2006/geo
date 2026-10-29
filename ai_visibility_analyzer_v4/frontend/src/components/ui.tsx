import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn, scoreTone, TONE_HEX } from "../lib/utils";

export function ScoreRing({ value, label, hint, size = 92 }: { value: number | null; label: string; hint: string; size?: number }) {
  const r = (size - 12) / 2, c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = TONE_HEX[scoreTone(v)];
  return (
    <div className="panel flex items-center gap-4 p-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EEF0F6" strokeWidth={9} />
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={9} strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} opacity={value === null ? 0 : 1} style={{ transition: "stroke-dashoffset .8s ease" }} />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center leading-none">
          <span className="tnum text-2xl font-extrabold">{value ?? "–"}</span>
          {value !== null && <span className="sr-only">out of 100</span>}
        </div>
      </div>
      <div>
        <div className="font-bold">{label}</div>
        <p className="mt-0.5 text-sm text-ink-soft">{hint}</p>
      </div>
    </div>
  );
}

const BADGE = {
  yes: "bg-green-50 text-green-700", no: "bg-slate-100 text-slate-500",
  high: "bg-rose-50 text-rose-600", medium: "bg-amber-50 text-amber-700", low: "bg-green-50 text-green-700",
  Positive: "bg-green-50 text-green-700", Neutral: "bg-slate-100 text-slate-600", Negative: "bg-rose-50 text-rose-600",
  brand: "bg-brand-tint text-brand-dark", rival: "bg-rival-tint text-teal-700", plain: "bg-canvas text-ink-soft border border-line",
} as const;

export function Badge({ tone = "plain", children, className }: { tone?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn("chip", BADGE[tone], className)}>{children}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-white/70 p-1">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition",
            value === t.id ? "bg-white text-ink shadow-card" : "text-ink-soft hover:text-ink")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 tnum text-xs text-ink-faint">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: { to: string; label: string } }) {
  return (
    <div className="panel mx-auto max-w-lg p-10 text-center">
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-sm text-ink-soft">{body}</p>
      {action && <Link to={action.to} className="btn-primary mt-5">{action.label}</Link>}
    </div>
  );
}

export function DemoBanner({ result }: { result: { mode: string; mock_answers?: number; query_results: unknown[] } }) {
  const offline = result.mode === "demo" && result.mock_answers === undefined;
  const partial = !!result.mock_answers && result.mode !== "demo";
  if (!offline && result.mode !== "demo" && !partial) return null;
  const msg = offline
    ? "Demo data. The backend at /api didn't respond, so these numbers are simulated. Start the FastAPI server and run the analysis again."
    : partial
      ? `${result.mock_answers} of the AI answers are simulated because some assistants have no API key set. Add the missing keys for fully live results.`
      : "Simulated answers. No assistant API keys are set on the backend, so every answer was generated locally. Add keys to the backend for live results.";
  return <div className="no-print mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">{msg}</div>;
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {sub && <p className="text-sm text-ink-soft">{sub}</p>}
      </div>
      {right}
    </div>
  );
}
