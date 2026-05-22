import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { formatCad, formatWarranty, asNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function VehicleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const model = await prisma.model.findUnique({
    where: { slug },
    include: {
      brand: true,
      ownershipCosts: { orderBy: { year: "desc" } },
      warranties: { orderBy: { coverageType: "asc" } },
      trims: {
        include: { powertrain: true },
        orderBy: [{ year: "desc" }, { msrpCad: "asc" }],
      },
      prosCons: { orderBy: [{ isPro: "desc" }, { weight: "desc" }] },
      commonIssues: { orderBy: [{ severity: "desc" }, { mentionCount: "desc" }] },
      externalMentions: {
        where: { platform: "REDDIT" },
        orderBy: [{ upvotes: "desc" }],
        take: 10,
      },
    },
  });
  if (!model) notFound();

  const brandFeatured = model.brand?.isFeatured;
  const featuredBar = brandFeatured
    ? model.brand?.slug === "toyota" ? "bg-toyota" : "bg-lexus-accent"
    : "bg-zinc-700";

  const latestCosts = model.ownershipCosts[0];
  const pros = model.prosCons.filter((p) => p.isPro);
  const cons = model.prosCons.filter((p) => !p.isPro);

  return (
    <>
      <div className={`h-1 ${featuredBar}`} />
      <section className="border-b border-ink-700">
        <div className="max-w-7xl mx-auto px-4 py-8">
          {model.brand && (
            <Link href={`/brands/${model.brand.slug}`} className="text-zinc-500 text-sm hover:text-zinc-300">
              ← {model.brand.name}
            </Link>
          )}
          <div className="flex items-baseline justify-between gap-4 mt-2">
            <h1 className="text-4xl font-bold text-white">
              {model.brand?.name && <span className="text-zinc-500 font-normal mr-2">{model.brand.name}</span>}
              {model.name}
            </h1>
            <div className="text-right">
              <p className="text-3xl font-mono text-toyota">{model.startingMsrpCad ? `from ${formatCad(asNumber(model.startingMsrpCad)!)}` : "MSRP —"}</p>
              <p className="text-xs text-zinc-500">starting MSRP, Ontario</p>
            </div>
          </div>
          <p className="text-zinc-400 mt-1">
            {model.bodyStyle}{model.segment && ` · ${model.segment}`}
          </p>
          {model.notesMd && (
            <p className="mt-4 max-w-3xl text-zinc-300 leading-relaxed">{model.notesMd}</p>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href={`/compare?slugs=${model.slug}`}
              className="px-4 py-1.5 bg-toyota text-white text-sm font-semibold rounded hover:bg-toyota-dark"
            >
              Add to compare →
            </Link>
            <Link
              href={`/vehicles?segment=${encodeURIComponent(model.segment ?? "")}`}
              className="px-4 py-1.5 bg-ink-700 text-zinc-100 text-sm rounded hover:bg-ink-700/70"
            >
              Other {model.segment ?? "vehicles"}
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Pros / cons */}
          {(pros.length > 0 || cons.length > 0) && (
            <Card title="Pros and cons">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-emerald-400 font-semibold mb-2">Pros</h4>
                  <ul className="space-y-2 text-sm">
                    {pros.length === 0 && <li className="text-zinc-500">No pros recorded yet.</li>}
                    {pros.map((p) => (
                      <li key={p.id} className="flex gap-2 text-zinc-200">
                        <span className="text-emerald-500">+</span>
                        <span>{p.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs uppercase tracking-wider text-amber-400 font-semibold mb-2">Cons</h4>
                  <ul className="space-y-2 text-sm">
                    {cons.length === 0 && <li className="text-zinc-500">No cons recorded yet.</li>}
                    {cons.map((p) => (
                      <li key={p.id} className="flex gap-2 text-zinc-200">
                        <span className="text-amber-500">−</span>
                        <span>{p.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}

          {/* Trims */}
          {model.trims.length > 0 && (
            <Card title={`Trims (${model.trims.length})`}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-ink-700">
                    <th className="py-2 pr-3">Trim</th>
                    <th className="py-2 pr-3">Year</th>
                    <th className="py-2 pr-3">Powertrain</th>
                    <th className="py-2 pr-3">Drivetrain</th>
                    <th className="py-2 pr-3 text-right">MSRP</th>
                  </tr>
                </thead>
                <tbody>
                  {model.trims.map((t) => (
                    <tr key={t.id} className="border-b border-ink-700/40">
                      <td className="py-2 pr-3 text-zinc-200">{t.name}</td>
                      <td className="py-2 pr-3 text-zinc-400">{t.year}</td>
                      <td className="py-2 pr-3 text-zinc-300">{t.powertrain.displayName}</td>
                      <td className="py-2 pr-3 text-zinc-400">{t.powertrain.drivetrain ?? "—"}</td>
                      <td className="py-2 pr-3 text-right font-mono text-toyota">{formatCad(asNumber(t.msrpCad)!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Common issues */}
          <Card title={`Known issues (${model.commonIssues.length})`}>
            {model.commonIssues.length === 0 ? (
              <p className="text-sm text-zinc-500">No specific issues on record for this model. Reddit mentions are still cross-referenced below.</p>
            ) : (
              <ul className="space-y-3">
                {model.commonIssues.map((issue) => (
                  <li key={issue.id} className="border-l-4 pl-3 py-1 border-l-amber-500/60">
                    <div className="flex items-baseline justify-between gap-2">
                      <h4 className="text-zinc-100 font-medium text-sm">{issue.title}</h4>
                      <SeverityPill severity={issue.severity} status={issue.status} />
                    </div>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Affected years: {issue.yearsAffected.join(", ") || "—"} · {issue.mentionCount} mention{issue.mentionCount === 1 ? "" : "s"}
                      {issue.recallId && <> · recall <span className="text-zinc-300 font-mono">{issue.recallId}</span></>}
                    </p>
                    <p className="text-sm text-zinc-300 mt-1">{issue.description}</p>
                    {issue.sourceUrl && (
                      <a href={issue.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 underline hover:text-zinc-300">source</a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Reddit mentions */}
          {model.externalMentions.length > 0 && (
            <Card title={`Reddit discussions (${model.externalMentions.length})`}>
              <ul className="space-y-2">
                {model.externalMentions.map((m) => (
                  <li key={m.id} className="text-sm">
                    <a href={m.url} target="_blank" rel="noreferrer" className="text-zinc-100 hover:text-toyota underline-offset-2 hover:underline">{m.title}</a>
                    <p className="text-xs text-zinc-500">
                      r/{m.subreddit ?? "—"} · ▲ {m.upvotes ?? 0}
                      {m.sentiment && <> · <SentimentTag s={m.sentiment} /></>}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {/* Warranty */}
          <Card title="Warranty">
            {model.warranties.length === 0 && model.brand ? (
              <dl className="text-sm space-y-1.5">
                <Row label="Basic" v={formatWarranty(model.brand.basicWarrantyMonths, model.brand.basicWarrantyKm)} />
                <Row label="Powertrain" v={formatWarranty(model.brand.powertrainWarrantyMonths, model.brand.powertrainWarrantyKm)} />
                <Row label="Hybrid components" v={formatWarranty(model.brand.hybridComponentMonths, model.brand.hybridComponentKm)} />
                <Row label="Hybrid battery" v={formatWarranty(model.brand.hybridBatteryMonths, model.brand.hybridBatteryKm)} />
                <Row label="Corrosion" v={formatWarranty(model.brand.corrosionMonths, model.brand.corrosionKm)} />
                <Row label="Roadside" v={formatWarranty(model.brand.roadsideMonths, model.brand.roadsideKm)} />
                <p className="text-xs text-zinc-500 mt-2 pt-2 border-t border-ink-700">Brand-default coverage (no model-specific override on file).</p>
              </dl>
            ) : (
              <dl className="text-sm space-y-1.5">
                {model.warranties.map((w) => (
                  <Row
                    key={w.id}
                    label={w.coverageType.replace(/_/g, " ").toLowerCase()}
                    v={formatWarranty(w.durationMonths, w.distanceKm)}
                  />
                ))}
              </dl>
            )}
          </Card>

          {/* Ownership cost */}
          {latestCosts && (
            <Card title={`Ownership cost (${latestCosts.year})`}>
              <dl className="text-sm space-y-1.5">
                <Row label="Tire size (front)" v={latestCosts.tireFrontSize ?? "—"} />
                {latestCosts.tireRearSize && latestCosts.tireRearSize !== latestCosts.tireFrontSize && (
                  <Row label="Tire size (rear)" v={latestCosts.tireRearSize} />
                )}
                <Row label="Tire set (est.)" v={asNumber(latestCosts.estTireSetCad) ? formatCad(asNumber(latestCosts.estTireSetCad)!) : "—"} />
                {latestCosts.estWinterTireSetCad && <Row label="Winter set (est.)" v={formatCad(asNumber(latestCosts.estWinterTireSetCad)!)} />}
                <Row label="Oil type" v={latestCosts.oilType ?? "—"} />
                <Row label="Oil change (est.)" v={asNumber(latestCosts.estOilChangeCad) ? formatCad(asNumber(latestCosts.estOilChangeCad)!) : "—"} />
                <Row label="Service interval" v={latestCosts.oilChangeIntervalKm ? `${latestCosts.oilChangeIntervalKm.toLocaleString()} km` : "—"} />
                <Row label="Brake job (front)" v={asNumber(latestCosts.brakeJobFrontCad) ? formatCad(asNumber(latestCosts.brakeJobFrontCad)!) : "—"} />
                <Row label="Brake job (rear)" v={asNumber(latestCosts.brakeJobRearCad) ? formatCad(asNumber(latestCosts.brakeJobRearCad)!) : "—"} />
                <Row label="Dealer labour /hr" v={asNumber(latestCosts.dealerLabourRateCad) ? formatCad(asNumber(latestCosts.dealerLabourRateCad)!) : "—"} />
                <Row label="Indie labour /hr" v={asNumber(latestCosts.indieLabourRateCad) ? formatCad(asNumber(latestCosts.indieLabourRateCad)!) : "—"} />
                {latestCosts.includedMaintenanceMonths && (
                  <Row label="Free maintenance" v={`${Math.round(latestCosts.includedMaintenanceMonths / 12)} yr / ${latestCosts.includedMaintenanceKm?.toLocaleString() ?? "—"} km`} />
                )}
                {latestCosts.fiveYearOwnershipCostCad && (
                  <Row label="5-yr ownership (est.)" v={formatCad(asNumber(latestCosts.fiveYearOwnershipCostCad)!)} />
                )}
              </dl>
              {latestCosts.includedMaintenanceNotes && (
                <p className="text-xs text-zinc-500 mt-3 italic">{latestCosts.includedMaintenanceNotes}</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-ink-800 border border-ink-700 rounded-lg p-5">
      <h3 className="text-base font-semibold text-white mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 capitalize">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-200 normal-case">{v}</dd>
    </div>
  );
}

function SeverityPill({ severity, status }: { severity: string; status: string }) {
  const colors: Record<string, string> = {
    LOW: "bg-zinc-700 text-zinc-300",
    MEDIUM: "bg-amber-900/40 text-amber-300",
    HIGH: "bg-orange-900/40 text-orange-300",
    CRITICAL: "bg-red-900/50 text-red-300",
  };
  return (
    <span className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${colors[severity] ?? colors.LOW}`}>
      {severity}{status && status !== "REPORTED" && ` · ${status.toLowerCase().replace(/_/g, " ")}`}
    </span>
  );
}

function SentimentTag({ s }: { s: string }) {
  const colors: Record<string, string> = {
    POSITIVE: "text-emerald-400",
    NEGATIVE: "text-amber-400",
    NEUTRAL: "text-zinc-400",
    MIXED: "text-sky-400",
  };
  return <span className={colors[s] ?? "text-zinc-400"}>{s.toLowerCase()}</span>;
}
