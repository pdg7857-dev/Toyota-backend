import { prisma } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

const SEVERITY_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export default async function IssuesPage() {
  const issues = await prisma.commonIssue.findMany({
    include: { model: { include: { brand: true } }, brand: true },
    orderBy: [{ severity: "desc" }, { mentionCount: "desc" }],
  });

  const sorted = [...issues].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity as keyof typeof SEVERITY_ORDER] ?? 9;
    const sb = SEVERITY_ORDER[b.severity as keyof typeof SEVERITY_ORDER] ?? 9;
    if (sa !== sb) return sa - sb;
    return b.mentionCount - a.mentionCount;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold text-white mb-1">Known issues across all brands</h1>
      <p className="text-sm text-zinc-500 mb-6">
        {sorted.length} issues on record. Sorted by severity, then mention count. Sourced from Transport Canada recalls and Reddit owner threads.
      </p>

      <div className="space-y-3">
        {sorted.map((issue) => {
          const target = issue.model
            ? { slug: issue.model.slug, label: `${issue.model.brand?.name ?? ""} ${issue.model.name}` }
            : issue.brand
            ? { slug: undefined, label: `${issue.brand.name} (brand-wide)` }
            : { slug: undefined, label: "Unknown vehicle" };
          return (
            <div key={issue.id} className="p-4 bg-ink-800 border border-ink-700 rounded-lg">
              <div className="flex items-baseline justify-between gap-3 flex-wrap">
                <div className="flex items-baseline gap-2">
                  <SeverityChip severity={issue.severity} />
                  {target.slug ? (
                    <Link href={`/vehicles/${target.slug}`} className="text-zinc-100 hover:text-toyota font-medium">{target.label}</Link>
                  ) : (
                    <span className="text-zinc-100 font-medium">{target.label}</span>
                  )}
                </div>
                <div className="text-xs text-zinc-500">
                  {issue.yearsAffected.join(", ")} · {issue.mentionCount} mention{issue.mentionCount === 1 ? "" : "s"}
                  {issue.recallId && <> · <span className="text-zinc-300 font-mono">{issue.recallId}</span></>}
                </div>
              </div>
              <h3 className="mt-2 text-sm font-semibold text-zinc-200">{issue.title}</h3>
              <p className="text-sm text-zinc-400 mt-1">{issue.description}</p>
              {issue.sourceUrl && (
                <a href={issue.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline hover:text-zinc-300">
                  source
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeverityChip({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    LOW: "bg-zinc-700 text-zinc-300",
    MEDIUM: "bg-amber-900/40 text-amber-300",
    HIGH: "bg-orange-900/50 text-orange-200",
    CRITICAL: "bg-red-900/60 text-red-200",
  };
  return <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded ${colors[severity] ?? colors.LOW}`}>{severity}</span>;
}
