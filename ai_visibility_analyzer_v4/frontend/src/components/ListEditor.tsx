import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";

export default function ListEditor({ label, items, onChange, max, placeholder, icon }: {
  label: string; items: string[]; onChange: (v: string[]) => void; max: number; placeholder: string; icon?: ReactNode;
}) {
  const set = (i: number, v: string) => onChange(items.map((x, j) => (j === i ? v : x)));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="label mb-0">{label} <span className="font-normal text-ink-faint tnum">({items.length}/{max})</span></span>
        <button type="button" disabled={items.length >= max} onClick={() => onChange([...items, ""])}
          className="inline-flex items-center gap-1 text-sm font-semibold text-brand disabled:opacity-40">
          <Plus size={14} /> Add
        </button>
      </div>
      <div className="space-y-2">
        {items.map((v, i) => (
          <div key={i} className="flex gap-2">
            <div className="relative flex-1">
              {icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">{icon}</span>}
              <input className={`field ${icon ? "pl-9" : ""}`} value={v} placeholder={placeholder} aria-label={`${label} ${i + 1}`}
                onChange={(e) => set(i, e.target.value)} />
            </div>
            <button type="button" aria-label={`Remove ${label} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="grid w-10 shrink-0 place-items-center rounded-xl border border-line bg-white text-ink-faint hover:text-bad">
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
