import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, DemoBanner, Empty, SectionTitle } from "../components/ui";
import { useStore } from "../lib/store";
import { cn } from "../lib/utils";

export default function Competitors() {
  const { current: a } = useStore();
  if (!a) return <Empty title="No analysis yet" body="Run an analysis with at least one competitor to compare." action={{ to: "/", label: "Start an analysis" }} />;
  const rows = [...a.competitors].sort((x, y) => y.ai_visibility - x.ai_visibility);
  const chart = a.competitors.map((c) => ({ name: c.domain, "AI Visibility": c.ai_visibility, GEO: c.geo, SEO: c.seo }));
  const you = a.competitors.find((c) => c.is_you);
  const seoLeader = [...a.competitors].sort((x, y) => y.seo - x.seo)[0];
  const aiLeader = rows[0];

  return (
    <div>
      <DemoBanner result={a} />
      <h1 className="text-3xl font-extrabold tracking-tight">Competitor comparison</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-soft">
        {aiLeader.is_you ? "You lead on AI visibility in this set." : `${aiLeader.domain} is mentioned most often by AI assistants.`}{" "}
        {seoLeader.domain !== aiLeader.domain && `${seoLeader.domain} has the strongest SEO, yet isn't the most visible in AI answers. Ranking well on Google doesn't guarantee being recommended by AI.`}
      </p>

      <section className="panel mt-6 p-5">
        <SectionTitle title="Scores side by side" />
        <div className="h-80">
          <ResponsiveContainer>
            <BarChart data={chart} margin={{ left: -20 }}>
              <CartesianGrid vertical={false} stroke="#EEF0F6" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
              <YAxis domain={[0, 100]} tickLine={false} axisLine={false} fontSize={12} />
              <Tooltip cursor={{ fill: "#F4F5FB" }} contentStyle={{ borderRadius: 12, border: "1px solid #E6E6F0" }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey="AI Visibility" fill="#5458E8" radius={[6, 6, 0, 0]} />
              <Bar dataKey="GEO" fill="#B44BD8" radius={[6, 6, 0, 0]} />
              <Bar dataKey="SEO" fill="#14B8A6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="panel overflow-x-auto p-5">
          <SectionTitle title="Ranking by AI visibility" />
          <table className="w-full min-w-[520px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-faint">
              <th className="py-2 font-semibold">#</th><th className="font-semibold">Website</th><th className="font-semibold">AI Visibility</th><th className="font-semibold">GEO</th><th className="font-semibold">SEO</th><th className="font-semibold">Share of voice</th>
            </tr></thead>
            <tbody>
              {rows.map((c, i) => (
                <tr key={c.domain} className={cn("border-b border-line/60 last:border-0", c.is_you && "bg-brand-tint/50")}>
                  <td className="py-3 tnum text-ink-faint">{i + 1}</td>
                  <td className="font-semibold">{c.domain} {c.is_you && <Badge tone="brand" className="ml-1">You</Badge>}</td>
                  <td className="tnum font-bold">{c.ai_visibility}</td><td className="tnum">{c.geo}</td><td className="tnum">{c.seo}</td>
                  <td className="tnum">{c.share_of_voice}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel p-5">
          <SectionTitle title="Share of voice" sub="Share of all brand mentions across discovery answers" />
          <div className="flex h-5 overflow-hidden rounded-full">
            {a.competitors.map((c, i) => (
              <div key={c.domain} title={`${c.domain}: ${c.share_of_voice}%`} style={{ width: `${c.share_of_voice}%`, background: c.is_you ? "#5458E8" : ["#14B8A6", "#5EEAD4", "#0F766E", "#99F6E4", "#2DD4BF"][i % 5] }} />
            ))}
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {a.competitors.map((c, i) => (
              <li key={c.domain} className="flex items-center justify-between">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.is_you ? "#5458E8" : ["#14B8A6", "#5EEAD4", "#0F766E", "#99F6E4", "#2DD4BF"][i % 5] }} />{c.domain}</span>
                <span className="tnum font-semibold">{c.share_of_voice}%</span>
              </li>
            ))}
          </ul>
          {you && <p className="mt-4 border-t border-line pt-3 text-xs text-ink-faint">Your GEO score is {you.geo}. Use the recommendations on the dashboard to raise it.</p>}
        </div>
      </section>
    </div>
  );
}
